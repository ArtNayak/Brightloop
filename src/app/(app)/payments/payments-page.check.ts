// run: npm run test:payments-page   (needs `npm run dev` running and the seeded finance demo data; adds 30 throwaway payments and removes them)
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { base, login } from "@/lib/check-helpers";
import { outstanding, overdueWhere } from "@/lib/finance";

let cookie = "";
// Fetches a page as the signed-in user; React's "<!-- -->" text separators are removed so text is easy to match.
async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
  return { status: res.status, html: (await res.text()).replace(/<!-- -->/g, "") };
}
const has = (html: string, n: string) => html.includes(n);
const totalOf = (html: string) => Number(/\((\d+) total\)/.exec(html)?.[1]);
// counts only inside the rendered table (Next also embeds the same data in a script tag further down)
const count = (html: string, s: string) => (/<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? "").split(s).length - 1;

async function main() {
  const customerCookie = await login("customer@brightloop.test");
  cookie = await login("staff@brightloop.test");
  assert.ok(cookie && customerCookie, "seeded users can sign in");

  // customers never see finance pages (the proxy sends them away)
  assert.equal((await fetch(`${base}/payments`, { headers: { Cookie: customerCookie }, redirect: "manual" })).status, 307);

  // --- Overdue tab: only overdue invoices, most overdue first, with the right grand total
  const over = (await get("/payments?tab=overdue")).html;
  assert.ok(has(over, "INV-FIN-002") && has(over, "INV-FIN-003"), "seeded overdue invoices are listed");
  for (const n of ["INV-FIN-001", "INV-FIN-004", "INV-FIN-005", "INV-FIN-006"]) assert.ok(!has(over, n), `${n} is not overdue`);
  assert.ok(over.indexOf("INV-FIN-003") < over.indexOf("INV-FIN-002"), "55 days late is listed before 25 days late");
  assert.match(over, /\d+ days overdue/, "red badge shows days overdue");
  // work the expected total out straight from the database, independently of the page
  const late = await db.invoice.findMany({ where: overdueWhere(), include: { payments: true } });
  const expected = late.reduce((sum, i) => sum.plus(outstanding(i)), new Prisma.Decimal(0));
  assert.ok(over.replace(/<[^>]+>/g, "").includes(`Total overdue: ${expected.toFixed(2)}`), `overdue total should be ${expected.toFixed(2)}`);

  // --- Outstanding tab: everything still owed (overdue or not), with a Record payment button
  const out = (await get("/payments?tab=outstanding")).html;
  for (const n of ["INV-FIN-001", "INV-FIN-002", "INV-FIN-003", "INV-FIN-006"]) assert.ok(has(out, n), `${n} is outstanding`);
  for (const n of ["INV-FIN-004", "INV-FIN-005"]) assert.ok(!has(out, n), `${n} is fully paid`);
  assert.ok(has(out, "Record payment"), "outstanding rows have the Record payment button");

  // --- Paid tab: only fully paid invoices, nothing left to record
  const paid = (await get("/payments?tab=paid")).html;
  for (const n of ["INV-FIN-004", "INV-FIN-005"]) assert.ok(has(paid, n), `${n} is paid`);
  for (const n of ["INV-FIN-001", "INV-FIN-002", "INV-FIN-003", "INV-FIN-006"]) assert.ok(!has(paid, n), `${n} is not paid`);
  assert.ok(!has(paid, "Record payment") && !/\d+ days? overdue/.test(paid), "paid rows have no button and no overdue badge");

  // --- All payments tab + filters: the "(N total)" shown must match an independent count
  const all = (await get("/payments")).html;
  assert.ok(has(all, "Seeded payment") && has(all, "INV-FIN-004"), "payments are listed with note and invoice number");
  assert.equal(totalOf(all), await db.payment.count());
  assert.equal(totalOf((await get("/payments?method=UPI")).html), await db.payment.count({ where: { method: "UPI" } }), "method filter");
  const byName = await db.payment.count({ where: { invoice: { customer: { name: { contains: "demo", mode: "insensitive" } } } } });
  assert.equal(totalOf((await get("/payments?q=DEMO")).html), byName, "customer search ignores letter case");
  const none = await get("/payments?q=nobody-has-this-name");
  assert.ok(has(none.html, "Nothing to show") && totalOf(none.html) === 0, "no match shows an empty message");
  // date range: the earliest seeded payment's day only
  const first = await db.payment.findFirstOrThrow({ orderBy: { paidAt: "asc" } });
  const d = first.paidAt.toISOString().slice(0, 10);
  const startOfDay = new Date(d), endOfDay = new Date(startOfDay.getTime() + 86_400_000 - 1);
  assert.equal(
    totalOf((await get(`/payments?from=${d}&to=${d}`)).html),
    await db.payment.count({ where: { paidAt: { gte: startOfDay, lte: endOfDay } } }),
    "date range includes the whole 'to' day",
  );

  // --- hand-edited URLs must not break the page
  for (const bad of ["?tab=evil", "?page=abc", "?page=-3", "?page=999", "?from=garbage&to=nope", "?method=BITCOIN"]) {
    assert.equal((await get(`/payments${bad}`)).status, 200, `page survives ${bad}`);
  }

  // --- pagination: 25 per page. Thirty fresh payments sort to the top, so they fill page 1 and spill onto page 2.
  const sub = await db.subscription.findUniqueOrThrow({ where: { number: "SUB-FIN-001" } });
  const staff = await db.user.findUniqueOrThrow({ where: { email: "staff@brightloop.test" } });
  const inv = await db.invoice.create({
    data: {
      number: `INV-PAGECHK-${Date.now()}`, subscriptionId: sub.id, customerId: sub.customerId, status: "CANCELLED", // cancelled: shows up in no invoice tab
      periodStart: new Date(Date.now() + 5 * 86_400_000), periodEnd: new Date(Date.now() + 35 * 86_400_000),
      dueDate: new Date(), subtotal: "30.00", taxTotal: "0.00", total: "30.00",
    },
  });
  await db.payment.createMany({
    data: Array.from({ length: 30 }, () => ({ invoiceId: inv.id, method: "CASH" as const, amount: "1.00", paidAt: new Date(), note: "PAGECHK-NOTE", recordedById: staff.id })),
  });
  const p1 = (await get("/payments")).html, p2 = (await get("/payments?page=2")).html;
  assert.equal(count(p1, "PAGECHK-NOTE"), 25, "page 1 shows exactly 25 rows");
  assert.equal(count(p2, "PAGECHK-NOTE"), 5, "page 2 shows the remaining 5 of the 30");
  assert.ok(has(p1, "Next") && has(p2, "Previous"), "next/previous links");

  console.log("payments pages ok");
}

main().finally(async () => {
  await db.payment.deleteMany({ where: { invoice: { number: { startsWith: "INV-PAGECHK-" } } } });
  await db.invoice.deleteMany({ where: { number: { startsWith: "INV-PAGECHK-" } } });
  await db.$disconnect();
});
