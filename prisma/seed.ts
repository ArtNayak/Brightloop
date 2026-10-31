import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedFinance } from "./seed-finance";
import { seedBilling } from "./seed-billing";
import { seedSubscriptions } from "./seed-subscriptions";
import { seedCatalog } from "./seed-catalog";

const db = new PrismaClient();

async function user(email: string, name: string, role: "ADMIN" | "STAFF" | "CUSTOMER") {
  return db.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash: await bcrypt.hash("Passw0rd!", 10) },
  });
}

async function main() {
  await user("admin@brightloop.test", "Admin", "ADMIN");
  await user("staff@brightloop.test", "Staff", "STAFF");
  await user("customer@brightloop.test", "Demo Customer", "CUSTOMER");
  await seedFinance(db); // demo invoices + payments (needs the users above)
  await seedBilling(db); // TEMP: subscriptions due for billing (SUB-T4-*)
  await seedCatalog(db);
  await seedSubscriptions(db); // depends on an active catalog product and plan
}

main().finally(() => db.$disconnect());
