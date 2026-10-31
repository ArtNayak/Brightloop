import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { discountStatus, type DiscountStatus } from "@/lib/discount-status";
import { createDiscount, createDiscountSchema, DiscountServiceError } from "@/lib/catalog/discounts";

const statuses: DiscountStatus[] = ["SCHEDULED", "ACTIVE", "EXPIRED", "EXHAUSTED"];
function failure(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof DiscountServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get("status") ?? "";
    if (requestedStatus && requestedStatus !== "ALL" && !statuses.includes(requestedStatus as DiscountStatus)) {
      return NextResponse.json({ error: "Invalid discount status" }, { status: 400 });
    }
    const q = url.searchParams.get("q")?.trim() ?? "";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = 25;
    const discounts = await db.discount.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, value: true, minPurchase: true, minQuantity: true, startDate: true, endDate: true, usageLimit: true, timesUsed: true, scope: true, productId: true, subscriptionId: true, product: { select: { name: true } }, subscription: { select: { number: true } } },
    });
    const filtered = discounts.filter((discount) => !requestedStatus || requestedStatus === "ALL" || discountStatus(discount) === requestedStatus);
    const total = filtered.length;
    const rows = filtered.slice((page - 1) * pageSize, page * pageSize).map((discount) => ({
      ...discount,
      value: discount.value.toString(),
      minPurchase: discount.minPurchase?.toString() ?? null,
      status: discountStatus(discount),
      target: discount.scope === "PRODUCT" ? discount.product?.name ?? "Product unavailable" : discount.subscription?.number ?? "All subscriptions",
    }));
    return NextResponse.json({ rows, total, page, pageSize });
  } catch (error) { return failure(error, "Unable to load discounts"); }
}

export async function POST(request: Request) {
  try {
    await requireRole("ADMIN");
    const parsed = createDiscountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid discount" }, { status: 400 });
    const discount = await createDiscount(db, parsed.data);
    return NextResponse.json({ ...discount, value: discount.value.toString(), minPurchase: discount.minPurchase?.toString() ?? null }, { status: 201 });
  } catch (error) { return failure(error, "Unable to create discount"); }
}
