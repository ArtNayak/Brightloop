import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowedActions } from "@/lib/subscription-state";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SubscriptionActions from "@/components/subscription-actions";

const currency = (amount: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(amount));
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(value) : "—";

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { id } = await params;
  const sub = await db.subscription.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true, email: true } }, plan: true, template: true, lines: { include: { product: { select: { name: true } }, variant: true, tax: true } }, invoices: { select: { id: true, number: true, status: true, issueDate: true, total: true }, orderBy: { issueDate: "desc" } } } });
  if (!sub) notFound();
  const actions = allowedActions(sub, sub.plan, session.user.role);
  const subtotal = sub.lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
  const tax = sub.lines.reduce((sum, line) => sum.plus(line.amount.mul(line.tax?.ratePercent ?? 0).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)), new Prisma.Decimal(0));
  const stages = ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "CLOSED"] as const;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><Link href="/subscriptions" className="text-sm text-muted-foreground hover:underline">Subscriptions</Link><h1 className="text-2xl font-semibold">{sub.number}</h1><SubscriptionStatusBadge status={sub.status} paused={sub.paused} /></div><div className="flex flex-wrap gap-2">{sub.status === "DRAFT" && <Button variant="outline" render={<Link href={`/subscriptions/${id}/edit`} />}>Edit draft</Button>}<SubscriptionActions id={sub.id} actions={actions} /></div></div>
    <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3"><div><p className="text-sm text-muted-foreground">Customer</p><p className="font-medium">{sub.customer.name}</p><p className="text-sm">{sub.customer.email}</p></div><div><p className="text-sm text-muted-foreground">Plan</p><p className="font-medium">{sub.plan.name}</p><p className="text-sm">{currency(sub.plan.price.toString())} / {sub.plan.period.toLowerCase()}</p></div><div><p className="text-sm text-muted-foreground">Payment terms</p><p>{sub.paymentTerms ?? "—"}</p></div><div><p className="text-sm text-muted-foreground">Start</p><p>{date(sub.startDate)}</p></div><div><p className="text-sm text-muted-foreground">Expiry</p><p>{date(sub.expiryDate)}</p></div><div><p className="text-sm text-muted-foreground">Next billing</p><p>{date(sub.nextBillingDate)}</p></div>{sub.quoteValidUntil && <div><p className="text-sm text-muted-foreground">Quote valid until</p><p>{date(sub.quoteValidUntil)}</p></div>}</section>
    <section className="space-y-2"><h2 className="font-semibold">Lifecycle</h2><ol className="flex flex-wrap gap-2">{stages.map((stage) => <li key={stage} className={`rounded-full border px-3 py-1 text-xs ${stage === sub.status ? "border-primary bg-primary text-primary-foreground" : stages.indexOf(stage) < stages.indexOf(sub.status) ? "bg-muted" : "text-muted-foreground"}`}>{stage}</li>)}</ol></section>
    <section className="space-y-2"><h2 className="font-semibold">Lines</h2><div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Variant</TableHead><TableHead>Qty</TableHead><TableHead>Unit price</TableHead><TableHead>Tax</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader><TableBody>{sub.lines.map((line) => <TableRow key={line.id}><TableCell>{line.product.name}</TableCell><TableCell>{line.variant ? `${line.variant.attribute}: ${line.variant.value}` : "—"}</TableCell><TableCell>{line.quantity}</TableCell><TableCell>{currency(line.unitPrice.toString())}</TableCell><TableCell>{line.tax ? `${line.tax.ratePercent.toString()}%` : "—"}</TableCell><TableCell>{currency(line.amount.toString())}</TableCell></TableRow>)}</TableBody></Table></div><div className="ml-auto max-w-xs space-y-1 text-right text-sm"><p>Subtotal: {currency(subtotal.toFixed(2))}</p><p>Estimated tax: {currency(tax.toFixed(2))}</p><p className="font-semibold">Total / period: {currency(subtotal.plus(tax).toFixed(2))}</p></div></section>
    <section className="space-y-2"><h2 className="font-semibold">Invoices</h2>{sub.invoices.length ? <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Status</TableHead><TableHead>Issue date</TableHead><TableHead>Total</TableHead></TableRow></TableHeader><TableBody>{sub.invoices.map((invoice) => <TableRow key={invoice.id}><TableCell><Link className="underline-offset-4 hover:underline" href={`/invoices/${invoice.id}`}>{invoice.number}</Link></TableCell><TableCell>{invoice.status}</TableCell><TableCell>{date(invoice.issueDate)}</TableCell><TableCell>{currency(invoice.total.toString())}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">No invoices yet.</p>}</section>
  </div>;
}
