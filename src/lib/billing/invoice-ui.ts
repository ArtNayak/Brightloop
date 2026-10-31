import type { InvoiceStatus } from "@prisma/client";

// Pure helpers for the invoice screens (detail, print, portal). No React, no database, so they are easy to check.

/** "1180.00" -> "1,180.00". Works on the string the API sends, so a Decimal never goes through a float. */
export function formatMoney(v: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(v);
  if (!m) return v;
  return `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[3] ?? ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO timestamp -> "5 Feb 2020". Dates are stored in UTC, so they are shown in UTC (no off-by-one in other timezones). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "NET_30" -> "Net 30", IMMEDIATE or missing -> "Due on receipt". Unknown text is shown as it is. */
export function termsLabel(terms: string | null | undefined): string {
  if (terms == null || terms === "IMMEDIATE") return "Due on receipt";
  const m = /^NET_(\d+)$/.exec(terms);
  return m ? `Net ${m[1]}` : terms;
}

export type InvoiceAction = "confirm" | "send" | "recordPayment" | "cancel";

/**
 * Which buttons staff see for an invoice. The API enforces the same rules (409 otherwise): this only decides what to
 * show. Paying is the only way to reach PAID (D4), and an invoice with payments can't be cancelled.
 */
export function invoiceActions(inv: { status: InvoiceStatus; payments: unknown[] }): InvoiceAction[] {
  switch (inv.status) {
    case "DRAFT":
      return ["confirm", "cancel"];
    case "CONFIRMED":
      return inv.payments.length > 0 ? ["send", "recordPayment"] : ["send", "recordPayment", "cancel"];
    case "PAID":
      return ["send"];
    case "CANCELLED":
      return [];
  }
}

// ---------- the /invoices list ----------

/** Next gives search params as string | string[] | undefined. Keep the first value and drop empty ones. */
export function firstValues(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined && first !== "") out[k] = first;
  }
  return out;
}

/** "/invoices?status=DRAFT&page=2". Empty values and page 1 are left out so links stay short and stable. */
export function invoiceListHref(params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "page" && Number(v) <= 1) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `/invoices?${s}` : "/invoices";
}

/** The quick filters above the table. "Overdue" is a filter, not a status (it is worked out from the due date). */
export const LIST_TABS = [
  { key: "all", label: "All", params: {} },
  { key: "DRAFT", label: "Draft", params: { status: "DRAFT" } },
  { key: "CONFIRMED", label: "Confirmed", params: { status: "CONFIRMED" } },
  { key: "overdue", label: "Overdue", params: { overdue: "1" } },
  { key: "PAID", label: "Paid", params: { status: "PAID" } },
  { key: "CANCELLED", label: "Cancelled", params: { status: "CANCELLED" } },
] as const;

export function activeTab(q: { status?: string; overdue?: string }): string {
  return q.overdue ? "overdue" : (q.status ?? "all");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sentence for the result of a billing run. */
export function describeBillingRun(s: { created: number; alreadyBilled: number; skipped: number; failed: unknown[] }): string {
  const parts = [`Created ${plural(s.created, "invoice")}.`];
  const rest = [
    s.alreadyBilled > 0 && `${s.alreadyBilled} already billed`,
    s.skipped > 0 && `${s.skipped} skipped`,
    s.failed.length > 0 && `${s.failed.length} failed`,
  ].filter(Boolean);
  if (rest.length) parts.push(`${rest.join(", ")}.`);
  return parts.join(" ");
}
