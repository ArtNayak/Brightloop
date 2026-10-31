// DB-backed check of the invoice workflow (confirm, cancel, bulk confirm, list, detail, send).
// Run: npm run check:invoices   Needs a database with the schema pushed.
// Only creates (and afterwards deletes) rows prefixed TEST-INV / INV-TESTINV / test-inv-, and the bulk confirm is
// scoped to those rows, so real data is never touched. Refuses a non-local database unless ALLOW_REMOTE_TEST_DB=1.
import assert from "node:assert/strict";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { InvoiceError, cancelInvoice, confirmDrafts, confirmInvoice, getInvoice, listInvoices, listQuery, sendInvoice } from "../src/lib/billing/invoices";

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

const NOW = new Date("2020-06-15T00:00:00.000Z");
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  const inv = { invoice: { number: { startsWith: "INV-TESTINV" } } };
  await db.payment.deleteMany({ where: inv });
  await db.invoice.deleteMany({ where: { number: { startsWith: "INV-TESTINV" } } });
  await db.subscription.deleteMany({ where: { number: { startsWith: "TEST-INV" } } });
  await db.plan.deleteMany({ where: { name: { startsWith: "TEST-INV" } } });
  await db.user.deleteMany({ where: { email: { startsWith: "test-inv-" } } });
}

async function rejects(p: Promise<unknown>, status: number, message: RegExp) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof InvoiceError, `expected InvoiceError, got ${e}`);
    assert.equal(e.status, status, e.message);
    assert.match(e.message, message);
    return;
  }
  assert.fail("expected the call to be refused, but it succeeded");
}

