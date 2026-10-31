import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);

// How much of this invoice the customer still has to pay.
// Takes the invoice together with its payments, adds the payments up and subtracts from the total.
export function outstanding(invoice: { total: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] }) {
  const paid = invoice.payments.reduce((sum, p) => sum.plus(p.amount), ZERO);
  const left = invoice.total.minus(paid);
  // If somebody overpaid we still report 0 owed, never a negative amount.
  return left.isNegative() ? ZERO : left;
}

// The database filter for "overdue invoices". We never store an "overdue" status,
// it is worked out fresh every time from the due date, so it can't go stale.
// An invoice is overdue when it is CONFIRMED (sent, not yet paid) and its due date is before today.
// We don't need to check the amount owed: once an invoice is fully paid it becomes PAID,
// so anything still CONFIRMED has money outstanding.
export function overdueWhere(now = new Date()): Prisma.InvoiceWhereInput {
  return { status: "CONFIRMED", dueDate: { lt: startOfTodayUTC(now) } };
}

// "Today" starts at midnight UTC. Dates are stored in UTC, and an invoice due today is not late yet.
function startOfTodayUTC(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// How many days late an invoice is (0 if it is not late). Part of a day counts as a full day,
// so something due yesterday afternoon already shows as 1 day overdue, matching overdueWhere.
export function daysOverdue(dueDate: Date, now = new Date()) {
  const late = startOfTodayUTC(now).getTime() - dueDate.getTime();
  return late > 0 ? Math.ceil(late / 86_400_000) : 0;
}
