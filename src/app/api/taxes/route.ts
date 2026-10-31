import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { createTax, createTaxSchema } from "@/lib/catalog/taxes";

export async function GET() {
  try {
    await requireRole("ADMIN", "STAFF");
    const taxes = await db.tax.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        ratePercent: true,
        active: true,
        _count: { select: { products: true, lines: true } },
      },
    });
    return NextResponse.json(
      taxes.map((tax) => ({
        id: tax.id,
        name: tax.name,
        ratePercent: tax.ratePercent.toString(),
        active: tax.active,
        productsUsing: tax._count.products,
        linesUsing: tax._count.lines,
      })),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load taxes" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireRole("ADMIN");
    const parsed = createTaxSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid tax" }, { status: 400 });
    }
    const tax = await createTax(db, parsed.data);
    return NextResponse.json(
      { id: tax.id, name: tax.name, ratePercent: tax.ratePercent.toString(), active: tax.active },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to create tax" }, { status: 500 });
  }
}
