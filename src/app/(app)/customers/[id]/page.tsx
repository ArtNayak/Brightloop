import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { outstanding } from "@/lib/finance";
import { formatDate, formatMoney } from "@/lib/billing/invoice-ui";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { id } = await params;
  const customer = await db.user.findFirst({ where: { id, role: "CUSTOMER" }, select: { id: true, name: true, email: true, createdAt: true, subscriptions: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, paused: true, startDate: true, expiryDate: true, nextBillingDate: true, plan: { select: { name: true, period: true } }, lines: { select: { amount: true } } } }, invoices: { orderBy: { issueDate: "desc" }, select: { id: true, number: true, status: true, issueDate: true, dueDate: true, total: true, payments: { select: { amount: true } } } } } });
  if (!customer) notFound();
  const openInvoices = customer.invoices.filter((invoice) => invoice.status === "CONFIRMED");
  const openTotal = openInvoices.reduce((sum, invoice) => sum.plus(outstanding(invoice)), new Prisma.Decimal(0));
  const currency = (amount: string) => formatMoney(amount);
  const date = (value: Date | null) => value ? formatDate(value.toISOString()) : "—";
  return <div className="space-y-7"><div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-2"><Link href="/customers" className="text-sm text-muted-foreground hover:underline">Customers</Link><h1 className="text-2xl font-semibold">{customer.name}</h1><p className="text-muted-foreground">{customer.email}</p><p className="text-xs text-muted-foreground">Customer since {date(customer.createdAt)}</p></div><Button variant="outline" render={<Link href="/customers" />}>Back to customers</Button></div>
    <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3"><div><p className="text-sm text-muted-foreground">Subscriptions</p><p className="text-xl font-semibold">{customer.subscriptions.length}</p></div><div><p className="text-sm text-muted-foreground">Open invoices</p><p className="text-xl font-semibold">{openInvoices.length}</p></div><div><p className="text-sm text-muted-foreground">Outstanding balance</p><p className="text-xl font-semibold">{currency(openTotal.toFixed(2))}</p></div></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Subscriptions</h2><div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Plan</TableHead><TableHead>Status</TableHead><TableHead>Start</TableHead><TableHead>Expiry</TableHead><TableHead>Next billing</TableHead><TableHead>Total / period</TableHead></TableRow></TableHeader><TableBody>{customer.subscriptions.length ? customer.subscriptions.map((sub) => { const total = sub.lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)); return <TableRow key={sub.id}><TableCell><Link className="font-medium hover:underline" href={`/subscriptions/${sub.id}`}>{sub.number}</Link></TableCell><TableCell>{sub.plan.name}</TableCell><TableCell><SubscriptionStatusBadge status={sub.status} paused={sub.paused} /></TableCell><TableCell>{date(sub.startDate)}</TableCell><TableCell>{date(sub.expiryDate)}</TableCell><TableCell>{date(sub.nextBillingDate)}</TableCell><TableCell>{currency(total.toFixed(2))} / {sub.plan.period.toLowerCase()}</TableCell></TableRow>; }) : <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No subscriptions yet.</TableCell></TableRow>}</TableBody></Table></div></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Invoices</h2><div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Status</TableHead><TableHead>Issue date</TableHead><TableHead>Due date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader><TableBody>{customer.invoices.length ? customer.invoices.map((invoice) => <TableRow key={invoice.id}><TableCell><Link className="font-medium hover:underline" href={`/invoices/${invoice.id}`}>{invoice.number}</Link></TableCell><TableCell>{invoice.status}</TableCell><TableCell>{date(invoice.issueDate)}</TableCell><TableCell>{date(invoice.dueDate)}</TableCell><TableCell className="text-right">{currency(invoice.total.toFixed(2))}</TableCell><TableCell className="text-right">{invoice.status === "CONFIRMED" ? currency(outstanding(invoice).toFixed(2)) : "—"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No invoices yet.</TableCell></TableRow>}</TableBody></Table></div></section>
  </div>;
}
