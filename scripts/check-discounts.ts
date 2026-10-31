// Discount validation/service regression checks. Run: npm run check:discounts
import assert from "node:assert/strict";
import { Prisma, type Discount } from "@prisma/client";
import { discountStatus } from "../src/lib/discount-status";
import {
  createDiscount,
  createDiscountSchema,
  deleteDiscount,
  DiscountServiceDb,
  DiscountServiceError,
  updateDiscount,
  updateDiscountSchema,
} from "../src/lib/catalog/discounts";

type DiscountRow = {
  id: string; name: string; type: "FIXED" | "PERCENTAGE"; value: Prisma.Decimal; minPurchase: Prisma.Decimal | null; minQuantity: number | null;
  startDate: Date; endDate: Date | null; usageLimit: number | null; timesUsed: number; scope: "PRODUCT" | "SUBSCRIPTION"; productId: string | null; subscriptionId: string | null;
};
type FakeOptions = { timesUsed?: number };
function fakeDb(options: FakeOptions = {}) {
  const discounts = new Map<string, DiscountRow>();
  const products = new Map([["prod-1", { id: "prod-1", active: true }]]);
  const subscriptions = new Map([["sub-1", { id: "sub-1" }]]);
  let nextId = 1;
  let deletes = 0;
  const db = {
    product: { findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null },
    subscription: { findUnique: async ({ where }: { where: { id: string } }) => subscriptions.get(where.id) ?? null },
    discount: {
      create: async ({ data }: { data: Omit<DiscountRow, "id" | "timesUsed"> }) => {
        const row = { id: `discount-${nextId++}`, timesUsed: 0, ...data };
        discounts.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = discounts.get(where.id);
        return row ? { ...row, timesUsed: options.timesUsed ?? row.timesUsed } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<DiscountRow> }) => {
        const row = discounts.get(where.id);
        assert.ok(row);
        const saved = { ...row, ...data, timesUsed: options.timesUsed ?? row.timesUsed };
        discounts.set(where.id, saved);
        return saved;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = discounts.get(where.id);
        assert.ok(row);
        discounts.delete(row.id);
        deletes++;
        return row;
      },
    },
  } as unknown as DiscountServiceDb;
  return { db, discounts, deleteCount: () => deletes };
}

const rawProductDiscount = () => ({
  name: " CRM launch ", type: "PERCENTAGE", value: "10.00", minPurchase: "100.00", minQuantity: "2",
  startDate: "2026-01-01", endDate: "2026-12-31", usageLimit: "10", scope: "PRODUCT", productId: "prod-1", subscriptionId: null,
});
const productDiscount = () => createDiscountSchema.parse(rawProductDiscount());
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push([name, run]);

test("discount schema enforces amount, date and scope rules", () => {
  const data = rawProductDiscount();
  const parsed = productDiscount();
  assert.equal(parsed.name, "CRM launch");
  assert.equal(parsed.value, 10);
  assert.equal(createDiscountSchema.safeParse({ ...data, value: 0 }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, value: 100.01 }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, type: "FIXED", value: 0 }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, value: 1.005 }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, endDate: "2025-12-31" }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, productId: null }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, subscriptionId: "sub-1" }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, usageLimit: 0 }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, minQuantity: 0 }).success, false);
  assert.equal(createDiscountSchema.safeParse({ ...data, minPurchase: null, minQuantity: null, usageLimit: null }).success, true);
  assert.equal(updateDiscountSchema.safeParse({}).success, false);
});

