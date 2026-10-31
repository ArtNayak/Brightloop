import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailSchema, passwordSchema } from "@/lib/validation";

const body = z.object({ name: z.string().trim().min(1), email: emailSchema, password: passwordSchema });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { name, email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }
  await db.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: "CUSTOMER" },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
