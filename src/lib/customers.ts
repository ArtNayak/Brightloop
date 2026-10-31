import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailSchema, passwordSchema } from "@/lib/validation";

export const customerInput = z.object({ name: z.string().trim().min(1, "Name is required").max(120), email: emailSchema, password: passwordSchema });
export type CustomerInput = z.infer<typeof customerInput>;

export class CustomerError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); this.name = "CustomerError"; }
}

export async function createCustomer(input: CustomerInput, dbClient: PrismaClient = db) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  try {
    return await dbClient.user.create({ data: { name: input.name, email: input.email, passwordHash, role: "CUSTOMER" }, select: { id: true, name: true, email: true, role: true, createdAt: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CustomerError("Email already registered", 409);
    throw error;
  }
}

export function customerSearchWhere(q: string): Prisma.UserWhereInput {
  const search = q.trim();
  return { role: "CUSTOMER", ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : {}) };
}
