import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { ProductServiceError, removeProduct, updateProduct, updateProductSchema } from "@/lib/catalog/products";
import { unitPrice } from "@/lib/pricing";

function failure(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof ProductServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await params;
    const product = await db.product.findUnique({ where: { id }, select: { id: true, name: true, type: true, salesPrice: true, costPrice: true, notes: true, active: true, taxId: true, tax: { select: { name: true, ratePercent: true, active: true } }, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }], select: { id: true, attribute: true, value: true, extraPrice: true, _count: { select: { subLines: true, templateLines: true } } } } } });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ ...product, salesPrice: product.salesPrice.toString(), costPrice: product.costPrice.toString(), tax: product.tax ? { ...product.tax, ratePercent: product.tax.ratePercent.toString() } : null, variants: product.variants.map((v) => ({ id: v.id, attribute: v.attribute, value: v.value, extraPrice: v.extraPrice.toString(), finalPrice: unitPrice(product, v).toString(), inUse: v._count.subLines > 0 || v._count.templateLines > 0 })) });
  } catch (error) { return failure(error, "Unable to load product"); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const parsed = updateProductSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product" }, { status: 400 });
    const product = await updateProduct(db, id, parsed.data);
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ ...product, salesPrice: product.salesPrice.toString(), costPrice: product.costPrice.toString() });
  } catch (error) { return failure(error, "Unable to update product"); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const result = await removeProduct(db, id);
    if (!result) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ action: result.kind });
  } catch (error) { return failure(error, "Unable to remove product"); }
}
