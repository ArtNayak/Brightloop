import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN", "STAFF");
    const { id } = await params;
    const customer = await db.user.findFirst({ where: { id, role: "CUSTOMER" }, select: { id: true, name: true, email: true, role: true, createdAt: true, subscriptions: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, paused: true, startDate: true, expiryDate: true, plan: { select: { name: true, period: true } }, lines: { select: { amount: true } } } }, invoices: { orderBy: { issueDate: "desc" }, select: { id: true, number: true, status: true, issueDate: true, dueDate: true, total: true, payments: { select: { amount: true } } } } } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    return NextResponse.json(customer);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load customer" }, { status: 500 });
  }
}
