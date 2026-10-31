import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { allowedActions } from "@/lib/subscription-state";
import { portalCustomerId, visibleToCustomer } from "@/lib/portal";
import { formatDate, formatMoney } from "@/lib/billing/invoice-ui";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import SubscriptionActions from "@/components/subscription-actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const stages = ["QUOTATION", "CONFIRMED", "ACTIVE", "CLOSED"] as const;
const num = "text-right tabular-nums";
const day = (d: Date | null) => (d ? formatDate(d.toISOString()) : "—");

// One of the customer's own subscriptions. The id AND the customer id are in the query, so somebody else's
// subscription (or a draft) is simply "not found" and the page answers 404.
// The buttons come from allowedActions(..., "CUSTOMER") and call P3's transition API, which checks ownership again.
export default async function PortalSubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const customerId = await portalCustomerId();
  const { id } = await params;
  const sub = await db.subscription.findFirst({
    where: { id, customerId, ...visibleToCustomer },
    include: {
      plan: true,
      lines: { include: { product: { select: { name: true } }, variant: true, tax: true }, orderBy: { id: "asc" } },
      invoices: { where: visibleToCustomer, select: { id: true, number: true, status: true, total: true }, orderBy: { issueDate: "desc" } },
    },
  });
  if (!sub) notFound();

  const actions = allowedActions(sub, sub.plan, "CUSTOMER");
  const at = stages.indexOf(sub.status as (typeof stages)[number]);

  return (
    <div className="space-y-6">
      <Link href="/portal" className="text-sm text-muted-foreground hover:underline">&larr; My subscriptions</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{sub.number}</h1>
          <SubscriptionStatusBadge status={sub.status} paused={sub.paused} />
        </div>
        <div className="flex flex-wrap gap-2">
          <SubscriptionActions id={sub.id} actions={actions} />
        </div>
      </div>

      <ol className="flex flex-wrap gap-2">
        {stages.map((s, i) => (
          <li key={s} className={`rounded-full border px-3 py-1 text-xs ${s === sub.status ? "border-primary bg-primary text-primary-foreground" : i < at ? "bg-muted" : "text-muted-foreground"}`}>{s}</li>
        ))}
      </ol>

      <dl className="grid gap-4 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Plan</dt><dd className="font-medium">{sub.plan.name}</dd></div>
        <div><dt className="text-muted-foreground">Start</dt><dd>{day(sub.startDate)}</dd></div>
        <div><dt className="text-muted-foreground">Expiry</dt><dd>{day(sub.expiryDate)}</dd></div>
        <div><dt className="text-muted-foreground">Next billing</dt><dd>{day(sub.nextBillingDate)}</dd></div>
        {sub.quoteValidUntil && <div><dt className="text-muted-foreground">Quote valid until</dt><dd>{day(sub.quoteValidUntil)}</dd></div>}
      </dl>

      <section className="space-y-2">
        <h2 className="font-semibold">Lines</h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className={num}>Qty</TableHead>
                <TableHead className={num}>Unit price</TableHead>
                <TableHead className={num}>Tax</TableHead>
                <TableHead className={num}>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sub.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.product.name}{l.variant ? ` (${l.variant.attribute}: ${l.variant.value})` : ""}</TableCell>
                  <TableCell className={num}>{l.quantity}</TableCell>
                  <TableCell className={num}>{formatMoney(l.unitPrice.toFixed(2))}</TableCell>
                  <TableCell className={num}>{l.tax ? `${l.tax.ratePercent}%` : "—"}</TableCell>
                  <TableCell className={num}>{formatMoney(l.amount.toFixed(2))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Invoices</h2>
        {sub.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {sub.invoices.map((i) => (
              <li key={i.id}>
                <Link className="underline-offset-4 hover:underline" href={`/portal/invoices/${i.id}`}>{i.number}</Link>
                <span className="text-muted-foreground"> · {i.status.toLowerCase()} · {formatMoney(i.total.toFixed(2))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
