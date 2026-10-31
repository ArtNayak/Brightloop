import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createCustomer, CustomerError, customerInput, customerSearchWhere } from "@/lib/customers";

const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") throw new Error(`Refusing to run customer checks against "${host || "no DATABASE_URL"}".`);
for (const password of ["short", "alllowercase!", "ALLUPPERCASE!", "NoSpecial123"]) assert.equal(customerInput.safeParse({ name: "Customer", email: "customer@example.test", password }).success, false);
const valid = customerInput.safeParse({ name: "  Customer Test ", email: "  TEST@Example.Test ", password: "StrongPass1!", role: "ADMIN" });
assert.equal(valid.success, true);
if (valid.success) { assert.equal(valid.data.email, "test@example.test"); assert.equal("role" in valid.data, false); }
assert.deepEqual(customerSearchWhere(" Ada "), { role: "CUSTOMER", OR: [{ name: { contains: "Ada", mode: "insensitive" } }, { email: { contains: "Ada", mode: "insensitive" } }] });

const email = `customer-check-${crypto.randomUUID().slice(0, 8)}@brightloop.test`;
async function main() {
  let customerId = "";
  try {
    const input = customerInput.parse({ name: "  Customer Check ", email: `  ${email.toUpperCase()} `, password: "StrongPass1!", role: "ADMIN" });
    const created = await createCustomer(input); customerId = created.id;
    assert.equal(created.name, "Customer Check"); assert.equal(created.email, email); assert.equal(created.role, "CUSTOMER");
    assert.equal("passwordHash" in created, false);
    const stored = await db.user.findUniqueOrThrow({ where: { id: customerId }, select: { passwordHash: true, role: true } });
    assert.equal(await bcrypt.compare("StrongPass1!", stored.passwordHash), true); assert.equal(stored.role, "CUSTOMER");
    await assert.rejects(createCustomer(input), (error: unknown) => error instanceof CustomerError && error.status === 409);
  } finally {
    if (customerId) await db.user.deleteMany({ where: { id: customerId } });
  }
  console.log("Customer validation, role forcing, password hashing, and duplicate checks passed");
}
main().finally(() => db.$disconnect());
