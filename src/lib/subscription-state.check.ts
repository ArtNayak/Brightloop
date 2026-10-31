import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  allowedActions,
  SubscriptionTransitionError,
  transition,
} from "@/lib/subscription-state";

const runId = crypto.randomUUID().slice(0, 8);
const prefix = `SUB-CHECK-${runId}`;
const now = new Date("2026-05-10T16:00:00.000Z");
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const createdNumbers: string[] = [];
const createdPlanIds: string[] = [];
let ownerId = "";
let otherCustomerId = "";
let productId = "";
let templateId = "";

const databaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(databaseHost) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  throw new Error(`Refusing to run subscription checks against "${databaseHost || "no DATABASE_URL"}".`);
}

function expectTransitionError(promise: Promise<unknown>, status: number, message?: string) {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SubscriptionTransitionError);
    assert.equal(error.status, status);
    if (message) assert.equal(error.message, message);
    return true;
  });
}

async function makePlan(
  name: string,
  options: { pausable?: boolean; closable?: boolean; renewable?: boolean; endDate?: Date } = {},
) {
  const plan = await db.plan.create({
    data: {
      name: `${prefix} ${name}`,
      price: "100.00",
      period: "MONTHLY",
      minQuantity: 1,
      startDate: day("2020-01-01"),
      ...(options.endDate ? { endDate: options.endDate } : {}),
      pausable: options.pausable ?? true,
      closable: options.closable ?? true,
      renewable: options.renewable ?? true,
    },
  });
  createdPlanIds.push(plan.id);
  return plan;
}

async function makeSubscription(
  name: string,
  planId: string,
  options: {
    status?: "DRAFT" | "QUOTATION" | "CONFIRMED" | "ACTIVE" | "CLOSED";
    startDate?: Date;
    expiryDate?: Date | null;
    quoteValidUntil?: Date | null;
    nextBillingDate?: Date | null;
    paused?: boolean;
    customerId?: string;
    lines?: boolean;
    templateId?: string | null;
  } = {},
) {
  const number = `${prefix}-${name}`;
  createdNumbers.push(number);
  return db.subscription.create({
    data: {
      number,
      customerId: options.customerId ?? ownerId,
      planId,
      templateId: options.templateId ?? null,
      status: options.status ?? "DRAFT",
      paused: options.paused ?? false,
      startDate: options.startDate ?? day("2026-05-01"),
      expiryDate: options.expiryDate === undefined ? day("2027-05-01") : options.expiryDate,
      quoteValidUntil: options.quoteValidUntil ?? null,
      nextBillingDate: options.nextBillingDate ?? null,
      paymentTerms: "NET_30",
      ...(options.lines
        ? {
            lines: {
              create: {
                productId,
                quantity: 1,
                unitPrice: "100.00",
                amount: "100.00",
              },
            },
          }
        : {}),
    },
  });
}

