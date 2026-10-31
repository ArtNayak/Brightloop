import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/rbac";
import {
  SUBSCRIPTION_ACTIONS,
  SubscriptionTransitionError,
  transition,
} from "@/lib/subscription-state";

const body = z.object({ action: z.enum(SUBSCRIPTION_ACTIONS) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("ADMIN", "STAFF", "CUSTOMER");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { id } = await ctx.params;
    const updated = await transition(id, parsed.data.action, {
      id: session.user.id,
      role: session.user.role,
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SubscriptionTransitionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
