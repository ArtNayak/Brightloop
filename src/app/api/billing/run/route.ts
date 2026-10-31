import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { dueWhere, runBilling } from "@/lib/billing/run";

export const maxDuration = 60; // Vercel

// Preview: how many subscriptions the next run would pick up.
export async function GET() {
  try {
    await requireRole("ADMIN", "STAFF");
    const due = await db.subscription.count({ where: dueWhere(new Date()) });
    return NextResponse.json({ due });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function POST() {
  try {
    await requireRole("ADMIN", "STAFF");
    return NextResponse.json(await runBilling());
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
