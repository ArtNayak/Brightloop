import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { outstanding } from "@/lib/finance";

const body = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "UPI", "CHEQUE"], "Pick a payment method"),
  // Money arrives as text or number, but must look like a positive amount with at most 2 decimals.
  amount: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 400 or 400.50")),
  paidAt: z.coerce.date("Enter a valid payment date"),
  note: z.string().trim().max(500).optional(),
});

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

// Staff record money received against a sent (CONFIRMED) invoice. Partial payments are fine;
// the payment that clears the balance flips the invoice to PAID.
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN", "STAFF");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(parsed.error.issues[0].message, 400);
    const { invoiceId, method, paidAt, note } = parsed.data;
    const amount = new Prisma.Decimal(parsed.data.amount);

    if (!amount.gt(0)) return fail("Amount must be more than zero", 400);
    if (paidAt.getTime() > Date.now()) return fail("Payment date cannot be in the future", 400);

    // Everything below happens in one transaction. We lock the invoice row first, so two people
    // paying the same invoice at the same moment queue up instead of both seeing the old balance
    // and overpaying it.
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
      if (!invoice) return fail("Invoice not found", 404);
      if (invoice.status !== "CONFIRMED") return fail(`Invoice is ${invoice.status}, payments can only be recorded on a confirmed invoice`, 409);

      const owed = outstanding(invoice);
      if (amount.gt(owed)) return fail("Amount exceeds what is owed", 400);

      await tx.payment.create({
        data: { invoiceId, method, amount, paidAt, note: note || null, recordedById: session.user.id },
      });
      // Paid in full? Then the invoice is closed (decision D4).
      const left = owed.minus(amount);
      if (left.isZero()) await tx.invoice.update({ where: { id: invoiceId }, data: { status: "PAID" } });
      return NextResponse.json(
        { ok: true, status: left.isZero() ? "PAID" : "CONFIRMED", outstanding: left.toFixed(2) },
        { status: 201 },
      );
    });
    // Either a refusal from the checks above (nothing was written) or the success response.
    return result;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