async function main() {
  const [owner, otherCustomer] = await Promise.all([
    db.user.create({
      data: {
        email: `${prefix.toLowerCase()}-owner@brightloop.test`,
        name: "State Check Owner",
        role: "CUSTOMER",
        passwordHash: "test-only",
      },
    }),
    db.user.create({
      data: {
        email: `${prefix.toLowerCase()}-other@brightloop.test`,
        name: "State Check Other Customer",
        role: "CUSTOMER",
        passwordHash: "test-only",
      },
    }),
  ]);
  ownerId = owner.id;
  otherCustomerId = otherCustomer.id;
  const product = await db.product.create({
    data: { name: `${prefix} Product`, type: "Software", salesPrice: "100.00", costPrice: "20.00" },
  });
  productId = product.id;

  const normalPlan = await makePlan("Normal");
  const restrictivePlan = await makePlan("Restrictive", { pausable: false, closable: false });
  const endedPlan = await makePlan("Ended Restrictive", {
    closable: false,
    endDate: day("2026-05-09"),
  });
  const notRenewablePlan = await makePlan("Not Renewable", { renewable: false });
  const futurePlan = await db.plan.create({
    data: {
      name: `${prefix} Future`,
      price: "100.00",
      period: "MONTHLY",
      startDate: day("2026-06-01"),
      pausable: true,
      closable: true,
      renewable: true,
    },
  });
  createdPlanIds.push(futurePlan.id);

  const template = await db.quotationTemplate.create({
    data: { name: `${prefix} Seven Day Quote`, validityDays: 7, planId: normalPlan.id },
  });
  templateId = template.id;

  // Quotes require a line and get a UTC calendar-day expiry from the template.
  const emptyDraft = await makeSubscription("empty-draft", normalPlan.id);
  await expectTransitionError(
    transition(emptyDraft.id, "send_quote", { id: "staff-check", role: Role.STAFF }, now),
    409,
    "A subscription needs at least one line before it can be quoted",
  );
  const quote = await makeSubscription("quote", normalPlan.id, { lines: true, templateId });
  const sentQuote = await transition(quote.id, "send_quote", { id: "staff-check", role: Role.STAFF }, now);
  assert.equal(sentQuote.status, "QUOTATION");
  assert.equal(sentQuote.quoteValidUntil?.toISOString(), "2026-05-17T00:00:00.000Z");
  const confirmed = await transition(quote.id, "confirm", { id: ownerId, role: Role.CUSTOMER }, now);
  assert.equal(confirmed.status, "CONFIRMED", "a customer can confirm their own valid quote");

  // Staff can deliberately activate before the scheduled start; billing starts on that start date.
  const futureStart = day("2026-06-01");
  const scheduled = await makeSubscription("scheduled", normalPlan.id, {
    status: "CONFIRMED",
    startDate: futureStart,
  });
  const activated = await transition(scheduled.id, "activate", { id: "staff-check", role: Role.STAFF }, now);
  assert.equal(activated.status, "ACTIVE");
  assert.equal(activated.nextBillingDate?.toISOString(), futureStart.toISOString());

  // Expired quotes, plan restrictions, and invalid source states return useful conflicts.
  const expiredQuote = await makeSubscription("expired-quote", normalPlan.id, {
    status: "QUOTATION",
    quoteValidUntil: day("2026-05-09"),
  });
  await expectTransitionError(
    transition(expiredQuote.id, "confirm", { id: ownerId, role: Role.CUSTOMER }, now),
    409,
    "Quote expired",
  );
  const cannotPause = await makeSubscription("cannot-pause", restrictivePlan.id, { status: "ACTIVE" });
  await expectTransitionError(
    transition(cannotPause.id, "pause", { id: "staff-check", role: Role.STAFF }, now),
    409,
    "This plan does not allow pausing",
  );
  const active = await makeSubscription("active", normalPlan.id, {
    status: "ACTIVE",
    nextBillingDate: day("2026-04-01"),
  });
  await transition(active.id, "pause", { id: ownerId, role: Role.CUSTOMER }, now);
  const resumed = await transition(active.id, "resume", { id: ownerId, role: Role.CUSTOMER }, now);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.nextBillingDate?.toISOString(), "2026-04-01T00:00:00.000Z", "resume preserves overdue billing dates");

  const tooEarlyToClose = await makeSubscription("too-early-close", restrictivePlan.id, { status: "ACTIVE" });
  await expectTransitionError(
    transition(tooEarlyToClose.id, "close", { id: "staff-check", role: Role.STAFF }, now),
    409,
    "This plan does not allow early closure",
  );
  const expiredActive = await makeSubscription("expired-active", restrictivePlan.id, {
    status: "ACTIVE",
    expiryDate: day("2026-05-09"),
  });
  assert.equal((await transition(expiredActive.id, "close", { id: "staff-check", role: Role.STAFF }, now)).status, "CLOSED");
  const activeOnEndedPlan = await makeSubscription("active-on-ended-plan", endedPlan.id, {
    status: "ACTIVE",
  });
  assert.equal(
    (await transition(activeOnEndedPlan.id, "close", { id: "staff-check", role: Role.STAFF }, now)).status,
    "CLOSED",
    "an ended plan can close even when the subscription expiry date is later",
  );
  const canceledDraft = await makeSubscription("cancel-draft", normalPlan.id);
  assert.equal((await transition(canceledDraft.id, "close", { id: "staff-check", role: Role.STAFF }, now)).status, "CLOSED");

  // Closed renewals extend the original term and choose the next anchored period boundary.
  const startDate = day("2026-01-01");
  const expiryDate = day("2026-02-01");
  const closed = await makeSubscription("renew-closed", normalPlan.id, {
    status: "CLOSED",
    startDate,
    expiryDate,
  });
  const renewed = await transition(closed.id, "renew", { id: "staff-check", role: Role.STAFF }, now);
  assert.equal(renewed.status, "ACTIVE");
  assert.equal(renewed.expiryDate?.toISOString(), "2026-03-04T00:00:00.000Z");
  assert.equal(renewed.nextBillingDate?.toISOString(), "2026-06-01T00:00:00.000Z");
  const nonrenewable = await makeSubscription("nonrenewable", notRenewablePlan.id, { status: "CLOSED" });
  await expectTransitionError(
    transition(nonrenewable.id, "renew", { id: "staff-check", role: Role.STAFF }, now),
    409,
    "This plan does not allow renewal",
  );
  const unavailable = await makeSubscription("unavailable", futurePlan.id, { status: "CLOSED" });
  await expectTransitionError(
    transition(unavailable.id, "renew", { id: "staff-check", role: Role.STAFF }, now),
    409,
    "This plan is not currently available",
  );

  // Ownership is checked before action legality; a guessed ID gets the same 404 as a missing ID.
  await expectTransitionError(
    transition(active.id, "pause", { id: otherCustomerId, role: Role.CUSTOMER }, now),
    404,
    "Subscription not found",
  );
  await expectTransitionError(
    transition(emptyDraft.id, "send_quote", { id: ownerId, role: Role.CUSTOMER }, now),
    403,
    "You cannot perform this subscription action",
  );
  const ownActions = allowedActions(
    { status: "QUOTATION", paused: false, startDate: day("2026-05-01"), expiryDate: day("2027-05-01"), quoteValidUntil: day("2026-05-17") },
    normalPlan,
    Role.CUSTOMER,
    now,
  );
  assert.deepEqual(ownActions, ["confirm", "close"]);

  // Concurrent transitions must not both apply to the same prior state.
  const concurrent = await makeSubscription("concurrent", normalPlan.id, { lines: true });
  const attempts = await Promise.allSettled([
    transition(concurrent.id, "send_quote", { id: "staff-check", role: Role.STAFF }, now),
    transition(concurrent.id, "send_quote", { id: "staff-check", role: Role.STAFF }, now),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);

  console.log("subscription state transitions ok");
}

main()
  .finally(async () => {
    await db.subscription.deleteMany({ where: { number: { startsWith: prefix } } });
    if (templateId) await db.quotationTemplate.deleteMany({ where: { id: templateId } });
    if (productId) await db.product.deleteMany({ where: { id: productId } });
    if (createdPlanIds.length) await db.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, otherCustomerId].filter(Boolean) } } });
    await db.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
