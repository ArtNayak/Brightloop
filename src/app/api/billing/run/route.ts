import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { handle } from "@/lib/billing/http";
import { billableWhere, runBilling } from "@/lib/billing/run";

export const maxDuration = 60; // Vercel

// Preview: how many subscriptions the next run would bill (skips ones it can never bill, see billableWhere).
export async function GET() {
  try {
    await requireRole("ADMIN", "STAFF");
    const due = await db.subscription.count({ where: billableWhere(new Date()) });
    return NextResponse.json({ due });
  } catch (e) {
    return handle(e);
  }
}

export async function POST() {
  try {
    await requireRole("ADMIN", "STAFF");
    return NextResponse.json(await runBilling());
  } catch (e) {
    return handle(e);
  }
}
