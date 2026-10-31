import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { InvoiceError, getInvoice } from "@/lib/billing/invoices";

// Every portal page starts here. It returns the signed-in customer's id; anyone else is sent away.
// (The proxy already redirects non-customers; this is the second lock, in case the proxy rules change.)
export async function portalCustomerId() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "CUSTOMER") redirect("/reports");
  return session.user.id;
}

// Customers never see drafts: an invoice or subscription that staff are still preparing.
export const visibleToCustomer = { status: { not: "DRAFT" as const } };

// One invoice for the portal. Somebody else's invoice, a draft and a missing id all give the same 404,
// so a customer can't tell "exists but isn't yours" from "doesn't exist".
export async function ownInvoice(id: string, customerId: string) {
  const invoice = await getInvoice(id).catch((e) => {
    if (e instanceof InvoiceError && e.status === 404) notFound();
    throw e;
  });
  if (invoice.customer.id !== customerId || invoice.status === "DRAFT") notFound();
  return invoice;
}
