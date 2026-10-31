// Payment terms are stored on Subscription.paymentTerms as one of these exact strings (decision D2).
export const PAYMENT_TERMS = ["IMMEDIATE", "NET_15", "NET_30", "NET_45"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

const DAYS: Record<PaymentTerms, number> = { IMMEDIATE: 0, NET_15: 15, NET_30: 30, NET_45: 45 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until an invoice is due. Missing terms mean IMMEDIATE; an unknown string is bad data and throws. */
export function termsDays(terms: string | null | undefined): number {
  if (terms == null) return 0;
  if (!(terms in DAYS)) throw new Error(`Unknown payment terms "${terms}"`);
  return DAYS[terms as PaymentTerms];
}

/** dueDate = issueDate + N days (UTC), IMMEDIATE = same day. */
export function dueDateFor(issueDate: Date, terms: string | null | undefined): Date {
  return new Date(issueDate.getTime() + termsDays(terms) * DAY_MS);
}
