// Plan schema/service regression checks. Run: npm run check:plans
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  availabilityStatus,
  createPlan,
  createPlanSchema,
  PlanServiceDb,
  PlanServiceError,
  updatePlan,
  updatePlanSchema,
} from "../src/lib/catalog/plans";

type PlanRow = {
  id: string; name: string; price: Prisma.Decimal; period: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; minQuantity: number;
  startDate: Date; endDate: Date | null; autoClose: boolean; closable: boolean; pausable: boolean; renewable: boolean;
};

type Options = { subscriptions?: number };
function fakeDb(options: Options = {}) {
  const plans = new Map<string, PlanRow>();
  let nextId = 1;
  const db = {
    plan: {
      create: async ({ data }: { data: Omit<PlanRow, "id"> }) => {
        const row = { id: `plan-${nextId++}`, ...data };
        plans.set(row.id, row);
        return row;
      },
      findUnique: async ({ where, select }: { where: { id: string }; select?: { _count?: unknown } }) => {
        const row = plans.get(where.id);
        if (!row) return null;
        return select?._count ? { ...row, _count: { subscriptions: options.subscriptions ?? 0 } } : row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PlanRow> }) => {
        const row = plans.get(where.id);
        assert.ok(row);
        const updated = { ...row, ...data };
        plans.set(where.id, updated);
        return updated;
      },
    },
  } as unknown as PlanServiceDb;
  return { db, plans };
}

const baseInput = () => createPlanSchema.parse({
  name: " Monthly Pro ", price: "1200.00", period: "MONTHLY", minQuantity: "1", startDate: "2026-01-01", endDate: "2026-12-31",
  autoClose: true, closable: true, pausable: false, renewable: true,
});
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push([name, run]);

test("plan schema trims, validates nonnegative money, positive quantity, and valid date ranges", () => {
  const plan = baseInput();
  assert.equal(plan.name, "Monthly Pro");
  assert.equal(plan.startDate.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(createPlanSchema.safeParse({ ...plan, price: "-0.01" }).success, false);
  assert.equal(createPlanSchema.safeParse({ ...plan, minQuantity: 0 }).success, false);
  assert.equal(createPlanSchema.safeParse({ ...plan, endDate: "2025-12-31" }).success, false);
  assert.equal(createPlanSchema.safeParse({ ...plan, startDate: "not-a-date" }).success, false);
});

test("create plan stores two-decimal Decimal price and each behavior flag", async () => {
  const { db, plans } = fakeDb();
  const input = baseInput();
  const saved = await createPlan(db, input);
  assert.equal(saved.name, "Monthly Pro");
  assert.equal(saved.price.toFixed(2), "1200.00");
  assert.equal(saved.period, "MONTHLY");
  assert.equal(saved.autoClose, true);
  assert.equal(saved.closable, true);
  assert.equal(saved.pausable, false);
  assert.equal(saved.renewable, true);
  assert.equal(plans.size, 1);
});

test("update only changes supplied fields and rejects an empty patch", async () => {
  const { db } = fakeDb();
  const created = await createPlan(db, baseInput());
  const updated = await updatePlan(db, created.id, updatePlanSchema.parse({ name: "Monthly Plus", pausable: true }));
  assert.ok(updated);
  assert.equal(updated.name, "Monthly Plus");
  assert.equal(updated.pausable, true);
  assert.equal(updated.period, "MONTHLY");
  assert.equal(updatePlanSchema.safeParse({}).success, false);
  assert.equal(await updatePlan(db, "missing", updatePlanSchema.parse({ name: "Missing" })), null);
});

test("period change is allowed without subscriptions and conflicts once referenced", async () => {
  const available = fakeDb();
  const plan = await createPlan(available.db, baseInput());
  const changed = await updatePlan(available.db, plan.id, updatePlanSchema.parse({ period: "YEARLY" }));
  assert.equal(changed?.period, "YEARLY");
  const referenced = fakeDb({ subscriptions: 1 });
  const used = await createPlan(referenced.db, baseInput());
  await assert.rejects(
    () => updatePlan(referenced.db, used.id, updatePlanSchema.parse({ period: "YEARLY" })),
    (error: unknown) => error instanceof PlanServiceError && error.status === 409,
  );
});

test("partial date edits are checked against the existing plan date", async () => {
  const { db } = fakeDb();
  const plan = await createPlan(db, baseInput());
  await assert.rejects(
    () => updatePlan(db, plan.id, updatePlanSchema.parse({ startDate: "2027-01-01" })),
    (error: unknown) => error instanceof PlanServiceError && error.status === 400,
  );
});

test("availability uses inclusive UTC calendar days", () => {
  const today = new Date("2026-05-10T17:00:00.000Z");
  assert.equal(availabilityStatus({ startDate: new Date("2026-05-11T00:00:00Z"), endDate: null }, today), "Upcoming");
  assert.equal(availabilityStatus({ startDate: new Date("2026-05-10T00:00:00Z"), endDate: new Date("2026-05-10T00:00:00Z") }, today), "Available");
  assert.equal(availabilityStatus({ startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-05-09T23:59:59Z") }, today), "Ended");
});

async function main() {
  let failures = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log(`  ok   ${name}`); }
    catch (error) { failures++; console.log(`  FAIL ${name}\n       ${(error as Error).message}`); }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
