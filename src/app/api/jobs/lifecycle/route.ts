import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { runLifecycle } from "@/lib/subscription-lifecycle";

export const maxDuration = 60;

export async function POST() {
  try {
    await requireRole("ADMIN");
    return NextResponse.json(await runLifecycle());
  } catch (error) {
    if (error instanceof Response) {
      const message = error.status === 401 ? "Unauthorized" : "Forbidden";
      return NextResponse.json({ error: message }, { status: error.status });
    }
    throw error;
  }
}
