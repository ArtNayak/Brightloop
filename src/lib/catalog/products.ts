import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const moneySchema = z.preprocess(
  (value) =>
    typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? value : undefined,
  z
    .coerce.number().finite().min(0, "Price cannot be negative")
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8, "Use no more than two decimal places"),
);

const notesSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().trim().max(4000, "Notes must be 4000 characters or fewer").nullable(),
);

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.string().trim().min(1, "Type is required").max(80),
  salesPrice: moneySchema,
  costPrice: moneySchema,
  notes: notesSchema.optional(),
  taxId: z.string().trim().min(1).nullable().optional(),
  active: z.boolean().optional(),
});

export const updateProductSchema = createProductSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: "Provide at least one product field to update",
});

export const createVariantSchema = z.object({
  attribute: z.string().trim().min(1, "Attribute is required").max(60),
  value: z.string().trim().min(1, "Value is required").max(100),
  extraPrice: moneySchema,
});

export const updateVariantSchema = createVariantSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: "Provide at least one variant field to update",
});

export type ProductServiceDb = Pick<PrismaClient, "product" | "productVariant" | "tax">;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export class ProductServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProductServiceError";
  }
}

function decimalMoney(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

async function ensureActiveTax(db: ProductServiceDb, taxId: string | null) {
  if (taxId === null) return;
  const tax = await db.tax.findUnique({ where: { id: taxId }, select: { id: true, active: true } });
  if (!tax || !tax.active) throw new ProductServiceError("Choose an active tax", 400);
}

export async function createProduct(db: ProductServiceDb, input: CreateProductInput) {
  const taxId = input.taxId ?? null;
  await ensureActiveTax(db, taxId);
  return db.product.create({
    data: {
      name: input.name,
      type: input.type,
      salesPrice: decimalMoney(input.salesPrice),
      costPrice: decimalMoney(input.costPrice),
      notes: input.notes ?? null,
      taxId,
      active: input.active ?? true,
    },
  });
}

export async function updateProduct(db: ProductServiceDb, id: string, input: UpdateProductInput) {
  const existing = await db.product.findUnique({ where: { id }, select: { id: true, taxId: true } });
  if (!existing) return null;

  if (input.taxId !== undefined && input.taxId !== existing.taxId) await ensureActiveTax(db, input.taxId);
  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.salesPrice !== undefined) data.salesPrice = decimalMoney(input.salesPrice);
  if (input.costPrice !== undefined) data.costPrice = decimalMoney(input.costPrice);
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.taxId !== undefined) {
    (data as Prisma.ProductUncheckedUpdateInput).taxId = input.taxId;
  }
  if (input.active !== undefined) data.active = input.active;
  return db.product.update({ where: { id }, data: data as Prisma.ProductUncheckedUpdateInput });
}

export type RemoveProductResult = { kind: "deleted" } | { kind: "deactivated" };

async function deactivateProduct(db: ProductServiceDb, id: string): Promise<RemoveProductResult> {
  await db.product.update({ where: { id }, data: { active: false } });
  return { kind: "deactivated" };
}

export async function removeProduct(db: ProductServiceDb, id: string): Promise<RemoveProductResult | null> {
  const existing = await db.product.findUnique({
    where: { id },
    select: { id: true, _count: { select: { subLines: true, templateLines: true } } },
  });
  if (!existing) return null;
  if (existing._count.subLines > 0 || existing._count.templateLines > 0) return deactivateProduct(db, id);

  try {
    await db.product.delete({ where: { id } });
    return { kind: "deleted" };
  } catch (error) {
    if (isPrismaCode(error, "P2003")) return deactivateProduct(db, id);
    throw error;
  }
}

export async function createVariant(db: ProductServiceDb, productId: string, input: CreateVariantInput) {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return null;
  try {
    return await db.productVariant.create({
      data: { productId, attribute: input.attribute, value: input.value, extraPrice: decimalMoney(input.extraPrice) },
    });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) throw new ProductServiceError("A variant with this attribute and value already exists", 409);
    throw error;
  }
}

export async function updateVariant(db: ProductServiceDb, productId: string, variantId: string, input: UpdateVariantInput) {
  const existing = await db.productVariant.findFirst({ where: { id: variantId, productId }, select: { id: true } });
  if (!existing) return null;
  const data: Prisma.ProductVariantUpdateInput = {};
  if (input.attribute !== undefined) data.attribute = input.attribute;
  if (input.value !== undefined) data.value = input.value;
  if (input.extraPrice !== undefined) data.extraPrice = decimalMoney(input.extraPrice);
  try {
    return await db.productVariant.update({ where: { id: variantId }, data });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) throw new ProductServiceError("A variant with this attribute and value already exists", 409);
    throw error;
  }
}

export type RemoveVariantResult = { kind: "deleted" } | { kind: "inUse" };

export async function removeVariant(db: ProductServiceDb, productId: string, variantId: string): Promise<RemoveVariantResult | null> {
  const existing = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true, _count: { select: { subLines: true, templateLines: true } } },
  });
  if (!existing || existing.productId !== productId) return null;
  if (existing._count.subLines > 0 || existing._count.templateLines > 0) return { kind: "inUse" };

  try {
    await db.productVariant.delete({ where: { id: variantId } });
    return { kind: "deleted" };
  } catch (error) {
    if (isPrismaCode(error, "P2003")) return { kind: "inUse" };
    throw error;
  }
}



