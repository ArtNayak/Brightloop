// Deployment readiness regression checks. Run: npm run check:deployment
import assert from "node:assert/strict";
import { databaseReadiness, validateDeploymentConfig } from "../src/lib/deployment";

const validEnv = () => ({
  DATABASE_URL: "postgresql://app:secret@db.example.com/brightloop?sslmode=require",
  NEXTAUTH_URL: "https://brightloop.example.com",
  NEXTAUTH_SECRET: "a-secure-production-secret-with-at-least-32-characters",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "brightloop",
  SMTP_PASS: "smtp-secret",
  MAIL_FROM: "Brightloop <noreply@example.com>",
});
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push([name, run]);

test("deployment config accepts a complete production setup", () => {
  const result = validateDeploymentConfig(validEnv());
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.SMTP_PORT, 587);
    assert.equal(result.data.NEXTAUTH_URL, "https://brightloop.example.com");
  }
});

test("deployment config rejects missing secrets, insecure URLs and non-Postgres databases", () => {
  const result = validateDeploymentConfig({ ...validEnv(), DATABASE_URL: "mysql://db.example.com/app", NEXTAUTH_URL: "http://brightloop.example.com", NEXTAUTH_SECRET: "short", SMTP_PASS: "" });
  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    assert.ok(paths.includes("DATABASE_URL"));
    assert.ok(paths.includes("NEXTAUTH_URL"));
    assert.ok(paths.includes("NEXTAUTH_SECRET"));
    assert.ok(paths.includes("SMTP_PASS"));
    assert.equal(JSON.stringify(result.error.issues).includes("short"), false);
  }
});

test("database readiness reports success when the probe succeeds", async () => {
  const result = await databaseReadiness(async () => 1);
  assert.deepEqual(result, { statusCode: 200, body: { status: "ok", database: "ok" } });
});

test("database readiness returns a generic failure without leaking driver errors", async () => {
  const result = await databaseReadiness(async () => { throw new Error("postgres://private-password@host"); });
  assert.deepEqual(result, { statusCode: 503, body: { status: "unavailable", database: "unavailable" } });
  assert.equal(JSON.stringify(result).includes("private-password"), false);
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
