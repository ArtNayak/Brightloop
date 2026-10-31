import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { runLifecycle } from "@/lib/subscription-lifecycle";

const runId = crypto.randomUUID().slice(0, 8);
const prefix = `LIFECYCLE-CHECK-${runId}`;
const now = new Date("2026-05-10T16:00:00.000Z");
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const planIds: string[] = [];
let customerId = "";

const databaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(databaseHost) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  throw new Error(`Refusing to run lifecycle checks against "${databaseHost || "no DATABASE_URL"}".`);
}

async function makePlan(
  name: string,
  options: { autoClose?: boolean; endDate?: Date; closable?: boolean } = {},
) {
  const plan = await db.plan.create({
    data: {
      name: `${prefix} ${name}`,
      price: "100.00",
      period: "MONTHLY",
      startDate: day("2020-01-01"),
      autoClose: options.autoClose ?? false,
      closable: options.closable ?? true,
      ...(options.endDate ? { endDate: options.endDate } : {}),
    },
  });
  planIds.push(plan.id);
  return plan;
}

const numbers: string[] = [];
async function makeSubscription(
  name: string,
  planId: string,
  options: {
    status: "CONFIRMED" | "ACTIVE";
    startDate?: Date;
    expiryDate?: Date | null;
    nextBillingDate?: Date | null;
    paused?: boolean;
  },
) {
  const number = `${prefix}-${name}`;
  numbers.push(number);
  return db.subscription.create({
    data: {
      number,
      customerId,
      planId,
      status: options.status,
      startDate: options.startDate ?? day("2026-05-01"),
      expiryDate: options.expiryDate === undefined ? day("2027-05-01") : options.expiryDate,
      nextBillingDate: options.nextBillingDate ?? null,
      paused: options.paused ?? false,
    },
  });
}

async function main() {
  const customer = await db.user.create({
    data: {
      email: `${prefix.toLowerCase()}@brightloop.test`,
      name: "Lifecycle Check Customer",
      role: "CUSTOMER",
      passwordHash: "test-only",
    },
  });
  customerId = customer.id;

  const ordinaryPlan = await makePlan("Ordinary");
  const autoClosePlan = await makePlan("Auto Close", { autoClose: true, closable: false });
  const planEnding = await makePlan("Ended Auto Close", {
    autoClose: true,
    closable: false,
    endDate: day("2026-05-09"),
  });

  const dueConfirmed = await makeSubscription("due-confirmed", ordinaryPlan.id, {
    status: "CONFIRMED",
    startDate: day("2026-05-10"),
  });
  const futureConfirmed = await makeSubscription("future-confirmed", ordinaryPlan.id, {
    status: "CONFIRMED",
    startDate: day("2026-05-11"),
  });
  const expired = await makeSubscription("expired", autoClosePlan.id, {
    status: "ACTIVE",
    expiryDate: day("2026-05-09"),
  });
  const endedPlanSubscription = await makeSubscription("plan-ended", planEnding.id, {
    status: "ACTIVE",
    expiryDate: day("2027-05-01"),
  });
  const pausedExpired = await makeSubscription("paused-expired", autoClosePlan.id, {
    status: "ACTIVE",
    paused: true,
    expiryDate: day("2026-05-09"),
  });
  const manualClose = await makeSubscription("manual-close", ordinaryPlan.id, {
    status: "ACTIVE",
    expiryDate: day("2026-05-09"),
  });

  const first = await runLifecycle(now);
  assert.deepEqual(first, { activated: 1, closed: 3 });
  const [activated, future, expiredRow, endedPlanRow, pausedRow, manualRow] = await Promise.all([
    db.subscription.findUniqueOrThrow({ where: { id: dueConfirmed.id } }),
    db.subscription.findUniqueOrThrow({ where: { id: futureConfirmed.id } }),
    db.subscription.findUniqueOrThrow({ where: { id: expired.id } }),
    db.subscription.findUniqueOrThrow({ where: { id: endedPlanSubscription.id } }),
    db.subscription.findUniqueOrThrow({ where: { id: pausedExpired.id } }),
    db.subscription.findUniqueOrThrow({ where: { id: manualClose.id } }),
  ]);
  assert.equal(activated.status, "ACTIVE");
  assert.equal(activated.nextBillingDate?.toISOString(), "2026-05-10T00:00:00.000Z");
  assert.equal(future.status, "CONFIRMED", "a future start date stays confirmed");
  assert.equal(expiredRow.status, "CLOSED");
  assert.equal(endedPlanRow.status, "CLOSED", "an ended auto-close plan closes its active subscriptions");
  assert.equal(pausedRow.status, "CLOSED", "auto-close also applies to paused active subscriptions");
  assert.equal(manualRow.status, "ACTIVE", "plans without auto-close remain for staff to close");
  assert.deepEqual(await runLifecycle(now), { activated: 0, closed: 0 }, "repeated runs are idempotent");

  const concurrentActivation = await makeSubscription("concurrent-activate", ordinaryPlan.id, {
    status: "CONFIRMED",
    startDate: day("2026-05-10"),
  });
  const concurrentClose = await makeSubscription("concurrent-close", autoClosePlan.id, {
    status: "ACTIVE",
    expiryDate: day("2026-05-09"),
  });
  const [left, right] = await Promise.all([runLifecycle(now), runLifecycle(now)]);
  assert.equal(left.activated + right.activated, 1, "concurrent lifecycle runs activate only once");
  assert.equal(left.closed + right.closed, 1, "concurrent lifecycle runs close only once");
  assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: concurrentActivation.id } })).status, "ACTIVE");
  assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: concurrentClose.id } })).status, "CLOSED");

  console.log("subscription lifecycle ok");
}

main()
  .finally(async () => {
    await db.subscription.deleteMany({ where: { number: { startsWith: prefix } } });
    if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    if (customerId) await db.user.deleteMany({ where: { id: customerId } });
    await db.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
