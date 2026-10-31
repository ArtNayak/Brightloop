import type { PrismaClient } from "@prisma/client";

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

// TEMPORARY demo data for the billing run (SUB-T4-001...), until P3's seed has subscriptions due for billing.
// Own tax/product/plan so it doesn't depend on the catalog seed. Safe to run many times.
// Delete this file and its call in seed.ts once the real seed exists.
export async function seedBilling(db: PrismaClient) {
  const customer = await db.user.findUniqueOrThrow({ where: { email: "customer@brightloop.test" } });

  const gst18 = (await db.tax.findFirst({ where: { name: "T4 GST 18%" } })) ?? (await db.tax.create({ data: { name: "T4 GST 18%", ratePercent: 18 } }));
  const gst5 = (await db.tax.findFirst({ where: { name: "T4 GST 5%" } })) ?? (await db.tax.create({ data: { name: "T4 GST 5%", ratePercent: 5 } }));

  const crm =
    (await db.product.findFirst({ where: { name: "T4 CRM" } })) ??
    (await db.product.create({ data: { name: "T4 CRM", type: "Software", salesPrice: 1000, costPrice: 400, taxId: gst18.id } }));
  const odoo = await db.productVariant.upsert({
    where: { productId_attribute_value: { productId: crm.id, attribute: "Brand", value: "Odoo" } },
    update: {},
    create: { productId: crm.id, attribute: "Brand", value: "Odoo", extraPrice: 560 },
  });
  const support =
    (await db.product.findFirst({ where: { name: "T4 Support pack" } })) ??
    (await db.product.create({ data: { name: "T4 Support pack", type: "Add-on", salesPrice: 250, costPrice: 100, taxId: gst5.id } }));

  const plan = async (name: string, period: "MONTHLY" | "YEARLY") =>
    (await db.plan.findFirst({ where: { name } })) ??
    (await db.plan.create({ data: { name, price: 1000, period, startDate: daysFromNow(-400), pausable: true } }));
  const monthly = await plan("T4 Monthly", "MONTHLY");
  const yearly = await plan("T4 Yearly", "YEARLY");

  // 10% off T4 CRM, limited to ONE use: with several due subscriptions only the first invoice gets it.
  if (!(await db.discount.findFirst({ where: { name: "T4 10% off CRM (1 use)" } }))) {
    await db.discount.create({
      data: { name: "T4 10% off CRM (1 use)", type: "PERCENTAGE", value: 10, startDate: daysFromNow(-30), usageLimit: 1, scope: "PRODUCT", productId: crm.id },
    });
  }

  type L = { productId: string; variantId?: string; quantity: number; unitPrice: number; taxId: string };
  const make = async (
    number: string,
    p: { plan: string; startAgo: number; due: number; expiry?: number; paused?: boolean; terms: string; lines: L[] },
  ) => {
    const start = daysFromNow(-p.startAgo);
    await db.subscription.upsert({
      where: { number },
      update: {},
      create: {
        number,
        customerId: customer.id,
        planId: p.plan,
        status: "ACTIVE",
        paused: p.paused ?? false,
        startDate: start,
        expiryDate: p.expiry === undefined ? null : daysFromNow(p.expiry),
        paymentTerms: p.terms,
        nextBillingDate: daysFromNow(p.due),
        lines: { create: p.lines.map((l) => ({ ...l, amount: l.quantity * l.unitPrice })) },
      },
    });
  };

  // monthly, two months behind: the run catches up (bills each missed period once)
  await make("SUB-T4-001", {
    plan: monthly.id, startAgo: 65, due: -65, terms: "NET_30",
    lines: [
      { productId: crm.id, variantId: odoo.id, quantity: 2, unitPrice: 1560, taxId: gst18.id },
      { productId: support.id, quantity: 1, unitPrice: 250, taxId: gst5.id },
    ],
  });
  // yearly, first period due now, pays immediately
  await make("SUB-T4-002", {
    plan: yearly.id, startAgo: 3, due: -3, terms: "IMMEDIATE",
    lines: [{ productId: crm.id, quantity: 1, unitPrice: 1000, taxId: gst18.id }],
  });
  // paused: must be skipped
  await make("SUB-T4-003", {
    plan: monthly.id, startAgo: 40, due: -10, paused: true, terms: "NET_15",
    lines: [{ productId: support.id, quantity: 1, unitPrice: 250, taxId: gst5.id }],
  });
  // no lines: skipped, no invoice
  await make("SUB-T4-004", { plan: monthly.id, startAgo: 35, due: -5, terms: "NET_15", lines: [] });
  // expired but still ACTIVE: never billed past expiry
  await make("SUB-T4-005", {
    plan: monthly.id, startAgo: 400, due: -35, expiry: -5, terms: "NET_45",
    lines: [{ productId: support.id, quantity: 1, unitPrice: 250, taxId: gst5.id }],
  });
}
