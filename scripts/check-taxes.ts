// Pure service regression checks. Run: npm run check:taxes
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  createTax,
  createTaxSchema,
  removeTax,
  TaxServiceDb,
  updateTax,
  updateTaxSchema,
} from "../src/lib/catalog/taxes";

type TaxRow = { id: string; name: string; ratePercent: Prisma.Decimal; active: boolean };
type FakeOptions = { products?: number; lines?: number; foreignKeyRace?: boolean };

function fakeDb(options: FakeOptions = {}) {
  const rows = new Map<string, TaxRow>();
  let nextId = 1;
  let hardDeletes = 0;
  const database = {
    tax: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row, _count: { products: options.products ?? 0, lines: options.lines ?? 0 } } : null;
      },
      create: async ({ data }: { data: Omit<TaxRow, "id"> }) => {
        const row = { id: `tax-${nextId++}`, ...data };
        rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<TaxRow> }) => {
        const current = rows.get(where.id);
        assert.ok(current, `missing tax ${where.id}`);
        const row = { ...current, ...data };
        rows.set(row.id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        if (options.foreignKeyRace) {
          throw new Prisma.PrismaClientKnownRequestError("Foreign key reference appeared during delete", {
            code: "P2003",
            clientVersion: "test",
          });
        }
        const row = rows.get(where.id);
        assert.ok(row, `missing tax ${where.id}`);
        rows.delete(where.id);
        hardDeletes++;
        return row;
      },
    },
  } as unknown as TaxServiceDb;

  return { db: database, rows, hardDeleteCount: () => hardDeletes };
}

const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

test("tax schemas trim names and accept rates with at most two decimal places", () => {
  const valid = createTaxSchema.safeParse({ name: " GST ", ratePercent: "18.25" });
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.name, "GST");
  assert.equal(createTaxSchema.safeParse({ name: " ", ratePercent: 18 }).success, false);
  assert.equal(createTaxSchema.safeParse({ name: "GST", ratePercent: " " }).success, false);
  assert.equal(createTaxSchema.safeParse({ name: "GST", ratePercent: null }).success, false);
  assert.equal(createTaxSchema.safeParse({ name: "GST", ratePercent: true }).success, false);
  assert.equal(createTaxSchema.safeParse({ name: "GST", ratePercent: 100.01 }).success, false);
  assert.equal(createTaxSchema.safeParse({ name: "GST", ratePercent: 18.125 }).success, false);
  assert.equal(updateTaxSchema.safeParse({}).success, false);
});

test("create tax stores a two-decimal rate and defaults active", async () => {
  const { db, rows } = fakeDb();
  const result = createTaxSchema.parse({ name: "GST 18.1%", ratePercent: 18.1 });
  const tax = await createTax(db, result);
  assert.equal(tax.name, "GST 18.1%");
  assert.equal(tax.ratePercent.toFixed(2), "18.10");
  assert.equal(tax.active, true);
  assert.equal(rows.size, 1);
});

test("patch updates only supplied fields and normalizes the rate", async () => {
  const { db } = fakeDb();
  const created = await createTax(db, createTaxSchema.parse({ name: "GST", ratePercent: 5 }));
  const input = updateTaxSchema.parse({ name: "GST Reduced", ratePercent: 5.5, active: false });
  const updated = await updateTax(db, created.id, input);
  assert.ok(updated);
  assert.equal(updated.name, "GST Reduced");
  assert.equal(updated.ratePercent.toFixed(2), "5.50");
  assert.equal(updated.active, false);
});

test("patch returns null for a missing tax", async () => {
  const { db } = fakeDb();
  assert.equal(await updateTax(db, "missing", updateTaxSchema.parse({ active: false })), null);
});

test("remove deactivates a tax referenced by products", async () => {
  const { db, rows, hardDeleteCount } = fakeDb({ products: 1 });
  const tax = await createTax(db, createTaxSchema.parse({ name: "GST", ratePercent: 18 }));
  const result = await removeTax(db, tax.id);
  assert.equal(result?.kind, "deactivated");
  assert.equal(rows.get(tax.id)?.active, false);
  assert.equal(hardDeleteCount(), 0);
});

test("remove deactivates a tax referenced by subscription lines", async () => {
  const { db, rows, hardDeleteCount } = fakeDb({ lines: 1 });
  const tax = await createTax(db, createTaxSchema.parse({ name: "GST", ratePercent: 18 }));
  const result = await removeTax(db, tax.id);
  assert.equal(result?.kind, "deactivated");
  assert.equal(rows.get(tax.id)?.active, false);
  assert.equal(hardDeleteCount(), 0);
});

test("remove hard-deletes an unused tax", async () => {
  const { db, rows, hardDeleteCount } = fakeDb();
  const tax = await createTax(db, createTaxSchema.parse({ name: "GST", ratePercent: 18 }));
  const result = await removeTax(db, tax.id);
  assert.equal(result?.kind, "deleted");
  assert.equal(rows.has(tax.id), false);
  assert.equal(hardDeleteCount(), 1);
});

test("remove deactivates if a reference appears between the usage check and delete", async () => {
  const { db, rows, hardDeleteCount } = fakeDb({ foreignKeyRace: true });
  const tax = await createTax(db, createTaxSchema.parse({ name: "GST", ratePercent: 18 }));
  const result = await removeTax(db, tax.id);
  assert.equal(result?.kind, "deactivated");
  assert.equal(rows.get(tax.id)?.active, false);
  assert.equal(hardDeleteCount(), 0);
});

test("remove returns null for a missing tax", async () => {
  const { db } = fakeDb();
  assert.equal(await removeTax(db, "missing"), null);
});

async function main() {
  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failures++;
      console.log(`  FAIL ${name}\n       ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
