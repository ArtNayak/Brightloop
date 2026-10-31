import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { emailSchema } from "@/lib/validation";

const body = z.object({ email: emailSchema });

// The name comes from the public sign-up form, so someone could register as "<script>..." or "<a href=...>".
// Escape it before putting it in the email's HTML so it shows up as plain text.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Step 1 of "I forgot my password": the user gives us their email and we mail them a reset link.
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  const { email } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    // The random token goes in the email. The database only gets its sha256 hash,
    // so even someone who reads the database can't use the stored value to reset anybody's password.
    const token = randomBytes(32).toString("hex");
    await db.user.update({
      where: { id: user.id },
      data: {
        resetToken: createHash("sha256").update(token).digest("hex"),
        resetExpires: new Date(Date.now() + 60 * 60 * 1000), // link works for 1 hour
      },
    });

    try {
      const link = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "Reset your Brightloop password",
        html: `<p>Hi ${esc(user.name)},</p>
<p>Click the link below to choose a new password. It works once and expires in 1 hour.</p>
<p><a href="${esc(link)}">${esc(link)}</a></p>
<p>If you didn't ask for this, you can ignore this email.</p>`,
      });
    } catch (e) {
      // If the mail server is down we only log it. Returning an error here would tell the
      // caller that this email has an account, which is exactly what we want to hide.
      console.error("forgot-password: could not send mail", e);
    }
  }

  // Same answer whether or not the email exists, so nobody can use this form to find out who has an account.
  return NextResponse.json({ ok: true, message: "If that email has an account, a reset link is on its way." });
}
