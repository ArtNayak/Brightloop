import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { deleteQuotationTemplate, getQuotationTemplate, QuotationTemplateError, quotationTemplateInput, updateQuotationTemplate } from "@/lib/quotation-templates";

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof QuotationTemplateError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to process quotation template" }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const template = await getQuotationTemplate((await params).id);
    return template ? NextResponse.json(template) : NextResponse.json({ error: "Quotation template not found" }, { status: 404 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const parsed = quotationTemplateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid quotation template" }, { status: 400 });
    return NextResponse.json(await updateQuotationTemplate((await params).id, parsed.data));
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    return NextResponse.json(await deleteQuotationTemplate((await params).id));
  } catch (error) { return failure(error); }
}
