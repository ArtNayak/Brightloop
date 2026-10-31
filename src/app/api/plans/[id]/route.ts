import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { PlanServiceError, updatePlan, updatePlanSchema } from "@/lib/catalog/plans";

function failure(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof PlanServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await params;
    const plan = await db.plan.findUnique({ where: { id }, select: { id: true, name: true, price: true, period: true, minQuantity: true, startDate: true, endDate: true, autoClose: true, closable: true, pausable: true, renewable: true, _count: { select: { subscriptions: true } } } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    return NextResponse.json({ ...plan, price: plan.price.toString(), startDate: plan.startDate.toISOString(), endDate: plan.endDate?.toISOString() ?? null, subscriptionsCount: plan._count.subscriptions });
  } catch (error) { return failure(error, "Unable to load plan"); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const parsed = updatePlanSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid plan" }, { status: 400 });
    const plan = await updatePlan(db, id, parsed.data);
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    return NextResponse.json({ ...plan, price: plan.price.toString(), startDate: plan.startDate.toISOString(), endDate: plan.endDate?.toISOString() ?? null });
  } catch (error) { return failure(error, "Unable to update plan"); }
}
