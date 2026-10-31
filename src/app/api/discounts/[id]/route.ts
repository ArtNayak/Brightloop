import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { discountStatus } from "@/lib/discount-status";
import { deleteDiscount, DiscountServiceError, updateDiscount, updateDiscountSchema } from "@/lib/catalog/discounts";

function failure(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof DiscountServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await params;
    const discount = await db.discount.findUnique({ where: { id }, select: { id: true, name: true, type: true, value: true, minPurchase: true, minQuantity: true, startDate: true, endDate: true, usageLimit: true, timesUsed: true, scope: true, productId: true, subscriptionId: true, product: { select: { name: true } }, subscription: { select: { number: true } } } });
    if (!discount) return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    return NextResponse.json({ ...discount, value: discount.value.toString(), minPurchase: discount.minPurchase?.toString() ?? null, status: discountStatus(discount), target: discount.scope === "PRODUCT" ? discount.product?.name ?? "Product unavailable" : discount.subscription?.number ?? "All subscriptions" });
  } catch (error) { return failure(error, "Unable to load discount"); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const parsed = updateDiscountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid discount" }, { status: 400 });
    const discount = await updateDiscount(db, id, parsed.data);
    if (!discount) return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    return NextResponse.json({ ...discount, value: discount.value.toString(), minPurchase: discount.minPurchase?.toString() ?? null });
  } catch (error) { return failure(error, "Unable to update discount"); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    if (!(await deleteDiscount(db, id))) return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    return NextResponse.json({ action: "deleted" });
  } catch (error) { return failure(error, "Unable to delete discount"); }
}
