import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { ProductServiceError, removeVariant, updateVariant, updateVariantSchema } from "@/lib/catalog/products";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id, variantId } = await params;
    const parsed = updateVariantSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid variant" }, { status: 400 });
    const variant = await updateVariant(db, id, variantId, parsed.data);
    if (!variant) return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    return NextResponse.json({ ...variant, extraPrice: variant.extraPrice.toString() });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ProductServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to update variant" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id, variantId } = await params;
    const result = await removeVariant(db, id, variantId);
    if (!result) return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    if (result.kind === "inUse") return NextResponse.json({ error: "This variant is used by a subscription or quotation and cannot be removed" }, { status: 409 });
    return NextResponse.json({ action: result.kind });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to remove variant" }, { status: 500 });
  }
}
