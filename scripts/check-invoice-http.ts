// HTTP check of the invoice API and the /invoices/[id] page: role matrix with the real seeded logins, status codes, JSON error shape and
// "no secrets in any response". Run: npm run check:invoice-http
// Needs: a seeded local database AND the app running (npm run dev, or build + start) at BASE_URL (default
// http://localhost:3000) using that same database. Fixture rows are prefixed INV-TESTHTTP / TEST-HTTP / test-http-
// and removed afterwards. It never sends mail and never calls confirm-drafts without ids.
import assert from "node:assert/strict";
import { db } from "../src/lib/db";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  console.error(`Refusing to run against "${host || "no DATABASE_URL"}". Use a local database (or set ALLOW_REMOTE_TEST_DB=1).`);
  process.exit(1);
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function login(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const take = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  take(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: header() },
    body: new URLSearchParams({ csrfToken, email, password: "Passw0rd!", json: "true" }),
  });
  take(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed for ${email} (HTTP ${res.status}). Is the database seeded and the app using it?`);
  return header();
}

async function call(cookie: string | null, method: "GET" | "POST", path: string, body?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

async function cleanup() {
  await db.payment.deleteMany({ where: { invoice: { number: { startsWith: "INV-TESTHTTP" } } } });
  await db.invoice.deleteMany({ where: { number: { startsWith: "INV-TESTHTTP" } } });
  await db.subscription.deleteMany({ where: { number: { startsWith: "TEST-HTTP" } } });
  await db.plan.deleteMany({ where: { name: { startsWith: "TEST-HTTP" } } });
  await db.user.deleteMany({ where: { email: { startsWith: "test-http-" } } });
}

async function main() {
  await cleanup();
  const customer = await db.user.create({ data: { email: "test-http-customer@brightloop.test", name: "Http TestCustomer", passwordHash: "x", role: "CUSTOMER" } });
  const staffUser = await db.user.findUniqueOrThrow({ where: { email: "staff@brightloop.test" } }).catch(() => {
    throw new Error("Seeded logins missing: run `npm run db:seed` on this database first.");
  });
  const plan = await db.plan.create({ data: { name: "TEST-HTTP Plan", price: 1, period: "MONTHLY", startDate: day("2019-01-01") } });
  const sub = await db.subscription.create({ data: { number: "TEST-HTTP-001", customerId: customer.id, planId: plan.id, status: "ACTIVE", startDate: day("2019-01-01") } });
  let n = 0;
  const mk = (status: "DRAFT" | "CONFIRMED" | "PAID" | "CANCELLED", payments: number[] = []) =>
    db.invoice
      .create({
        data: {
          number: `INV-TESTHTTP-${++n}`,
          subscriptionId: sub.id,
          customerId: customer.id,
          status,
          periodStart: new Date(day("2019-01-01").getTime() + n * 86_400_000),
          periodEnd: day("2030-01-01"),
          dueDate: day("2020-02-05"),
          subtotal: 1000,
          taxTotal: 180,
          total: 1180,
          lines: { create: [{ description: "Line", quantity: 1, unitPrice: 1000, taxPercent: 18, amount: 1000 }] },
        },
      })
      .then(async (inv) => {
        for (const amount of payments) await db.payment.create({ data: { invoiceId: inv.id, method: "CASH", amount, paidAt: day("2020-02-01"), recordedById: staffUser.id } });
        return inv;
      });
  const statusOf = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).status;

  const [admin, staff, cust] = await Promise.all([login("admin@brightloop.test"), login("staff@brightloop.test"), login("customer@brightloop.test")]);

  const results: [string, boolean][] = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push([name, true]);
      console.log(`  ok   ${name}`);
    } catch (e) {
      results.push([name, false]);
      console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n").join("\n       ")}`);
    }
  };

  // ---------------- who may call what ----------------
  const guard = await mk("DRAFT"); // used by the role tests: must never change
  const endpoints: [string, "GET" | "POST", string, string?][] = [
    ["list", "GET", "/api/invoices"],
    ["detail", "GET", `/api/invoices/${guard.id}`],
    ["confirm", "POST", `/api/invoices/${guard.id}/confirm`],
    ["cancel", "POST", `/api/invoices/${guard.id}/cancel`],
    ["send", "POST", `/api/invoices/${guard.id}/send`],
    ["confirm-drafts", "POST", "/api/invoices/confirm-drafts", JSON.stringify({ ids: [guard.id] })],
  ];
  await check("anonymous callers get nothing from any invoice endpoint (redirected to login / 401)", async () => {
    for (const [name, method, path, body] of endpoints) {
      const r = await call(null, method, path, body);
      assert.ok([307, 401].includes(r.status), `${name}: HTTP ${r.status}`);
      assert.ok(!r.text.includes("INV-TESTHTTP"), `${name} leaked data to an anonymous caller`);
    }
    assert.equal(await statusOf(guard.id), "DRAFT");
  });
  await check("CUSTOMER gets 403 {error} from every invoice endpoint and nothing changes", async () => {
    for (const [name, method, path, body] of endpoints) {
      const r = await call(cust, method, path, body);
      assert.equal(r.status, 403, name);
      assert.equal(typeof r.json?.error, "string", `${name}: error body is not JSON {error}`);
      assert.ok(!r.text.includes("INV-TESTHTTP"), `${name} leaked data to a customer`);
    }
    assert.equal(await statusOf(guard.id), "DRAFT");
  });
  await check("STAFF and ADMIN can read the list and detail", async () => {
    for (const who of [staff, admin]) {
      const list = await call(who, "GET", `/api/invoices?customerId=${customer.id}`);
      assert.equal(list.status, 200);
      assert.ok(Array.isArray(list.json?.items) && (list.json!.items as unknown[]).length >= 1);
      const one = await call(who, "GET", `/api/invoices/${guard.id}`);
      assert.equal(one.status, 200);
      assert.equal(one.json?.number, "INV-TESTHTTP-1");
    }
  });

  // ---------------- the /invoices/[id] page ----------------
  const page = (cookie: string | null, id: string) => call(cookie, "GET", `/invoices/${id}`);
  await check("page: anonymous goes to login, CUSTOMER is sent to the portal, neither sees invoice data", async () => {
    const anon = await page(null, guard.id);
    assert.equal(anon.status, 307);
    assert.ok(!anon.text.includes("INV-TESTHTTP"));
    const c = await fetch(`${BASE}/invoices/${guard.id}`, { redirect: "manual", headers: { cookie: cust } });
    assert.equal(c.status, 307);
    assert.ok(new URL(c.headers.get("location") ?? "", BASE).pathname.startsWith("/portal"), `redirected to ${c.headers.get("location")}`);
    assert.ok(!(await c.text()).includes("INV-TESTHTTP"));
  });
  await check("page: STAFF and ADMIN see the invoice; unknown id is a 404", async () => {
    for (const who of [staff, admin]) {
      const r = await page(who, guard.id);
      assert.equal(r.status, 200);
      for (const s of ["INV-TESTHTTP-1", "Http TestCustomer", "1,180.00", "Draft"]) assert.ok(r.text.includes(s), `missing "${s}"`);
    }
    assert.equal((await page(staff, "does-not-exist")).status, 404);
  });
  await check("page: buttons match the status (DRAFT confirm/cancel, CONFIRMED send/cancel, with payments no cancel, PAID send, CANCELLED none)", async () => {
    const has = async (id: string) => {
      const t = (await page(staff, id)).text;
      return { confirm: t.includes("Confirm invoice"), send: t.includes("Send to customer"), cancel: t.includes("Cancel invoice") };
    };
    assert.deepEqual(await has((await mk("DRAFT")).id), { confirm: true, send: false, cancel: true });
    assert.deepEqual(await has((await mk("CONFIRMED")).id), { confirm: false, send: true, cancel: true });
    assert.deepEqual(await has((await mk("CONFIRMED", [100])).id), { confirm: false, send: true, cancel: false });
    assert.deepEqual(await has((await mk("PAID", [1180])).id), { confirm: false, send: true, cancel: false });
    assert.deepEqual(await has((await mk("CANCELLED")).id), { confirm: false, send: false, cancel: false });
  });
  await check("page: never contains password hashes or reset tokens", async () => {
    const t = (await page(staff, guard.id)).text;
    assert.ok(!/passwordHash|resetToken|resetExpires|\$2[aby]\$/.test(t));
  });

  // ---------------- behaviour over HTTP ----------------
  await check("confirm: 200 then 409 {error} the second time; unknown id 404", async () => {
    const i = await mk("DRAFT");
    const a = await call(staff, "POST", `/api/invoices/${i.id}/confirm`);
    assert.equal(a.status, 200);
    assert.equal(a.json?.status, "CONFIRMED");
    const b = await call(staff, "POST", `/api/invoices/${i.id}/confirm`);
    assert.equal(b.status, 409);
    assert.match(String(b.json?.error), /Cannot confirm a CONFIRMED invoice/);
    assert.equal((await call(staff, "POST", "/api/invoices/does-not-exist/confirm")).status, 404);
  });
  await check("cancel: 200 for a DRAFT, 409 when payments exist, admin allowed too", async () => {
    const d = await mk("DRAFT");
    assert.equal((await call(admin, "POST", `/api/invoices/${d.id}/cancel`)).json?.status, "CANCELLED");
    const paid = await mk("CONFIRMED", [100]);
    const r = await call(staff, "POST", `/api/invoices/${paid.id}/cancel`);
    assert.equal(r.status, 409);
    assert.match(String(r.json?.error), /has payments/);
    assert.equal(await statusOf(paid.id), "CONFIRMED");
  });
  await check("send: a DRAFT is refused with 409 (no mail attempted); unknown id 404", async () => {
    const d = await mk("DRAFT");
    const r = await call(staff, "POST", `/api/invoices/${d.id}/send`);
    assert.equal(r.status, 409);
    assert.match(String(r.json?.error), /Cannot send a DRAFT invoice/);
    assert.equal((await call(staff, "POST", "/api/invoices/does-not-exist/send")).status, 404);
  });
  await check("confirm-drafts: confirms only the listed drafts; bad bodies are 400", async () => {
    const [a, b, keep] = await Promise.all([mk("DRAFT"), mk("DRAFT"), mk("DRAFT")]);
    const r = await call(staff, "POST", "/api/invoices/confirm-drafts", JSON.stringify({ ids: [a.id, b.id, "nope"] }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { confirmed: 2, skipped: 1 });
    assert.equal(await statusOf(keep.id), "DRAFT");
    for (const bad of [JSON.stringify({ ids: [] }), JSON.stringify({ ids: "x" }), JSON.stringify({ all: true }), "{not json"]) {
      const x = await call(staff, "POST", "/api/invoices/confirm-drafts", bad);
      assert.equal(x.status, 400, bad);
      assert.equal(typeof x.json?.error, "string");
    }
    assert.equal(await statusOf(keep.id), "DRAFT");
  });
  await check("list: bad query is 400 {error} naming the field; filters work over HTTP", async () => {
    const bad = await call(staff, "GET", "/api/invoices?pageSize=1000");
    assert.equal(bad.status, 400);
    assert.match(String(bad.json?.error), /pageSize/);
    assert.equal((await call(staff, "GET", "/api/invoices?status=NOPE")).status, 400);
    const r = await call(staff, "GET", `/api/invoices?customerId=${customer.id}&status=CANCELLED&pageSize=100`);
    assert.equal(r.status, 200);
    const items = r.json!.items as { status: string }[];
    assert.ok(items.length >= 1 && items.every((i) => i.status === "CANCELLED"));
  });

  // ---------------- secrets ----------------
  await check("no response ever contains password hashes or reset tokens", async () => {
    for (const path of [`/api/invoices?customerId=${customer.id}`, `/api/invoices/${guard.id}`]) {
      for (const who of [staff, admin]) {
        const r = await call(who, "GET", path);
        assert.ok(!/passwordHash|resetToken|resetExpires|\$2[aby]\$/.test(r.text), `${path} leaked a secret field`);
      }
    }
  });

  await cleanup();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => db.$disconnect());
