import { Prisma } from "@prisma/client";
import { db } from "./db";

// How much money is still owed across ALL invoices matching `where` (not just one page of them):
// what was billed minus what has been paid. Two small database sums, no rows loaded.
export async function amountOwed(where: Prisma.InvoiceWhereInput) {
  const [billed, paid] = await Promise.all([
    db.invoice.aggregate({ where, _sum: { total: true } }),
    db.payment.aggregate({ where: { invoice: where }, _sum: { amount: true } }),
  ]);
  return (billed._sum.total ?? new Prisma.Decimal(0)).minus(paid._sum.amount ?? 0);
}

// Monthly recurring revenue (MRR): what the active subscriptions bring in per month. Each subscription's line amounts
// (before tax) are scaled from its plan's billing period to one month: weekly x 52/12, yearly / 12, daily x 365/12.
// Paused and non-active subscriptions don't count. Same optional plan / customer filters as the other dashboard cards.
export async function monthlyRecurring(opts: { planId?: string; customerQ?: string } = {}) {
  const plan = opts.planId ? Prisma.sql`AND s."planId" = ${opts.planId}` : Prisma.empty;
  const customer = opts.customerQ
    ? Prisma.sql`AND (strpos(lower(u."name"), lower(${opts.customerQ})) > 0 OR strpos(lower(u."email"), lower(${opts.customerQ})) > 0)`
    : Prisma.empty;
  const [row] = await db.$queryRaw<{ mrr: Prisma.Decimal | null }[]>`
    SELECT SUM(l."amount" * CASE p."period"::text
             WHEN 'DAILY' THEN 365.0 / 12 WHEN 'WEEKLY' THEN 52.0 / 12 WHEN 'YEARLY' THEN 1.0 / 12 ELSE 1 END) AS mrr
    FROM "SubscriptionLine" l
    JOIN "Subscription" s ON s."id" = l."subscriptionId"
    JOIN "Plan" p ON p."id" = s."planId"
    JOIN "User" u ON u."id" = s."customerId"
    WHERE s."status" = 'ACTIVE' AND s."paused" = false ${plan} ${customer}`;
  return new Prisma.Decimal(row?.mrr ?? 0).toDecimalPlaces(2);
}

// Money collected per calendar month for the last `months` months (this month included), oldest first.
// Months with no payments come back as 0 so the chart has no gaps. Optionally narrowed to one plan
// and/or to customers whose name or email contains `customerQ`.
export async function monthlyRevenue(opts: { planId?: string; customerQ?: string } = {}, months = 12) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  // Filters are only added to the SQL when they are set. Values go in as parameters, never glued into the text.
  const plan = opts.planId ? Prisma.sql`AND s."planId" = ${opts.planId}` : Prisma.empty;
  // strpos instead of ILIKE so a "%" or "_" typed into the search box is treated as a normal character
  const customer = opts.customerQ
    ? Prisma.sql`AND (strpos(lower(u."name"), lower(${opts.customerQ})) > 0 OR strpos(lower(u."email"), lower(${opts.customerQ})) > 0)`
    : Prisma.empty;

  const rows = await db.$queryRaw<{ month: string; total: Prisma.Decimal }[]>`
    SELECT to_char(date_trunc('month', p."paidAt"), 'YYYY-MM') AS month, SUM(p."amount") AS total
    FROM "Payment" p
    JOIN "Invoice" i ON i."id" = p."invoiceId"
    JOIN "Subscription" s ON s."id" = i."subscriptionId"
    JOIN "User" u ON u."id" = i."customerId"
    WHERE p."paidAt" >= ${start} ${plan} ${customer}
    GROUP BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month, r.total]));

  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const month = d.toISOString().slice(0, 7);
    return { month, revenue: new Prisma.Decimal(byMonth.get(month) ?? 0).toFixed(2) };
  });
}
