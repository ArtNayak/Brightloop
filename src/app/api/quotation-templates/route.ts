import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { createQuotationTemplate, listQuotationTemplates, QuotationTemplateError, quotationTemplateInput } from "@/lib/quotation-templates";

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof QuotationTemplateError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to process quotation templates" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    return NextResponse.json(await listQuotationTemplates(new URL(request.url).searchParams.get("q") ?? ""));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const parsed = quotationTemplateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid quotation template" }, { status: 400 });
    return NextResponse.json(await createQuotationTemplate(parsed.data), { status: 201 });
  } catch (error) { return failure(error); }
}
