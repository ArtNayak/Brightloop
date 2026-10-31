// HTTP role check for the lifecycle job. Run with the app and seeded local database running.
import assert from "node:assert/strict";

const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

async function login(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const take = (res: Response) => {
    for (const cookie of res.headers.getSetCookie()) {
      const value = cookie.split(";")[0];
      const i = value.indexOf("=");
      jar.set(value.slice(0, i), value.slice(i + 1));
    }
  };
  const cookieHeader = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");

  const csrf = await fetch(`${base}/api/auth/csrf`);
  take(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password: "Passw0rd!", json: "true" }),
  });
  take(response);
  if (![...jar.keys()].some((key) => key.includes("session-token"))) {
    throw new Error(`Login failed for ${email}; ensure the local database is seeded.`);
  }
  return cookieHeader();
}

async function call(cookie?: string) {
  const response = await fetch(`${base}/api/jobs/lifecycle`, {
    method: "POST",
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, text, json };
}

async function main() {
  const anonymous = await call();
  assert.ok([307, 401].includes(anonymous.status), `anonymous request returned ${anonymous.status}`);
  assert.ok(!anonymous.text.includes("activated") && !anonymous.text.includes("closed"), "anonymous response leaked lifecycle results");

  for (const roleEmail of ["staff@brightloop.test", "customer@brightloop.test"]) {
    const response = await call(await login(roleEmail));
    assert.equal(response.status, 403, `${roleEmail} must not run lifecycle`);
    assert.equal(typeof response.json?.error, "string", "forbidden response must use { error }");
    assert.ok(!response.text.includes("activated") && !response.text.includes("closed"), "forbidden response leaked lifecycle results");
  }

  console.log("lifecycle HTTP access checks ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
