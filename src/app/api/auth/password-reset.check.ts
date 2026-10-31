// run: npm run test:auth   (needs the database from .env; creates a throwaway user and deletes it at the end)
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { POST as forgot } from "./forgot-password/route";
import { POST as reset } from "./reset-password/route";

const email = `reset-check-${Date.now()}@brightloop.test`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const call = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));
const fetchUser = () => db.user.findUniqueOrThrow({ where: { email } });

// give the throwaway user a known token, as if the email link had been sent
const plant = (token: string, expiresInMs: number) =>
  db.user.update({ where: { email }, data: { resetToken: sha(token), resetExpires: new Date(Date.now() + expiresInMs) } });

async function main() {
  await db.user.create({ data: { email, name: "Reset Check", passwordHash: await bcrypt.hash("OldPassw0rd!", 10) } });

  // --- forgot-password: nobody can tell which emails have accounts, and no secrets leak out
  const known = await call(forgot, { email });
  const unknown = await call(forgot, { email: "nobody-here@brightloop.test" });
  const [knownBody, unknownBody] = [await known.text(), await unknown.text()];
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(knownBody, unknownBody, "response must be identical for known and unknown emails");
  const u = await fetchUser();
  assert.match(u.resetToken ?? "", /^[0-9a-f]{64}$/, "a sha256 hash is stored");
  assert.ok(!knownBody.includes(u.resetToken!) && !knownBody.includes(u.passwordHash), "no token or hash in the response");
  const ttl = u.resetExpires!.getTime() - Date.now();
  assert.ok(ttl > 59 * 60_000 && ttl <= 60 * 60_000, "link lasts one hour");

  // --- reset-password
  await plant("good-token", 60_000);
  const weak = await call(reset, { token: "good-token", password: "weak" });
  assert.equal(weak.status, 400);
  assert.ok((await fetchUser()).resetToken, "a rejected weak password must not burn the link");

  const wrong = await call(reset, { token: "not-the-token", password: "NewPassw0rd!" });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, "Link invalid or expired");

  const ok = await call(reset, { token: "good-token", password: "NewPassw0rd!" });
  assert.equal(ok.status, 200);
  const after = await fetchUser();
  assert.ok(await bcrypt.compare("NewPassw0rd!", after.passwordHash), "new password works");
  assert.ok(!(await bcrypt.compare("OldPassw0rd!", after.passwordHash)), "old password stops working");
  assert.equal(after.resetToken, null);
  assert.equal(after.resetExpires, null);

  const again = await call(reset, { token: "good-token", password: "Another1Pass!" });
  assert.equal(again.status, 400, "the link works only once");

  await plant("old-token", -1000);
  const expired = await call(reset, { token: "old-token", password: "NewPassw0rd!" });
  assert.equal(expired.status, 400, "expired link is rejected");

  console.log("password reset ok");
}

main()
  .finally(async () => {
    await db.user.deleteMany({ where: { email } }); // leave no test data behind
    await db.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
