import { Prisma, type BillingPeriod, type SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { unitPrice } from "@/lib/pricing";
import { PAYMENT_TERMS } from "@/lib/billing/terms";

export class SubscriptionApiError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

export const subscriptionInput = z.object({
  customerId: z.string().min(1), planId: z.string().min(1), templateId: z.string().min(1).nullable().optional(),
  startDate: z.iso.date(), expiryDate: z.iso.date().nullable().optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).nullable().optional(),
  lines: z.array(z.object({ productId: z.string().min(1), variantId: z.string().min(1).nullable().optional(), quantity: z.coerce.number().int().min(1) })).min(1),
});
export type SubscriptionInput = z.infer<typeof subscriptionInput>;

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function validatedData(input: SubscriptionInput) {
  const startDate = date(input.startDate);
  const expiryDate = input.expiryDate ? date(input.expiryDate) : null;
  if (expiryDate && expiryDate <= startDate) throw new SubscriptionApiError("Expiry date must be after the start date", 400);
  const [customer, plan, template, catalog] = await Promise.all([
    db.user.findUnique({ where: { id: input.customerId }, select: { id: true, role: true } }),
    db.plan.findUnique({ where: { id: input.planId } }),
    input.templateId ? db.quotationTemplate.findUnique({ where: { id: input.templateId }, select: { id: true, planId: true, validityDays: true } }) : null,
    db.product.findMany({ where: { id: { in: [...new Set(input.lines.map((line) => line.productId))] }, active: true }, include: { variants: true } }),
  ]);
  if (!customer || customer.role !== "CUSTOMER") throw new SubscriptionApiError("Choose a valid customer", 400);
  if (!plan) throw new SubscriptionApiError("Plan not found", 400);
  if (startDate < plan.startDate || (plan.endDate && startDate > plan.endDate)) throw new SubscriptionApiError("Plan is not available on the start date", 400);
  if (template && template.planId !== plan.id) throw new SubscriptionApiError("Template does not match the selected plan", 400);
  if (input.lines.some((line) => line.quantity < plan.minQuantity)) throw new SubscriptionApiError(`Each line must have quantity at least ${plan.minQuantity}`, 400);
  const lines = input.lines.map((line) => {
    const product = catalog.find((item) => item.id === line.productId);
    const variant = line.variantId ? product?.variants.find((item) => item.id === line.variantId) : null;
    if (!product || (line.variantId && !variant)) throw new SubscriptionApiError("A selected product or variant is unavailable", 400);
    const price = unitPrice(product, variant);
    return { productId: product.id, variantId: variant?.id ?? null, quantity: line.quantity, unitPrice: price, amount: price.mul(line.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP), taxId: product.taxId };
  });
  return { customerId: customer.id, planId: plan.id, templateId: template?.id ?? null, startDate, expiryDate, paymentTerms: input.paymentTerms ?? null, lines, quoteValidUntil: null as Date | null, template };
}

async function nextNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ max: number | null }[]>`SELECT MAX(CAST(SUBSTRING(number FROM 5) AS INTEGER)) AS max FROM "Subscription" WHERE number ~ '^SUB-[0-9]+$'`;
  return `SUB-${String((rows[0]?.max ?? 0) + 1).padStart(4, "0")}`;
}

export async function createSubscription(input: SubscriptionInput) {
  const data = await validatedData(input);
  if (data.template) {
    const until = new Date(); until.setUTCHours(0, 0, 0, 0); until.setUTCDate(until.getUTCDate() + data.template.validityDays);
    data.quoteValidUntil = until;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const number = await nextNumber(tx);
        return tx.subscription.create({ data: { number, customerId: data.customerId, planId: data.planId, templateId: data.templateId, startDate: data.startDate, expiryDate: data.expiryDate, paymentTerms: data.paymentTerms, quoteValidUntil: data.quoteValidUntil, lines: { create: data.lines } }, select: { id: true, number: true, status: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 4) continue;
      throw error;
    }
  }
  throw new SubscriptionApiError("Could not allocate a subscription number; please retry", 409);
}

export async function updateDraftSubscription(id: string, input: SubscriptionInput) {
  const data = await validatedData(input);
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Subscription" WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) throw new SubscriptionApiError("Subscription not found", 404);
    if (locked[0].status !== "DRAFT") throw new SubscriptionApiError("Only draft subscriptions can be edited", 409);
    await tx.subscription.update({ where: { id }, data: { customerId: data.customerId, planId: data.planId, templateId: data.templateId, startDate: data.startDate, expiryDate: data.expiryDate, paymentTerms: data.paymentTerms, quoteValidUntil: data.quoteValidUntil } });
    await tx.subscriptionLine.deleteMany({ where: { subscriptionId: id } });
    await tx.subscriptionLine.createMany({ data: data.lines.map((line) => ({ ...line, subscriptionId: id })) });
    return tx.subscription.findUniqueOrThrow({ where: { id }, select: { id: true, number: true, status: true } });
  });
}

export function subscriptionListWhere(filters: { q?: string; status?: SubscriptionStatus; planId?: string; customer?: string }): Prisma.SubscriptionWhereInput {
  const and: Prisma.SubscriptionWhereInput[] = [];
  if (filters.status) and.push({ status: filters.status });
  if (filters.planId) and.push({ planId: filters.planId });
  if (filters.customer) and.push({ customer: { OR: [{ name: { contains: filters.customer, mode: "insensitive" } }, { email: { contains: filters.customer, mode: "insensitive" } }] } });
  if (filters.q) and.push({ OR: [{ number: { contains: filters.q, mode: "insensitive" } }, { customer: { OR: [{ name: { contains: filters.q, mode: "insensitive" } }, { email: { contains: filters.q, mode: "insensitive" } }] } }] });
  return { AND: and };
}

export const billingPeriodLabel = (period: BillingPeriod) => ({ DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" })[period];
