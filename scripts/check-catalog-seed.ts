// Catalog seed regression check. Run: npm run check:catalog-seed
import assert from "node:assert/strict";
import type { Discount, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { discountStatus, isDiscountActive } from "../src/lib/discount-status";
import { seedCatalog } from "../prisma/seed-catalog";

type Row = Record<string, unknown> & { id: string; name: string };
type NamedStore = Map<string, Row>;

const stores: Record<string, NamedStore> = {
  tax: new Map(),
  product: new Map(),
  plan: new Map(),
  discount: new Map(),
};
const variantStore = new Map<string, Row>();
let nextId = 1;

function namedDelegate(store: NamedStore) {
  return {
    findFirst: async ({ where }: { where: { name: string } }) => store.get(where.name) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `row-${nextId++}`, ...data } as Row;
      store.set(row.name, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const previous = [...store.values()].find((row) => row.id === where.id);
      assert.ok(previous, `cannot update missing row ${where.id}`);
      const row = { ...previous, ...data } as Row;
      store.set(row.name, row);
      return row;
    },
  };
}

const fakeDb = {
  tax: namedDelegate(stores.tax),
  product: namedDelegate(stores.product),
  plan: namedDelegate(stores.plan),
  discount: namedDelegate(stores.discount),
  productVariant: {
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { productId_attribute_value: { productId: string; attribute: string; value: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => {
      const key = Object.values(where.productId_attribute_value).join("|");
      const previous = variantStore.get(key);
      const row = previous
        ? ({ ...previous, ...update } as Row)
        : ({ id: `row-${nextId++}`, name: key, ...create } as Row);
      variantStore.set(key, row);
      return row;
    },
  },
} as unknown as PrismaClient;

async function main() {
  const now = new Date("2026-10-31T12:00:00.000Z");
  await seedCatalog(fakeDb, now);

  assert.deepEqual(
    [...stores.tax.values()].map((tax) => [tax.name, String(tax.ratePercent)]).sort(),
    [["Exempt 0%", "0"], ["GST 18%", "18"], ["GST 5%", "5"]].sort(),
  );
  assert.equal(stores.product.size, 5, "expected five catalog products");
  assert.ok([...stores.product.values()].every((product) => typeof product.taxId === "string"));
  assert.equal(variantStore.size, 3, "expected the Odoo, Custom, and Pro variants");

  const crm = stores.product.get("Brightloop CRM");
  const odoo = [...variantStore.values()].find((variant) => variant.value === "Odoo");
  assert.ok(crm && odoo);
  assert.equal(
    new Prisma.Decimal(String(crm.salesPrice)).plus(String(odoo.extraPrice)).toFixed(2),
    "1560.00",
    "CRM with the Odoo brand must cost 1560",
  );

  assert.deepEqual(
    [...stores.plan.values()].map((plan) => plan.period).sort(),
    ["DAILY", "MONTHLY", "WEEKLY", "YEARLY"],
  );
  const monthly = stores.plan.get("Monthly");
  const weekly = stores.plan.get("Weekly");
  assert.ok(monthly && weekly);
  assert.equal(monthly.price, 1000);
  assert.equal(monthly.autoClose, true);
  assert.ok(monthly.endDate instanceof Date);
  assert.equal(monthly.endDate.toISOString(), new Date(Date.UTC(2026, 9, 31) + 30 * 86_400_000).toISOString());
  assert.equal(monthly.closable, true);
  assert.equal(monthly.renewable, true);
  assert.equal(weekly.pausable, true);

  const activeDiscount = stores.discount.get("10% off 10+ seats");
  const expiredDiscount = stores.discount.get("Expired 15% Helpdesk promotion");
  assert.ok(activeDiscount && expiredDiscount);
  const active = activeDiscount as unknown as Discount;
  assert.equal(discountStatus(active, now), "ACTIVE");
  assert.equal(isDiscountActive(active, now), true);
  assert.equal(discountStatus(expiredDiscount as unknown as Discount, now), "EXPIRED");
  assert.equal(discountStatus({ ...active, startDate: new Date("2026-11-01T00:00:00.000Z") }, now), "SCHEDULED");
  assert.equal(discountStatus({ ...active, usageLimit: 1, timesUsed: 1 }, now), "EXHAUSTED");
  assert.equal(stores.discount.get("Flat 500 off subscriptions over 5000")?.minPurchase, 5000);
  assert.equal(stores.discount.size, 3);

  // Seed twice and confirm fixture rows/variants remain singular and usage history survives.
  stores.discount.get("10% off 10+ seats")!.timesUsed = 2;
  const firstCounts = [stores.tax.size, stores.product.size, variantStore.size, stores.plan.size, stores.discount.size];
  await seedCatalog(fakeDb, now);
  assert.deepEqual(
    [stores.tax.size, stores.product.size, variantStore.size, stores.plan.size, stores.discount.size],
    firstCounts,
    "rerunning the seed must not create duplicate catalog fixtures",
  );
  assert.equal(stores.discount.get("10% off 10+ seats")?.timesUsed, 2, "rerunning must preserve discount usage history");
  console.log("Catalog seed checks passed (5 products, 4 plans, 3 taxes, 3 discounts; rerun safe).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
