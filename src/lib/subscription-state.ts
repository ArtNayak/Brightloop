import { Prisma, type Plan, type Role, type Subscription, type SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addPeriod } from "@/lib/period";

export const SUBSCRIPTION_ACTIONS = [
  "send_quote",
  "confirm",
  "activate",
  "pause",
  "resume",
  "close",
  "renew",
] as const;

export type Action = (typeof SUBSCRIPTION_ACTIONS)[number];
export type SubscriptionActor = { id: string; role: Role };

export class SubscriptionTransitionError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
    this.name = "SubscriptionTransitionError";
  }
}

export class SubscriptionNotFoundError extends SubscriptionTransitionError {
  constructor() {
    super("Subscription not found", 404);
    this.name = "SubscriptionNotFoundError";
  }
}

type ActionableSubscription = Pick<
  Subscription,
  "status" | "paused" | "startDate" | "expiryDate" | "quoteValidUntil"
> & {
  lines?: { id: string }[];
  _count?: { lines: number };
};

const CUSTOMER_ACTIONS: readonly Action[] = ["confirm", "pause", "resume", "close", "renew"];

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function isBeforeToday(value: Date | null, now: Date) {
  return value !== null && startOfUtcDay(value) < startOfUtcDay(now);
}

function isExpired(sub: ActionableSubscription, plan: Plan, now: Date) {
  return isBeforeToday(sub.expiryDate, now) || isBeforeToday(plan.endDate, now);
}

function isOnOrBeforeToday(value: Date, now: Date) {
  return startOfUtcDay(value) <= startOfUtcDay(now);
}

function planIsAvailable(plan: Plan, now: Date) {
  const today = startOfUtcDay(now);
  return startOfUtcDay(plan.startDate) <= today && (!plan.endDate || startOfUtcDay(plan.endDate) >= today);
}

function lineCount(sub: ActionableSubscription) {
  return sub._count?.lines ?? sub.lines?.length ?? 0;
}

/** Returns actions valid for the subscription's current state and actor role. */
export function allowedActions(
  sub: ActionableSubscription,
  plan: Plan,
  role: Role,
  now = new Date(),
): Action[] {
  const customer = role === "CUSTOMER";
  const actions: Action[] = [];

  if (sub.status === "DRAFT" && lineCount(sub) > 0) actions.push("send_quote");
  if (
    sub.status === "QUOTATION" &&
    sub.quoteValidUntil !== null &&
    startOfUtcDay(sub.quoteValidUntil) >= startOfUtcDay(now)
  ) {
    actions.push("confirm");
  }
  if (
    sub.status === "CONFIRMED" &&
    (isOnOrBeforeToday(sub.startDate, now) || !customer)
  ) {
    actions.push("activate");
  }
  if (sub.status === "ACTIVE" && !sub.paused && plan.pausable) actions.push("pause");
  if (sub.status === "ACTIVE" && sub.paused) actions.push("resume");
  if (
    sub.status !== "CLOSED" &&
    (sub.status !== "ACTIVE" || plan.closable || isExpired(sub, plan, now))
  ) {
    actions.push("close");
  }
  if (
    (sub.status === "ACTIVE" || sub.status === "CLOSED") &&
    plan.renewable &&
    planIsAvailable(plan, now) &&
    sub.expiryDate !== null &&
    sub.expiryDate.getTime() > sub.startDate.getTime()
  ) {
    actions.push("renew");
  }

  return customer ? actions.filter((action) => CUSTOMER_ACTIONS.includes(action)) : actions;
}

function invalidTransition(action: Action, status: SubscriptionStatus): never {
  throw new SubscriptionTransitionError(`Cannot ${action} a ${status} subscription`, 409);
}

