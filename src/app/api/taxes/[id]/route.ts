import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { removeTax, updateTax, updateTaxSchema } from "@/lib/catalog/taxes";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: Context) {
  try {
    await requireRole("ADMIN");
    const parsed = updateTaxSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid tax update" }, { status: 400 });
    }
    const { id } = await context.params;
    const tax = await updateTax(db, id, parsed.data);
    if (!tax) return NextResponse.json({ error: "Tax not found" }, { status: 404 });
    return NextResponse.json({ id: tax.id, name: tax.name, ratePercent: tax.ratePercent.toString(), active: tax.active });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to update tax" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: Context) {
  try {
    await requireRole("ADMIN");
    const { id } = await context.params;
    const result = await removeTax(db, id);
    if (!result) return NextResponse.json({ error: "Tax not found" }, { status: 404 });
    return NextResponse.json({ ok: true, action: result.kind });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to remove tax" }, { status: 500 });
  }
}
