import { getServerSession } from "next-auth";
import type { Role } from "@prisma/client";
import { authOptions } from "./auth";

/**
 * Guard for server components and route handlers. Throws a Response (401/403).
 * Route handlers: wrap in try/catch and `if (e instanceof Response) return e;`
 * Example: const s = await requireRole("ADMIN", "STAFF");
 */
export async function requireRole(...roles: Role[]) {
  const s = await getServerSession(authOptions);
  if (!s) throw new Response("Unauthorized", { status: 401 });
  if (!roles.includes(s.user.role)) throw new Response("Forbidden", { status: 403 });
  return s;
}
