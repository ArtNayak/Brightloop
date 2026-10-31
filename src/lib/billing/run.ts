import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calcInvoice, type CalcResult, type Disc, type Line } from "./calc";
import { addPeriod, isDiscountActive, runLifecycle } from "./deps";
import { dueDateFor } from "./terms";

const CHUNK = 200;
const MAX_PERIODS_PER_RUN = 24; // ponytail: catch-up cap per subscription per run, the next run continues
const MAX_NUMBER_RETRIES = 5;

export type BillingSummary = {
  created: number; // invoices created
  alreadyBilled: number; // subscriptions whose due period already had an invoice (or another run got there first)
  skipped: number; // subscriptions with nothing to bill right now
  failed: { subscription: string; error: string }[];
};

type Tx = Prisma.TransactionClient;
type Outcome = { created: number; alreadyBilled: boolean; skipped: boolean };

/** Subscriptions the billing run picks up. */
export function dueWhere(now: Date): Prisma.SubscriptionWhereInput {
  return { status: "ACTIVE", paused: false, nextBillingDate: { lte: now } };
}

// ---------- invoice numbers (D6) ----------
// Allocated from an in-memory counter seeded with MAX(number) so a run doesn't scan the table per invoice.
// A rolled-back subscription gives its numbers back (no gaps); a collision with another writer re-reads the max.
const formatNumber = (n: number) => `INV-${String(n).padStart(4, "0")}`;

class InvoiceNumbers {
  private last: number | null = null;

