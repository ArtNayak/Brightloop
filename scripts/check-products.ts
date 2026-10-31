// Pure catalog service regression checks. Run: npm run check:products
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  createProduct,
  createProductSchema,
  createVariant,
  createVariantSchema,
  ProductServiceDb,
  ProductServiceError,
  removeProduct,
  removeVariant,
  updateProduct,
  updateProductSchema,
  updateVariant,
  updateVariantSchema,
} from "../src/lib/catalog/products";

type ProductRow = {
  id: string;
  name: string;
  type: string;
  salesPrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  notes: string | null;
  active: boolean;
  taxId: string | null;
};
type VariantRow = { id: string; productId: string; attribute: string; value: string; extraPrice: Prisma.Decimal };
type FakeOptions = {
  productUsage?: { subLines?: number; templateLines?: number };
  variantUsage?: { subLines?: number; templateLines?: number };
  duplicateVariantCreate?: boolean;
  duplicateVariantUpdate?: boolean;
  deleteProductError?: boolean;
  deleteVariantError?: boolean;
};

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique/foreign key violation", { code, clientVersion: "test" });
}

function fakeDb(options: FakeOptions = {}) {
  const products = new Map<string, ProductRow>();
  const variants = new Map<string, VariantRow>();
  const taxes = new Map<string, boolean>([["tax-active", true], ["tax-inactive", false]]);
  let nextId = 1;
  let productDeletes = 0;
  let variantDeletes = 0;
  let productUpdates = 0;
  const database = {
    tax: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const active = taxes.get(where.id);
        return active === undefined ? null : { id: where.id, active };
      },
    },
    product: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: { _count?: unknown } }) => {
        const row = products.get(where.id);
        if (!row) return null;
        return select?._count
          ? { ...row, _count: { subLines: options.productUsage?.subLines ?? 0, templateLines: options.productUsage?.templateLines ?? 0 } }
          : row;
      },
      create: async ({ data }: { data: Omit<ProductRow, "id"> }) => {
        const row = { id: `product-${nextId++}`, ...data };
        products.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ProductRow> }) => {
        productUpdates++;
        const current = products.get(where.id);
        assert.ok(current, `missing product ${where.id}`);
        const row = { ...current, ...data };
        products.set(row.id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        if (options.deleteProductError) throw knownError("P2003");
        const row = products.get(where.id);
        assert.ok(row, `missing product ${where.id}`);
        products.delete(where.id);
        productDeletes++;
        return row;
      },
    },
    productVariant: {
      create: async ({ data }: { data: Omit<VariantRow, "id"> }) => {
        if (options.duplicateVariantCreate) throw knownError("P2002");
        const row = { id: `variant-${nextId++}`, ...data };
        variants.set(row.id, row);
        return row;
      },
      findFirst: async ({ where }: { where: { id: string; productId: string } }) => {
        const row = variants.get(where.id);
        return row?.productId === where.productId ? row : null;
      },
      findUnique: async ({ where, select }: { where: { id: string }; select?: { _count?: unknown } }) => {
        const row = variants.get(where.id);
        if (!row) return null;
        return select?._count
          ? { ...row, _count: { subLines: options.variantUsage?.subLines ?? 0, templateLines: options.variantUsage?.templateLines ?? 0 } }
          : row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<VariantRow> }) => {
        if (options.duplicateVariantUpdate) throw knownError("P2002");
        const current = variants.get(where.id);
        assert.ok(current, `missing variant ${where.id}`);
        const row = { ...current, ...data };
        variants.set(row.id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        if (options.deleteVariantError) throw knownError("P2003");
        const row = variants.get(where.id);
        assert.ok(row, `missing variant ${where.id}`);
        variants.delete(row.id);
        variantDeletes++;
        return row;
      },
    },
  } as unknown as ProductServiceDb;

  return { db: database, products, variants, productDeleteCount: () => productDeletes, productUpdateCount: () => productUpdates, variantDeleteCount: () => variantDeletes };
}

const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

const productInput = () => createProductSchema.parse({
  name: " Brightloop CRM ", type: " Software ", salesPrice: "1000.00", costPrice: "400", notes: " CRM ", taxId: "tax-active",
});

test("product schema trims text and rejects negative or over-precise prices", () => {
  const parsed = productInput();
  assert.equal(parsed.name, "Brightloop CRM");
  assert.equal(parsed.type, "Software");
  assert.equal(parsed.notes, "CRM");
  assert.equal(createProductSchema.safeParse({ ...parsed, salesPrice: -1 }).success, false);
  assert.equal(createProductSchema.safeParse({ ...parsed, costPrice: "10.001" }).success, false);
  assert.equal(createProductSchema.safeParse({ ...parsed, salesPrice: " " }).success, false);
});

test("variant schema requires nonempty attribute/value and a nonnegative two-decimal surcharge", () => {
  assert.equal(createVariantSchema.safeParse({ attribute: "Brand", value: "Odoo", extraPrice: "560.00" }).success, true);
  assert.equal(createVariantSchema.safeParse({ attribute: " ", value: "Odoo", extraPrice: 10 }).success, false);
  assert.equal(createVariantSchema.safeParse({ attribute: "Brand", value: "Odoo", extraPrice: -1 }).success, false);
  assert.equal(createVariantSchema.safeParse({ attribute: "Brand", value: "Odoo", extraPrice: 1.005 }).success, false);
  assert.equal(updateVariantSchema.safeParse({}).success, false);
});

