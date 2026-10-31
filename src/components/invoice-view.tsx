import type { InvoiceDetail } from "@/lib/billing/invoices";
import { formatDate, formatMoney, termsLabel } from "@/lib/billing/invoice-ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Read-only invoice. Takes the plain object from getInvoice() (money as strings, dates as ISO), so it works from a
// server page, the print page and the customer portal. It has no buttons and no links to staff pages.
// Never pass it a raw Prisma row: Decimals can't cross to the browser.

export function InvoiceStatusBadge({ status, overdue = false }: { status: InvoiceDetail["status"]; overdue?: boolean }) {
  if (overdue) return <Badge variant="destructive">Overdue</Badge>;
  if (status === "PAID") return <Badge>Paid</Badge>;
  if (status === "CANCELLED") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="secondary">{status === "DRAFT" ? "Draft" : "Confirmed"}</Badge>;
}

const methodLabel = (m: string) => m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, " ");

export default function InvoiceView({ invoice: inv }: { invoice: InvoiceDetail }) {
  const num = "text-right tabular-nums";
  return (
    <div className="space-y-6" data-invoice={inv.number}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{inv.number}</h1>
            <InvoiceStatusBadge status={inv.status} overdue={inv.overdue} />
          </div>
          <p className="text-sm text-muted-foreground">
            {inv.customer.name} &middot; {inv.customer.email}
          </p>
          <p className="text-sm text-muted-foreground">
            Subscription {inv.subscription.number} &middot; Terms: {termsLabel(inv.subscription.paymentTerms)}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Billing period</dt>
          <dd>
            {formatDate(inv.periodStart)} to {formatDate(inv.periodEnd)}
          </dd>
          <dt className="text-muted-foreground">Issued</dt>
          <dd>{formatDate(inv.issueDate)}</dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd className={inv.overdue ? "font-medium text-destructive" : undefined}>
            {formatDate(inv.dueDate)}
            {inv.overdue && ` (${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"} overdue)`}
          </dd>
        </dl>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className={num}>Qty</TableHead>
              <TableHead className={num}>Unit price</TableHead>
              <TableHead className={num}>Discount</TableHead>
              <TableHead className={num}>Tax</TableHead>
              <TableHead className={num}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inv.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.description}</TableCell>
                <TableCell className={num}>{l.quantity}</TableCell>
                <TableCell className={num}>{formatMoney(l.unitPrice)}</TableCell>
                <TableCell className={num}>{l.discountAmount === "0.00" ? "-" : `-${formatMoney(l.discountAmount)}`}</TableCell>
                <TableCell className={num}>{l.taxPercent}%</TableCell>
                <TableCell className={num}>{formatMoney(l.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className={num}>{formatMoney(inv.subtotal)}</dd>
        <dt className="text-muted-foreground">Discount</dt>
        <dd className={num}>{inv.discountTotal === "0.00" ? "-" : `-${formatMoney(inv.discountTotal)}`}</dd>
        <dt className="text-muted-foreground">Tax</dt>
        <dd className={num}>{formatMoney(inv.taxTotal)}</dd>
        <dt className="border-t pt-1 font-semibold">Total</dt>
        <dd className={`${num} border-t pt-1 font-semibold`}>{formatMoney(inv.total)}</dd>
        <dt className="text-muted-foreground">Paid</dt>
        <dd className={num}>{formatMoney(inv.paid)}</dd>
        <dt className="font-semibold">Amount due</dt>
        <dd className={`${num} font-semibold`}>{formatMoney(inv.status === "CANCELLED" ? "0.00" : inv.outstanding)}</dd>
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Payments</h2>
        {inv.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className={num}>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.paidAt)}</TableCell>
                    <TableCell>{methodLabel(p.method)}</TableCell>
                    <TableCell>{p.recordedBy.name}</TableCell>
                    <TableCell>{p.note ?? ""}</TableCell>
                    <TableCell className={num}>{formatMoney(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
