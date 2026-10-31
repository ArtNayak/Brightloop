// DB-backed check of the billing run. Run: npm run check:billing-run
// Needs a database with the schema pushed. It only creates (and afterwards deletes) rows prefixed TEST-RUN, and
// bills only those subscriptions (runBilling's `only` scope) at a fixed date in 2020, so real/seeded data is never
// billed or discounted. Refuses to run against a non-local database unless ALLOW_REMOTE_TEST_DB=1.
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { describeFailure, runBilling } from "../src/lib/billing/run";

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

const P = "TEST-RUN";
const NOW = new Date("2020-06-15T00:00:00.000Z");
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const nums = (...n: string[]) => ({ number: { in: n } });
const fx = (v: Prisma.Decimal) => v.toFixed(2);

async function cleanup() {
  await db.invoice.deleteMany({ where: { subscription: { number: { startsWith: P } } } });
  await db.subscription.deleteMany({ where: { number: { startsWith: P } } });
  await db.discount.deleteMany({ where: { name: { startsWith: P } } });
  await db.product.deleteMany({ where: { name: { startsWith: P } } });
  await db.plan.deleteMany({ where: { name: { startsWith: P } } });
  await db.tax.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "test-run-" } } });
}

type L = { productId: string; variantId?: string; quantity: number; unitPrice: number; taxId?: string };
type S = { planId: string; start: string; next: string; terms?: string; paused?: boolean; expiry?: string; lines: L[] };

