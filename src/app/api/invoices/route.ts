import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { badRequest, handle } from "@/lib/billing/http";
import { listInvoices, listQuery } from "@/lib/billing/invoices";

// GET /api/invoices?status=&customerId=&subscriptionId=&q=&from=&to=&overdue=1&page=1&pageSize=25
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ""));
    const parsed = listQuery.safeParse(params);
    if (!parsed.success) return badRequest(parsed.error);
    return NextResponse.json(await listInvoices(parsed.data));
  } catch (e) {
    return handle(e);
  }
}
