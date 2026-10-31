import type { Discount } from "@prisma/client";

export type DiscountStatus = "SCHEDULED" | "ACTIVE" | "EXPIRED" | "EXHAUSTED";

export function discountStatus(d: Discount, now = new Date()): DiscountStatus {
  if (d.usageLimit !== null && d.timesUsed >= d.usageLimit) return "EXHAUSTED";
  if (now.getTime() < d.startDate.getTime()) return "SCHEDULED";
  if (d.endDate !== null && now.getTime() > d.endDate.getTime()) return "EXPIRED";
  return "ACTIVE";
}

export const isDiscountActive = (d: Discount, now?: Date) => discountStatus(d, now) === "ACTIVE";