async function main() {
  await cleanup(); // leftovers from a crashed earlier run

  const customer = await db.user.create({ data: { email: "test-run-customer@brightloop.test", name: "Test Run", passwordHash: "x", role: "CUSTOMER" } });
  const gst18 = await db.tax.create({ data: { name: `${P} GST 18%`, ratePercent: 18 } });
  const gst5 = await db.tax.create({ data: { name: `${P} GST 5%`, ratePercent: 5 } });
  const crm = await db.product.create({ data: { name: `${P} CRM`, type: "Software", salesPrice: 1000, costPrice: 400, taxId: gst18.id } });
  const odoo = await db.productVariant.create({ data: { productId: crm.id, attribute: "Brand", value: "Odoo", extraPrice: 560 } });
  const support = await db.product.create({ data: { name: `${P} Support`, type: "Add-on", salesPrice: 250, costPrice: 100, taxId: gst5.id } });
  const plan = (name: string, period: "DAILY" | "MONTHLY" | "YEARLY") =>
    db.plan.create({ data: { name: `${P} ${name}`, price: 1000, period, startDate: day("2019-01-01") } });
  const monthly = await plan("Monthly", "MONTHLY");
  const yearly = await plan("Yearly", "YEARLY");
  const daily = await plan("Daily", "DAILY");
  const discount = await db.discount.create({
    data: { name: `${P} 10% off CRM (1 use)`, type: "PERCENTAGE", value: 10, startDate: day("2020-01-01"), usageLimit: 1, scope: "PRODUCT", productId: crm.id },
  });

  const mk = (number: string, o: S) =>
    db.subscription.create({
      data: {
        number: `${P}-${number}`,
        customerId: customer.id,
        planId: o.planId,
        status: "ACTIVE",
        paused: o.paused ?? false,
        startDate: day(o.start),
        expiryDate: o.expiry ? day(o.expiry) : null,
        paymentTerms: o.terms ?? "NET_30",
        nextBillingDate: day(o.next),
        lines: { create: o.lines.map((l) => ({ ...l, amount: l.quantity * l.unitPrice })) },
      },
    });
  const crmLine = (q: number, withOdoo = false): L =>
    withOdoo ? { productId: crm.id, variantId: odoo.id, quantity: q, unitPrice: 1560, taxId: gst18.id } : { productId: crm.id, quantity: q, unitPrice: 1000, taxId: gst18.id };
  const supportLine: L = { productId: support.id, quantity: 1, unitPrice: 250, taxId: gst5.id };
  const plain100: L = { productId: support.id, quantity: 1, unitPrice: 100 }; // no tax

  const invoicesOf = (number: string) =>
    db.invoice.findMany({ where: { subscription: { number: `${P}-${number}` } }, orderBy: { periodStart: "asc" }, include: { lines: true } });
  const periods = (inv: { periodStart: Date; periodEnd: Date }[]) => inv.map((i) => `${iso(i.periodStart)}>${iso(i.periodEnd)}`);
  const subOf = (number: string) => db.subscription.findUniqueOrThrow({ where: { number: `${P}-${number}` } });

  const results: [string, boolean, string?][] = [];
  const check = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      results.push([name, true]);
      console.log(`  ok   ${name}`);
    } catch (e) {
      results.push([name, false, (e as Error).message]);
      console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n").join("\n       ")}`);
    }
  };

  // ---------------- main scenario: one run, then the same run again ----------------
  await mk("001", { planId: monthly.id, start: "2020-03-31", next: "2020-03-31", lines: [crmLine(2, true), supportLine] }); // clamps to Apr 30
  await mk("002", { planId: yearly.id, start: "2020-06-01", next: "2020-06-01", terms: "IMMEDIATE", lines: [crmLine(1)] });
  await mk("003", { planId: monthly.id, start: "2020-04-01", next: "2020-05-01", paused: true, lines: [supportLine] });
  await mk("004", { planId: monthly.id, start: "2020-04-01", next: "2020-05-01", lines: [] });
  await mk("005", { planId: monthly.id, start: "2019-01-15", next: "2020-04-15", expiry: "2020-05-15", lines: [supportLine] });
  await mk("006", { planId: monthly.id, start: "2020-01-31", next: "2020-01-31", terms: "NET_15", lines: [plain100] }); // Jan 31, Feb 29 (leap), Mar 31...
  await mk("007", { planId: monthly.id, start: "2020-04-01", next: "2020-05-01", terms: "Net 15", lines: [crmLine(1)] }); // bad terms -> fails alone
  const main = nums("001", "002", "003", "004", "005", "006", "007").number.in.map((n) => `${P}-${n}`);
  const scope = { number: { in: main } };

  const r1 = await runBilling(NOW, scope);
  await check("run 1 summary: 10 invoices, 1 skipped (no lines), 1 failed (bad terms)", () => {
    assert.equal(r1.created, 10);
    assert.equal(r1.alreadyBilled, 0);
    assert.equal(r1.skipped, 1);
    assert.equal(r1.failed.length, 1);
    assert.equal(r1.failed[0].subscription, `${P}-007`);
    assert.match(r1.failed[0].error, /Unknown payment terms/);
  });
  await check("catch-up bills each missed period once, clamped to month end (Mar 31 -> Apr 30)", async () => {
    assert.deepEqual(periods(await invoicesOf("001")), ["2020-03-31>2020-04-30", "2020-04-30>2020-05-31", "2020-05-31>2020-06-30"]);
  });
  await check("Jan 31 monthly never drifts: Jan 31, Feb 29, Mar 31, Apr 30, May 31", async () => {
    assert.deepEqual(periods(await invoicesOf("006")), [
      "2020-01-31>2020-02-29",
      "2020-02-29>2020-03-31",
      "2020-03-31>2020-04-30",
      "2020-04-30>2020-05-31",
      "2020-05-31>2020-06-30",
    ]);
  });
  await check("yearly subscription bills one year, IMMEDIATE terms due the same day", async () => {
    const [inv, ...rest] = await invoicesOf("002");
    assert.equal(rest.length, 0);
    assert.equal(`${iso(inv.periodStart)}>${iso(inv.periodEnd)}`, "2020-06-01>2021-06-01");
    assert.equal(inv.dueDate.toISOString(), NOW.toISOString());
  });
  await check("NET_30 due date = issue date + 30 days; invoices start as DRAFT", async () => {
    const [inv] = await invoicesOf("001");
    assert.equal(inv.status, "DRAFT");
    assert.equal(iso(inv.dueDate), "2020-07-15");
  });
  await check("paused and no-lines subscriptions are not billed and not advanced", async () => {
    for (const n of ["003", "004"]) {
      assert.equal((await invoicesOf(n)).length, 0);
      assert.equal(iso((await subOf(n)).nextBillingDate!), "2020-05-01");
    }
  });
  await check("subscription past its expiry is billed up to expiry and not beyond", async () => {
    assert.deepEqual(periods(await invoicesOf("005")), ["2020-04-15>2020-05-15"]);
  });
  await check("a failing subscription rolls back completely (no invoice, not advanced, no discount used)", async () => {
    assert.equal((await invoicesOf("007")).length, 0);
    assert.equal(iso((await subOf("007")).nextBillingDate!), "2020-05-01");
  });
  await check("subscription pointer moves to the end of the last billed period", async () => {
    assert.equal(iso((await subOf("001")).nextBillingDate!), "2020-06-30");
    assert.equal(iso((await subOf("002")).nextBillingDate!), "2021-06-01");
    assert.equal(iso((await subOf("005")).nextBillingDate!), "2020-05-15");
  });
  await check("usageLimit 1 across several due invoices: exactly one invoice gets the discount", async () => {
    const all = await db.invoice.findMany({ where: { subscription: { number: { in: main } } }, include: { lines: true } });
    const discounted = all.filter((i) => i.discountTotal.gt(0));
    assert.equal(discounted.length, 1);
    assert.equal((await db.discount.findUniqueOrThrow({ where: { id: discount.id } })).timesUsed, 1);
    const crmLineRow = discounted[0].lines.find((l) => l.discountAmount.gt(0))!;
    assert.equal(fx(crmLineRow.discountAmount), fx(crmLineRow.unitPrice.mul(crmLineRow.quantity).div(10))); // 10% of that line
  });
  await check("every invoice adds up: lines = subtotal - discount, total = subtotal - discount + tax", async () => {
    const all = await db.invoice.findMany({ where: { subscription: { number: { in: main } } }, include: { lines: true } });
    assert.equal(all.length, 10);
    for (const i of all) {
      const lineSum = i.lines.reduce((a, l) => a.plus(l.amount), new Prisma.Decimal(0));
      assert.equal(fx(lineSum), fx(i.subtotal.minus(i.discountTotal)), i.number);
      assert.equal(fx(i.total), fx(i.subtotal.minus(i.discountTotal).plus(i.taxTotal)), i.number);
    }
  });
  await check("tax and totals come from the line snapshot (support pack 250 @5% = 262.50; untaxed 100 = 100.00)", async () => {
    assert.equal(fx((await invoicesOf("005"))[0].total), "262.50");
    assert.equal(fx((await invoicesOf("006"))[0].total), "100.00");
  });
  await check("invoice description includes the variant", async () => {
    const lines = (await invoicesOf("001"))[0].lines.map((l) => l.description).sort();
    assert.ok(lines.includes(`${P} CRM (Brand: Odoo)`), lines.join(" | "));
  });

  // run 2: the same run again must change nothing
  const r2 = await runBilling(NOW, scope);
  await check("run 2: nothing created, nothing billed twice (still 10 invoices)", async () => {
    assert.equal(r2.created, 0);
    assert.equal(r2.skipped, 2); // no lines + expired
    assert.equal(r2.failed.length, 1); // bad terms still bad
    assert.equal(await db.invoice.count({ where: { subscription: { number: { in: main } } } }), 10);
  });
  await check("invoice numbers are unique and gapless", async () => {
    const n = (await db.invoice.findMany({ where: { subscription: { number: { in: main } } }, select: { number: true } })).map((i) => Number(i.number.slice(4))).sort((a, b) => a - b);
    assert.equal(new Set(n).size, n.length);
    assert.ok(n.every((v, i) => v === n[0] + i), n.join(","));
  });

  // ---------------- catch-up cap ----------------
  await mk("CAP", { planId: daily.id, start: "2020-05-01", next: "2020-05-01", lines: [plain100] }); // 46 daily periods due
  await check("catch-up is capped at 24 periods per run and the next run continues (24 then 22)", async () => {
    const a = await runBilling(NOW, nums(`${P}-CAP`));
    assert.equal(a.created, 24);
    const b = await runBilling(NOW, nums(`${P}-CAP`));
    assert.equal(b.created, 22);
    const c = await runBilling(NOW, nums(`${P}-CAP`));
    assert.equal(c.created, 0);
    assert.equal((await invoicesOf("CAP")).length, 46);
  });

  // ---------------- a period that already has an invoice ----------------
  const heal = await mk("HEAL", { planId: monthly.id, start: "2020-04-30", next: "2020-04-30", lines: [plain100] });
  await db.invoice.create({
    data: { number: "INV-TESTRUN-CANCELLED", subscriptionId: heal.id, customerId: customer.id, status: "CANCELLED", periodStart: day("2020-04-30"), periodEnd: day("2020-05-30"), dueDate: day("2020-05-30"), subtotal: 100, taxTotal: 0, total: 100 },
  });
  await check("a cancelled invoice keeps its period locked: no duplicate, billing moves on to the next period", async () => {
    const r = await runBilling(NOW, nums(`${P}-HEAL`));
    assert.equal(r.created, 1);
    assert.equal(r.alreadyBilled, 1);
    assert.deepEqual(periods(await invoicesOf("HEAL")), ["2020-04-30>2020-05-30", "2020-05-30>2020-06-30"]);
  });

  // ---------------- two runs at the same time ----------------
  const group = async (prefix: string, count: number) => {
    const names: string[] = [];
    for (let i = 1; i <= count; i++) {
      await mk(`${prefix}${i}`, { planId: monthly.id, start: "2020-04-01", next: "2020-04-01", lines: [plain100] }); // 3 periods each
      names.push(`${P}-${prefix}${i}`);
    }
    return names;
  };
  const overlap = await group("OV", 3);
  await check("two overlapping runs: no failures, no duplicates, every period billed exactly once", async () => {
    const [a, b] = await Promise.all([runBilling(NOW, nums(...overlap)), runBilling(NOW, nums(...overlap))]);
    assert.deepEqual([...a.failed, ...b.failed], []);
    assert.equal(a.created + b.created, 9);
    assert.equal(await db.invoice.count({ where: { subscription: { number: { in: overlap } } } }), 9);
    const dup = await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) c FROM (SELECT "subscriptionId","periodStart" FROM "Invoice" GROUP BY 1,2 HAVING COUNT(*) > 1) x`;
    assert.equal(Number(dup[0].c), 0);
  });
  const d = await group("DA", 3);
  const e = await group("DB", 3);
  await check("two runs on different subscriptions collide on invoice numbers and still all succeed with unique gapless numbers", async () => {
    const [a, b] = await Promise.all([runBilling(NOW, nums(...d)), runBilling(NOW, nums(...e))]);
    assert.deepEqual([...a.failed, ...b.failed], []);
    assert.equal(a.created + b.created, 18);
    const n = (await db.invoice.findMany({ where: { subscription: { number: { in: [...d, ...e] } } }, select: { number: true } })).map((i) => Number(i.number.slice(4))).sort((x, y) => x - y);
    assert.equal(n.length, 18);
    assert.equal(new Set(n).size, 18);
    assert.ok(n.every((v, i) => v === n[0] + i), n.join(","));
  });

  // ---------------- what the API is allowed to say about a failure ----------------
  await check("failure text never leaks database internals", () => {
    const known = new Prisma.PrismaClientKnownRequestError("Invalid `prisma.x()` at postgres://user:secret@db.internal:5432/app", { code: "P2024", clientVersion: "x" });
    const init = new Prisma.PrismaClientInitializationError("Can't reach database server at `db.internal:5432`", "x");
    for (const err of [known, init]) {
      const out = describeFailure(err);
      assert.ok(!/db\.internal|secret|postgres:/.test(out), out);
    }
    assert.equal(describeFailure(known), "Database error (P2024)");
    assert.equal(describeFailure(new Error("Unknown payment terms \"Net 15\"")), "Unknown payment terms \"Net 15\"");
  });

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
