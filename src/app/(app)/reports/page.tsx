import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { daysOverdue, outstanding, overdueWhere } from "@/lib/finance";
import { amountOwed, monthlyRecurring, monthlyRevenue } from "@/lib/finance-totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RevenueChart from "./revenue-chart";

type Search = { from?: string; to?: string; plan?: string; q?: string };
const day = (d: Date) => d.toISOString().slice(0, 10);
// "2026-10-31" -> a Date, or undefined when empty / not a real date (a hand-edited URL must not crash the page)
const toDate = (s?: string) => {
  const d = s ? new Date(s) : undefined;
  return d && !isNaN(d.getTime()) ? d : undefined;
};

// One figure in the KPI strip: small label, big number, a line of context. Colour only when the number is bad news.
function Kpi({ title, value, sub, id, bad }: { title: string; value: React.ReactNode; sub?: React.ReactNode; id: string; bad?: boolean }) {
  return (
    <div className="bg-card px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${bad ? "text-destructive" : ""}`} data-card={id}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// Each block of the page eases in a little after the one above it (CSS only, no animation library).
const rise = (i: number, extra = "") => ({
  className: `animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards duration-500 ${extra}`,
  style: { animationDelay: `${i * 70}ms` },
});

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  // Date range for "revenue collected". Defaults to this month so far.
  const now = new Date();
  const from = toDate(sp.from) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = toDate(sp.to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toEnd = new Date(to.getTime() + 86_400_000 - 1); // "to" is a whole day
  const q = sp.q?.trim() ?? "";
  const planId = sp.plan || undefined;

  // The plan and customer filters apply to every number on the page, so build them once per kind of record.
  const customerWhere: Prisma.UserWhereInput | undefined = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
    : undefined;
  const subScope: Prisma.SubscriptionWhereInput = { ...(planId && { planId }), ...(customerWhere && { customer: customerWhere }) };
  const invScope: Prisma.InvoiceWhereInput = { ...(planId && { subscription: { planId } }), ...(customerWhere && { customer: customerWhere }) };
  const overdue: Prisma.InvoiceWhereInput = { ...overdueWhere(), ...invScope };

  // Every query is independent, so they all run at the same time. Cards use counts/sums, never loaded rows.
  const [plans, active, paused, mrr, byStatus, revenue, openInvoices, owed, overdueCount, overdueOwed, months, topOverdue, lastPayments] =
    await Promise.all([
      db.plan.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.subscription.count({ where: { ...subScope, status: "ACTIVE", paused: false } }),
      db.subscription.count({ where: { ...subScope, status: "ACTIVE", paused: true } }),
      monthlyRecurring({ planId, customerQ: q || undefined }),
      db.subscription.groupBy({ by: ["status"], where: subScope, _count: true }),
      db.payment.aggregate({ where: { paidAt: { gte: from, lte: toEnd }, invoice: invScope }, _sum: { amount: true } }),
      db.invoice.count({ where: { ...invScope, status: "CONFIRMED" } }),
      amountOwed({ ...invScope, status: "CONFIRMED" }),
      db.invoice.count({ where: overdue }),
      amountOwed(overdue),
      monthlyRevenue({ planId, customerQ: q || undefined }),
      db.invoice.findMany({ where: overdue, orderBy: { dueDate: "asc" }, take: 10, include: { customer: true, payments: true } }),
      db.payment.findMany({ where: { invoice: invScope }, orderBy: { paidAt: "desc" }, take: 10, include: { invoice: { include: { customer: true } } } }),
    ]);

  const money = (d: Prisma.Decimal | null) => (d ?? new Prisma.Decimal(0)).toFixed(2);

  const num = "text-right";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {/* Plain GET form: the filters live in the URL, so a filtered dashboard can be shared as a link. */}
        <form className="flex flex-wrap items-end gap-2" action="/reports">
          <label className="text-xs text-muted-foreground">From <Input type="date" name="from" defaultValue={day(from)} /></label>
          <label className="text-xs text-muted-foreground">To <Input type="date" name="to" defaultValue={day(to)} /></label>
          <select name="plan" defaultValue={planId ?? ""} className="h-8 rounded-lg border bg-card px-2 text-sm">
            <option value="">All plans</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Input name="q" defaultValue={q} placeholder="Search customer" className="w-44" />
          <Button type="submit" size="sm">Apply</Button>
          <Link href="/reports" className="text-sm text-muted-foreground underline">Reset</Link>
        </form>
      </div>

      {/* gap-px on a border-coloured grid draws the hairlines between figures, however the grid wraps */}
      <div {...rise(0)}>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-5 sm:[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
          <Kpi id="active" title="Active subscriptions" value={active} sub={`${paused} paused`} />
          <Kpi id="mrr" title="Monthly recurring revenue" value={money(mrr)} sub="active subscriptions, before tax" />
          <Kpi id="revenue" title="Revenue collected" value={money(revenue._sum.amount)} sub={`${day(from)} to ${day(to)}`} />
          <Kpi id="owed" title="Outstanding (still owed)" value={money(owed)} sub={`${openInvoices} open invoices`} />
          <Kpi id="overdue" title="Overdue" value={money(overdueOwed)} sub={`${overdueCount} invoices`} bad={overdueOwed.gt(0)} />
        </div>
      </div>

      <section {...rise(1, "space-y-2")}>
        <h2 className="text-sm font-medium">Revenue per month <span className="font-normal text-muted-foreground">last 12 months</span></h2>
        <div className="rounded-lg border bg-card p-4">
          <RevenueChart data={months.map((m) => ({ month: m.month, revenue: Number(m.revenue) }))} />
        </div>
      </section>

      <section {...rise(2, "space-y-2")}>
        <h2 className="text-sm font-medium">Subscriptions by status</h2>
        <div className="flex flex-wrap gap-2">
          {byStatus.map((s) => <Badge key={s.status} variant="secondary">{s.status}: {s._count}</Badge>)}
          {byStatus.length === 0 && <p className="text-sm text-muted-foreground">No subscriptions.</p>}
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <section {...rise(3, "min-w-0 space-y-2")}>
          <h2 className="text-sm font-medium">Most overdue invoices</h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Due date</TableHead>
                  <TableHead className={num}>Outstanding</TableHead><TableHead>Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topOverdue.map((i) => {
                  const late = daysOverdue(i.dueDate);
                  return (
                    <TableRow key={i.id}>
                      <TableCell><Link className="underline underline-offset-2" href={`/invoices/${i.id}`}>{i.number}</Link></TableCell>
                      <TableCell>{i.customer.name}</TableCell>
                      <TableCell>{day(i.dueDate)}</TableCell>
                      <TableCell className={num}>{outstanding(i).toFixed(2)}</TableCell>
                      <TableCell><Badge variant="destructive">{late} {late === 1 ? "day" : "days"}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {topOverdue.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing is overdue.</p>}
          </div>
        </section>

        <section {...rise(4, "min-w-0 space-y-2")}>
          <h2 className="text-sm font-medium">Latest payments</h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Method</TableHead>
                  <TableHead className={num}>Amount</TableHead><TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastPayments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><Link className="underline underline-offset-2" href={`/invoices/${p.invoiceId}`}>{p.invoice.number}</Link></TableCell>
                    <TableCell>{p.invoice.customer.name}</TableCell>
                    <TableCell>{p.method.replace("_", " ")}</TableCell>
                    <TableCell className={num}>{p.amount.toFixed(2)}</TableCell>
                    <TableCell>{day(p.paidAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {lastPayments.length === 0 && <p className="p-4 text-sm text-muted-foreground">No payments yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
