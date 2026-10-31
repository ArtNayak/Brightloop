// run: npm run test:reports   (needs `npm run dev` running and the seeded demo data; adds a few throwaway payments and removes them)
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { base, login } from "@/lib/check-helpers";
import { outstanding, overdueWhere } from "@/lib/finance";
import { amountOwed, monthlyRevenue } from "@/lib/finance-totals";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), D(0));
const monthsAgo = (n: number) => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, 15, 12)); };

let cookie = "";
async function page(query = "") {
  const res = await fetch(`${base}/reports${query}`, { headers: { Cookie: cookie }, redirect: "manual" });
  return { status: res.status, html: (await res.text()).replace(/<!-- -->/g, "") };
}
// reads one card's big number out of the page, e.g. card(html, "revenue") -> "1234.00"
const card = (html: string, id: string) => new RegExp(`data-card="${id}">([^<]*)<`).exec(html)?.[1];

async function main() {
  const staff = await db.user.findUniqueOrThrow({ where: { email: "staff@brightloop.test" } });
  const sub = await db.subscription.findUniqueOrThrow({ where: { number: "SUB-FIN-001" } });

  // ---------- monthly revenue (database level, independent calculation in plain JS)
  const expectedMonths = async (filter: Prisma.PaymentWhereInput = {}) => {
    const rows = await monthlyRevenue({}, 12);
    const payments = await db.payment.findMany({ where: filter });
    return rows.map((r) => ({ month: r.month, revenue: sum(payments.filter((p) => p.paidAt.toISOString().slice(0, 7) === r.month).map((p) => p.amount)).toFixed(2) }));
  };
  const before = await monthlyRevenue();
  assert.equal(before.length, 12, "twelve buckets, oldest first");
  assert.ok(before[11].month === new Date().toISOString().slice(0, 7), "last bucket is this month");

  // a cancelled invoice (shows up in no invoice list) carrying payments 3 months ago and 14 months ago
  const inv = await db.invoice.create({
    data: {
      number: `INV-DASHCHK-${Date.now()}`, subscriptionId: sub.id, customerId: sub.customerId, status: "CANCELLED",
      periodStart: new Date(Date.now() + 9 * 86_400_000), periodEnd: new Date(Date.now() + 39 * 86_400_000),
      dueDate: new Date(), subtotal: "1.00", taxTotal: "0.00", total: "1.00",
    },
  });
  const pay = (amount: string, paidAt: Date) => ({ invoiceId: inv.id, method: "CASH" as const, amount, paidAt, recordedById: staff.id });
  await db.payment.createMany({ data: [pay("100.00", monthsAgo(3)), pay("23.45", monthsAgo(3)), pay("999.00", monthsAgo(14))] });

  const after = await monthlyRevenue();
  const bucket = (rows: typeof after, n: number) => D(rows.find((r) => r.month === monthsAgo(n).toISOString().slice(0, 7))!.revenue);
  assert.equal(bucket(after, 3).minus(bucket(before, 3)).toFixed(2), "123.45", "payments land in their own month");
  assert.deepEqual(after, await expectedMonths(), "every month matches a plain recount of the payments");
  assert.ok(!after.some((r) => D(r.revenue).gte(999) && r.month === monthsAgo(14).toISOString().slice(0, 7)), "14 months ago is outside the window");

  // filters: a plan that doesn't exist, a customer nobody has, and "%" (must not act as a wildcard)
  for (const f of [{ planId: "no-such-plan" }, { customerQ: "nobody-has-this-name" }, { customerQ: "%" }]) {
    assert.ok((await monthlyRevenue(f)).every((r) => r.revenue === "0.00"), `filter ${JSON.stringify(f)} excludes everything`);
  }
  const demo = await monthlyRevenue({ customerQ: "DEMO", planId: sub.planId });
  assert.deepEqual(demo, after, "matching filters (any letter case) keep the demo customer's payments");

  // amount still owed: database sum vs adding up each invoice with the same outstanding() rule
  const late = await db.invoice.findMany({ where: overdueWhere(), include: { payments: true } });
  assert.equal((await amountOwed(overdueWhere())).toFixed(2), sum(late.map(outstanding)).toFixed(2), "overdue owed");
  const open = await db.invoice.findMany({ where: { status: "CONFIRMED" }, include: { payments: true } });
  assert.equal((await amountOwed({ status: "CONFIRMED" })).toFixed(2), sum(open.map(outstanding)).toFixed(2), "outstanding owed");

  // ---------- the dashboard page itself (cards must equal independent counts)
  const customerCookie = await login("customer@brightloop.test");
  assert.equal((await fetch(`${base}/reports`, { headers: { Cookie: customerCookie }, redirect: "manual" })).status, 307, "customers are sent away");
  cookie = await login("staff@brightloop.test");
  assert.ok(cookie);

  const all = (await page("?from=2000-01-01&to=2100-01-01")).html;
  assert.equal(card(all, "active"), String(await db.subscription.count({ where: { status: "ACTIVE", paused: false } })));
  assert.equal(card(all, "revenue"), (await db.payment.aggregate({ _sum: { amount: true } }))._sum.amount!.toFixed(2), "revenue over all time");
  assert.equal(card(all, "owed"), sum(open.map(outstanding)).toFixed(2));
  assert.equal(card(all, "overdue"), sum(late.map(outstanding)).toFixed(2));
  assert.ok(all.includes(`${late.length} invoices`) && all.includes(`${await db.subscription.count({ where: { status: "ACTIVE", paused: true } })} paused`));

  // date range: only the 3-months-ago day should count 123.45 (a window around exactly that day)
  const d3 = monthsAgo(3).toISOString().slice(0, 10);
  const day = await page(`?from=${d3}&to=${d3}`);
  assert.equal(card(day.html, "revenue"), sum((await db.payment.findMany({ where: { paidAt: { gte: new Date(d3), lt: new Date(new Date(d3).getTime() + 86_400_000) } } })).map((p) => p.amount)).toFixed(2), "'to' day is included in full");

  // customer / plan filters narrow every card
  const none = (await page("?q=nobody-has-this-name&from=2000-01-01&to=2100-01-01")).html;
  assert.deepEqual(["active", "revenue", "owed", "overdue"].map((c) => card(none, c)), ["0", "0.00", "0.00", "0.00"]);
  const planOnly = (await page(`?plan=${sub.planId}&from=2000-01-01&to=2100-01-01`)).html;
  assert.equal(card(planOnly, "active"), String(await db.subscription.count({ where: { planId: sub.planId, status: "ACTIVE", paused: false } })), "plan filter");
  assert.equal(card(planOnly, "overdue"), sum(late.filter((i) => i.subscriptionId === sub.id).map(outstanding)).toFixed(2), "plan filter on overdue");

  // lists: most overdue first, latest payment visible
  assert.ok(all.indexOf("INV-FIN-003") !== -1 && all.indexOf("INV-FIN-003") < all.indexOf("INV-FIN-002"), "top overdue list is oldest-first");
  assert.ok(all.includes("Latest payments"));

  // hand-edited URLs must not break it
  for (const bad of ["?from=garbage&to=nope", "?plan=nonsense", "?q=%25", "?q=%27%22%3C"]) assert.equal((await page(bad)).status, 200, `survives ${bad}`);

  console.log("reports ok");
}

main().finally(async () => {
  await db.payment.deleteMany({ where: { invoice: { number: { startsWith: "INV-DASHCHK-" } } } });
  await db.invoice.deleteMany({ where: { number: { startsWith: "INV-DASHCHK-" } } });
  await db.$disconnect();
});
