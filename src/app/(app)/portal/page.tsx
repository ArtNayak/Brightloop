import Link from "next/link";
import { db } from "@/lib/db";
import { outstanding, daysOverdue } from "@/lib/finance";
import { portalCustomerId, visibleToCustomer } from "@/lib/portal";
import { formatDate, formatMoney } from "@/lib/billing/invoice-ui";
import { SubscriptionStatusBadge } from "@/components/subscription-status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const num = "text-right tabular-nums";

// The customer's home: their subscriptions and their invoices, nothing else.
// Both queries are filtered by the signed-in customer's id, so there is no way to see another customer's rows.
export default async function PortalPage() {
  const customerId = await portalCustomerId();
  const [subs, invoices] = await Promise.all([
    db.subscription.findMany({
      where: { customerId, ...visibleToCustomer },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, status: true, paused: true, nextBillingDate: true, plan: { select: { name: true } } },
    }),
    db.invoice.findMany({
      where: { customerId, ...visibleToCustomer },
      orderBy: { issueDate: "desc" },
      select: { id: true, number: true, status: true, dueDate: true, total: true, payments: { select: { amount: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">My subscriptions</h1>
        {subs.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no subscriptions yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next billing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link className="underline-offset-4 hover:underline" href={`/portal/subscriptions/${s.id}`}>{s.number}</Link>
                    </TableCell>
                    <TableCell>{s.plan.name}</TableCell>
                    <TableCell><SubscriptionStatusBadge status={s.status} paused={s.paused} /></TableCell>
                    <TableCell>{s.nextBillingDate ? formatDate(s.nextBillingDate.toISOString()) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">My invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no invoices yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className={num}>Total</TableHead>
                  <TableHead className={num}>Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => {
                  const owed = i.status === "CONFIRMED" ? outstanding(i) : null;
                  const late = i.status === "CONFIRMED" ? daysOverdue(i.dueDate) : 0;
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link className="underline-offset-4 hover:underline" href={`/portal/invoices/${i.id}`}>{i.number}</Link>
                      </TableCell>
                      <TableCell>{formatDate(i.dueDate.toISOString())}</TableCell>
                      <TableCell>
                        {late > 0 ? <span className="text-destructive">{late} {late === 1 ? "day" : "days"} overdue</span> : i.status.toLowerCase()}
                      </TableCell>
                      <TableCell className={num}>{formatMoney(i.total.toFixed(2))}</TableCell>
                      <TableCell className={num}>{owed ? formatMoney(owed.toFixed(2)) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
