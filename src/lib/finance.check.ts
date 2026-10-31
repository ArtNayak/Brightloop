// run: npx tsx src/lib/finance.check.ts
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { daysOverdue, outstanding, overdueWhere } from "./finance";

const D = (v: string) => new Prisma.Decimal(v);

// nothing paid yet -> the whole amount is owed
assert.equal(outstanding({ total: D("1000.00"), payments: [] }).toFixed(2), "1000.00");
// partial payment -> the rest is owed
assert.equal(outstanding({ total: D("1000.00"), payments: [{ amount: D("400.00") }] }).toFixed(2), "600.00");
// 0.10 + 0.20 must be exactly 0.30 (plain JS numbers would give 0.30000000000000004)
assert.equal(outstanding({ total: D("0.30"), payments: [{ amount: D("0.10") }, { amount: D("0.20") }] }).toFixed(2), "0.00");
// overpaid -> owed is 0, not negative
assert.equal(outstanding({ total: D("100.00"), payments: [{ amount: D("150.00") }] }).toFixed(2), "0.00");

// mid-afternoon on the 31st: "today" should start at midnight, so only earlier days count as overdue
const w = overdueWhere(new Date("2026-10-31T15:30:00Z"));
assert.equal(w.status, "CONFIRMED");
assert.equal((w.dueDate as { lt: Date }).lt.toISOString(), "2026-10-31T00:00:00.000Z");

// days overdue: due today or later = 0, due yesterday = 1, due 25 days ago = 25, an afternoon due time still counts as a full day
const now = new Date("2026-10-31T15:30:00Z");
assert.equal(daysOverdue(new Date("2026-10-31T00:00:00Z"), now), 0);
assert.equal(daysOverdue(new Date("2026-11-05T00:00:00Z"), now), 0);
assert.equal(daysOverdue(new Date("2026-10-30T00:00:00Z"), now), 1);
assert.equal(daysOverdue(new Date("2026-10-30T15:00:00Z"), now), 1);
assert.equal(daysOverdue(new Date("2026-10-06T00:00:00Z"), now), 25);

console.log("finance ok");
