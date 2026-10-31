import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { createProduct, createProductSchema, ProductServiceError } from "@/lib/catalog/products";

function failure(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof ProductServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const url = new URL(request.url);
    const picker = url.searchParams.get("active") === "1";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = 25;
    const where: Prisma.ProductWhereInput = {};
    if (picker || url.searchParams.has("active")) where.active = url.searchParams.get("active") === "1";
    const type = url.searchParams.get("type")?.trim();
    if (type) where.type = type;
    const q = url.searchParams.get("q")?.trim();
    if (q) where.name = { contains: q, mode: "insensitive" };

    if (picker) {
      const products = await db.product.findMany({
        where: { active: true }, orderBy: { name: "asc" }, take: 100,
        select: { id: true, name: true, salesPrice: true, taxId: true, tax: { select: { ratePercent: true } }, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }], select: { id: true, attribute: true, value: true, extraPrice: true } } },
      });
      return NextResponse.json(products.map((p) => ({ id: p.id, name: p.name, salesPrice: p.salesPrice.toString(), taxId: p.taxId, taxPercent: p.tax?.ratePercent.toString() ?? "0.00", variants: p.variants.map((v) => ({ ...v, extraPrice: v.extraPrice.toString() })) })));
    }

    const [total, products] = await db.$transaction([
      db.product.count({ where }),
      db.product.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, type: true, salesPrice: true, costPrice: true, active: true, tax: { select: { name: true, ratePercent: true } } } }),
    ]);
    return NextResponse.json({ rows: products.map((p) => ({ ...p, salesPrice: p.salesPrice.toString(), costPrice: p.costPrice.toString(), margin: p.salesPrice.minus(p.costPrice).toString(), tax: p.tax ? { ...p.tax, ratePercent: p.tax.ratePercent.toString() } : null })), total, page, pageSize });
  } catch (error) { return failure(error, "Unable to load products"); }
}

export async function POST(request: Request) {
  try {
    await requireRole("ADMIN");
    const parsed = createProductSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product" }, { status: 400 });
    const product = await createProduct(db, parsed.data);
    return NextResponse.json({ ...product, salesPrice: product.salesPrice.toString(), costPrice: product.costPrice.toString() }, { status: 201 });
  } catch (error) { return failure(error, "Unable to create product"); }
}
