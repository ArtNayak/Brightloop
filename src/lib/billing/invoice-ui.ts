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
