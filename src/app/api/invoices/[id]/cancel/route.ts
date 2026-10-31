import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { handle } from "@/lib/billing/http";
import { cancelInvoice } from "@/lib/billing/invoices";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await ctx.params;
    return NextResponse.json(await cancelInvoice(id));
  } catch (e) {
    return handle(e);
  }
}
