import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { handle } from "@/lib/billing/http";
import { getInvoice } from "@/lib/billing/invoices";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await ctx.params;
    return NextResponse.json(await getInvoice(id));
  } catch (e) {
    return handle(e);
  }
}
