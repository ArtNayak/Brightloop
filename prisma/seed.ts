import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedFinance } from "./seed-finance";
import { seedBilling } from "./seed-billing";

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

  if (await db.tax.count()) return; // rest is demo data, seed once
  const gst = await db.tax.create({ data: { name: "GST 18%", ratePercent: 18 } });
  const crm = await db.product.create({
    data: { name: "Brightloop CRM", type: "Software", salesPrice: 1000, costPrice: 400, taxId: gst.id },
  });
  await db.productVariant.create({
    data: { productId: crm.id, attribute: "Brand", value: "Odoo", extraPrice: 560 },
  });
  await db.plan.create({
    data: { name: "Monthly", price: 1000, period: "MONTHLY", startDate: new Date(), pausable: true },
  });
  await db.discount.create({
    data: {
      name: "10% off 10+ seats",
      type: "PERCENTAGE",
      value: 10,
      minQuantity: 10,
      startDate: new Date(),
      usageLimit: 100,
      scope: "PRODUCT",
      productId: crm.id,
    },
  });
}

main().finally(() => db.$disconnect());
