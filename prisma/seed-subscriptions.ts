import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Seeds repeatable subscription fixtures used by billing, lifecycle, and portal demos. */
export async function seedSubscriptions(db: DbClient) {
  const customer = await db.user.findUniqueOrThrow({ where: { email: "customer@brightloop.test" } });
  const product = await db.product.findFirstOrThrow({ where: { active: true }, orderBy: { name: "asc" } });
  const basePlan = await db.plan.findFirstOrThrow({ orderBy: { name: "asc" } });
  const autoClosePlan =
    (await db.plan.findFirst({ where: { name: "Lifecycle Demo Monthly" } })) ??
    (await db.plan.create({
      data: {
        name: "Lifecycle Demo Monthly",
        price: basePlan.price,
        period: "MONTHLY",
        minQuantity: 1,
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        autoClose: true,
        closable: true,
        pausable: true,
        renewable: true,
      },
    }));

  const [customer2, customer3] = await Promise.all([
    db.user.upsert({
      where: { email: "customer2@brightloop.test" },
      update: {},
      create: {
        email: "customer2@brightloop.test",
        name: "Demo Customer 2",
        role: "CUSTOMER",
        passwordHash: await bcrypt.hash("Passw0rd!", 10),
      },
    }),
    db.user.upsert({
      where: { email: "customer3@brightloop.test" },
      update: {},
      create: {
        email: "customer3@brightloop.test",
        name: "Demo Customer 3",
        role: "CUSTOMER",
        passwordHash: await bcrypt.hash("Passw0rd!", 10),
      },
    }),
  ]);

  const now = new Date();
  const date = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const fixtures = [
    { number: "SUB-0001", status: "ACTIVE" as const, customerId: customer.id, start: -60, next: -1, terms: "NET_15" },
    { number: "SUB-0002", status: "ACTIVE" as const, customerId: customer2.id, start: -60, next: -1, terms: "NET_30" },
    { number: "SUB-0003", status: "ACTIVE" as const, customerId: customer.id, start: -60, next: -1, terms: "IMMEDIATE" },
    { number: "SUB-0004", status: "ACTIVE" as const, customerId: customer.id, start: -30, next: -1, terms: "NET_15", paused: true },
    { number: "SUB-0005", status: "QUOTATION" as const, customerId: customer.id, start: 0, next: 30, terms: "NET_30", quoteDays: 30 },
    { number: "SUB-0006", status: "DRAFT" as const, customerId: customer.id, start: 0, next: 30, terms: "NET_30" },
    { number: "SUB-0007", status: "CONFIRMED" as const, customerId: customer3.id, start: 0, next: 0, terms: "NET_30" },
    { number: "SUB-0008", status: "CLOSED" as const, customerId: customer.id, start: -90, next: -60, terms: "NET_30" },
    { number: "SUB-0009", status: "ACTIVE" as const, customerId: customer.id, start: -90, next: -60, terms: "NET_30", expiry: -1 },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const quantity = (index % 3) + 1;
    const unitPrice = product.salesPrice;
    const planId = fixture.number === "SUB-0009" ? autoClosePlan.id : basePlan.id;
    const line = {
      productId: product.id,
      quantity,
      unitPrice,
      taxId: product.taxId,
      amount: unitPrice.mul(quantity),
    };
    const subscriptionData = {
      customerId: fixture.customerId,
      planId,
      status: fixture.status,
      paused: "paused" in fixture ? fixture.paused : false,
      startDate: date(fixture.start),
      expiryDate: "expiry" in fixture ? date(fixture.expiry ?? -1) : date(365),
      paymentTerms: fixture.terms,
      quoteValidUntil: "quoteDays" in fixture ? date(fixture.quoteDays ?? 30) : null,
      nextBillingDate: date(fixture.next),
    };

    await db.subscription.upsert({
      where: { number: fixture.number },
      update: {
        ...subscriptionData,
        lines: { deleteMany: {}, create: line },
      },
      create: {
        number: fixture.number,
        ...subscriptionData,
        lines: { create: line },
      },
    });
  }
}
