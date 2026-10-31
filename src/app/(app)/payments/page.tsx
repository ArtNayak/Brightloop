import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { daysOverdue, outstanding, overdueWhere } from "@/lib/finance";
import { amountOwed } from "@/lib/finance-totals";
import { RecordPaymentDialog } from "@/components/record-payment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 25;
const METHODS = ["CASH", "CARD", "BANK_TRANSFER", "UPI", "CHEQUE"] as const;
const TABS = [
  { key: "all", label: "All payments" },
  { key: "outstanding", label: "Invoices outstanding" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Search = { tab?: string; page?: string; q?: string; method?: string; from?: string; to?: string };
const day = (d: Date) => d.toISOString().slice(0, 10);
// "2026-10-31" -> a Date, or undefined when it is empty or not a real date (a hand-edited URL must not crash the page)
const toDate = (s?: string) => {
  const d = s ? new Date(s) : undefined;
  return d && !isNaN(d.getTime()) ? d : undefined;
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === sp.tab)?.key ?? "all";
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const q = sp.q?.trim() ?? "";
  const method = METHODS.find((m) => m === sp.method);
  const from = toDate(sp.from);
  const to = toDate(sp.to);
  const paging = { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };

  // Customer search: matches the customer's name or email, in any letter case.
  const customerWhere: Prisma.UserWhereInput | undefined = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
    : undefined;

  // Link that keeps the current filters but changes some of them (used by pagination).
  const href = (changes: Partial<Search>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...changes })) if (v) params.set(k, v);
    return `/payments?${params}`;
  };

  let content: React.ReactNode;
  let total = 0;
  let overdueTotal: Prisma.Decimal | undefined;

  if (tab === "all") {
    const where: Prisma.PaymentWhereInput = {
      ...(method && { method }),
      // "to" is a whole day, so include everything up to the last millisecond of that day
      ...((from || to) && { paidAt: { ...(from && { gte: from }), ...(to && { lte: new Date(to.getTime() + 86_400_000 - 1) }) } }),
      ...(customerWhere && { invoice: { customer: customerWhere } }),
    };
    const [rows, count] = await Promise.all([
      db.payment.findMany({
        where, orderBy: { paidAt: "desc" }, ...paging,
        include: { invoice: { include: { customer: true } }, recordedBy: true },
      }),
      db.payment.count({ where }),
    ]);
    total = count;
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            {["Invoice", "Customer", "Method", "Amount", "Date", "Note", "Recorded by"].map((h) => <TableHead key={h} className={h === "Amount" ? "text-right" : ""}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell><Link className="underline underline-offset-2" href={`/invoices/${p.invoiceId}`}>{p.invoice.number}</Link></TableCell>
              <TableCell>{p.invoice.customer.name}</TableCell>
              <TableCell>{p.method.replace("_", " ")}</TableCell>
              <TableCell className="text-right">{p.amount.toFixed(2)}</TableCell>
              <TableCell>{day(p.paidAt)}</TableCell>
              <TableCell>{p.note}</TableCell>
              <TableCell>{p.recordedBy.name}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else {
    // The three invoice tabs differ only in which invoices they pick and how they are sorted.
    const where: Prisma.InvoiceWhereInput = {
      ...(tab === "paid" ? { status: "PAID" } : tab === "overdue" ? overdueWhere() : { status: "CONFIRMED" }),
      ...(customerWhere && { customer: customerWhere }),
    };
    const [rows, count] = await Promise.all([
      db.invoice.findMany({
        where, ...paging, include: { customer: true, payments: true },
        // overdue: most overdue (oldest due date) first; paid: newest first; outstanding: soonest due first
        orderBy: { dueDate: tab === "paid" ? "desc" : "asc" },
      }),
      db.invoice.count({ where }),
    ]);
    total = count;

    if (tab === "overdue") {
      // Total still owed across ALL overdue invoices (not only this page).
      overdueTotal = await amountOwed(where);
    }

    content = (
      <Table>
        <TableHeader>
          <TableRow>
            {["Invoice", "Customer", "Due date", "Total", "Paid", "Outstanding", "Overdue", ""].map((h, i) => <TableHead key={i} className={i >= 3 && i <= 5 ? "text-right" : ""}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((inv) => {
            const owed = outstanding(inv);
            const late = inv.status === "CONFIRMED" ? daysOverdue(inv.dueDate) : 0;
            return (
              <TableRow key={inv.id}>
                <TableCell><Link className="underline underline-offset-2" href={`/invoices/${inv.id}`}>{inv.number}</Link></TableCell>
                <TableCell>{inv.customer.name}</TableCell>
                <TableCell>{day(inv.dueDate)}</TableCell>
                <TableCell className="text-right">{inv.total.toFixed(2)}</TableCell>
                <TableCell className="text-right">{inv.total.minus(owed).toFixed(2)}</TableCell>
                <TableCell className="text-right">{owed.toFixed(2)}</TableCell>
                <TableCell>{late > 0 && <Badge variant="destructive">{late} {late === 1 ? "day" : "days"} overdue</Badge>}</TableCell>
                <TableCell>{inv.status === "CONFIRMED" && <RecordPaymentDialog invoiceId={inv.id} outstanding={owed.toFixed(2)} />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payments</h1>

      <nav className="flex gap-5 border-b">
        {TABS.map((t) => (
          <Link key={t.key} href={`/payments?tab=${t.key}`}
            className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${t.key === tab ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {overdueTotal && <p className="text-sm text-muted-foreground">Total overdue: <strong className="text-lg font-semibold tabular-nums text-destructive">{overdueTotal.toFixed(2)}</strong></p>}

      {/* Plain GET form: submitting just reloads this page with the filters in the URL. */}
      <form className="flex flex-wrap items-end gap-2" action="/payments">
        <input type="hidden" name="tab" value={tab} />
        <Input name="q" defaultValue={q} placeholder="Search customer" className="w-48" />
        {tab === "all" && (
          <>
            <select name="method" defaultValue={method ?? ""} className="h-8 rounded-lg border bg-card px-2 text-sm">
              <option value="">All methods</option>
              {METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
            </select>
            <label className="text-xs text-muted-foreground">From <Input type="date" name="from" defaultValue={sp.from} /></label>
            <label className="text-xs text-muted-foreground">To <Input type="date" name="to" defaultValue={sp.to} /></label>
          </>
        )}
        <Button type="submit" size="sm">Filter</Button>
        <Link href={`/payments?tab=${tab}`} className="text-sm text-muted-foreground underline">Clear</Link>
      </form>

      {total === 0 ? <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Nothing to show.</p> : <div className="rounded-lg border bg-card">{content}</div>}

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {page > 1 && <Link className="underline underline-offset-2" href={href({ page: String(page - 1) })}>Previous</Link>}
        <span>Page {page} of {pages} ({total} total)</span>
        {page < pages && <Link className="underline underline-offset-2" href={href({ page: String(page + 1) })}>Next</Link>}
      </div>
    </div>
  );
}
