import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { passwordSchema } from "@/lib/validation";

const body = z.object({ token: z.string().min(1), password: passwordSchema });

// Step 2: the user came back from the email with the token and picked a new password.
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // e.g. "Needs an uppercase letter", the same rules as sign-up
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { token, password } = parsed.data;

  // We stored the hash of the token, so hash what we were given before looking it up.
  // Doing the lookup and the update as ONE query means a link can't be used twice,
  // even if two requests with the same token arrive at the same moment.
  const { count } = await db.user.updateMany({
    where: {
      resetToken: createHash("sha256").update(token).digest("hex"),
      resetExpires: { gt: new Date() }, // not expired yet
    },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      resetToken: null, // burn the link
      resetExpires: null,
    },
  });

  // Wrong, already used and expired tokens all get the same message on purpose.
  if (count === 0) {
    return NextResponse.json({ error: "Link invalid or expired" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
