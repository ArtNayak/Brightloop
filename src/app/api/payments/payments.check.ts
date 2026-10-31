// run: npm run test:payments   (needs `npm run dev` running and the seeded users; creates throwaway invoices and deletes them)
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { base, login } from "@/lib/check-helpers";

const stamp = Date.now();
const DAY = 86_400_000;
const pay = (cookie: string, payload: Record<string, unknown>) =>
  fetch(`${base}/api/payments`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(payload) });

// A fresh invoice of 1000.00 for the demo customer, hung on the finance demo subscription (from the seed).
async function makeInvoice(tag: string, status: "DRAFT" | "CONFIRMED") {
  const sub = await db.subscription.findUniqueOrThrow({ where: { number: "SUB-FIN-001" } });
  return db.invoice.create({
    data: {
      number: `INV-PAYCHK-${stamp}-${tag}`, subscriptionId: sub.id, customerId: sub.customerId, status,
      // the period start is unique per invoice (timestamp + tag), so it never clashes with seeded ones
      periodStart: new Date(stamp + Number(tag.length) * DAY), periodEnd: new Date(stamp + 30 * DAY),
      dueDate: new Date(stamp + 15 * DAY), subtotal: "1000.00", taxTotal: "0.00", total: "1000.00",
    },
  });
}
const state = (id: string) => db.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const staff = await login("staff@brightloop.test");
  const customer = await login("customer@brightloop.test");
  assert.ok(staff && customer, "seeded users can sign in");
  const staffUser = await db.user.findUniqueOrThrow({ where: { email: "staff@brightloop.test" } });

  // --- who may record payments
  const inv = await makeInvoice("a", "CONFIRMED");
  const ok = { invoiceId: inv.id, method: "CASH", amount: "400.00", paidAt: today };
  assert.ok([307, 401].includes((await pay("", ok)).status), "signed-out caller is stopped");
  assert.equal((await pay(customer, ok)).status, 403, "customers are refused");
  assert.equal((await state(inv.id)).payments.length, 0, "refused calls record nothing");

  // --- input checks (each must be refused and leave the invoice untouched)
  const bad: [string, Record<string, unknown>, number][] = [
    ["zero amount", { ...ok, amount: "0" }, 400],
    ["negative amount", { ...ok, amount: "-5" }, 400],
    ["three decimals", { ...ok, amount: "10.555" }, 400],
    ["not a number", { ...ok, amount: "abc" }, 400],
    ["unknown method", { ...ok, method: "BITCOIN" }, 400],
    ["bad date", { ...ok, paidAt: "not-a-date" }, 400],
    ["future date", { ...ok, paidAt: new Date(Date.now() + 3 * DAY).toISOString() }, 400],
    ["more than owed", { ...ok, amount: "1000.01" }, 400],
    ["unknown invoice", { ...ok, invoiceId: "does-not-exist" }, 404],
  ];
  for (const [label, payload, status] of bad) assert.equal((await pay(staff, payload)).status, status, label);
  assert.equal((await state(inv.id)).payments.length, 0, "bad requests record nothing");

  // --- the spec's walk-through: 400 of 1000, then the last 600, then nothing more is accepted
  let res = await pay(staff, ok);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, status: "CONFIRMED", outstanding: "600.00" });
  let s = await state(inv.id);
  assert.equal(s.status, "CONFIRMED");
  assert.equal(s.payments[0].recordedById, staffUser.id, "payment is attributed to the signed-in user");
  res = await pay(staff, { ...ok, amount: "600.00" });
  assert.deepEqual(await res.json(), { ok: true, status: "PAID", outstanding: "0.00" });
  assert.equal((await state(inv.id)).status, "PAID");
  assert.equal((await pay(staff, { ...ok, amount: "1.00" })).status, 409, "a paid invoice takes no more payments");

  // --- a draft invoice can't be paid
  const draft = await makeInvoice("dd", "DRAFT");
  assert.equal((await pay(staff, { ...ok, invoiceId: draft.id })).status, 409, "draft invoice");

  // --- two people paying at the same moment: only one of them may succeed (the row lock)
  const race = await makeInvoice("race", "CONFIRMED");
  const both = await Promise.all([1, 2].map(() => pay(staff, { ...ok, invoiceId: race.id, amount: "600.00" })));
  const codes = both.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 400], "exactly one of two simultaneous 600 payments wins");
  assert.equal((await state(race.id)).payments.length, 1, "no overpayment");

  console.log("payments ok");
}

main().finally(async () => {
  // payments first (they point at the invoices), then the invoices themselves
  const mine = { invoice: { number: { startsWith: "INV-PAYCHK-" } } };
  await db.payment.deleteMany({ where: mine });
  await db.invoice.deleteMany({ where: { number: { startsWith: "INV-PAYCHK-" } } });
  await db.$disconnect();
});