test("create product stores exact two-decimal Decimal prices and validates active tax", async () => {
  const { db, products } = fakeDb();
  const product = await createProduct(db, productInput());
  assert.equal(product.salesPrice.toFixed(2), "1000.00");
  assert.equal(product.costPrice.toFixed(2), "400.00");
  assert.equal(product.active, true);
  assert.equal(products.size, 1);
  await assert.rejects(
    () => createProduct(db, createProductSchema.parse({ ...productInput(), taxId: "tax-inactive" })),
    (error: unknown) => error instanceof ProductServiceError && error.status === 400,
  );
});

test("update product changes supplied fields and returns null when missing", async () => {
  const { db } = fakeDb();
  const product = await createProduct(db, productInput());
  const update = updateProductSchema.parse({ name: "CRM Pro", active: false });
  const saved = await updateProduct(db, product.id, update);
  assert.ok(saved);
  assert.equal(saved.name, "CRM Pro");
  assert.equal(saved.active, false);
  assert.equal(await updateProduct(db, "missing", update), null);
});

test("remove deactivates products used by subscription lines or quotation lines", async () => {
  for (const productUsage of [{ subLines: 1 }, { templateLines: 1 }]) {
    const { db, products, productDeleteCount } = fakeDb({ productUsage });
    const product = await createProduct(db, productInput());
    assert.equal((await removeProduct(db, product.id))?.kind, "deactivated");
    assert.equal(products.get(product.id)?.active, false);
    assert.equal(productDeleteCount(), 0);
  }
});

test("foreign-key race while removing a product safely deactivates it", async () => {
  const { db, products } = fakeDb({ deleteProductError: true });
  const product = await createProduct(db, productInput());
  assert.equal((await removeProduct(db, product.id))?.kind, "deactivated");
});

test("remove hard-deletes an unused product", async () => {
  const { db, products, productDeleteCount } = fakeDb();
  const product = await createProduct(db, productInput());
  assert.equal((await removeProduct(db, product.id))?.kind, "deleted");
  assert.equal(products.has(product.id), false);
  assert.equal(productDeleteCount(), 1);
});

test("variant creation handles missing products and maps compound uniqueness to 409", async () => {
  const { db } = fakeDb();
  const data = createVariantSchema.parse({ attribute: "Brand", value: "Odoo", extraPrice: 560 });
  assert.equal(await createVariant(db, "missing", data), null);
  const product = await createProduct(db, productInput());
  const duplicateDb = fakeDb({ duplicateVariantCreate: true });
  const duplicateProduct = await createProduct(duplicateDb.db, productInput());
  await assert.rejects(
    () => createVariant(duplicateDb.db, duplicateProduct.id, data),
    (error: unknown) => error instanceof ProductServiceError && error.status === 409,
  );
  assert.ok(product);
});

test("variant update maps compound uniqueness conflicts to 409", async () => {
  const duplicateDb = fakeDb({ duplicateVariantUpdate: true });
  const product = await createProduct(duplicateDb.db, productInput());
  const variant = await createVariant(duplicateDb.db, product.id, createVariantSchema.parse({ attribute: "Brand", value: "Odoo", extraPrice: 560 }));
  assert.ok(variant);
  await assert.rejects(
    () => updateVariant(duplicateDb.db, product.id, variant.id, updateVariantSchema.parse({ value: "Custom" })),
    (error: unknown) => error instanceof ProductServiceError && error.status === 409,
  );
});

test("remove refuses variants referenced by subscription or quotation lines", async () => {
  for (const variantUsage of [{ subLines: 1 }, { templateLines: 1 }]) {
    const { db, variantDeleteCount } = fakeDb({ variantUsage });
    const product = await createProduct(db, productInput());
    const variant = await createVariant(db, product.id, createVariantSchema.parse({ attribute: "Brand", value: "Odoo", extraPrice: 560 }));
    assert.ok(variant);
    assert.equal((await removeVariant(db, product.id, variant.id))?.kind, "inUse");
    assert.equal(variantDeleteCount(), 0);
  }
});

test("foreign-key race while removing a variant returns in-use", async () => {
  const { db } = fakeDb({ deleteVariantError: true });
  const product = await createProduct(db, productInput());
  const variant = await createVariant(db, product.id, createVariantSchema.parse({ attribute: "Brand", value: "Odoo", extraPrice: 560 }));
  assert.ok(variant);
  assert.equal((await removeVariant(db, product.id, variant.id))?.kind, "inUse");
});

test("remove hard-deletes an unused variant", async () => {
  const { db, variants, variantDeleteCount } = fakeDb();
  const product = await createProduct(db, productInput());
  const variant = await createVariant(db, product.id, createVariantSchema.parse({ attribute: "Brand", value: "Odoo", extraPrice: 560 }));
  assert.ok(variant);
  assert.equal((await removeVariant(db, product.id, variant.id))?.kind, "deleted");
  assert.equal(variants.has(variant.id), false);
  assert.equal(variantDeleteCount(), 1);
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










