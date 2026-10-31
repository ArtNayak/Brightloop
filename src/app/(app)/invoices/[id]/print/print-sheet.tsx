import type { InvoiceDetail } from "@/lib/billing/invoices";
import { formatDate } from "@/lib/billing/invoice-ui";
import InvoiceView from "@/components/invoice-view";

// The paper version of an invoice: brand header, the shared read-only InvoiceView, and a footer saying when it was
// printed. Plain props, no data fetching and no buttons, so it can be rendered in a check.
export default function PrintSheet({ invoice, printedOn }: { invoice: InvoiceDetail; printedOn: string }) {
  return (
    <article className="print-sheet mx-auto max-w-3xl space-y-6 rounded-lg border bg-white p-8">
      <header className="flex items-end justify-between border-b pb-4">
        <p className="text-xl font-bold">Brightloop</p>
        <p className="text-sm uppercase tracking-wide text-gray-600">Invoice</p>
      </header>
      <InvoiceView invoice={invoice} />
      <footer className="border-t pt-3 text-xs text-gray-500">
        {invoice.number} &middot; Printed on {formatDate(printedOn)}
      </footer>
    </article>
  );
}
