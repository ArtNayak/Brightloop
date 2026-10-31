// Self-check for the pure billing math. Run: npm run check:billing
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { calcInvoice, type Disc, type Line } from "../src/lib/billing/calc";
import { PAYMENT_TERMS, dueDateFor, termsDays } from "../src/lib/billing/terms";

const D = (v: string | number) => new Prisma.Decimal(v);
const fx = (v: Prisma.Decimal) => v.toFixed(2);

function line(productId: string, quantity: number, unitPrice: string, taxPercent = "0", description = productId): Line {
  return { productId, description, quantity, unitPrice: D(unitPrice), taxPercent: D(taxPercent) };
}

function disc(p: Partial<Disc> & Pick<Disc, "id" | "type" | "value" | "scope">): Disc {
  return { minPurchase: null, minQuantity: null, productId: null, ...p } as Disc;
}

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test("no discount: gross, tax per line, totals", () => {
  const r = calcInvoice([line("a", 1, "1000", "18"), line("b", 2, "500", "5")], []);
  assert.deepEqual(r.lines.map((l) => fx(l.gross)), ["1000.00", "1000.00"]);
  assert.deepEqual(r.lines.map((l) => fx(l.tax)), ["180.00", "50.00"]);
  assert.equal(fx(r.subtotal), "2000.00");
  assert.equal(fx(r.discountTotal), "0.00");
  assert.equal(fx(r.taxTotal), "230.00");
  assert.equal(fx(r.total), "2230.00");
  assert.deepEqual(r.appliedDiscountIds, []);
});

test("10% product discount with 18% tax (CRM 1000 + Odoo 560)", () => {
  const r = calcInvoice(
    [line("crm", 1, "1560", "18")],
    [disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "PRODUCT", productId: "crm" })],
  );
  assert.equal(fx(r.lines[0].discountAmount), "156.00");
  assert.equal(fx(r.lines[0].amount), "1404.00");
  assert.equal(fx(r.lines[0].tax), "252.72");
  assert.equal(fx(r.subtotal), "1560.00");
  assert.equal(fx(r.discountTotal), "156.00");
  assert.equal(fx(r.total), "1656.72");
  assert.deepEqual(r.appliedDiscountIds, ["d1"]);
});

test("fixed discount larger than the line is capped at the line", () => {
  const r = calcInvoice(
    [line("a", 1, "300", "18")],
    [disc({ id: "d1", type: "FIXED", value: D(500), scope: "SUBSCRIPTION" })],
  );
  assert.equal(fx(r.lines[0].discountAmount), "300.00");
  assert.equal(fx(r.lines[0].amount), "0.00");
  assert.equal(fx(r.taxTotal), "0.00");
  assert.equal(fx(r.total), "0.00");
});

test("minQuantity not met: discount skipped", () => {
  const r = calcInvoice(
    [line("a", 3, "100")],
    [disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "PRODUCT", productId: "a", minQuantity: 5 })],
  );
  assert.equal(fx(r.discountTotal), "0.00");
  assert.deepEqual(r.appliedDiscountIds, []);
});

test("minQuantity met exactly: discount applies", () => {
  const r = calcInvoice(
    [line("a", 5, "100")],
    [disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "PRODUCT", productId: "a", minQuantity: 5 })],
  );
  assert.equal(fx(r.discountTotal), "50.00");
});

test("minPurchase: below skipped, equal applies", () => {
  const d = disc({ id: "d1", type: "FIXED", value: D(20), scope: "SUBSCRIPTION", minPurchase: D(150) });
  assert.equal(fx(calcInvoice([line("a", 1, "100")], [d]).discountTotal), "0.00");
  assert.equal(fx(calcInvoice([line("a", 1, "150")], [d]).discountTotal), "20.00");
});

test("subscription 10% across 2 lines with different taxes", () => {
  const r = calcInvoice(
    [line("a", 1, "33.33", "18"), line("b", 1, "66.67", "5")],
    [disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "SUBSCRIPTION" })],
  );
  assert.deepEqual(r.lines.map((l) => fx(l.discountAmount)), ["3.33", "6.67"]);
  assert.deepEqual(r.lines.map((l) => fx(l.amount)), ["30.00", "60.00"]);
  assert.deepEqual(r.lines.map((l) => fx(l.tax)), ["5.40", "3.00"]);
  assert.equal(fx(r.total), "98.40");
});

test("odd cent remainder: 0.05 fixed over 3 equal lines sums exactly", () => {
  const r = calcInvoice(
    [line("a", 1, "10"), line("b", 1, "10"), line("c", 1, "10")],
    [disc({ id: "d1", type: "FIXED", value: D("0.05"), scope: "SUBSCRIPTION" })],
  );
  assert.deepEqual(r.lines.map((l) => fx(l.discountAmount)), ["0.02", "0.02", "0.01"]);
  assert.equal(fx(r.discountTotal), "0.05");
});

