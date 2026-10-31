// Everything the billing run needs from other people's folders lives behind this one file.
// P2 (period.ts, discount-status.ts) and P3 (subscription-lifecycle.ts) haven't merged yet, so these are
// temporary versions with the agreed signatures. When theirs land, replace each block with a re-export:
//   export { addPeriod } from "@/lib/period";
//   export { isDiscountActive } from "@/lib/discount-status";
//   export { runLifecycle } from "@/lib/subscription-lifecycle";
import type { BillingPeriod } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- TEMP until P2's src/lib/period.ts ----
// Month-end safe, UTC: Jan 31 + 1 month = Feb 28/29, Feb 29 2028 + 1 year = Feb 28 2029.
function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
}

export function addPeriod(date: Date, period: BillingPeriod, n = 1): Date {
  switch (period) {
    case "DAILY":
      return new Date(date.getTime() + n * DAY_MS);
    case "WEEKLY":
      return new Date(date.getTime() + 7 * n * DAY_MS);
    case "MONTHLY":
      return addMonths(date, n);
    case "YEARLY":
      return addMonths(date, 12 * n);
  }
}

// ---- TEMP until P2's src/lib/discount-status.ts ----
// ACTIVE = started, not ended, and not used up.
export function isDiscountActive(
  d: { startDate: Date; endDate: Date | null; usageLimit: number | null; timesUsed: number },
  now = new Date(),
): boolean {
  return d.startDate <= now && (d.endDate == null || d.endDate >= now) && (d.usageLimit == null || d.timesUsed < d.usageLimit);
}

// ---- TEMP until P3's src/lib/subscription-lifecycle.ts ----
// Real one activates due CONFIRMED subscriptions and auto-closes expired ones. Until then the billing run
// still never bills past a subscription's expiryDate on its own, so skipping this is safe.
export async function runLifecycle(_now = new Date()): Promise<{ activated: number; closed: number }> {
  return { activated: 0, closed: 0 };
}
