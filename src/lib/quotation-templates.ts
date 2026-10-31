import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const quotationTemplateInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  validityDays: z.coerce.number().int().min(1, "Validity must be at least one day").max(3650),
  planId: z.string().trim().min(1, "Choose a plan"),
  lines: z.array(z.object({ productId: z.string().trim().min(1), variantId: z.string().trim().min(1).nullable().optional(), quantity: z.coerce.number().int().min(1) })).min(1, "Add at least one product line"),
});
export type QuotationTemplateInput = z.infer<typeof quotationTemplateInput>;

export class QuotationTemplateError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); this.name = "QuotationTemplateError"; }
}

export type TemplateDb = Pick<PrismaClient, "plan" | "product" | "quotationTemplate" | "$transaction">;

async function validate(dbClient: TemplateDb, input: QuotationTemplateInput) {
  const plan = await dbClient.plan.findUnique({ where: { id: input.planId }, select: { id: true, minQuantity: true } });
  if (!plan) throw new QuotationTemplateError("Plan not found", 400);
  if (input.lines.some((line) => line.quantity < plan.minQuantity)) throw new QuotationTemplateError(`Each line must have quantity at least ${plan.minQuantity}`, 400);
  const products = await dbClient.product.findMany({ where: { id: { in: [...new Set(input.lines.map((line) => line.productId))] }, active: true }, select: { id: true, variants: { select: { id: true } } } });
  for (const line of input.lines) {
    const product = products.find((item) => item.id === line.productId);
    if (!product) throw new QuotationTemplateError("Choose an active product for every line", 400);
    if (line.variantId && !product.variants.some((variant) => variant.id === line.variantId)) throw new QuotationTemplateError("A variant must belong to its selected product", 400);
  }
}

export async function listQuotationTemplates(query = "", dbClient: TemplateDb = db) {
  const q = query.trim();
  return dbClient.quotationTemplate.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { plan: { name: { contains: q, mode: "insensitive" } } }] } : {},
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { plan: { select: { id: true, name: true, period: true } }, _count: { select: { lines: true, subscriptions: true } } },
  });
}

export async function getQuotationTemplate(id: string, dbClient: TemplateDb = db) {
  return dbClient.quotationTemplate.findUnique({ where: { id }, include: { plan: { select: { id: true, name: true, minQuantity: true, period: true } }, lines: { include: { product: { select: { id: true, name: true, active: true } }, variant: { select: { id: true, attribute: true, value: true } } }, orderBy: { id: "asc" } } } });
}

export async function createQuotationTemplate(input: QuotationTemplateInput, dbClient: TemplateDb = db) {
  await validate(dbClient, input);
  return dbClient.quotationTemplate.create({ data: { name: input.name, validityDays: input.validityDays, planId: input.planId, lines: { create: input.lines.map((line) => ({ productId: line.productId, variantId: line.variantId || null, quantity: line.quantity })) } }, include: { plan: { select: { id: true, name: true, period: true } }, _count: { select: { lines: true, subscriptions: true } } } });
}

export async function updateQuotationTemplate(id: string, input: QuotationTemplateInput, dbClient: TemplateDb = db) {
  await validate(dbClient, input);
  return dbClient.$transaction(async (tx) => {
    const exists = await tx.quotationTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new QuotationTemplateError("Quotation template not found", 404);
    await tx.quotationTemplate.update({ where: { id }, data: { name: input.name, validityDays: input.validityDays, planId: input.planId } });
    await tx.quotationTemplateLine.deleteMany({ where: { templateId: id } });
    await tx.quotationTemplateLine.createMany({ data: input.lines.map((line) => ({ templateId: id, productId: line.productId, variantId: line.variantId || null, quantity: line.quantity })) });
    return tx.quotationTemplate.findUnique({ where: { id }, include: { plan: { select: { id: true, name: true, minQuantity: true, period: true } }, lines: { include: { product: { select: { id: true, name: true, active: true } }, variant: { select: { id: true, attribute: true, value: true } } }, orderBy: { id: "asc" } } } });
  });
}

export async function deleteQuotationTemplate(id: string, dbClient: TemplateDb = db) {
  const existing = await dbClient.quotationTemplate.findUnique({ where: { id }, select: { id: true, _count: { select: { subscriptions: true } } } });
  if (!existing) throw new QuotationTemplateError("Quotation template not found", 404);
  if (existing._count.subscriptions) throw new QuotationTemplateError("This template is used by subscriptions and cannot be deleted", 409);
  try { await dbClient.quotationTemplate.delete({ where: { id } }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new QuotationTemplateError("This template is used by subscriptions and cannot be deleted", 409);
    throw error;
  }
  return { id };
}
