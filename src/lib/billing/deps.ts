// Everything the billing run needs from other people's folders lives behind this one file.
// P2's period helper and P3's lifecycle runner are wired in; the discount helper is still temporary.
export { addPeriod } from "@/lib/period";
export { runLifecycle } from "@/lib/subscription-lifecycle";

// ---- TEMP until P2's src/lib/discount-status.ts ----
// ACTIVE = started, not ended, and not used up.
export function isDiscountActive(
  d: { startDate: Date; endDate: Date | null; usageLimit: number | null; timesUsed: number },
  now = new Date(),
): boolean {
  return d.startDate <= now && (d.endDate == null || d.endDate >= now) && (d.usageLimit == null || d.timesUsed < d.usageLimit);
}
