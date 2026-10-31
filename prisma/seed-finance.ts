import type { PrismaClient } from "@prisma/client";

const DAY = 86_400_000;
// handy: daysFromNow(-5) = five days ago, daysFromNow(10) = ten days ahead
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

// Makes a few fake invoices (INV-FIN-001...) so we can build the payments page and dashboard
// before the real billing engine exists. Safe to run many times, it never creates duplicates.
// Delete this once real billing data exists.
export async function seedFinance(db: PrismaClient) {
  // Every invoice needs a customer, a person recording payments and a subscription to hang off.
  const customer = await db.user.findUniqueOrThrow({ where: { email: "customer@brightloop.test" } });
  const staff = await db.user.findUniqueOrThrow({ where: { email: "staff@brightloop.test" } });

  // Use our own little plan so we don't depend on the catalog seed having run first.
  const plan =
    (await db.plan.findFirst({ where: { name: "Finance Demo Plan" } })) ??
    (await db.plan.create({
      data: { name: "Finance Demo Plan", price: 1000, period: "MONTHLY", startDate: daysFromNow(-120) },
    }));
  const sub = await db.subscription.upsert({
    where: { number: "SUB-FIN-001" },
    update: {},
    create: {
      number: "SUB-FIN-001",
      customerId: customer.id,
      planId: plan.id,
      status: "ACTIVE",
      startDate: daysFromNow(-120),
      paymentTerms: "NET_15",
    },
  });

  // One row per invoice: [number, status, issued N days ago, due in N days (negative = already past), total, payments made]
  // Together they cover every case the pages need: not due yet, overdue, part paid, fully paid.
  const rows: [string, "CONFIRMED" | "PAID", number, number, number, number[]][] = [
    ["INV-FIN-001", "CONFIRMED", 5, 10, 1180, []], // not yet due
    ["INV-FIN-002", "CONFIRMED", 40, -25, 1180, []], // overdue, nothing paid
    ["INV-FIN-003", "CONFIRMED", 70, -55, 1180, [400]], // overdue, partly paid
    ["INV-FIN-004", "PAID", 100, -85, 1180, [1180]], // fully paid
    ["INV-FIN-005", "PAID", 30, -15, 590, [300, 290]], // paid in two parts
    ["INV-FIN-006", "CONFIRMED", 3, 12, 2360, [1000]], // partly paid, not due
  ];

  for (const [i, [number, status, ago, due, total, pays]] of rows.entries()) {
    const periodStart = daysFromNow(-ago);
    const subtotal = total / 1.18; // the total includes 18% GST, so work backwards to the pre-tax amount
    // upsert by invoice number: first run creates it, later runs leave it alone
    const invoice = await db.invoice.upsert({
      where: { number },
      update: {},
      create: {
        number,
        subscriptionId: sub.id,
        customerId: customer.id,
        status,
        periodStart,
        periodEnd: new Date(periodStart.getTime() + 30 * DAY),
        issueDate: periodStart,
        dueDate: daysFromNow(due),
        subtotal: subtotal.toFixed(2),
        taxTotal: (total - subtotal).toFixed(2),
        total,
        lines: { create: [{ description: "Finance demo line", quantity: 1, unitPrice: subtotal.toFixed(2), taxPercent: 18, amount: subtotal.toFixed(2) }] },
      },
    });
    // already has payments from an earlier run? then don't add them again
    if (await db.payment.count({ where: { invoiceId: invoice.id } })) continue;
    await db.payment.createMany({
      data: pays.map((amount, j) => ({
        invoiceId: invoice.id,
        // rotate through the payment methods so the demo data shows a mix
        method: (["BANK_TRANSFER", "UPI", "CARD", "CASH", "CHEQUE"] as const)[(i + j) % 5],
        amount,
        // paid a couple of days after issue, spaced out for multi-part payments, but never in the future
        paidAt: daysFromNow(-Math.max(ago - 2 - j * 3, 1)),
        note: "Seeded payment",
        recordedById: staff.id,
      })),
    });
  }
}