  async next(tx: Tx) {
    if (this.last === null) {
      const rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(SUBSTRING(number FROM 5) AS INTEGER)) AS max FROM "Invoice" WHERE number ~ '^INV-[0-9]+$'`;
      this.last = rows[0]?.max ?? 0;
    }
    return formatNumber(++this.last);
  }
  snapshot = () => this.last;
  restore = (s: number | null) => void (this.last = s);
  reset = () => void (this.last = null);
}

// Thrown inside a transaction when another run moved the subscription first; rolls everything back.
class AlreadyBilled extends Error {}

function uniqueTarget(e: unknown): string | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  return String((e.meta as { target?: unknown } | undefined)?.target ?? "");
}

/**
 * What the API tells the client about a failed subscription. Our own errors (e.g. unknown payment terms) are
 * safe to show; database/driver errors can carry hostnames, table names or query text, so they're reduced to a
 * code. The full error always goes to the server log.
 */
export function describeFailure(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `Database error (${e.code})`;
  if (e && typeof e === "object" && e.constructor.name.startsWith("PrismaClient")) return "Database error";
  return e instanceof Error ? e.message.trim().split("\n").filter(Boolean).pop() ?? "Unknown error" : "Unknown error";
}

// ---------- discounts ----------
const toDisc = (d: Prisma.DiscountGetPayload<object>): Disc => ({
  id: d.id,
  type: d.type,
  value: d.value,
  minPurchase: d.minPurchase,
  minQuantity: d.minQuantity,
  scope: d.scope,
  productId: d.productId,
});

/**
 * Calculates the invoice and reserves one usage of each discount that applies. A reservation is a guarded
 * UPDATE, so if a limited discount ran out meanwhile (another subscription, another run) we recalculate without it.
 * Reservations live in the caller's transaction: if the invoice isn't created they roll back with it.
 */
async function calcWithDiscounts(tx: Tx, lines: Line[], productIds: string[], subscriptionId: string, now: Date): Promise<CalcResult> {
  const found = await tx.discount.findMany({
    where: {
      AND: [
        { startDate: { lte: now } },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
        {
          OR: [
            { scope: "PRODUCT", productId: { in: productIds } },
            { scope: "SUBSCRIPTION", OR: [{ subscriptionId }, { subscriptionId: null }] },
          ],
        },
      ],
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const candidates = found.filter((d) => isDiscountActive(d, now));
  const byId = new Map(candidates.map((d) => [d.id, d]));
  const excluded = new Set<string>();
  const reserved = new Set<string>();

  for (;;) {
    const result = calcInvoice(lines, candidates.filter((d) => !excluded.has(d.id)).map(toDisc));
    let changed = false;
    for (const id of result.appliedDiscountIds) {
      if (reserved.has(id)) continue;
      const limit = byId.get(id)!.usageLimit;
      const { count } = await tx.discount.updateMany({
        where: { id, OR: [{ usageLimit: null }, ...(limit == null ? [] : [{ timesUsed: { lt: limit } }])] },
        data: { timesUsed: { increment: 1 } },
      });
      if (count === 0) {
        excluded.add(id);
        changed = true;
      } else {
        reserved.add(id);
      }
    }
    if (!changed) return result;
  }
}

// ---------- billing one subscription ----------
async function billInTx(tx: Tx, id: string, now: Date, numbers: InvoiceNumbers): Promise<Outcome> {
  const sub = await tx.subscription.findUnique({
    where: { id },
    include: {
      plan: { select: { period: true } },
      lines: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { name: true } },
          variant: { select: { attribute: true, value: true } },
          tax: { select: { ratePercent: true } },
        },
      },
    },
  });
  if (!sub) return { created: 0, alreadyBilled: false, skipped: true };
  // Someone else billed or paused it between the list query and now.
  if (sub.nextBillingDate && sub.nextBillingDate > now) return { created: 0, alreadyBilled: true, skipped: false };
  if (sub.status !== "ACTIVE" || sub.paused || !sub.nextBillingDate) return { created: 0, alreadyBilled: false, skipped: true };

  // D1: invoice lines are the subscription lines. D8: price and tax come from the line snapshot.
  const lines: Line[] = sub.lines.map((l) => ({
    productId: l.productId,
    description: l.variant ? `${l.product.name} (${l.variant.attribute}: ${l.variant.value})` : l.product.name,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxPercent: l.tax?.ratePercent ?? new Prisma.Decimal(0),
  }));
  if (lines.every((l) => l.unitPrice.mul(l.quantity).isZero())) return { created: 0, alreadyBilled: false, skipped: true };
  const productIds = [...new Set(lines.map((l) => l.productId))];

  let periodStart = sub.nextBillingDate;
  let k = 1;
  let periods = 0;
  let created = 0;
  let alreadyBilled = false;

  while (periodStart <= now && periods < MAX_PERIODS_PER_RUN) {
    // never bill a period that starts on or after expiry, lifecycle closes it
    if (sub.expiryDate && periodStart >= sub.expiryDate) break;

    // Always count from the original startDate (never chain from the previous end) so Jan 31 doesn't drift to the 28th.
    let periodEnd = addPeriod(sub.startDate, sub.plan.period, k);
    while (periodEnd <= periodStart) periodEnd = addPeriod(sub.startDate, sub.plan.period, ++k);

    const exists = await tx.invoice.findUnique({
      where: { subscriptionId_periodStart: { subscriptionId: sub.id, periodStart } },
      select: { id: true },
    });
    if (exists) {
      alreadyBilled = true; // invoiced earlier (even if cancelled the period stays locked), just move the pointer on
    } else {
      const r = await calcWithDiscounts(tx, lines, productIds, sub.id, now);
      await tx.invoice.create({
        data: {
          number: await numbers.next(tx),
          subscriptionId: sub.id,
          customerId: sub.customerId,
          status: "DRAFT",
          periodStart,
          periodEnd,
          issueDate: now,
          dueDate: dueDateFor(now, sub.paymentTerms),
          subtotal: r.subtotal,
          discountTotal: r.discountTotal,
          taxTotal: r.taxTotal,
          total: r.total,
          lines: {
            create: r.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxPercent: l.taxPercent,
              discountAmount: l.discountAmount,
              amount: l.amount,
            })),
          },
        },
      });
      created++;
    }

    // Compare-and-set: a subscription only moves on from the exact period we just handled, in the same transaction.
    const moved = await tx.subscription.updateMany({
      where: { id: sub.id, nextBillingDate: periodStart },
      data: { nextBillingDate: periodEnd },
    });
    if (moved.count === 0) throw new AlreadyBilled();

    periodStart = periodEnd;
    periods++;
  }

  return { created, alreadyBilled, skipped: created === 0 && !alreadyBilled };
}

async function billSubscription(id: string, now: Date, numbers: InvoiceNumbers): Promise<Outcome> {
  for (let attempt = 1; ; attempt++) {
    const before = numbers.snapshot();
    try {
      return await db.$transaction((tx) => billInTx(tx, id, now, numbers), { maxWait: 10_000, timeout: 30_000 });
    } catch (e) {
      numbers.restore(before);
      if (e instanceof AlreadyBilled) return { created: 0, alreadyBilled: true, skipped: false };
      const target = uniqueTarget(e);
      if (target === null) throw e;
      if (target.includes("number")) {
        // someone else took our invoice number: re-read the max and try again
        if (attempt >= MAX_NUMBER_RETRIES) throw e;
        numbers.reset();
        continue;
      }
      // unique(subscriptionId, periodStart): another run created this period first. Safety net working as intended.
      return { created: 0, alreadyBilled: true, skipped: false };
    }
  }
}

// ---------- the run ----------
// `only` narrows which due subscriptions are billed (tests use it so they never touch real data).
export async function runBilling(now = new Date(), only?: Prisma.SubscriptionWhereInput): Promise<BillingSummary> {
  await runLifecycle(now);

  const summary: BillingSummary = { created: 0, alreadyBilled: 0, skipped: 0, failed: [] };
  const numbers = new InvoiceNumbers();
  let cursor: string | undefined;

  // Chunks by id so a subscription that stays due (skipped / failed) can't make the loop spin forever.
  // One subscription at a time, each in its own transaction: one failure never blocks the rest.
  for (;;) {
    const batch = await db.subscription.findMany({
      where: { AND: [dueWhere(now), only ?? {}, cursor ? { id: { gt: cursor } } : {}] },
      select: { id: true, number: true },
      orderBy: { id: "asc" },
      take: CHUNK,
    });
    if (batch.length === 0) break;

    for (const s of batch) {
      try {
        const r = await billSubscription(s.id, now, numbers);
        summary.created += r.created;
        if (r.alreadyBilled) summary.alreadyBilled++;
        if (r.skipped) summary.skipped++;
      } catch (e) {
        console.error(`billing failed for ${s.number}`, e);
        summary.failed.push({ subscription: s.number, error: describeFailure(e) });
      }
    }
    cursor = batch[batch.length - 1].id;
  }
  return summary;
}
