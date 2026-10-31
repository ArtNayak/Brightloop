import { NextResponse } from "next/server";
import { Prisma, type BillingPeriod } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { createPlan, createPlanSchema, PlanServiceError } from "@/lib/catalog/plans";

function failure(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof PlanServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const url = new URL(request.url);
    const availableOnly = url.searchParams.get("available") === "1";
    const today = new Date();
    const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);
    const where: Prisma.PlanWhereInput = availableOnly
      ? { startDate: { lte: endOfToday }, OR: [{ endDate: null }, { endDate: { gte: startOfToday } }] }
      : {};
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = 25;
    if (availableOnly) {
      const plans = await db.plan.findMany({ where, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, price: true, period: true, minQuantity: true, startDate: true, endDate: true, autoClose: true, closable: true, pausable: true, renewable: true } });
      return NextResponse.json(plans.map((plan) => ({ ...plan, price: plan.price.toString(), startDate: plan.startDate.toISOString(), endDate: plan.endDate?.toISOString() ?? null })));
    }
    const period = url.searchParams.get("period");
    if (period && !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(period)) {
      return NextResponse.json({ error: "Invalid billing period" }, { status: 400 });
    }
    const q = url.searchParams.get("q")?.trim();
    const listWhere: Prisma.PlanWhereInput = { ...(period ? { period: period as BillingPeriod } : {}), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) };
    const [total, plans] = await db.$transaction([
      db.plan.count({ where: listWhere }),
      db.plan.findMany({ where: listWhere, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, price: true, period: true, minQuantity: true, startDate: true, endDate: true, autoClose: true, closable: true, pausable: true, renewable: true } }),
    ]);
    return NextResponse.json({ rows: plans.map((plan) => ({ ...plan, price: plan.price.toString(), startDate: plan.startDate.toISOString(), endDate: plan.endDate?.toISOString() ?? null })), total, page, pageSize });
  } catch (error) { return failure(error, "Unable to load plans"); }
}

export async function POST(request: Request) {
  try {
    await requireRole("ADMIN");
    const parsed = createPlanSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid plan" }, { status: 400 });
    const plan = await createPlan(db, parsed.data);
    return NextResponse.json({ ...plan, price: plan.price.toString(), startDate: plan.startDate.toISOString(), endDate: plan.endDate?.toISOString() ?? null }, { status: 201 });
  } catch (error) { return failure(error, "Unable to create plan"); }
}

