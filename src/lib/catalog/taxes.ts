import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const ratePercentSchema = z.preprocess(
  (value) =>
    typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? value : undefined,
  z
    .coerce.number().finite().min(0, "Rate cannot be negative").max(100, "Rate cannot exceed 100")
    .refine((rate) => Math.abs(rate * 100 - Math.round(rate * 100)) < 1e-8, "Use no more than two decimal places"),
);

export const createTaxSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name must be 80 characters or fewer"),
  ratePercent: ratePercentSchema,
  active: z.boolean().optional(),
});

export const updateTaxSchema = createTaxSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: "Provide at least one tax field to update",
});

export type TaxServiceDb = Pick<PrismaClient, "tax">;
export type CreateTaxInput = z.infer<typeof createTaxSchema>;
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;

function decimalRate(rate: number): Prisma.Decimal {
  return new Prisma.Decimal(rate.toFixed(2)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export async function createTax(db: TaxServiceDb, input: CreateTaxInput) {
  return db.tax.create({
    data: {
      name: input.name,
      ratePercent: decimalRate(input.ratePercent),
      active: input.active ?? true,
    },
  });
}

export async function updateTax(db: TaxServiceDb, id: string, input: UpdateTaxInput) {
  const existing = await db.tax.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;

  const data: Prisma.TaxUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.ratePercent !== undefined) data.ratePercent = decimalRate(input.ratePercent);
  if (input.active !== undefined) data.active = input.active;
  return db.tax.update({ where: { id }, data });
}

export type RemoveTaxResult =
  | { kind: "deleted" }
  | { kind: "deactivated"; tax: Awaited<ReturnType<TaxServiceDb["tax"]["update"]>> };

async function deactivateTax(db: TaxServiceDb, id: string): Promise<RemoveTaxResult> {
  return { kind: "deactivated", tax: await db.tax.update({ where: { id }, data: { active: false } }) };
}

export async function removeTax(db: TaxServiceDb, id: string): Promise<RemoveTaxResult | null> {
  const existing = await db.tax.findUnique({
    where: { id },
    select: { id: true, _count: { select: { products: true, lines: true } } },
  });
  if (!existing) return null;

  if (existing._count.products > 0 || existing._count.lines > 0) return deactivateTax(db, id);

  try {
    await db.tax.delete({ where: { id } });
    return { kind: "deleted" };
  } catch (error) {
    // A product or subscription line may have started referencing the tax after the count query.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return deactivateTax(db, id);
    }
    throw error;
  }
}
