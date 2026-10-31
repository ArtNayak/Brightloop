// Everything the billing run needs from other people's folders lives behind this one file.
// P2's period.ts is wired in; P2's discount-status.ts and P3 (subscription-lifecycle.ts) haven't merged yet, so these are
// temporary versions with the agreed signatures. When theirs land, replace each block with a re-export:
//   export { isDiscountActive } from "@/lib/discount-status";
//   export { runLifecycle } from "@/lib/subscription-lifecycle";
export { addPeriod } from "@/lib/period";

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
