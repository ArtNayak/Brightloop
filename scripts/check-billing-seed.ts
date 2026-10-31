// Integration check: the billing run against the TEAM'S REAL SEED (P1 invoices, P2 catalog + discounts, P3 subscriptions
// and lifecycle), not against fixtures of mine. Run: npm run check:billing-seed
// Needs a local database that holds ONLY the seed (`npx prisma db push && npx prisma db seed` on an empty database).
// It runs the real billing run (including P3's lifecycle), checks what came out with arithmetic that does not use the
// billing code, runs it a second time to prove nothing is billed twice, then puts every row it touched back.
// It refuses to start if the database holds anything that isn't seed data, so it can't alter real work.
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { runBilling } from "../src/lib/billing/run";

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  console.error(`Refusing to run against "${host || "no DATABASE_URL"}". Use a local database (or set ALLOW_REMOTE_TEST_DB=1).`);
  process.exit(1);
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const DAY = 86_400_000;
const TERMS_DAYS: Record<string, number> = { IMMEDIATE: 0, NET_15: 15, NET_30: 30, NET_45: 45 };

const SEED_SUBS = ["SUB-0001", "SUB-0002", "SUB-0003", "SUB-0004", "SUB-0005", "SUB-0006", "SUB-0007", "SUB-0008", "SUB-0009", "SUB-FIN-001"];

