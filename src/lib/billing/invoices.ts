import { Prisma, type InvoiceStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { outstanding, overdueWhere } from "@/lib/finance";
import { sendMail } from "@/lib/mail";
import { invoiceEmail } from "./invoice-email";

// Invoice workflow (P4 T3). PAID is NOT set here: P1's payment transaction does it (D4).
// DRAFT -> CONFIRMED, DRAFT|CONFIRMED -> CANCELLED. Every transition is a guarded UPDATE, so two clicks at once
// can never both win.

export class InvoiceError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 502,
  ) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Throws the right error once a guarded update matched nothing: 404 if the invoice is gone, else 409. */
async function refuse(id: string, verb: string): Promise<never> {
  const inv = await db.invoice.findUnique({ where: { id }, select: { status: true } });
  if (!inv) throw new InvoiceError("Invoice not found", 404);
  throw new InvoiceError(`Cannot ${verb} a ${inv.status} invoice`, 409);
}

export async function confirmInvoice(id: string) {
  const { count } = await db.invoice.updateMany({ where: { id, status: "DRAFT" }, data: { status: "CONFIRMED" } });
  if (count === 0) await refuse(id, "confirm");
  return db.invoice.findUniqueOrThrow({ where: { id }, select: { id: true, number: true, status: true } });
}

/**
 * A cancelled invoice keeps its period locked (the unique(subscriptionId, periodStart) row stays), so that period
 * is never billed again. Refused once any payment exists. The row is locked while we check, the same lock P1's
 * payment transaction takes, so a payment and a cancel can't both go through.
 */
