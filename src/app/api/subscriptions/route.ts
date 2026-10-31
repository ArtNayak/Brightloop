import { NextResponse } from "next/server";
import { Prisma, type SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { createSubscription, subscriptionInput, subscriptionListWhere, SubscriptionApiError } from "@/lib/subscriptions";

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof SubscriptionApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to process subscriptions" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const pageSize = 25;
    const statusValue = params.get("status") ?? "";
    const status = ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "CLOSED"].includes(statusValue) ? statusValue as SubscriptionStatus : undefined;
    const base = subscriptionListWhere({ q: params.get("q")?.trim() || undefined, planId: params.get("planId") || undefined, customer: params.get("customer")?.trim() || undefined });
    const where = subscriptionListWhere({ q: params.get("q")?.trim() || undefined, planId: params.get("planId") || undefined, customer: params.get("customer")?.trim() || undefined, status });
    const [rows, total, counts] = await Promise.all([
      db.subscription.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { customer: { select: { id: true, name: true, email: true } }, plan: { select: { id: true, name: true, period: true } }, lines: { select: { amount: true } } } }),
      db.subscription.count({ where }),
      db.subscription.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]));
    return NextResponse.json({ rows: rows.map((row) => ({ ...row, total: row.lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)).toFixed(2) })), total, page, pageSize, counts: byStatus });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const parsed = subscriptionInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid subscription" }, { status: 400 });
    return NextResponse.json(await createSubscription(parsed.data), { status: 201 });
  } catch (error) { return failure(error); }
}