async function main() {
  // ---------- is this really a seed-only database? ----------
  const subs = await db.subscription.findMany({ select: { number: true } });
  const strangers = subs.map((s) => s.number).filter((n) => !SEED_SUBS.includes(n));
  const missing = SEED_SUBS.filter((n) => !subs.some((s) => s.number === n));
  const foreignInvoices = await db.invoice.count({ where: { NOT: { number: { startsWith: "INV-FIN-" } } } });
  if (strangers.length || missing.length || foreignInvoices) {
    console.error(
      `This check needs a database holding only the team seed.\n  unexpected subscriptions: ${strangers.join(", ") || "none"}\n  missing seed subscriptions: ${missing.join(", ") || "none"}\n  invoices that are not seed invoices: ${foreignInvoices}\nCreate a clean one: npx prisma db push && npx prisma db seed (on an empty local database).`,
    );
    process.exit(1);
  }

  // ---------- snapshot everything the run may touch ----------
  const before = {
    subs: await db.subscription.findMany({ select: { id: true, number: true, status: true, paused: true, nextBillingDate: true, expiryDate: true }, orderBy: { number: "asc" } }),
    discounts: await db.discount.findMany({ select: { id: true, name: true, timesUsed: true }, orderBy: { name: "asc" } }),
    invoiceIds: (await db.invoice.findMany({ select: { id: true } })).map((i) => i.id),
  };
  const subBefore = new Map(before.subs.map((s) => [s.number, s]));

  async function restore() {
    await db.payment.deleteMany({ where: { invoiceId: { notIn: before.invoiceIds } } });
    await db.invoice.deleteMany({ where: { id: { notIn: before.invoiceIds } } }); // lines go with them
    for (const s of before.subs) await db.subscription.update({ where: { id: s.id }, data: { status: s.status, paused: s.paused, nextBillingDate: s.nextBillingDate, expiryDate: s.expiryDate } });
    for (const d of before.discounts) await db.discount.update({ where: { id: d.id }, data: { timesUsed: d.timesUsed } });
  }

  const results: [string, boolean][] = [];
  const check = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      results.push([name, true]);
      console.log(`  ok   ${name}`);
    } catch (e) {
      results.push([name, false]);
      console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n").join("\n       ")}`);
    }
  };

  try {
    const now = new Date();
    const first = await runBilling(now);
    const created = await db.invoice.findMany({
      where: { id: { notIn: before.invoiceIds } },
      include: { lines: true, subscription: { select: { number: true, paymentTerms: true, lines: { include: { product: true, tax: true } } } } },
      orderBy: { number: "asc" },
    });
    const bySub = (n: string) => created.filter((i) => i.subscription.number === n);

    await check("the run reports no failures and its count matches the invoices that exist", () => {
      assert.deepEqual(first.failed, []);
      assert.equal(first.created, created.length);
      assert.ok(created.length > 0, "nothing was billed: is the seed older than its due dates?");
    });

    await check("only ACTIVE, unpaused, due subscriptions are billed (paused, quotation, draft, closed, expired are not)", () => {
      for (const n of ["SUB-0004", "SUB-0005", "SUB-0006", "SUB-0008", "SUB-0009", "SUB-FIN-001"]) assert.equal(bySub(n).length, 0, `${n} must not be billed`);
      for (const n of ["SUB-0001", "SUB-0002", "SUB-0003"]) assert.ok(bySub(n).length >= 1, `${n} is due and active, it must be billed`);
    });

    await check("P3's lifecycle runs first: the CONFIRMED subscription starting today is activated, then billed; the expired auto-close one is closed, not billed", async () => {
      const [s7, s9] = await Promise.all([db.subscription.findUniqueOrThrow({ where: { number: "SUB-0007" } }), db.subscription.findUniqueOrThrow({ where: { number: "SUB-0009" } })]);
      assert.equal(subBefore.get("SUB-0007")!.status, "CONFIRMED");
      assert.equal(s7.status, "ACTIVE");
      assert.ok(bySub("SUB-0007").length >= 1, "SUB-0007 should be billed right after activation");
      assert.equal(s9.status, "CLOSED");
    });

    await check("catch-up bills every missed daily period exactly once: one invoice per day since the billing date, none after today", async () => {
      for (const n of ["SUB-0001", "SUB-0002", "SUB-0003"]) {
        const start = subBefore.get(n)!.nextBillingDate!.getTime();
        const expected = Math.min(24, Math.floor((now.getTime() - start) / DAY) + 1); // daily plan, cap of 24 periods per run
        const mine = bySub(n);
        assert.equal(mine.length, expected, `${n}: ${mine.length} invoices, expected ${expected}`);
        mine.forEach((inv, k) => assert.equal(inv.periodStart.getTime(), start + k * DAY, `${n} period ${k} starts on the wrong day`));
        assert.equal((await db.subscription.findUniqueOrThrow({ where: { number: n } })).nextBillingDate!.getTime(), start + expected * DAY);
      }
    });

    await check("invoice numbers are INV-0001, INV-0002, ... with no gaps, next to the seed's INV-FIN-* numbers", () => {
      const nums = created.map((i) => i.number).sort();
      assert.deepEqual(nums, nums.map((_, k) => `INV-${String(k + 1).padStart(4, "0")}`));
    });

    await check("every invoice is a DRAFT whose lines are a snapshot of the subscription line and whose money adds up (checked with separate arithmetic)", () => {
      for (const inv of created) {
        assert.equal(inv.status, "DRAFT");
        const sl = inv.subscription.lines;
        assert.equal(inv.lines.length, sl.length, `${inv.number}: line count`);
        let subtotal = D(0);
        let tax = D(0);
        let discount = D(0);
        sl.forEach((s, k) => {
          const line = inv.lines[k];
          const gross = D(s.unitPrice).mul(s.quantity);
          const afterDiscount = gross.minus(line.discountAmount);
          assert.ok(line.discountAmount.gte(0) && line.discountAmount.lte(gross), `${inv.number}: discount must be between 0 and the line price`);
          assert.equal(line.amount.toFixed(2), afterDiscount.toFixed(2), `${inv.number}: line amount = price x qty - discount`);
          assert.equal(line.unitPrice.toFixed(2), D(s.unitPrice).toFixed(2));
          assert.equal(line.quantity, s.quantity);
          assert.ok(line.description.includes(s.product.name), `${inv.number}: description should name the product`);
          subtotal = subtotal.plus(gross);
          discount = discount.plus(line.discountAmount);
          tax = tax.plus(round2(afterDiscount.mul(s.tax?.ratePercent ?? 0).div(100)));
        });
        assert.equal(inv.subtotal.toFixed(2), subtotal.toFixed(2), `${inv.number}: subtotal`);
        assert.equal(inv.discountTotal.toFixed(2), discount.toFixed(2), `${inv.number}: discount total`);
        assert.equal(inv.taxTotal.toFixed(2), tax.toFixed(2), `${inv.number}: tax total`);
        assert.equal(inv.total.toFixed(2), subtotal.minus(discount).plus(tax).toFixed(2), `${inv.number}: total`);
      }
    });

    await check("due date = issue date + the subscription's payment terms", () => {
      for (const inv of created) {
        const days = TERMS_DAYS[inv.subscription.paymentTerms ?? "IMMEDIATE"];
        assert.ok(days !== undefined, `unknown terms ${inv.subscription.paymentTerms}`);
        const issue = Date.UTC(inv.issueDate.getUTCFullYear(), inv.issueDate.getUTCMonth(), inv.issueDate.getUTCDate());
        assert.equal(inv.dueDate.getTime(), issue + days * DAY, `${inv.number} (${inv.subscription.paymentTerms})`);
      }
    });

    await check("discount usage moves only when a discount actually took money off an invoice (and never for the expired one)", async () => {
      const after = await db.discount.findMany({ select: { name: true, timesUsed: true }, orderBy: { name: "asc" } });
      const used = after.reduce((a, d) => a + d.timesUsed, 0) - before.discounts.reduce((a, d) => a + d.timesUsed, 0);
      const discounted = created.filter((i) => i.discountTotal.gt(0)).length;
      if (discounted === 0) assert.equal(used, 0, "usage went up although no invoice got a discount");
      else assert.ok(used >= discounted, `${discounted} discounted invoices but only ${used} usages recorded`);
      const expired = after.find((d) => d.name.startsWith("Expired"))!;
      assert.equal(expired.timesUsed, before.discounts.find((d) => d.name.startsWith("Expired"))!.timesUsed);
    });

    await check("running it again creates nothing: no duplicate invoices, no extra discount usage, billing dates unchanged", async () => {
      const dates = (await db.subscription.findMany({ select: { number: true, nextBillingDate: true }, orderBy: { number: "asc" } })).map((s) => `${s.number}:${s.nextBillingDate?.toISOString()}`);
      const usage = (await db.discount.findMany({ select: { timesUsed: true }, orderBy: { name: "asc" } })).map((d) => d.timesUsed);
      const count = await db.invoice.count();
      const second = await runBilling(new Date(now.getTime() + 1000));
      assert.equal(second.created, 0);
      assert.deepEqual(second.failed, []);
      assert.equal(await db.invoice.count(), count);
      assert.deepEqual((await db.subscription.findMany({ select: { number: true, nextBillingDate: true }, orderBy: { number: "asc" } })).map((s) => `${s.number}:${s.nextBillingDate?.toISOString()}`), dates);
      assert.deepEqual((await db.discount.findMany({ select: { timesUsed: true }, orderBy: { name: "asc" } })).map((d) => d.timesUsed), usage);
    });
  } finally {
    await restore();
  }

  await check("everything the run touched was put back (subscriptions, discount usage, invoices)", async () => {
    const subs2 = await db.subscription.findMany({ select: { id: true, number: true, status: true, paused: true, nextBillingDate: true, expiryDate: true }, orderBy: { number: "asc" } });
    assert.deepEqual(subs2, before.subs);
    assert.deepEqual(await db.discount.findMany({ select: { id: true, name: true, timesUsed: true }, orderBy: { name: "asc" } }), before.discounts);
    assert.deepEqual((await db.invoice.findMany({ select: { id: true } })).map((i) => i.id).sort(), [...before.invoiceIds].sort());
  });

  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
