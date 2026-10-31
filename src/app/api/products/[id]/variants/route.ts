import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { createVariant, createVariantSchema, ProductServiceError } from "@/lib/catalog/products";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const parsed = createVariantSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid variant" }, { status: 400 });
    const variant = await createVariant(db, id, parsed.data);
    if (!variant) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ ...variant, extraPrice: variant.extraPrice.toString() }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ProductServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to create variant" }, { status: 500 });
  }
}
