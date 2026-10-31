// T10: fills a database with a realistic amount of data so we can check that the pages stay fast.
//   5,000 subscriptions across 200 customers, 15,000 invoices (mixed status and due dates), about 8,000 payments.
// Run it on a SEPARATE database, never the shared demo one (see the guard below):
//   createdb brightloop_bulk ; DATABASE_URL=.../brightloop_bulk npx prisma db push ; DATABASE_URL=.../brightloop_bulk npm run db:seed-bulk
// Safe to run twice: if the bulk rows are already there it stops.
import { PrismaClient, Prisma, type InvoiceStatus, type SubscriptionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const DAY = 86_400_000;
const CHUNK = 1000;
const CUSTOMERS = 200;
const SUBS = 5000;

// Same numbers every run, so two timing runs are comparable.
let seed = 42;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

// Inserts rows 1,000 at a time so one statement never gets huge.
async function insert<T>(label: string, rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
  console.log(`${label}: ${rows.length}`);
}

async function main() {
  // The guard: this script adds ~28,000 rows, so it refuses to touch a database that isn't clearly a throwaway one.
  const name = new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.slice(1);
  if (!name.includes("bulk")) {
    throw new Error(`Refusing to bulk-seed "${name}". Point DATABASE_URL at a separate database whose name contains "bulk".`);
  }
  if (await db.subscription.findUnique({ where: { number: "SUB-BULK-00001" } })) {
    console.log("Bulk data is already there, nothing to do.");
    return;
  }

  const passwordHash = await bcrypt.hash("Passw0rd!", 10); // one hash reused: hashing 200 times would take ages
  const staff = await db.user.upsert({ where: { email: "staff@brightloop.test" }, update: {}, create: { email: "staff@brightloop.test", name: "Staff", role: "STAFF", passwordHash } });
  await db.user.upsert({ where: { email: "admin@brightloop.test" }, update: {}, create: { email: "admin@brightloop.test", name: "Admin", role: "ADMIN", passwordHash } });
  await db.user.upsert({ where: { email: "customer@brightloop.test" }, update: {}, create: { email: "customer@brightloop.test", name: "Demo Customer", role: "CUSTOMER", passwordHash } });

  const customers = Array.from({ length: CUSTOMERS }, (_, i) => ({
    id: randomUUID(), email: `bulk-customer-${i + 1}@brightloop.test`, name: `Bulk Customer ${i + 1}`, role: "CUSTOMER" as const, passwordHash,
  }));
  await insert("customers", customers, (data) => db.user.createMany({ data }));

  const plans = await Promise.all(
    [["Bulk Monthly", "MONTHLY", 500], ["Bulk Yearly", "YEARLY", 5000], ["Bulk Weekly", "WEEKLY", 150]].map(([name, period, price]) =>
      db.plan.create({ data: { name: name as string, period: period as "MONTHLY", price: price as number, startDate: daysFromNow(-800), pausable: true } }),
    ),
  );
  const product = await db.product.create({ data: { name: "Bulk Product", type: "Software", salesPrice: 500, costPrice: 200 } });

  // ---- subscriptions: mostly ACTIVE, a few of every other status
  const statuses: SubscriptionStatus[] = [...Array(14).fill("ACTIVE"), ...Array(2).fill("CLOSED"), "CONFIRMED", "QUOTATION", ...Array(2).fill("DRAFT")];
  const subs = Array.from({ length: SUBS }, (_, i) => {
    const status = pick(statuses);
    const start = daysFromNow(-Math.floor(rand() * 400) - 60);
    return {
      id: randomUUID(), number: `SUB-BULK-${String(i + 1).padStart(5, "0")}`, customerId: customers[i % CUSTOMERS].id,
      planId: plans[i % plans.length].id, status, startDate: start, paymentTerms: "NET_15",
      nextBillingDate: status === "ACTIVE" ? daysFromNow(Math.floor(rand() * 30) - 5) : null,
    };
  });
  await insert("subscriptions", subs, (data) => db.subscription.createMany({ data }));
  await insert("subscription lines", subs.map((s) => ({ subscriptionId: s.id, productId: product.id, quantity: 1, unitPrice: 500, amount: 500 })), (data) =>
    db.subscriptionLine.createMany({ data }),
  );

  // ---- invoices: three per ACTIVE/CLOSED subscription, until we reach 15,000
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const billed = subs.filter((s) => s.status === "ACTIVE" || s.status === "CLOSED");
  for (let k = 0; invoices.length < 15000; k++) {
    const s = billed[k % billed.length];
    const round = Math.floor(k / billed.length); // 0, 1, 2, ...: each round is the next billing period of that subscription
    const periodStart = new Date(s.startDate.getTime() + round * 30 * DAY);
    const subtotal = 100 + Math.floor(rand() * 4900);
    const tax = Math.round(subtotal * 18) / 100;
    const r = rand();
    const status: InvoiceStatus = r < 0.45 ? "PAID" : r < 0.88 ? "CONFIRMED" : r < 0.94 ? "DRAFT" : "CANCELLED";
    // CONFIRMED invoices fall due anywhere from 90 days ago to 30 days ahead: a good mix of late and not yet due
    const dueDate = status === "CONFIRMED" ? daysFromNow(Math.floor(rand() * 120) - 90) : new Date(periodStart.getTime() + 45 * DAY);
    invoices.push({
      id: randomUUID(), number: `INV-BULK-${String(invoices.length + 1).padStart(6, "0")}`, subscriptionId: s.id, customerId: s.customerId,
      status, periodStart, periodEnd: new Date(periodStart.getTime() + 30 * DAY), issueDate: periodStart, dueDate,
      subtotal: dec(subtotal), taxTotal: dec(tax), total: dec(subtotal + tax),
    });
  }
  await insert("invoices", invoices, (data) => db.invoice.createMany({ data }));

  // ---- payments: every PAID invoice is paid in full, and some CONFIRMED ones are part-paid, to land near 8,000
  const methods = ["CASH", "CARD", "BANK_TRANSFER", "UPI", "CHEQUE"] as const;
  const payments: Prisma.PaymentCreateManyInput[] = [];
  for (const inv of invoices) {
    const total = Number(inv.total);
    const full = inv.status === "PAID";
    if (!full && !(inv.status === "CONFIRMED" && rand() < 0.2)) continue;
    payments.push({
      id: randomUUID(), invoiceId: inv.id as string, method: pick(methods), recordedById: staff.id, note: "Bulk payment",
      amount: dec(full ? total : Math.round(total * (20 + Math.floor(rand() * 60))) / 100),
      paidAt: new Date(Math.min(Date.now(), (inv.issueDate as Date).getTime() + Math.floor(rand() * 40) * DAY)),
    });
  }
  await insert("payments", payments, (data) => db.payment.createMany({ data }));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
