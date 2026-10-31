import assert from "node:assert/strict";
import { addPeriod } from "../src/lib/period";

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

assert.equal(addPeriod(utc(2026, 1, 31), "MONTHLY").toISOString(), utc(2026, 2, 28).toISOString());
assert.equal(addPeriod(utc(2028, 1, 31), "MONTHLY").toISOString(), utc(2028, 2, 29).toISOString());
assert.equal(addPeriod(utc(2026, 3, 31), "MONTHLY").toISOString(), utc(2026, 4, 30).toISOString());
assert.equal(addPeriod(utc(2028, 2, 29), "YEARLY").toISOString(), utc(2029, 2, 28).toISOString());
assert.equal(addPeriod(utc(2026, 1, 1), "DAILY", 2).toISOString(), utc(2026, 1, 3).toISOString());
assert.equal(addPeriod(utc(2026, 1, 1), "WEEKLY", 2).toISOString(), utc(2026, 1, 15).toISOString());

console.log("Billing period checks passed.");
