import { cache } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { InvoiceError, getInvoice } from "@/lib/billing/invoices";
import PrintButton from "./print-button";
import PrintSheet from "./print-sheet";

// Printing hides the app sidebar and the toolbar, drops the grey background and keeps table rows whole. Colours are kept
// so the Overdue / Paid badges still show on paper. This <style> is only on this page.
const PRINT_CSS = `
@page { size: A4; margin: 14mm; }
.print-sheet, .print-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  aside, .no-print { display: none !important; }
  body { background: #fff !important; }
  main { padding: 0 !important; }
  .print-sheet { border: 0 !important; padding: 0 !important; max-width: none !important; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}`;

const load = cache((id: string) => getInvoice(id)); // page and metadata share one query

// The page title becomes the default file name when saving as PDF, so make it the invoice number.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const invoice = await load(id).catch(() => null);
  return { title: invoice ? invoice.number : "Invoice" };
}

// Staff print view of one invoice. Customers are sent to the portal (the proxy does it too).
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "STAFF") redirect("/portal");

  const { id } = await params;
  const invoice = await load(id).catch((e) => {
    if (e instanceof InvoiceError && e.status === 404) notFound();
    throw e;
  });

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      <div className="no-print mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <Link href={`/invoices/${invoice.id}`} className="text-sm text-muted-foreground hover:underline">
          &larr; Back to invoice
        </Link>
        <PrintButton />
      </div>
      <PrintSheet invoice={invoice} printedOn={new Date().toISOString()} />
    </div>
  );
}
