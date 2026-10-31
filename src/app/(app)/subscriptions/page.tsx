import Link from "next/link";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptionListWhere, billingPeriodLabel } from "@/lib/subscriptions";
import type { SubscriptionStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import RunLifecycleButton from "@/components/run-lifecycle-button";

type Search = { q?: string; status?: string; planId?: string; customer?: string; page?: string };
const statuses: SubscriptionStatus[] = ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "CLOSED"];
const currency = (amount: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(amount));
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(value) : "—";

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const filter = await searchParams;
  const q = filter.q?.trim() ?? ""; const customer = filter.customer?.trim() ?? ""; const planId = filter.planId ?? "";
  const status = statuses.includes(filter.status as SubscriptionStatus) ? filter.status as SubscriptionStatus : undefined;
  const page = Math.max(1, Number.parseInt(filter.page ?? "1", 10) || 1); const pageSize = 25;
  const where = subscriptionListWhere({ q: q || undefined, customer: customer || undefined, planId: planId || undefined, status });
  const [rows, total, counts, plans] = await Promise.all([
    db.subscription.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { customer: { select: { name: true } }, plan: { select: { name: true, period: true } }, lines: { select: { amount: true } } } }),
    db.subscription.count({ where }),
    db.subscription.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.plan.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const countsByStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (nextPage: number, nextStatus = status) => { const params = new URLSearchParams(); if (q) params.set("q", q); if (customer) params.set("customer", customer); if (planId) params.set("planId", planId); if (nextStatus) params.set("status", nextStatus); if (nextPage > 1) params.set("page", String(nextPage)); return `/subscriptions${params.size ? `?${params}` : ""}`; };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Subscriptions</h1><p className="text-sm text-muted-foreground">Manage subscription lifecycle and customer agreements.</p></div><div className="flex gap-2">{session.user.role === "ADMIN" && <RunLifecycleButton />}<Button render={<Link href="/subscriptions/new" />}>New subscription</Button></div></div>
    <div className="flex flex-wrap gap-2">{[[undefined, "All", Object.values(countsByStatus).reduce((sum: number, value: unknown) => sum + Number(value), 0)] as const, ...statuses.map((item) => [item, item, countsByStatus[item] ?? 0] as const)].map(([value, label, count]) => <Button key={label} size="sm" variant={value === status ? "default" : "outline"} render={<Link href={href(1, value)} />}>{label} ({count})</Button>)}</div>
    <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_14rem_auto] sm:items-end" action="/subscriptions"><label className="space-y-1 text-sm">Search number or customer<Input name="q" defaultValue={q} placeholder="SUB-0001 or name" /></label><label className="space-y-1 text-sm">Customer name or email<Input name="customer" defaultValue={customer} placeholder="Search customer" /></label><label className="space-y-1 text-sm">Plan<select name="planId" defaultValue={planId} className="h-9 w-full rounded-md border bg-background px-2"><option value="">All plans</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>{status && <input type="hidden" name="status" value={status} />}<Button type="submit">Filter</Button></form>
    <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Customer</TableHead><TableHead>Plan</TableHead><TableHead>Status</TableHead><TableHead>Start</TableHead><TableHead>Expiry</TableHead><TableHead>Next billing</TableHead><TableHead>Total / period</TableHead></TableRow></TableHeader><TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No subscriptions match these filters.</TableCell></TableRow> : rows.map((row) => { const totalAmount = row.lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)).toFixed(2); return <TableRow key={row.id}><TableCell><Link className="font-medium hover:underline" href={`/subscriptions/${row.id}`}>{row.number}</Link></TableCell><TableCell>{row.customer.name}</TableCell><TableCell>{row.plan.name}</TableCell><TableCell><SubscriptionStatusBadge status={row.status} paused={row.paused} /></TableCell><TableCell>{date(row.startDate)}</TableCell><TableCell>{date(row.expiryDate)}</TableCell><TableCell>{date(row.nextBillingDate)}</TableCell><TableCell>{currency(totalAmount)} / {billingPeriodLabel(row.plan.period)}</TableCell></TableRow>; })}</TableBody></Table></div>
    <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{total} subscription{total === 1 ? "" : "s"} · Page {page} of {pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={href(Math.max(1, page - 1))} />}>Previous</Button><Button variant="outline" size="sm" disabled={page >= pages} render={<Link href={href(Math.min(pages, page + 1))} />}>Next</Button></div></div>
  </div>;
}
