import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/rbac";
import { badRequest, handle } from "@/lib/billing/http";
import { confirmDrafts } from "@/lib/billing/invoices";

const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(5000).optional() }).strict();

// No body = confirm every DRAFT invoice. { ids } = only those (non-drafts are skipped and counted).
export async function POST(req: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const text = await req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
      }
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success) return badRequest(parsed.error);
    return NextResponse.json(await confirmDrafts(parsed.data.ids));
  } catch (e) {
    return handle(e);
  }
}
