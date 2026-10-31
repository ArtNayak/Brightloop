import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { emailSchema, passwordSchema } from "@/lib/validation";

// Note there is no `role` field here on purpose: whatever the client sends, a new account is always STAFF.
const body = z.object({ name: z.string().trim().min(1, "Name is required"), email: emailSchema, password: passwordSchema });

// Admin creates a staff account and hands over the temporary password in person.
export async function POST(req: Request) {
  try {
    await requireRole("ADMIN"); // staff and customers get 403, signed-out callers get 401
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { name, email, password } = parsed.data;
    if (await db.user.findUnique({ where: { email } })) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    await db.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: "STAFF" },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
