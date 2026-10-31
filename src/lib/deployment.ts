import { z } from "zod";

const postgresUrl = z.string().url().refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), "Must use a PostgreSQL connection URL");
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "Production URL must use HTTPS");
const port = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.coerce.number().int().min(1).max(65535));

export const deploymentConfigSchema = z.object({
  DATABASE_URL: postgresUrl,
  NEXTAUTH_URL: httpsUrl,
  NEXTAUTH_SECRET: z.string().min(32, "Must be at least 32 characters"),
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: port,
  SMTP_USER: z.string().trim().min(1),
  SMTP_PASS: z.string().min(1),
  MAIL_FROM: z.string().trim().min(1),
});

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;

export function validateDeploymentConfig(env: Record<string, string | undefined>) {
  return deploymentConfigSchema.safeParse(env);
}

export type DatabaseReadiness =
  | { statusCode: 200; body: { status: "ok"; database: "ok" } }
  | { statusCode: 503; body: { status: "unavailable"; database: "unavailable" } };

export async function databaseReadiness(probe: () => Promise<unknown>): Promise<DatabaseReadiness> {
  try {
    await probe();
    return { statusCode: 200, body: { status: "ok", database: "ok" } };
  } catch {
    return { statusCode: 503, body: { status: "unavailable", database: "unavailable" } };
  }
}
