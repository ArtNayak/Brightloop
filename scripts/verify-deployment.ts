import { PrismaClient } from "@prisma/client";
import { validateDeploymentConfig, databaseReadiness } from "../src/lib/deployment";

const parsed = validateDeploymentConfig(process.env);
if (!parsed.success) {
  console.error("Deployment environment is incomplete or invalid:");
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join(".") || "environment"}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  const db = new PrismaClient();
  try {
    const readiness = await databaseReadiness(() => db.$queryRaw`SELECT 1`);
    if (readiness.statusCode !== 200) {
      console.error("Database is unavailable. Check the configured PostgreSQL URL and database status.");
      process.exitCode = 1;
    } else {
      const [admins, taxes, products, plans, discounts] = await Promise.all([
        db.user.count({ where: { role: "ADMIN" } }),
        db.tax.count(),
        db.product.count(),
        db.plan.count(),
        db.discount.count(),
      ]);
      if (admins < 1 || taxes < 1 || products < 1 || plans < 1 || discounts < 1) {
        console.error("Database schema is reachable, but required demo seed data is missing.");
        console.error(`Counts - admins: ${admins}, taxes: ${taxes}, products: ${products}, plans: ${plans}, discounts: ${discounts}`);
        process.exitCode = 1;
      } else {
        console.log("Deployment configuration, PostgreSQL schema and catalog seed data are ready.");
        console.log(`Counts - admins: ${admins}, taxes: ${taxes}, products: ${products}, plans: ${plans}, discounts: ${discounts}`);
        console.log("Health endpoint: GET /api/health");
      }
    }
  } catch {
    console.error("Database verification failed. Check that the schema has been applied and the database is reachable.");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