test("discount status covers scheduled, active, expired and exhausted rules", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const base: Discount = { id: "d1", name: "Rule", type: "PERCENTAGE", value: new Prisma.Decimal(10), minPurchase: null, minQuantity: null, startDate: new Date("2026-01-01T00:00:00Z"), endDate: null, usageLimit: null, timesUsed: 0, scope: "SUBSCRIPTION", productId: null, subscriptionId: null };
  assert.equal(discountStatus({ ...base, startDate: new Date("2026-06-16T00:00:00Z") }, now), "SCHEDULED");
  assert.equal(discountStatus(base, now), "ACTIVE");
  assert.equal(discountStatus({ ...base, endDate: new Date("2026-06-14T23:59:59Z") }, now), "EXPIRED");
  assert.equal(discountStatus({ ...base, usageLimit: 2, timesUsed: 2 }, now), "EXHAUSTED");
});
test("subscription-wide fixed discounts may target all subscriptions", () => {
  const input = createDiscountSchema.safeParse({ name: "All subs", type: "FIXED", value: 500, startDate: "2026-01-01", scope: "SUBSCRIPTION", productId: null, subscriptionId: null });
  assert.equal(input.success, true);
  assert.equal(createDiscountSchema.safeParse({ name: "All subs", type: "FIXED", value: 500, startDate: "2026-01-01", scope: "SUBSCRIPTION", productId: "prod-1", subscriptionId: null }).success, false);
});

test("create stores Decimal values and validates scope target references", async () => {
  const { db, discounts } = fakeDb();
  const saved = await createDiscount(db, productDiscount());
  assert.equal(saved.value.toFixed(2), "10.00");
  assert.equal(saved.minPurchase?.toFixed(2), "100.00");
  assert.equal(saved.timesUsed, 0);
  assert.equal(discounts.size, 1);
  await assert.rejects(() => createDiscount(db, { ...productDiscount(), productId: "missing" }), (error: unknown) => error instanceof DiscountServiceError && error.status === 400);
  await assert.rejects(() => createDiscount(db, createDiscountSchema.parse({ name: "One sub", type: "FIXED", value: 5, startDate: "2026-01-01", scope: "SUBSCRIPTION", subscriptionId: "missing" })), (error: unknown) => error instanceof DiscountServiceError && error.status === 400);
});

test("update changes ordinary fields and scope target atomically", async () => {
  const { db } = fakeDb();
  const created = await createDiscount(db, productDiscount());
  const changed = await updateDiscount(db, created.id, updateDiscountSchema.parse({ type: "FIXED", value: 500, scope: "SUBSCRIPTION", productId: null, subscriptionId: "sub-1" }));
  assert.ok(changed);
  assert.equal(changed.type, "FIXED");
  assert.equal(changed.value.toFixed(2), "500.00");
  assert.equal(changed.productId, null);
  assert.equal(changed.subscriptionId, "sub-1");
  assert.equal(await updateDiscount(db, "missing", updateDiscountSchema.parse({ name: "x" })), null);
});

test("used discounts cannot change type or scope but can change other fields", async () => {
  const used = fakeDb({ timesUsed: 1 });
  const record = await createDiscount(used.db, productDiscount());
  await assert.rejects(() => updateDiscount(used.db, record.id, updateDiscountSchema.parse({ type: "FIXED", value: 5 })), (error: unknown) => error instanceof DiscountServiceError && error.status === 409);
  await assert.rejects(() => updateDiscount(used.db, record.id, updateDiscountSchema.parse({ scope: "SUBSCRIPTION", productId: null })), (error: unknown) => error instanceof DiscountServiceError && error.status === 409);
  const renamed = await updateDiscount(used.db, record.id, updateDiscountSchema.parse({ name: "Renamed" }));
  assert.equal(renamed?.name, "Renamed");  await assert.rejects(() => updateDiscount(used.db, record.id, updateDiscountSchema.parse({ startDate: "2027-01-01" })), (error: unknown) => error instanceof DiscountServiceError && error.status === 400);
});

test("delete removes an existing discount and reports missing rows", async () => {
  const { db, deleteCount } = fakeDb();
  const record = await createDiscount(db, productDiscount());
  assert.equal(await deleteDiscount(db, record.id), true);
  assert.equal(await deleteDiscount(db, "missing"), false);
  assert.equal(deleteCount(), 1);
});

async function main() {
  let failures = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log(`  ok   ${name}`); }
    catch (error) { failures++; console.log(`  FAIL ${name}\n       ${(error as Error).message}`); }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
