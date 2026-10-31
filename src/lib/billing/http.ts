import { NextResponse } from "next/server";
import type { z } from "zod";
import { InvoiceError } from "./invoices";

// Every error leaves the API as { error: "message" } (overview section 8).

/** For the catch block of a route handler: auth Responses and InvoiceErrors become JSON, anything else is rethrown. */
export async function handle(e: unknown): Promise<NextResponse> {
  if (e instanceof Response) return NextResponse.json({ error: (await e.text()) || "Request refused" }, { status: e.status });
  if (e instanceof InvoiceError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

export function badRequest(error: z.ZodError): NextResponse {
  const issue = error.issues[0];
  const where = issue.path.join(".");
  return NextResponse.json({ error: where ? `${where}: ${issue.message}` : issue.message }, { status: 400 });
}
