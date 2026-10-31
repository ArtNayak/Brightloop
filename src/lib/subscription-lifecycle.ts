import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  SubscriptionTransitionError,
  transition,
  type Action,
} from "@/lib/subscription-state";

const PAGE_SIZE = 200;
const CONCURRENCY = 25;
const lifecycleActor = { id: "subscription-lifecycle", role: "ADMIN" as const };

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

async function transitionCandidates(
  action: Action,
  where: Prisma.SubscriptionWhereInput,
  now: Date,
) {
  let changed = 0;
  let cursor: string | undefined;

  for (;;) {
    const candidates = await db.subscription.findMany({
      where: { AND: [where, cursor ? { id: { gt: cursor } } : {}] },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (!candidates.length) break;
    cursor = candidates[candidates.length - 1].id;

    for (let offset = 0; offset < candidates.length; offset += CONCURRENCY) {
      const batch = candidates.slice(offset, offset + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(({ id }) => transition(id, action, lifecycleActor, now)),
      );

      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === "fulfilled") {
          changed++;
          continue;
        }

        const error = result.reason;
        if (error instanceof SubscriptionTransitionError && error.status === 404) continue;
        if (error instanceof SubscriptionTransitionError && error.status === 409) {
          // Another lifecycle run may have won the compare-and-set. Ignore only when it moved the row
          // out of this candidate state; surface genuine rule/data conflicts for an operator to fix.
          const current = await db.subscription.findUnique({
            where: { id: batch[index].id },
            select: { status: true },
          });
          const alreadyHandled = action === "activate"
            ? current?.status !== "CONFIRMED"
            : current?.status !== "ACTIVE";
          if (alreadyHandled) continue;
        }
        throw error;
      }
    }
  }

  return changed;
}

/** Activates subscriptions whose start day has arrived and closes expired auto-close plans. */
export async function runLifecycle(now = new Date()): Promise<{ activated: number; closed: number }> {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const activated = await transitionCandidates(
    "activate",
    { status: "CONFIRMED", startDate: { lt: tomorrow } },
    now,
  );

  const closed = await transitionCandidates(
    "close",
    {
      status: "ACTIVE",
      OR: [
        { expiryDate: { lt: today }, plan: { is: { autoClose: true } } },
        { plan: { is: { autoClose: true, endDate: { lt: today } } } },
      ],
    },
    now,
  );

  return { activated, closed };
}
