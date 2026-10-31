// Everything the billing run needs from other people's folders lives behind this one file, so a change in
// their code means touching one place here. All three are the real implementations now:
//   P2: period.ts (next billing date), discount-status.ts (is a discount usable right now)
//   P3: subscription-lifecycle.ts (activate due subscriptions, close expired ones before billing)
export { addPeriod } from "@/lib/period";
export { isDiscountActive } from "@/lib/discount-status";
export { runLifecycle } from "@/lib/subscription-lifecycle";
