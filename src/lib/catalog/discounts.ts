import { DiscountScope, DiscountType, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const amountSchema = z.preprocess(
  (value) => typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? value : undefined,
  z.coerce.number().finite().min(0, "Amount cannot be negative").max(9999999999.99, "Amount is too large")
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8, "Use no more than two decimal places"),
);
const optionalAmountSchema = z.preprocess((value) => value === "" || value === null ? null : value, amountSchema.nullable().optional());
const dateSchema = z.iso.date().transform((date) => new Date(`${date}T00:00:00.000Z`));
const optionalId = z.string().trim().min(1).nullable().optional();
const optionalPositiveInteger = z.preprocess((value) => value === "" || value === null ? null : value, z.coerce.number().int().min(1, "Value must be at least 1").max(2147483647).nullable().optional());

function validateDefinition(data: {
  type?: DiscountType; value?: number; scope?: DiscountScope; productId?: string | null; subscriptionId?: string | null;
  startDate?: Date; endDate?: Date | null;
}, ctx: z.RefinementCtx) {
  if (data.type === "PERCENTAGE" && data.value !== undefined && (data.value <= 0 || data.value > 100)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Percentage must be greater than 0 and no more than 100" });
  }
  if (data.type === "FIXED" && data.value !== undefined && data.value <= 0) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Fixed discount must be greater than 0" });
  }
  if (data.startDate && data.endDate && data.endDate <= data.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
  }
  if (data.scope === "PRODUCT") {
    if (!data.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose a product for a product discount" });
    if (data.subscriptionId) ctx.addIssue({ code: "custom", path: ["subscriptionId"], message: "Product discounts cannot target a subscription" });
  }
  if (data.scope === "SUBSCRIPTION" && data.productId) {
    ctx.addIssue({ code: "custom", path: ["productId"], message: "Subscription discounts cannot target a product" });
  }
}

export const createDiscountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(DiscountType),
  value: amountSchema,
  minPurchase: optionalAmountSchema,
  minQuantity: optionalPositiveInteger,
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  usageLimit: optionalPositiveInteger,
  scope: z.enum(DiscountScope),
  productId: optionalId,
  subscriptionId: optionalId,
}).superRefine(validateDefinition);

export const updateDiscountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  type: z.enum(DiscountType).optional(),
  value: amountSchema.optional(),
  minPurchase: optionalAmountSchema,
  minQuantity: optionalPositiveInteger,
  startDate: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  usageLimit: optionalPositiveInteger,
  scope: z.enum(DiscountScope).optional(),
  productId: optionalId,
  subscriptionId: optionalId,
}).refine((data) => Object.keys(data).length > 0, { message: "Provide at least one discount field to update" }).superRefine(validateDefinition);

export type DiscountServiceDb = Pick<PrismaClient, "discount" | "product" | "subscription">;
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;

export class DiscountServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DiscountServiceError";
  }
}

function decimalMoney(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

async function validateTarget(db: DiscountServiceDb, scope: DiscountScope, productId: string | null, subscriptionId: string | null, requireActiveProduct = false) {
  if (scope === "PRODUCT") {
    if (!productId || subscriptionId) throw new DiscountServiceError("Product discounts require a product and cannot target a subscription", 400);
    const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, active: true } });
    if (!product || (requireActiveProduct && !product.active)) throw new DiscountServiceError("Choose an active product", 400);
  } else {
    if (productId) throw new DiscountServiceError("Subscription discounts cannot target a product", 400);
    if (subscriptionId) {
      const subscription = await db.subscription.findUnique({ where: { id: subscriptionId }, select: { id: true } });
      if (!subscription) throw new DiscountServiceError("Choose an existing subscription", 400);
    }
  }
}

export async function createDiscount(db: DiscountServiceDb, input: CreateDiscountInput) {
  const productId = input.scope === "PRODUCT" ? input.productId ?? null : null;
  const subscriptionId = input.scope === "SUBSCRIPTION" ? input.subscriptionId ?? null : null;
  await validateTarget(db, input.scope, productId, subscriptionId, true);
  return db.discount.create({ data: {
    name: input.name,
    type: input.type,
    value: decimalMoney(input.value),
    minPurchase: input.minPurchase == null ? null : decimalMoney(input.minPurchase),
    minQuantity: input.minQuantity ?? null,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    usageLimit: input.usageLimit ?? null,
    scope: input.scope,
    productId,
    subscriptionId,
  } });
}

export async function updateDiscount(db: DiscountServiceDb, id: string, input: UpdateDiscountInput) {
  const existing = await db.discount.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.timesUsed > 0 && (input.type !== undefined || input.scope !== undefined)) {
    throw new DiscountServiceError("Type and scope are locked after a discount has been used", 409);
  }

  const scope = input.scope ?? existing.scope;
  const productId = scope === "PRODUCT"
    ? (input.productId !== undefined ? input.productId : existing.scope === "PRODUCT" ? existing.productId : null)
    : null;
  const subscriptionId = scope === "SUBSCRIPTION"
    ? (input.subscriptionId !== undefined ? input.subscriptionId : existing.scope === "SUBSCRIPTION" ? existing.subscriptionId : null)
    : null;
  const type = input.type ?? existing.type;
  const value = input.value ?? Number(existing.value.toString());
  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate === undefined ? existing.endDate : input.endDate;
  if (type === "PERCENTAGE" && (value <= 0 || value > 100)) throw new DiscountServiceError("Percentage must be greater than 0 and no more than 100", 400);
  if (type === "FIXED" && value <= 0) throw new DiscountServiceError("Fixed discount must be greater than 0", 400);
  if (endDate && endDate <= startDate) throw new DiscountServiceError("End date must be after start date", 400);
  await validateTarget(db, scope, productId, subscriptionId);

  const data: Prisma.DiscountUncheckedUpdateInput = { scope, productId, subscriptionId };
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.value !== undefined) data.value = decimalMoney(input.value);
  if (input.minPurchase !== undefined) data.minPurchase = input.minPurchase === null ? null : decimalMoney(input.minPurchase);
  if (input.minQuantity !== undefined) data.minQuantity = input.minQuantity;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.usageLimit !== undefined) data.usageLimit = input.usageLimit;
  return db.discount.update({ where: { id }, data });
}

export async function deleteDiscount(db: DiscountServiceDb, id: string): Promise<boolean> {
  const existing = await db.discount.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await db.discount.delete({ where: { id } });
  return true;
}