function validateAction(
  action: Action,
  sub: Prisma.SubscriptionGetPayload<{
    include: { plan: true; template: true; _count: { select: { lines: true } } };
  }>,
  actor: SubscriptionActor,
  now: Date,
) {
  if (actor.role === "CUSTOMER" && !CUSTOMER_ACTIONS.includes(action)) {
    throw new SubscriptionTransitionError("You cannot perform this subscription action", 403);
  }

  switch (action) {
    case "send_quote":
      if (sub.status !== "DRAFT") invalidTransition(action, sub.status);
      if (sub._count.lines < 1) {
        throw new SubscriptionTransitionError("A subscription needs at least one line before it can be quoted", 409);
      }
      break;
    case "confirm":
      if (sub.status !== "QUOTATION") invalidTransition(action, sub.status);
      if (!sub.quoteValidUntil || startOfUtcDay(sub.quoteValidUntil) < startOfUtcDay(now)) {
        throw new SubscriptionTransitionError("Quote expired", 409);
      }
      break;
    case "activate":
      if (sub.status !== "CONFIRMED") invalidTransition(action, sub.status);
      if (actor.role === "CUSTOMER") invalidTransition(action, sub.status);
      break;
    case "pause":
      if (sub.status !== "ACTIVE") invalidTransition(action, sub.status);
      if (sub.paused) invalidTransition(action, sub.status);
      if (!sub.plan.pausable) {
        throw new SubscriptionTransitionError("This plan does not allow pausing", 409);
      }
      break;
    case "resume":
      if (sub.status !== "ACTIVE" || !sub.paused) invalidTransition(action, sub.status);
      break;
    case "close":
      if (sub.status === "CLOSED") invalidTransition(action, sub.status);
      if (sub.status === "ACTIVE" && !sub.plan.closable && !isExpired(sub, sub.plan, now)) {
        throw new SubscriptionTransitionError("This plan does not allow early closure", 409);
      }
      break;
    case "renew":
      if (sub.status !== "ACTIVE" && sub.status !== "CLOSED") invalidTransition(action, sub.status);
      if (!sub.plan.renewable) {
        throw new SubscriptionTransitionError("This plan does not allow renewal", 409);
      }
      if (!planIsAvailable(sub.plan, now)) {
        throw new SubscriptionTransitionError("This plan is not currently available", 409);
      }
      if (!sub.expiryDate || sub.expiryDate.getTime() <= sub.startDate.getTime()) {
        throw new SubscriptionTransitionError("Subscription has no valid term to renew", 409);
      }
      break;
  }
}

function nextPeriodBoundary(startDate: Date, period: Plan["period"], now: Date) {
  if (startDate > now) return startDate;
  let periods = 1;
  let boundary = addPeriod(startDate, period, periods);
  while (boundary <= now) boundary = addPeriod(startDate, period, ++periods);
  return boundary;
}

/** Applies one legal transition, checking ownership and updating atomically. */
export async function transition(id: string, action: Action, actor: SubscriptionActor, now = new Date()) {
  return db.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id },
      include: { plan: true, template: true, _count: { select: { lines: true } } },
    });
    if (!sub) throw new SubscriptionNotFoundError();

    // Use the same transaction and an indistinguishable 404 to prevent cross-customer ID probing.
    if (actor.role === "CUSTOMER" && sub.customerId !== actor.id) {
      throw new SubscriptionNotFoundError();
    }

    validateAction(action, sub, actor, now);
    const actions = allowedActions(sub, sub.plan, actor.role, now);
    if (!actions.includes(action)) invalidTransition(action, sub.status);

    const data: Prisma.SubscriptionUpdateManyMutationInput = {};
    switch (action) {
      case "send_quote": {
        data.status = "QUOTATION";
        if (!sub.quoteValidUntil) {
          const quoteValidUntil = startOfUtcDay(now);
          quoteValidUntil.setUTCDate(quoteValidUntil.getUTCDate() + (sub.template?.validityDays ?? 30));
          data.quoteValidUntil = quoteValidUntil;
        }
        break;
      }
      case "confirm":
        data.status = "CONFIRMED";
        break;
      case "activate":
        data.status = "ACTIVE";
        data.nextBillingDate = sub.startDate;
        break;
      case "pause":
        data.paused = true;
        break;
      case "resume":
        data.paused = false;
        break;
      case "close":
        data.status = "CLOSED";
        break;
      case "renew": {
        const termMs = sub.expiryDate!.getTime() - sub.startDate.getTime();
        data.expiryDate = new Date(sub.expiryDate!.getTime() + termMs);
        data.status = "ACTIVE";
        if (sub.status === "CLOSED") {
          data.paused = false;
          data.nextBillingDate = nextPeriodBoundary(sub.startDate, sub.plan.period, now);
        }
        break;
      }
    }

    const update = await tx.subscription.updateMany({
      where: {
        id,
        status: sub.status,
        paused: sub.paused,
        quoteValidUntil: sub.quoteValidUntil,
        nextBillingDate: sub.nextBillingDate,
      },
      data,
    });
    if (update.count !== 1) {
      throw new SubscriptionTransitionError("Subscription changed; refresh and try again", 409);
    }

    return tx.subscription.findUniqueOrThrow({ where: { id } });
  });
}