export async function cancelInvoice(id: string) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: InvoiceStatus }[]>`SELECT status FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new InvoiceError("Invoice not found", 404);
    const { status } = rows[0];
    if (status !== "DRAFT" && status !== "CONFIRMED") throw new InvoiceError(`Cannot cancel a ${status} invoice`, 409);
    if ((await tx.payment.count({ where: { invoiceId: id } })) > 0)
      throw new InvoiceError("Cannot cancel an invoice that has payments", 409);
    return tx.invoice.update({ where: { id }, data: { status: "CANCELLED" }, select: { id: true, number: true, status: true } });
  });
}

/**
 * Confirms every DRAFT invoice (or only `ids`) in a single UPDATE, so hundreds take milliseconds.
 * Invoices that aren't DRAFT are left alone. `only` narrows the set further (tests use it).
 */
export async function confirmDrafts(ids?: string[], only?: Prisma.InvoiceWhereInput) {
  const { count } = await db.invoice.updateMany({
    where: { AND: [{ status: "DRAFT" }, ids ? { id: { in: ids } } : {}, only ?? {}] },
    data: { status: "CONFIRMED" },
  });
  return { confirmed: count, skipped: ids ? ids.length - count : 0 };
}

// ---------- reading ----------

const money = (v: Prisma.Decimal) => v.toFixed(2);

function paymentState(inv: { status: InvoiceStatus; dueDate: Date; total: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] }, now: Date) {
  const paid = inv.payments.reduce((a, p) => a.plus(p.amount), new Prisma.Decimal(0));
  const today = startOfDay(now);
  // same rule as finance.overdueWhere: CONFIRMED and due before today
  const overdue = inv.status === "CONFIRMED" && inv.dueDate < today;
  return {
    paid: money(paid),
    outstanding: money(outstanding(inv)),
    overdue,
    daysOverdue: overdue ? Math.round((today.getTime() - startOfDay(inv.dueDate).getTime()) / DAY_MS) : 0,
  };
}

const STATUSES = ["DRAFT", "CONFIRMED", "PAID", "CANCELLED"] as const;

export const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  customerId: z.string().min(1).optional(),
  subscriptionId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.iso.date().optional(), // issue date, inclusive
  to: z.iso.date().optional(), // issue date, inclusive
  overdue: z.enum(["1", "true"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuery>;

export async function listInvoices(query: ListQuery, now = new Date()) {
  const { status, customerId, subscriptionId, q, from, to, overdue, page, pageSize } = query;
  const and: Prisma.InvoiceWhereInput[] = [];
  if (status) and.push({ status });
  if (customerId) and.push({ customerId });
  if (subscriptionId) and.push({ subscriptionId });
  if (q)
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { customer: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } },
      ],
    });
  if (from) and.push({ issueDate: { gte: new Date(`${from}T00:00:00.000Z`) } });
  if (to) and.push({ issueDate: { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS) } });
  if (overdue) and.push(overdueWhere(now));
  const where: Prisma.InvoiceWhereInput = { AND: and };

  // one page of rows + the total, no queries per row
  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        issueDate: true,
        dueDate: true,
        total: true,
        customer: { select: { id: true, name: true, email: true } },
        subscription: { select: { id: true, number: true } },
        payments: { select: { amount: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.invoice.count({ where }),
  ]);

  return {
    items: rows.map(({ payments, ...inv }) => ({
      ...inv,
      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),
      issueDate: inv.issueDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      total: money(inv.total),
      ...paymentState({ ...inv, payments }, now),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// Explicit selects everywhere: a password hash or reset token can never end up in a response.
const detailSelect = {
  id: true,
  number: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  issueDate: true,
  dueDate: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  customer: { select: { id: true, name: true, email: true } },
  subscription: { select: { id: true, number: true, paymentTerms: true } },
  lines: {
    select: { id: true, description: true, quantity: true, unitPrice: true, taxPercent: true, discountAmount: true, amount: true },
    orderBy: { id: "asc" },
  },
  payments: {
    select: { id: true, method: true, amount: true, paidAt: true, note: true, recordedBy: { select: { name: true } } },
    orderBy: { paidAt: "asc" },
  },
} satisfies Prisma.InvoiceSelect;

/** Plain, serialisable invoice (decimals as strings, dates as ISO) for the API, InvoiceView and the portal. */
export async function getInvoice(id: string, now = new Date()) {
  const inv = await db.invoice.findUnique({ where: { id }, select: detailSelect });
  if (!inv) throw new InvoiceError("Invoice not found", 404);
  return {
    ...inv,
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    subtotal: money(inv.subtotal),
    discountTotal: money(inv.discountTotal),
    taxTotal: money(inv.taxTotal),
    total: money(inv.total),
    lines: inv.lines.map((l) => ({
      ...l,
      unitPrice: money(l.unitPrice),
      taxPercent: money(l.taxPercent),
      discountAmount: money(l.discountAmount),
      amount: money(l.amount),
    })),
    payments: inv.payments.map((p) => ({ ...p, amount: money(p.amount), paidAt: p.paidAt.toISOString() })),
    ...paymentState(inv, now),
  };
}
export type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>;

// ---------- sending ----------

/**
 * Emails the invoice to its customer. Only CONFIRMED or PAID invoices can be sent. The link goes to the customer
 * portal (customers can't open the staff pages). `deps` lets tests pass a fake mailer.
 */
export async function sendInvoice(id: string, deps: { sendMail: typeof sendMail } = { sendMail }) {
  const inv = await getInvoice(id);
  if (inv.status !== "CONFIRMED" && inv.status !== "PAID") throw new InvoiceError(`Cannot send a ${inv.status} invoice`, 409);

  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const { subject, html } = invoiceEmail(
    {
      number: inv.number,
      customerName: inv.customer.name,
      periodStart: inv.periodStart.slice(0, 10),
      periodEnd: inv.periodEnd.slice(0, 10),
      issueDate: inv.issueDate.slice(0, 10),
      dueDate: inv.dueDate.slice(0, 10),
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      taxTotal: inv.taxTotal,
      total: inv.total,
      paid: inv.paid,
      outstanding: inv.outstanding,
      lines: inv.lines,
    },
    `${base}/portal/invoices/${inv.id}`,
  );

  try {
    await deps.sendMail({ to: inv.customer.email, subject, html });
  } catch (e) {
    console.error(`sending ${inv.number} failed`, e); // details stay in the server log, not in the response
    throw new InvoiceError("Could not send the email, please try again", 502);
  }
  return { sent: true, to: inv.customer.email };
}
