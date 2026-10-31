import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { createCustomer, customerInput, customerSearchWhere, CustomerError } from "@/lib/customers";

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof CustomerError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Unable to process customers" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const pageSize = 25;
    const where = customerSearchWhere(q);
    const [rows, total] = await Promise.all([
      db.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, email: true, createdAt: true, _count: { select: { subscriptions: true, invoices: { where: { status: "CONFIRMED" } } } } } }),
      db.user.count({ where }),
    ]);
    return NextResponse.json({ rows, total, page, pageSize });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const parsed = customerInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid customer" }, { status: 400 });
    return NextResponse.json(await createCustomer(parsed.data), { status: 201 });
  } catch (error) { return failure(error); }
}
