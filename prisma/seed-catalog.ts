import type { BillingPeriod, DiscountScope, DiscountType, PrismaClient } from "@prisma/client";

type CatalogFixtures = {
  taxes: { name: string; ratePercent: number; active: boolean }[];
  products: {
    name: string;
    type: string;
    salesPrice: number;
    costPrice: number;
    notes: string;
    active: boolean;
    taxName: string;
  }[];
  variants: { productName: string; attribute: string; value: string; extraPrice: number }[];
  plans: {
    name: string;
    price: number;
    period: BillingPeriod;
    minQuantity: number;
    startDate: Date;
    endDate: Date | null;
    autoClose: boolean;
    closable: boolean;
    pausable: boolean;
    renewable: boolean;
  }[];
  discounts: {
    name: string;
    type: DiscountType;
    value: number;
    minPurchase: number | null;
    minQuantity: number | null;
    startDate: Date;
    endDate: Date | null;
    usageLimit: number | null;
    scope: DiscountScope;
    productName: string | null;
  }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function shiftDay(date: Date, amount: number): Date {
  return new Date(utcDay(date).getTime() + amount * DAY_MS);
}

/** Exported so the catalog fixture contract can be checked without a database. */
export function catalogSeedFixtures(now = new Date()): CatalogFixtures {
  const today = utcDay(now);
  const availableFrom = shiftDay(today, -30);
  const plan: Omit<CatalogFixtures["plans"][number], "name" | "price" | "period"> = {
    minQuantity: 1,
    startDate: availableFrom,
    endDate: null,
    autoClose: false,
    closable: true,
    pausable: false,
    renewable: true,
  };

  return {
    taxes: [
      { name: "GST 18%", ratePercent: 18, active: true },
      { name: "GST 5%", ratePercent: 5, active: true },
      { name: "Exempt 0%", ratePercent: 0, active: true },
    ],
    products: [
      { name: "Brightloop CRM", type: "Software", salesPrice: 1000, costPrice: 400, notes: "Customer relationship management workspace.", active: true, taxName: "GST 18%" },
      { name: "Brightloop Accounting", type: "Software", salesPrice: 1500, costPrice: 600, notes: "Billing and accounting tools for growing teams.", active: true, taxName: "GST 18%" },
      { name: "Brightloop Helpdesk", type: "Software", salesPrice: 800, costPrice: 300, notes: "Shared customer support inbox.", active: true, taxName: "GST 18%" },
      { name: "Extra seats add-on", type: "Add-on", salesPrice: 150, costPrice: 50, notes: "Additional user seats per billing period.", active: true, taxName: "GST 5%" },
      { name: "Support pack", type: "Add-on", salesPrice: 250, costPrice: 100, notes: "Priority support for the billing period.", active: true, taxName: "GST 5%" },
    ],
    variants: [
      { productName: "Brightloop CRM", attribute: "Brand", value: "Odoo", extraPrice: 560 },
      { productName: "Brightloop CRM", attribute: "Brand", value: "Custom", extraPrice: 250 },
      { productName: "Brightloop Helpdesk", attribute: "Size", value: "Pro", extraPrice: 300 },
    ],
    plans: [
      { ...plan, name: "Daily", price: 100, period: "DAILY" },
      { ...plan, name: "Weekly", price: 500, period: "WEEKLY", pausable: true },
      { ...plan, name: "Monthly", price: 1000, period: "MONTHLY", endDate: shiftDay(today, 30), autoClose: true, pausable: true },
      { ...plan, name: "Yearly", price: 10000, period: "YEARLY" },
    ],
    discounts: [
      {
        name: "10% off 10+ seats", type: "PERCENTAGE", value: 10, minPurchase: null, minQuantity: 10,
        startDate: today, endDate: null, usageLimit: 100, scope: "PRODUCT", productName: "Brightloop CRM",
      },
      {
        name: "Flat 500 off subscriptions over 5000", type: "FIXED", value: 500, minPurchase: 5000, minQuantity: null,
        startDate: today, endDate: null, usageLimit: 50, scope: "SUBSCRIPTION", productName: null,
      },
      {
        name: "Expired 15% Helpdesk promotion", type: "PERCENTAGE", value: 15, minPurchase: null, minQuantity: null,
        startDate: shiftDay(today, -90), endDate: shiftDay(today, -30), usageLimit: null, scope: "PRODUCT", productName: "Brightloop Helpdesk",
      },
    ],
  };
}

async function namedRecord<T extends { id: string }>(
  find: () => Promise<T | null>,
  update: (existing: T) => Promise<T>,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await find();
  return existing ? update(existing) : create();
}

/** Upsert the catalog demo fixtures by stable names, without resetting discount usage history. */
export async function seedCatalog(db: PrismaClient, now = new Date()): Promise<void> {
  const fixtures = catalogSeedFixtures(now);
  const taxIds = new Map<string, string>();
  const productIds = new Map<string, string>();

  for (const tax of fixtures.taxes) {
    const row = await namedRecord(
      () => db.tax.findFirst({ where: { name: tax.name } }),
      (existing) => db.tax.update({ where: { id: existing.id }, data: tax }),
      () => db.tax.create({ data: tax }),
    );
    taxIds.set(tax.name, row.id);
  }

  for (const product of fixtures.products) {
    const { taxName, ...fields } = product;
    const taxId = taxIds.get(taxName);
    if (!taxId) throw new Error(`Missing catalog tax fixture: ${taxName}`);
    const data = { ...fields, taxId };
    const row = await namedRecord(
      () => db.product.findFirst({ where: { name: product.name } }),
      (existing) => db.product.update({ where: { id: existing.id }, data }),
      () => db.product.create({ data }),
    );
    productIds.set(product.name, row.id);
  }

  for (const variant of fixtures.variants) {
    const productId = productIds.get(variant.productName);
    if (!productId) throw new Error(`Missing catalog product fixture: ${variant.productName}`);
    const key = { productId, attribute: variant.attribute, value: variant.value };
    await db.productVariant.upsert({
      where: { productId_attribute_value: key },
      update: { extraPrice: variant.extraPrice },
      create: { ...key, extraPrice: variant.extraPrice },
    });
  }

  for (const plan of fixtures.plans) {
    await namedRecord(
      () => db.plan.findFirst({ where: { name: plan.name } }),
      (existing) => db.plan.update({ where: { id: existing.id }, data: plan }),
      () => db.plan.create({ data: plan }),
    );
  }

  for (const discount of fixtures.discounts) {
    const { productName, ...fields } = discount;
    const productId = productName === null ? null : productIds.get(productName) ?? null;
    if (productName !== null && productId === null) throw new Error(`Missing discount product fixture: ${productName}`);
    const data = { ...fields, productId, subscriptionId: null };
    await namedRecord(
      () => db.discount.findFirst({ where: { name: discount.name } }),
      (existing) => db.discount.update({ where: { id: existing.id }, data }),
      () => db.discount.create({ data }),
    );
  }
}
