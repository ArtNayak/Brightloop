import { BillingPeriod, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const moneySchema = z.preprocess(
  (value) => typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? value : undefined,
  z.coerce.number().finite().min(0, "Price cannot be negative").max(9999999999.99, "Price is too large")
    .refine((price) => Math.abs(price * 100 - Math.round(price * 100)) < 1e-8, "Use no more than two decimal places"),
);
const dateSchema = z.iso.date().transform((date) => new Date(`${date}T00:00:00.000Z`));
const dateRange = (data: { startDate?: Date; endDate?: Date | null }, ctx: z.RefinementCtx) => {
  if (data.startDate && data.endDate && data.endDate <= data.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
  }
};

export const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  price: moneySchema,
  period: z.enum(BillingPeriod),
  minQuantity: z.coerce.number().int().min(1, "Minimum quantity must be at least 1").max(2147483647),
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  autoClose: z.boolean().default(false),
  closable: z.boolean().default(true),
  pausable: z.boolean().default(false),
  renewable: z.boolean().default(true),
}).superRefine(dateRange);

export const updatePlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  price: moneySchema.optional(),
  period: z.enum(BillingPeriod).optional(),
  minQuantity: z.coerce.number().int().min(1, "Minimum quantity must be at least 1").max(100000).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  autoClose: z.boolean().optional(),
  closable: z.boolean().optional(),
  pausable: z.boolean().optional(),
  renewable: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: "Provide at least one plan field to update" }).superRefine(dateRange);

export type PlanServiceDb = Pick<PrismaClient, "plan">;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export class PlanServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PlanServiceError";
  }
}

function decimalMoney(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function availabilityStatus(
  plan: { startDate: Date; endDate: Date | null },
  now = new Date(),
): "Upcoming" | "Available" | "Ended" {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(plan.startDate.getUTCFullYear(), plan.startDate.getUTCMonth(), plan.startDate.getUTCDate()));
  if (start > today) return "Upcoming";
  if (plan.endDate) {
    const end = new Date(Date.UTC(plan.endDate.getUTCFullYear(), plan.endDate.getUTCMonth(), plan.endDate.getUTCDate()));
    if (end < today) return "Ended";
  }
  return "Available";
}

export async function createPlan(db: PlanServiceDb, input: CreatePlanInput) {
  return db.plan.create({
    data: {
      name: input.name,
      price: decimalMoney(input.price),
      period: input.period,
      minQuantity: input.minQuantity,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      autoClose: input.autoClose,
      closable: input.closable,
      pausable: input.pausable,
      renewable: input.renewable,
    },
  });
}

export async function updatePlan(db: PlanServiceDb, id: string, input: UpdatePlanInput) {
  const existing = await db.plan.findUnique({
    where: { id },
    select: { id: true, period: true, startDate: true, endDate: true, _count: { select: { subscriptions: true } } },
  });
  if (!existing) return null;
  if (input.period !== undefined && input.period !== existing.period && existing._count.subscriptions > 0) {
    throw new PlanServiceError("Billing period cannot change after subscriptions use this plan", 409);
  }
  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate === undefined ? existing.endDate : input.endDate;
  if (endDate && endDate <= startDate) throw new PlanServiceError("End date must be after start date", 400);

  const data: Prisma.PlanUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.price !== undefined) data.price = decimalMoney(input.price);
  if (input.period !== undefined) data.period = input.period;
  if (input.minQuantity !== undefined) data.minQuantity = input.minQuantity;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.autoClose !== undefined) data.autoClose = input.autoClose;
  if (input.closable !== undefined) data.closable = input.closable;
  if (input.pausable !== undefined) data.pausable = input.pausable;
  if (input.renewable !== undefined) data.renewable = input.renewable;
  return db.plan.update({ where: { id }, data });
}