test("product discount only touches that product's lines, spread proportionally", () => {
  const r = calcInvoice(
    [line("p1", 1, "10", "0", "p1 small"), line("p1", 1, "20", "0", "p1 big"), line("p2", 1, "100")],
    [disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "PRODUCT", productId: "p1" })],
  );
  assert.deepEqual(r.lines.map((l) => fx(l.discountAmount)), ["1.00", "2.00", "0.00"]);
  assert.equal(fx(r.discountTotal), "3.00");
});

test("stacking: every eligible discount applies but a line never goes below zero", () => {
  const r = calcInvoice(
    [line("a", 1, "100")],
    [
      disc({ id: "d1", type: "PERCENTAGE", value: D(60), scope: "SUBSCRIPTION" }),
      disc({ id: "d2", type: "PERCENTAGE", value: D(60), scope: "SUBSCRIPTION" }),
    ],
  );
  assert.equal(fx(r.lines[0].discountAmount), "100.00");
  assert.equal(fx(r.lines[0].amount), "0.00");
  assert.equal(fx(r.discountTotal), "100.00");
  assert.deepEqual(r.appliedDiscountIds, ["d1", "d2"]);
});

test("stacking: each discount is computed on the original amount, not the reduced one", () => {
  const r = calcInvoice(
    [line("a", 1, "100")],
    [
      disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "SUBSCRIPTION" }),
      disc({ id: "d2", type: "PERCENTAGE", value: D(10), scope: "SUBSCRIPTION" }),
    ],
  );
  assert.equal(fx(r.discountTotal), "20.00"); // not 19.00
});

test("a discount that ends up removing nothing is not reported as applied", () => {
  const r = calcInvoice(
    [line("a", 1, "100")],
    [
      disc({ id: "d1", type: "PERCENTAGE", value: D(100), scope: "SUBSCRIPTION" }),
      disc({ id: "d2", type: "FIXED", value: D(10), scope: "SUBSCRIPTION" }),
    ],
  );
  assert.equal(fx(r.discountTotal), "100.00");
  assert.deepEqual(r.appliedDiscountIds, ["d1"]);
});

test("zero cases: no lines, zero-value discount, zero-price line", () => {
  const empty = calcInvoice([], [disc({ id: "d1", type: "FIXED", value: D(10), scope: "SUBSCRIPTION" })]);
  assert.equal(fx(empty.total), "0.00");
  assert.deepEqual(empty.appliedDiscountIds, []);
  const zero = calcInvoice(
    [line("a", 1, "100")],
    [disc({ id: "d1", type: "FIXED", value: D(0), scope: "SUBSCRIPTION" })],
  );
  assert.deepEqual(zero.appliedDiscountIds, []);
  assert.equal(fx(calcInvoice([line("a", 2, "0", "18")], []).total), "0.00");
});

test("rounds half up: 0.005 -> 0.01", () => {
  const r = calcInvoice([line("a", 1, "0.05", "10")], []); // tax 0.005
  assert.equal(fx(r.lines[0].tax), "0.01");
  assert.equal(fx(r.total), "0.06");
  const r2 = calcInvoice(
    [line("a", 1, "0.05")],
    [disc({ id: "d1", type: "PERCENTAGE", value: D(10), scope: "SUBSCRIPTION" })], // discount 0.005
  );
  assert.equal(fx(r2.discountTotal), "0.01");
});

test("tax is rounded per line, then summed", () => {
  // each line tax = 0.005 -> 0.01; three lines = 0.03 (not round(0.015) = 0.02)
  const r = calcInvoice([line("a", 1, "0.05", "10"), line("b", 1, "0.05", "10"), line("c", 1, "0.05", "10")], []);
  assert.equal(fx(r.taxTotal), "0.03");
});

test("payment terms -> due date", () => {
  assert.deepEqual([...PAYMENT_TERMS], ["IMMEDIATE", "NET_15", "NET_30", "NET_45"]);
  assert.equal(termsDays("IMMEDIATE"), 0);
  assert.equal(termsDays("NET_15"), 15);
  assert.equal(termsDays("NET_30"), 30);
  assert.equal(termsDays("NET_45"), 45);
  assert.equal(termsDays(null), 0);
  assert.throws(() => termsDays("Net 15"));
  const issued = new Date("2026-01-20T00:00:00.000Z");
  assert.equal(dueDateFor(issued, "NET_15").toISOString(), "2026-02-04T00:00:00.000Z");
  assert.equal(dueDateFor(issued, "IMMEDIATE").toISOString(), issued.toISOString());
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n").join("\n       ")}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
