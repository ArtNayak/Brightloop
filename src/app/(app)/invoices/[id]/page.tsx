import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { InvoiceError, getInvoice } from "@/lib/billing/invoices";
import { invoiceActions } from "@/lib/billing/invoice-ui";
import InvoiceView from "@/components/invoice-view";
import { RecordPaymentDialog } from "@/components/record-payment";
import InvoiceActions from "./invoice-actions";

// Staff view of one invoice. Customers are sent to the portal (the proxy already does this; checked again here).
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "STAFF") redirect("/portal");

  const { id } = await params;
  const invoice = await getInvoice(id).catch((e) => {
    if (e instanceof InvoiceError && e.status === 404) notFound();
    throw e;
  });

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="text-sm text-gray-600 hover:underline">
        &larr; All invoices
      </Link>
      <InvoiceActions
        id={invoice.id}
        number={invoice.number}
        actions={invoiceActions(invoice)}
        paymentSlot={<RecordPaymentDialog invoiceId={invoice.id} outstanding={invoice.outstanding} />}
      />
      <InvoiceView invoice={invoice} />
    </div>
  );
}
