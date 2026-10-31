import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { countDrafts, listInvoices, listQuery } from "@/lib/billing/invoices";
import { LIST_TABS, activeTab, firstValues, invoiceListHref } from "@/lib/billing/invoice-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDrafts from "./confirm-drafts";
import InvoiceTable from "./invoice-table";
import RunBilling from "./run-billing";

// Staff list of invoices. Every filter lives in the URL (?status=&q=&from=&to=&overdue=&page=), so a filtered list can
// be bookmarked or shared, and it is rendered on the server. Customers are sent to the portal.
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "STAFF") redirect("/portal");

  const parsed = listQuery.safeParse(firstValues(await searchParams));
  // A bad value in the URL shows a message and the unfiltered list instead of an error page.
  const problem = parsed.success ? null : `${parsed.error.issues[0].path.join(".") || "filter"}: ${parsed.error.issues[0].message}`;
  const query = parsed.success ? parsed.data : listQuery.parse({});

  const [{ items, total, page, totalPages }, drafts] = await Promise.all([listInvoices(query), countDrafts()]);

  const keep = { q: query.q, from: query.from, to: query.to, customerId: query.customerId, subscriptionId: query.subscriptionId };
  const tab = activeTab(query);
  const scoped = query.customerId || query.subscriptionId;
  const hasFilters = !!(query.q || query.from || query.to);
  const here = { ...keep, status: query.status, overdue: query.overdue };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex flex-wrap items-center gap-2">
          <RunBilling />
          <ConfirmDrafts drafts={drafts} />
        </div>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Invoice status">
        {LIST_TABS.map((t) => (
          <Link
            key={t.key}
            href={invoiceListHref({ ...keep, ...t.params })}
            aria-current={tab === t.key ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${tab === t.key ? "bg-gray-900 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <form method="get" action="/invoices" className="flex flex-wrap items-end gap-2">
        {query.status && <input type="hidden" name="status" value={query.status} />}
        {query.overdue && <input type="hidden" name="overdue" value={query.overdue} />}
        {query.customerId && <input type="hidden" name="customerId" value={query.customerId} />}
        {query.subscriptionId && <input type="hidden" name="subscriptionId" value={query.subscriptionId} />}
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Search
          <Input name="q" defaultValue={query.q ?? ""} placeholder="Invoice number, customer name or email" className="w-72" maxLength={100} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Issued from
          <Input name="from" type="date" defaultValue={query.from ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          to
          <Input name="to" type="date" defaultValue={query.to ?? ""} />
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {hasFilters && (
          <Link href={invoiceListHref({ status: query.status, overdue: query.overdue, customerId: query.customerId, subscriptionId: query.subscriptionId })} className="pb-1.5 text-sm text-gray-600 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {scoped && (
        <p className="text-sm text-gray-600">
          Showing the invoices of one {query.subscriptionId ? "subscription" : "customer"}.{" "}
          <Link href={invoiceListHref({ status: query.status, overdue: query.overdue, q: query.q, from: query.from, to: query.to })} className="underline">
            Show all
          </Link>
        </p>
      )}
      {problem && <p className="text-sm text-red-600">That filter was ignored ({problem}).</p>}

      {items.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-600">
          {total > 0 ? (
            <>
              There is no page {page}.{" "}
              <Link href={invoiceListHref({ ...here })} className="underline">
                Back to the first page
              </Link>
            </>
          ) : tab === "all" && !hasFilters && !scoped ? (
            "No invoices yet. Run billing to create them for subscriptions that are due."
          ) : (
            "No invoices match these filters."
          )}
        </div>
      ) : (
        <InvoiceTable items={items} />
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {total} invoice{total === 1 ? "" : "s"} &middot; page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <span className="flex gap-3">
          {page > 1 ? (
            <Link href={invoiceListHref({ ...here, page: page - 1 })} rel="prev" className="underline">
              Previous
            </Link>
          ) : (
            <span className="text-gray-400">Previous</span>
          )}
          {page < totalPages ? (
            <Link href={invoiceListHref({ ...here, page: page + 1 })} rel="next" className="underline">
              Next
            </Link>
          ) : (
            <span className="text-gray-400">Next</span>
          )}
        </span>
      </div>
    </div>
  );
}
