import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { createQuotationTemplate, deleteQuotationTemplate, QuotationTemplateError, quotationTemplateInput, updateQuotationTemplate } from "@/lib/quotation-templates";

const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") throw new Error(`Refusing to run quotation template checks against "${host || "no DATABASE_URL"}".`);
const input = (planId: string, productId: string, variantId: string | null = null) => ({ name: "Template check", validityDays: 14, planId, lines: [{ productId, variantId, quantity: 2 }] });
for (const bad of [
  { name: "", validityDays: 14, planId: "p", lines: [{ productId: "x", quantity: 1 }] },
  { name: "Quote", validityDays: 0, planId: "p", lines: [{ productId: "x", quantity: 1 }] },
  { name: "Quote", validityDays: 3.5, planId: "p", lines: [{ productId: "x", quantity: 1 }] },
  { name: "Quote", validityDays: 4, planId: "p", lines: [] },
  { name: "Quote", validityDays: 4, planId: "p", lines: [{ productId: "x", quantity: 0 }] },
]) assert.equal(quotationTemplateInput.safeParse(bad).success, false);

const run = crypto.randomUUID().slice(0, 8);
let planId = ""; let productId = ""; let customerId = ""; let templateId = ""; let subscriptionId = "";
async function main() {
  const [plan, product, customer] = await Promise.all([
    db.plan.create({ data: { name: `TEMPLATE-CHECK-${run}`, price: "99.00", period: "MONTHLY", minQuantity: 2, startDate: new Date("2020-01-01T00:00:00Z") } }),
    db.product.create({ data: { name: `TEMPLATE-CHECK-${run}`, type: "Test", salesPrice: "10.00", costPrice: "1.00" } }),
    db.user.create({ data: { email: `template-check-${run}@brightloop.test`, name: "Template Check", role: "CUSTOMER", passwordHash: "test-only" } }),
  ]);
  planId = plan.id; productId = product.id; customerId = customer.id;
  try {
    const variant = await db.productVariant.create({ data: { productId, attribute: "Edition", value: "Premium", extraPrice: "2.00" } });
    const created = await createQuotationTemplate(input(planId, productId, variant.id)); templateId = created.id;
    assert.equal(created.validityDays, 14); assert.equal(created._count.lines, 1);
    await assert.rejects(createQuotationTemplate({ ...input(planId, productId), lines: [{ productId, quantity: 1 }] }), (error: unknown) => error instanceof QuotationTemplateError && error.status === 400);
    await assert.rejects(createQuotationTemplate({ ...input(planId, productId), lines: [{ productId, variantId: "wrong-variant", quantity: 2 }] }), (error: unknown) => error instanceof QuotationTemplateError && error.status === 400);
    const updated = await updateQuotationTemplate(templateId, { ...input(planId, productId), name: "Updated template", validityDays: 21 });
    assert.equal(updated?.name, "Updated template"); assert.equal(updated?.validityDays, 21); assert.equal(updated?.lines.length, 1);
    const sub = await db.subscription.create({ data: { number: `TEMPLATE-CHECK-${run}`, customerId, planId, templateId, startDate: new Date(), lines: { create: { productId, quantity: 2, unitPrice: "10.00", amount: "20.00" } } } }); subscriptionId = sub.id;
    await assert.rejects(deleteQuotationTemplate(templateId), (error: unknown) => error instanceof QuotationTemplateError && error.status === 409);
  } finally {
    if (subscriptionId) await db.subscription.deleteMany({ where: { id: subscriptionId } });
    if (templateId) await db.quotationTemplate.deleteMany({ where: { id: templateId } });
    if (productId) await db.productVariant.deleteMany({ where: { productId } });
    if (productId) await db.product.deleteMany({ where: { id: productId } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    if (customerId) await db.user.deleteMany({ where: { id: customerId } });
  }
  console.log("Quotation template validation, variant, update, and subscription protection checks passed");
}
main().finally(() => db.$disconnect());
