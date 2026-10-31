// run: npm run test:audit   (needs `npm run dev` running and the seeded users; changes nothing)
// T9 security audit, as a repeatable check. Three parts:
//   1. every route handler under src/app/api starts with requireRole (except the public auth routes)
//   2. the role matrix: customers can't call staff APIs, staff can't call admin-only APIs, signed-out callers get nothing
//   3. no response or page ever contains a password hash or a reset token
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { db } from "@/lib/db";
import { base, login } from "@/lib/check-helpers";

const apiDir = join(process.cwd(), "src", "app", "api");
const PUBLIC = ["auth/[...nextauth]", "auth/register", "auth/forgot-password", "auth/reset-password"];

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? routes(p) : f === "route.ts" ? [p] : [];
  });
}

// ---- 1. static: the first await inside every handler must be requireRole(...)
function checkGuards() {
  let handlers = 0;
  for (const file of routes(apiDir)) {
    const name = relative(apiDir, file).replace(/\\/g, "/").replace("/route.ts", "");
    if (PUBLIC.includes(name)) continue;
    const parts = readFileSync(file, "utf8").split(/export async function /).slice(1);
    assert.ok(parts.length > 0, `${name}: no handler found`);
    for (const part of parts) {
      handlers++;
      assert.equal(/await\s+([\w.]+)/.exec(part)?.[1], "requireRole", `/api/${name} ${part.split("(")[0]}: first await must be requireRole`);
    }
  }
  return handlers;
}

// ---- 2. dynamic: [method, path, body]. Ids are made up on purpose: the guard must answer before anything looks them up.
type Call = [string, string, unknown?];
const STAFF_ONLY: Call[] = [
  ["GET", "/api/invoices"], ["GET", "/api/invoices/x"], ["POST", "/api/invoices/x/confirm"], ["POST", "/api/invoices/x/send"],
  ["POST", "/api/invoices/x/cancel"], ["POST", "/api/invoices/confirm-drafts", {}], ["GET", "/api/billing/run"], ["POST", "/api/billing/run"],
  ["POST", "/api/payments", {}], ["GET", "/api/plans"], ["GET", "/api/plans/x"], ["GET", "/api/products"], ["GET", "/api/products/x"],
  ["GET", "/api/taxes"], ["GET", "/api/subscriptions"], ["POST", "/api/subscriptions", {}], ["GET", "/api/subscriptions/x"],
  ["PATCH", "/api/subscriptions/x", {}], ["GET", "/api/subscriptions/customers"],
];
const ADMIN_ONLY: Call[] = [
  ["POST", "/api/staff", {}], ["POST", "/api/jobs/lifecycle"], ["POST", "/api/plans", {}], ["PATCH", "/api/plans/x", {}],
  ["POST", "/api/products", {}], ["PATCH", "/api/products/x", {}], ["DELETE", "/api/products/x"], ["POST", "/api/products/x/variants", {}],
  ["PATCH", "/api/products/x/variants/y", {}], ["DELETE", "/api/products/x/variants/y"], ["POST", "/api/taxes", {}],
  ["PATCH", "/api/taxes/x", {}], ["DELETE", "/api/taxes/x"],
];

async function call(cookie: string, [method, path, body]: Call) {
  const res = await fetch(`${base}${path}`, {
    method, redirect: "manual",
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

async function checkMatrix() {
  const [admin, staff, customer] = await Promise.all(["admin", "staff", "customer"].map((w) => login(`${w}@brightloop.test`)));
  assert.ok(admin && staff && customer, "seeded logins work");
  for (const c of [...STAFF_ONLY, ...ADMIN_ONLY]) {
    const label = `${c[0]} ${c[1]}`;
    assert.ok([307, 401].includes((await call("", c)).status), `${label}: signed-out must be refused`);
    assert.equal((await call(customer, c)).status, 403, `${label}: customer must get 403`);
  }
  for (const c of ADMIN_ONLY) assert.equal((await call(staff, c)).status, 403, `${c[0]} ${c[1]}: staff must get 403`);
  // admins pass the guard (whatever the handler then says about the fake id, it is not 401/403)
  for (const c of [...STAFF_ONLY, ...ADMIN_ONLY]) {
    if (c[1] === "/api/jobs/lifecycle" || c[1] === "/api/billing/run" && c[0] === "POST") continue; // these really run jobs
    assert.ok(![401, 403, 307].includes((await call(admin, c)).status), `${c[0]} ${c[1]}: admin should get past the guard`);
  }
  return { admin, staff, customer };
}

// ---- 3. secrets: look through real responses and pages for hashes and tokens
async function checkNoSecrets(admin: string) {
  const sub = await db.subscription.findFirstOrThrow();
  const inv = await db.invoice.findFirstOrThrow();
  const secret = /passwordHash|resetToken|resetExpires|\$2[aby]\$\d\d\$/;
  const urls = [
    "/api/invoices", `/api/invoices/${inv.id}`, "/api/subscriptions", `/api/subscriptions/${sub.id}`, "/api/subscriptions/customers",
    "/api/plans", "/api/products", "/api/taxes",
    "/reports", "/payments", "/invoices", `/invoices/${inv.id}`, "/subscriptions", `/subscriptions/${sub.id}`, "/staff", "/products", "/plans",
  ];
  for (const u of urls) {
    const r = await call(admin, ["GET", u]);
    assert.equal(r.status, 200, `${u} should load for admin`);
    assert.ok(!secret.test(r.text), `${u} leaks a secret`);
  }
  // the public auth routes must not echo tokens or hashes either
  const email = `audit-${Date.now()}@brightloop.test`;
  const reg = await call("", ["POST", "/api/auth/register", { name: "Audit", email, password: "Passw0rd!x" }]);
  try {
    assert.equal(reg.status, 201);
    assert.ok(!secret.test(reg.text), "register leaks a secret");
    assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).role, "CUSTOMER", "register always makes a customer");
    const roleTry = await call("", ["POST", "/api/auth/register", { name: "Evil", email: `evil-${email}`, password: "Passw0rd!x", role: "ADMIN" }]);
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: `evil-${email}` } })).role, "CUSTOMER", "client-sent role is ignored");
    assert.ok(!secret.test(roleTry.text));
    const fp = await call("", ["POST", "/api/auth/forgot-password", { email }]);
    assert.ok(!secret.test(fp.text) && !/token/i.test(fp.text), "forgot-password must not return the token");
    const unknown = await call("", ["POST", "/api/auth/forgot-password", { email: "nobody-here@brightloop.test" }]);
    assert.equal(unknown.status, fp.status, "same answer for known and unknown emails (no account probing)");
  } finally {
    await db.user.deleteMany({ where: { email: { in: [email, `evil-${email}`] } } });
  }
}

async function main() {
  const n = checkGuards();
  const { admin } = await checkMatrix();
  await checkNoSecrets(admin);
  console.log(`security audit ok (${n} handlers guarded)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
