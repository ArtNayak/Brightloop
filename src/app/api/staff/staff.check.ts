// run: npm run test:staff   (needs `npm run dev` running and the seeded users; creates one throwaway staff user and deletes it)
// The role guard needs a real session, so this signs in through NextAuth over HTTP instead of calling the handler directly.
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { base, login } from "@/lib/check-helpers";

const email = `staff-check-${Date.now()}@brightloop.test`;
const tempPassword = "TempPassw0rd!";

const create = (cookie: string, payload: unknown) =>
  fetch(`${base}/api/staff`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(payload) });

async function main() {
  const payload = { name: "Staff Check", email, password: tempPassword };

  // --- only an admin may create accounts
  // signed out: the proxy bounces the caller to /login (307); the handler itself would answer 401
  assert.ok([307, 401].includes((await create("", payload)).status), "signed-out caller");
  for (const who of ["staff@brightloop.test", "customer@brightloop.test"]) {
    const cookie = await login(who);
    assert.ok(cookie, `${who} can sign in`);
    assert.equal((await create(cookie, payload)).status, 403, `${who} must be refused`);
  }
  assert.equal(await db.user.count({ where: { email } }), 0, "refused calls must not create anything");

  // --- admin path
  const admin = await login("admin@brightloop.test");
  assert.ok(admin, "admin can sign in");
  assert.equal((await create(admin, { ...payload, password: "weak" })).status, 400, "weak password");
  // a client trying to sneak in role: ADMIN must still get a STAFF account
  assert.equal((await create(admin, { ...payload, role: "ADMIN" })).status, 201);
  assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).role, "STAFF", "role is never taken from the client");
  assert.equal((await create(admin, payload)).status, 409, "duplicate email");

  // --- the new account works with the temporary password, and has no admin powers
  const fresh = await login(email, tempPassword);
  assert.ok(fresh, "new staff can sign in with the temporary password");
  assert.equal((await create(fresh, { ...payload, email: `other-${email}` })).status, 403, "new staff cannot create staff");
  assert.equal(await login(email, "WrongPassw0rd!"), "", "wrong password is refused");

  console.log("staff ok");
}

main().finally(async () => {
  await db.user.deleteMany({ where: { email: { contains: "staff-check-" } } });
  await db.$disconnect();
});