async function main() {
  await cleanup();

  const mkUser = (key: string, name: string, role: "CUSTOMER" | "STAFF" = "CUSTOMER") =>
    db.user.create({ data: { email: `test-inv-${key}@brightloop.test`, name, passwordHash: "x", role } });
  const asha = await mkUser("asha", "Asha TestInv");
  const bhanu = await mkUser("bhanu", "Bhanu TestInv");
  const staff = await mkUser("staff", "Test Inv Staff", "STAFF");
  const plan = await db.plan.create({ data: { name: "TEST-INV Monthly", price: 1000, period: "MONTHLY", startDate: day("2019-01-01") } });
  const mkSub = (n: string, customerId: string) =>
    db.subscription.create({ data: { number: `TEST-INV-${n}`, customerId, planId: plan.id, status: "ACTIVE", startDate: day("2019-01-01"), paymentTerms: "NET_30" } });
  const s1 = await mkSub("001", asha.id);
  const s2 = await mkSub("002", bhanu.id);
  const sBulk = await mkSub("BULK", asha.id);

  let counter = 0;
  const mkInv = async (o: { sub: { id: string }; customer: { id: string }; status: InvoiceStatus; periodStart: string; issue?: string; due?: string; payments?: number[]; key?: string }) => {
    const inv = await db.invoice.create({
      data: {
        number: `INV-TESTINV-${o.key ?? ++counter}`,
        subscriptionId: o.sub.id,
        customerId: o.customer.id,
        status: o.status,
        periodStart: day(o.periodStart),
        periodEnd: day("2030-01-01"),
        issueDate: day(o.issue ?? "2020-01-05"),
        dueDate: day(o.due ?? "2020-02-05"),
        subtotal: 1000,
        taxTotal: 180,
        total: 1180,
        lines: { create: [{ description: "CRM <b>line</b>", quantity: 1, unitPrice: 1000, taxPercent: 18, amount: 1000 }] },
      },
    });
    for (const amount of o.payments ?? [])
      await db.payment.create({ data: { invoiceId: inv.id, method: "CASH", amount, paidAt: day("2020-02-01"), recordedById: staff.id } });
    return inv;
  };
  const statusOf = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).status;
  let ps = 0; // distinct periodStart per invoice (unique with subscription)
  const period = () => `2019-${String(1 + Math.floor(ps / 28)).padStart(2, "0")}-${String(1 + (ps++ % 28)).padStart(2, "0")}`;

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

  // ---------------- confirm ----------------
  await check("confirm: DRAFT becomes CONFIRMED", async () => {
    const i = await mkInv({ sub: s1, customer: asha, status: "DRAFT", periodStart: period() });
    assert.equal((await confirmInvoice(i.id)).status, "CONFIRMED");
    assert.equal(await statusOf(i.id), "CONFIRMED");
  });
  await check("confirm: anything but DRAFT is refused with 409 and left unchanged", async () => {
    for (const status of ["CONFIRMED", "PAID", "CANCELLED"] as const) {
      const i = await mkInv({ sub: s1, customer: asha, status, periodStart: period() });
      await rejects(confirmInvoice(i.id), 409, new RegExp(`Cannot confirm a ${status} invoice`));
      assert.equal(await statusOf(i.id), status);
    }
  });
  await check("confirm: unknown id is 404", () => rejects(confirmInvoice("does-not-exist"), 404, /not found/i));
  await check("confirm: two clicks at once, exactly one wins", async () => {
    const i = await mkInv({ sub: s1, customer: asha, status: "DRAFT", periodStart: period() });
    const out = await Promise.allSettled([confirmInvoice(i.id), confirmInvoice(i.id)]);
    assert.equal(out.filter((o) => o.status === "fulfilled").length, 1);
    const lost = out.find((o) => o.status === "rejected") as PromiseRejectedResult;
    assert.equal((lost.reason as InvoiceError).status, 409);
  });

  // ---------------- cancel ----------------
  await check("cancel: DRAFT and CONFIRMED (no payments) become CANCELLED", async () => {
    for (const status of ["DRAFT", "CONFIRMED"] as const) {
      const i = await mkInv({ sub: s1, customer: asha, status, periodStart: period() });
      assert.equal((await cancelInvoice(i.id)).status, "CANCELLED");
      assert.equal(await statusOf(i.id), "CANCELLED");
    }
  });
  await check("cancel: refused once there are payments, and the invoice stays CONFIRMED", async () => {
    const i = await mkInv({ sub: s1, customer: asha, status: "CONFIRMED", periodStart: period(), payments: [100] });
    await rejects(cancelInvoice(i.id), 409, /has payments/);
    assert.equal(await statusOf(i.id), "CONFIRMED");
  });
  await check("cancel: PAID and already CANCELLED are refused, unknown id is 404", async () => {
    for (const status of ["PAID", "CANCELLED"] as const) {
      const i = await mkInv({ sub: s1, customer: asha, status, periodStart: period() });
      await rejects(cancelInvoice(i.id), 409, new RegExp(`Cannot cancel a ${status} invoice`));
    }
    await rejects(cancelInvoice("does-not-exist"), 404, /not found/i);
  });
  await check("cancel: the period stays locked, the same period can never get a second invoice", async () => {
    const p = period();
    const i = await mkInv({ sub: s1, customer: asha, status: "DRAFT", periodStart: p });
    await cancelInvoice(i.id);
    await assert.rejects(mkInv({ sub: s1, customer: asha, status: "DRAFT", periodStart: p }), (e: { code?: string }) => e.code === "P2002");
  });
  await check("cancel waits for an in-flight payment (row lock) and then refuses", async () => {
    const i = await mkInv({ sub: s1, customer: asha, status: "CONFIRMED", periodStart: period() });
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holding = new Promise<void>((r) => (locked = r));
    // what P1's payment transaction does: lock the invoice row, insert the payment, commit later
    const payer = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${i.id} FOR UPDATE`;
        await tx.payment.create({ data: { invoiceId: i.id, method: "CASH", amount: 100, paidAt: day("2020-02-01"), recordedById: staff.id } });
        locked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await holding;
    let settled = false;
    const cancelling = cancelInvoice(i.id).then(
      () => "cancelled" as const,
      (e: unknown) => e,
    );
    void cancelling.then(() => (settled = true));
    await sleep(400);
    assert.equal(settled, false, "cancel did not wait for the payment transaction");
    release();
    await payer;
    const outcome = await cancelling;
    assert.ok(outcome instanceof InvoiceError && outcome.status === 409 && /has payments/.test(outcome.message), String(outcome));
    assert.equal(await statusOf(i.id), "CONFIRMED");
  });

  // ---------------- bulk confirm ----------------
  await check("confirmDrafts(ids): only the listed DRAFTs are confirmed, the rest counted as skipped", async () => {
    const [d1, d2, other] = await Promise.all([
      mkInv({ sub: s2, customer: bhanu, status: "DRAFT", periodStart: period() }),
      mkInv({ sub: s2, customer: bhanu, status: "DRAFT", periodStart: period() }),
      mkInv({ sub: s2, customer: bhanu, status: "DRAFT", periodStart: period() }), // not listed: must stay DRAFT
    ]);
    const paid = await mkInv({ sub: s2, customer: bhanu, status: "PAID", periodStart: period() });
    const r = await confirmDrafts([d1.id, d2.id, paid.id, "does-not-exist"], { customerId: bhanu.id });
    assert.deepEqual(r, { confirmed: 2, skipped: 2 });
    assert.equal(await statusOf(d1.id), "CONFIRMED");
    assert.equal(await statusOf(other.id), "DRAFT");
    assert.equal(await statusOf(paid.id), "PAID");
  });
  await check("confirmDrafts(): 600 drafts confirmed in one go, in well under 2 s", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      number: `INV-TESTINV-BULK-${i}`,
      subscriptionId: sBulk.id,
      customerId: asha.id,
      status: "DRAFT" as const,
      periodStart: new Date(day("2015-01-01").getTime() + i * 86_400_000),
      periodEnd: day("2030-01-01"),
      dueDate: day("2020-02-05"),
      subtotal: 1000,
      taxTotal: 180,
      total: 1180,
    }));
    await db.invoice.createMany({ data: rows });
    const t0 = Date.now();
    const r = await confirmDrafts(undefined, { subscriptionId: sBulk.id });
    const ms = Date.now() - t0;
    assert.equal(r.confirmed, 600);
    assert.equal(await db.invoice.count({ where: { subscriptionId: sBulk.id, status: "DRAFT" } }), 0);
    assert.ok(ms < 2000, `took ${ms} ms`);
  });

  // ---------------- list ----------------
  const a1 = await mkInv({ key: "A1", sub: s1, customer: asha, status: "DRAFT", periodStart: period(), issue: "2020-01-10", due: "2020-02-10" });
  const a2 = await mkInv({ key: "A2", sub: s1, customer: asha, status: "CONFIRMED", periodStart: period(), issue: "2019-12-01", due: "2020-01-01" });
  const a3 = await mkInv({ key: "A3", sub: s1, customer: asha, status: "CONFIRMED", periodStart: period(), issue: "2020-02-02", due: "2020-07-01", payments: [400] });
  const a4 = await mkInv({ key: "A4", sub: s1, customer: asha, status: "PAID", periodStart: period(), issue: "2020-03-03", due: "2020-04-03", payments: [1180] });
  const b1 = await mkInv({ key: "B1", sub: s2, customer: bhanu, status: "CANCELLED", periodStart: period(), issue: "2020-04-04", due: "2020-05-04" });
  const b2 = await mkInv({ key: "B2", sub: s2, customer: bhanu, status: "CONFIRMED", periodStart: period(), issue: "2020-05-05", due: "2020-05-30" });
  const list = (q: Record<string, string>) => listInvoices(listQuery.parse(q), NOW);
  const ids = (r: { items: { id: string }[] }) => r.items.map((x) => x.id).sort();
  const sorted = (...xs: { id: string }[]) => xs.map((x) => x.id).sort();
  // every list test is scoped to the fixtures with q=TestInv (customer names)
  await check("list: filters by status, customer, subscription", async () => {
    assert.equal((await list({ q: "TestInv", status: "CONFIRMED", customerId: asha.id, subscriptionId: s1.id, pageSize: "100" })).items.filter((i) => ["A2", "A3"].some((k) => i.number.endsWith(k))).length, 2);
    // earlier tests also left PAID/CANCELLED invoices behind, so check "all have this status" + "target included"
    for (const [status, target] of [["PAID", a4], ["CANCELLED", b1]] as const) {
      const r = await list({ q: "TestInv", status, pageSize: "100" });
      assert.ok(r.items.length > 0 && r.items.every((i) => i.status === status), status);
      assert.ok(ids(r).includes(target.id), `${status} list is missing its invoice`);
      assert.ok(!ids(r).includes(a1.id), "a DRAFT leaked into the filtered list");
    }
    assert.equal((await list({ q: "TestInv", status: "DRAFT", pageSize: "100" })).items.some((i) => i.id === a4.id), false);
    // Bhanu also owns the invoices from the bulk-confirm test, so check ownership + total, not an exact set
    const byCustomer = await list({ customerId: bhanu.id, pageSize: "100" });
    assert.equal(byCustomer.total, await db.invoice.count({ where: { customerId: bhanu.id } }));
    assert.ok(byCustomer.items.every((i) => i.customer.id === bhanu.id));
    assert.ok([b1, b2].every((x) => ids(byCustomer).includes(x.id)));
    assert.ok(!ids(byCustomer).includes(a1.id));
    const bySub = await list({ subscriptionId: s2.id, pageSize: "100" });
    assert.ok(bySub.items.every((i) => i.subscription.id === s2.id));
    assert.equal(bySub.total, await db.invoice.count({ where: { subscriptionId: s2.id } }));
  });
  await check("list: search by invoice number and by customer name/email, case-insensitive", async () => {
    assert.deepEqual(ids(await list({ q: "inv-testinv-a2" })), sorted(a2));
    assert.deepEqual(ids(await list({ q: "BHANU", pageSize: "100" })), (await db.invoice.findMany({ where: { customerId: bhanu.id }, select: { id: true } })).map((x) => x.id).sort());
    assert.deepEqual(ids(await list({ q: "test-inv-bhanu@", pageSize: "100" })).length, (await db.invoice.count({ where: { customerId: bhanu.id } })));
  });
  await check("list: issue-date range is inclusive on both ends", async () => {
    assert.deepEqual(ids(await list({ customerId: asha.id, subscriptionId: s1.id, from: "2020-01-10", to: "2020-01-10" })), sorted(a1));
    const r = await list({ customerId: asha.id, subscriptionId: s1.id, from: "2020-01-01", to: "2020-03-03", pageSize: "100" });
    assert.ok([a1, a3, a4].every((x) => ids(r).includes(x.id)) && !ids(r).includes(a2.id));
  });
  await check("list: overdue=1 returns only CONFIRMED invoices due before today, with days overdue", async () => {
    const r = await list({ q: "TestInv", overdue: "1", pageSize: "100" });
    const mine = r.items.filter((i) => ["A2", "B2"].some((k) => i.number.endsWith(`-${k}`)));
    assert.equal(mine.length, 2);
    assert.ok(r.items.every((i) => i.status === "CONFIRMED" && i.overdue));
    assert.equal(r.items.find((i) => i.id === a2.id)!.daysOverdue, 166); // 2020-01-01 -> 2020-06-15
    assert.equal(r.items.find((i) => i.id === b2.id)!.daysOverdue, 16); // 2020-05-30 -> 2020-06-15
    assert.equal((await list({ q: "TestInv", overdue: "1", status: "DRAFT" })).total, 0);
  });
  await check("list: paid / outstanding / overdue are computed per row", async () => {
    const r = await list({ customerId: asha.id, subscriptionId: s1.id, pageSize: "100" });
    const by = (id: string) => r.items.find((i) => i.id === id)!;
    assert.deepEqual([by(a3.id).paid, by(a3.id).outstanding, by(a3.id).overdue], ["400.00", "780.00", false]);
    assert.deepEqual([by(a4.id).paid, by(a4.id).outstanding], ["1180.00", "0.00"]);
    assert.deepEqual([by(a1.id).paid, by(a1.id).outstanding, by(a1.id).overdue], ["0.00", "1180.00", false]);
    assert.equal(by(a2.id).overdue, true);
    assert.equal(by(a4.id).overdue, false);
  });
  await check("list: pagination has stable order, no overlap, correct totals", async () => {
    const q = { customerId: bhanu.id };
    const total = await db.invoice.count({ where: { customerId: bhanu.id } });
    const p1 = await list({ ...q, pageSize: "1", page: "1" });
    const p2 = await list({ ...q, pageSize: "1", page: "2" });
    assert.equal(p1.total, total);
    assert.equal(p1.totalPages, total);
    assert.equal(p1.items.length, 1);
    assert.notEqual(p1.items[0].id, p2.items[0].id);
    assert.equal((await list({ ...q, pageSize: "1", page: String(total + 1) })).items.length, 0);
    const again = await list({ ...q, pageSize: "1", page: "1" });
    assert.equal(again.items[0].id, p1.items[0].id); // same order twice
  });
  await check("list: row shape is plain strings (no Decimal/Date objects, no secrets)", async () => {
    const r = await list({ customerId: asha.id, subscriptionId: s1.id });
    const row = r.items[0];
    assert.equal(typeof row.total, "string");
    assert.equal(typeof row.dueDate, "string");
    const json = JSON.stringify(r);
    assert.ok(!/passwordHash|resetToken/.test(json));
    assert.deepEqual(Object.keys(row.customer).sort(), ["email", "id", "name"]);
  });
  await check("list: bad query values are rejected", () => {
    for (const bad of [{ pageSize: "101" }, { page: "0" }, { status: "BOGUS" }, { from: "31-12-2020" }, { overdue: "maybe" }, { q: "   " }])
      assert.equal(listQuery.safeParse(bad).success, false, JSON.stringify(bad));
    assert.equal(listQuery.safeParse({}).success, true);
    assert.equal(listQuery.parse({}).pageSize, 25);
  });

  // ---------------- detail ----------------
  await check("detail: lines, payments and totals, plain values, no secrets", async () => {
    const d = await getInvoice(a3.id, NOW);
    assert.equal(d.number, "INV-TESTINV-A3");
    assert.equal(d.total, "1180.00");
    assert.equal(d.lines.length, 1);
    assert.equal(d.lines[0].unitPrice, "1000.00");
    assert.equal(d.payments.length, 1);
    assert.equal(d.payments[0].recordedBy.name, "Test Inv Staff");
    assert.equal(d.outstanding, "780.00");
    assert.deepEqual(Object.keys(d.customer).sort(), ["email", "id", "name"]);
    assert.ok(!/passwordHash|resetToken/.test(JSON.stringify(d)));
  });
  await check("detail: unknown id is 404", () => rejects(getInvoice("does-not-exist"), 404, /not found/i));

  // ---------------- send ----------------
  const sent: { to: string; subject: string; html: string }[] = [];
  const fake = { sendMail: async (m: { to: string; subject: string; html: string }) => void sent.push(m) };
  await check("send: DRAFT and CANCELLED are refused with 409 and nothing is mailed", async () => {
    await rejects(sendInvoice(a1.id, fake), 409, /Cannot send a DRAFT invoice/);
    await rejects(sendInvoice(b1.id, fake), 409, /Cannot send a CANCELLED invoice/);
    assert.equal(sent.length, 0);
  });
  await check("send: CONFIRMED and PAID are mailed to the customer with a portal link", async () => {
    for (const i of [a3, a4]) {
      const r = await sendInvoice(i.id, fake);
      assert.deepEqual(r, { sent: true, to: "test-inv-asha@brightloop.test" });
    }
    assert.equal(sent.length, 2);
    const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    assert.equal(sent[0].to, "test-inv-asha@brightloop.test");
    assert.match(sent[0].subject, /INV-TESTINV-A3/);
    assert.ok(sent[0].html.includes(`href="${base}/portal/invoices/${a3.id}"`));
    assert.ok(sent[0].html.includes("780.00")); // amount due
  });
  await check("send: line text from the database is escaped in the email", () => {
    assert.ok(sent[0].html.includes("CRM &lt;b&gt;line&lt;/b&gt;"));
    assert.ok(!sent[0].html.includes("<b>line</b>"));
  });
  await check("send: a mail server failure is a 502 with a generic message (no internals)", async () => {
    const down = { sendMail: async () => Promise.reject(new Error("connect ECONNREFUSED smtp.internal.corp:2525 user=secret")) };
    try {
      await sendInvoice(a3.id, down);
      assert.fail("should have failed");
    } catch (e) {
      assert.ok(e instanceof InvoiceError && e.status === 502);
      assert.ok(!/smtp\.internal|ECONNREFUSED|secret/.test(e.message), e.message);
    }
  });
  await check("send: unknown id is 404", () => rejects(sendInvoice("does-not-exist", fake), 404, /not found/i));

  await cleanup();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => db.$disconnect());
