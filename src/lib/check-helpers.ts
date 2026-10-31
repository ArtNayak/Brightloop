// Shared by the HTTP-based checks (npm run test:staff, test:payments). They need `npm run dev` running.
export const base = process.env.BASE_URL ?? "http://localhost:3000";

// Signs in through NextAuth with email + password and returns the session cookie, or "" if the login was refused.
export async function login(who: string, password = "Passw0rd!") {
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const jar = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar },
    body: new URLSearchParams({ csrfToken, email: who, password, json: "true" }),
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return cookies.find((c) => c.includes("session-token")) ? [jar, ...cookies].join("; ") : "";
}
