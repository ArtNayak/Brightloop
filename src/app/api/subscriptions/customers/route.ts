import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN", "STAFF");
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const rows = await db.user.findMany({ where: { role: "CUSTOMER", ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}) }, orderBy: { name: "asc" }, take: 25, select: { id: true, name: true, email: true } });
    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to find customers" }, { status: 500 });
  }
}
