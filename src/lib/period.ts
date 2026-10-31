import type { BillingPeriod } from "@prisma/client";

/** Add billing periods in UTC, clamping month/year overflow to the last valid day. */
export function addPeriod(date: Date, period: BillingPeriod, n = 1): Date {
  if (!Number.isInteger(n)) throw new RangeError("Billing period count must be an integer");

  const result = new Date(date.getTime());
  if (period === "DAILY") {
    result.setUTCDate(result.getUTCDate() + n);
    return result;
  }
  if (period === "WEEKLY") {
    result.setUTCDate(result.getUTCDate() + 7 * n);
    return result;
  }

  const monthDelta = period === "MONTHLY" ? n : 12 * n;
  const targetMonthIndex = result.getUTCMonth() + monthDelta;
  const targetYear = result.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCFullYear(targetYear, normalizedMonth, 1);
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}
