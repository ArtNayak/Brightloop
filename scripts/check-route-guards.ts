// Static audit of the billing API: every route handler under src/app/api/billing and src/app/api/invoices must call
// requireRole(...) as the FIRST awaited thing, and only for ADMIN/STAFF. No database or server needed.
// Run: npm run check:route-guards. It is the safety net for "someone added a route and forgot the guard".
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/api/billing", "src/app/api/invoices"];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}

/** The handlers a route file exports, with their source text. */
export function handlers(src: string): { method: string; body: string }[] {
  const starts = [...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)].map((m) => ({ name: m[1], at: m.index! }));
  const exported = [...src.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g)].map((m) => m[1]);
  assert.deepEqual(exported.filter((n) => METHODS.includes(n)), [], "route handlers must be `export async function`, so this check can read them");
  return starts
    .map((s, i) => ({ method: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }))
    .filter((h) => METHODS.includes(h.method));
}

/** Throws a readable message if the handler isn't guarded properly. */
export function assertGuarded(file: string, h: { method: string; body: string }) {
  const where = `${file} ${h.method}`;
  const firstAwait = /await\s+([\w.]+)\s*\(/.exec(h.body);
  assert.ok(firstAwait, `${where}: no await found`);
  assert.equal(firstAwait![1], "requireRole", `${where}: the first await must be requireRole(...), found ${firstAwait![1]}(...)`);
  const args = /await\s+requireRole\(([^)]*)\)/.exec(h.body)![1];
  assert.ok(/^\s*"ADMIN"\s*,\s*"STAFF"\s*$|^\s*"STAFF"\s*,\s*"ADMIN"\s*$/.test(args), `${where}: requireRole must allow exactly ADMIN and STAFF, got (${args.trim()})`);
}

// Self-test of the checker: a handler without a guard, with a late guard, or open to customers must be rejected.
const good = `export async function GET() { try { await requireRole("ADMIN", "STAFF"); return await db.x(); } catch {} }`;
const unguarded = `export async function GET() { return NextResponse.json(await db.invoice.findMany()); }`;
const late = `export async function POST(req: Request) { const b = await req.json(); await requireRole("ADMIN", "STAFF"); }`;
const wide = `export async function GET() { await requireRole("ADMIN", "STAFF", "CUSTOMER"); }`;
assertGuarded("good", handlers(good)[0]);
for (const [name, src] of [["unguarded", unguarded], ["late", late], ["wide", wide]] as const) assert.throws(() => assertGuarded(name, handlers(src)[0]), Error, `self-test: "${name}" should be rejected`);

let count = 0;
let failed = 0;
for (const file of ROOTS.flatMap(routeFiles).sort()) {
  const found = handlers(readFileSync(file, "utf8"));
  if (found.length === 0) {
    failed++;
    console.log(`  FAIL ${file}: no handler found (is it written as \`export async function GET\`?)`);
  }
  for (const h of found) {
    count++;
    try {
      assertGuarded(file, h);
      console.log(`  ok   ${file} ${h.method}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${(e as Error).message}`);
    }
  }
}
assert.ok(count >= 8, `expected at least 8 handlers, found ${count}: did the folders move?`);
console.log(`\n${count - failed}/${count} handlers guarded (checker self-test passed)`);
if (failed) process.exit(1);
