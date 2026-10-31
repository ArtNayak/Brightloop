import Link from "next/link";
import type { InvoiceListItem } from "@/lib/billing/invoices";
import { formatDate, formatMoney } from "@/lib/billing/invoice-ui";
import { InvoiceStatusBadge } from "@/components/invoice-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// One page of the invoice list. Plain props (from listInvoices), no data fetching, so it can be rendered in a check.
export default function InvoiceTable({ items }: { items: InvoiceListItem[] }) {
  const num = "text-right tabular-nums";
  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className={num}>Total</TableHead>
            <TableHead className={num}>Outstanding</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              <TableCell>
                <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                  {i.number}
                </Link>
                <div className="text-xs text-gray-500">
                  {i.subscription.number} &middot; {formatDate(i.periodStart)} to {formatDate(i.periodEnd)}
                </div>
              </TableCell>
              <TableCell>
                {i.customer.name}
                <div className="text-xs text-gray-500">{i.customer.email}</div>
              </TableCell>
              <TableCell>{formatDate(i.issueDate)}</TableCell>
              <TableCell className={i.overdue ? "font-medium text-red-600" : undefined}>
                {formatDate(i.dueDate)}
                {i.overdue && <div className="text-xs">{i.daysOverdue} day{i.daysOverdue === 1 ? "" : "s"} overdue</div>}
              </TableCell>
              <TableCell className={num}>{formatMoney(i.total)}</TableCell>
              <TableCell className={num}>{i.status === "CANCELLED" ? "-" : formatMoney(i.outstanding)}</TableCell>
              <TableCell>
                <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
