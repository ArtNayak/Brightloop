import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { databaseReadiness } from "@/lib/deployment";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await databaseReadiness(() => db.$queryRaw`SELECT 1`);
  return NextResponse.json(readiness.body, {
    status: readiness.statusCode,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
