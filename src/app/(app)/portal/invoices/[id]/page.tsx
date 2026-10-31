import Link from "next/link";
import { ownInvoice, portalCustomerId } from "@/lib/portal";
import InvoiceView from "@/components/invoice-view";
import PrintButton from "./print-button";

// The customer's copy of an invoice: P4's read-only InvoiceView plus a Print button.
// ownInvoice() answers 404 for anything that isn't theirs.
export default async function PortalInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const customerId = await portalCustomerId();
  const { id } = await params;
  const invoice = await ownInvoice(id, customerId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/portal" className="text-sm text-muted-foreground hover:underline">&larr; My invoices</Link>
        <PrintButton />
      </div>
      <InvoiceView invoice={invoice} />
    </div>
  );
}
