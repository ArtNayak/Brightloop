import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { allowedActions } from "@/lib/subscription-state";
import { subscriptionInput, SubscriptionApiError, updateDraftSubscription } from "@/lib/subscriptions";

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof SubscriptionApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to process subscription" }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("ADMIN", "STAFF");
    const { id } = await params;
    const subscription = await db.subscription.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true, email: true } }, plan: true, template: true, lines: { include: { product: { select: { id: true, name: true } }, variant: true, tax: true } }, invoices: { select: { id: true, number: true, status: true, issueDate: true, total: true }, orderBy: { issueDate: "desc" } } } });
    if (!subscription) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    return NextResponse.json({ ...subscription, allowedActions: allowedActions(subscription, subscription.plan, session.user.role) });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await params;
    const parsed = subscriptionInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid subscription" }, { status: 400 });
    return NextResponse.json(await updateDraftSubscription(id, parsed.data));
  } catch (error) { return failure(error); }
}
