// Render checks for <InvoiceView />, the /invoices table and the print sheet: no database, no server. Run: npm run check:invoice-view
// Renders the component to HTML with fake invoices and checks what a person (or the customer portal) would see.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvoiceView from "../src/components/invoice-view";
import InvoiceTable from "../src/app/(app)/invoices/invoice-table";
import PrintSheet from "../src/app/(app)/invoices/[id]/print/print-sheet";
import type { InvoiceDetail, InvoiceListItem } from "../src/lib/billing/invoices";

function inv(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: "inv1",
    number: "INV-0042",
    status: "CONFIRMED",
    periodStart: "2020-01-01T00:00:00.000Z",
    periodEnd: "2020-01-31T00:00:00.000Z",
    issueDate: "2020-01-31T00:00:00.000Z",
    dueDate: "2020-02-15T00:00:00.000Z",
    subtotal: "12000.00",
    discountTotal: "1200.00",
    taxTotal: "1944.00",
    total: "12744.00",
    customer: { id: "c1", name: "Asha Rao", email: "asha@example.com" },
    subscription: { id: "s1", number: "SUB-001", paymentTerms: "NET_15" },
    lines: [
      { id: "l1", description: "Pro plan", quantity: 2, unitPrice: "5000.00", taxPercent: "18.00", discountAmount: "1200.00", amount: "8800.00" },
      { id: "l2", description: "Support add-on", quantity: 1, unitPrice: "2000.00", taxPercent: "0.00", discountAmount: "0.00", amount: "2000.00" },
    ],
    payments: [],
    paid: "0.00",
    outstanding: "12744.00",
    overdue: false,
    daysOverdue: 0,
    ...over,
  };
}
const html = (i: InvoiceDetail) => renderToStaticMarkup(createElement(InvoiceView, { invoice: i }));

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test("shows number, customer, terms, dates, lines and every total with grouped money", () => {
  const h = html(inv());
  for (const s of ["INV-0042", "Asha Rao", "asha@example.com", "SUB-001", "Net 15", "1 Jan 2020 to 31 Jan 2020", "Issued", "15 Feb 2020"]) assert.ok(h.includes(s), `missing "${s}"`);
  for (const s of ["Pro plan", "Support add-on", "5,000.00", "8,800.00", "-1,200.00", "12,000.00", "1,944.00", "12,744.00"]) assert.ok(h.includes(s), `missing "${s}"`);
  assert.ok(h.includes("Confirmed"));
  assert.ok(h.includes("No payments recorded yet."));
});

test("a zero discount shows as a dash, not -0.00", () => {
  const h = html(inv({ discountTotal: "0.00", lines: [{ ...inv().lines[0], discountAmount: "0.00" }] }));
  assert.ok(!h.includes("-0.00"));
});

test("payments are listed with a readable method, who recorded them, and the amount due drops", () => {
  const h = html(
    inv({
      payments: [{ id: "p1", method: "BANK_TRANSFER", amount: "4000.00", paidAt: "2020-02-01T00:00:00.000Z", note: "part payment", recordedBy: { name: "Sam Staff" } }],
      paid: "4000.00",
      outstanding: "8744.00",
    }),
  );
  for (const s of ["Bank transfer", "Sam Staff", "part payment", "1 Feb 2020", "4,000.00", "8,744.00"]) assert.ok(h.includes(s), `missing "${s}"`);
  assert.ok(!h.includes("No payments recorded yet."));
});

test("overdue: red Overdue badge and the number of days (singular and plural)", () => {
  assert.match(html(inv({ overdue: true, daysOverdue: 3 })), /Overdue[\s\S]*\(3 days overdue\)/);
  assert.ok(html(inv({ overdue: true, daysOverdue: 1 })).includes("(1 day overdue)"));
  assert.ok(!html(inv()).includes("overdue"));
});

test("PAID shows Paid and nothing due; CANCELLED shows Cancelled and nothing due even though nothing was paid", () => {
  const paid = html(inv({ status: "PAID", paid: "12744.00", outstanding: "0.00" }));
  assert.ok(paid.includes(">Paid<"));
  const cancelled = html(inv({ status: "CANCELLED" }));
  assert.ok(cancelled.includes("Cancelled"));
  assert.match(cancelled, /Amount due<\/dt><dd[^>]*>0\.00</);
});

test("customer-controlled text is escaped: no script or tag injection from names, descriptions or notes", () => {
  const evil = `<script>alert(1)</script>`;
  const h = html(
    inv({
      customer: { id: "c1", name: evil, email: `"><img src=x onerror=alert(1)>@x.com` },
      lines: [{ ...inv().lines[0], description: `<img src=x onerror=alert(2)>` }],
      payments: [{ id: "p1", method: "CASH", amount: "1.00", paidAt: "2020-02-01T00:00:00.000Z", note: evil, recordedBy: { name: `<b>x</b>` } }],
    }),
  );
  assert.ok(!h.includes("<script"), "raw <script> in output");
  assert.ok(!/<img/.test(h), "raw <img> in output");
  assert.ok(!h.includes("<b>x"), "raw <b> in output");
  assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("read-only: no buttons, links or forms, so the portal and print page can reuse it safely", () => {
  const h = html(inv({ status: "DRAFT" }));
  for (const tag of ["<button", "<a ", "<a>", "<form", "<input"]) assert.ok(!h.includes(tag), `found ${tag}`);
});

test("only the documented fields are rendered: a stray password hash on a nested object never reaches the HTML", () => {
  const dirty = inv();
  (dirty.customer as Record<string, unknown>).passwordHash = "$2a$10$abcdefghijklmnopqrstuv";
  (dirty.customer as Record<string, unknown>).resetToken = "tok_secret_123";
  const h = html(dirty);
  assert.ok(!/\$2[aby]\$|tok_secret_123|passwordHash|resetToken/.test(h));
});

// ---------- the /invoices table ----------
function row(over: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return {
    id: "r1",
    number: "INV-0007",
    status: "CONFIRMED",
    periodStart: "2020-01-01T00:00:00.000Z",
    periodEnd: "2020-01-31T00:00:00.000Z",
    issueDate: "2020-01-31T00:00:00.000Z",
    dueDate: "2020-02-15T00:00:00.000Z",
    total: "12744.00",
    customer: { id: "c1", name: "Asha Rao", email: "asha@example.com" },
    subscription: { id: "s1", number: "SUB-001" },
    paid: "0.00",
    outstanding: "12744.00",
    overdue: false,
    daysOverdue: 0,
    ...over,
  };
}
const table = (items: InvoiceListItem[]) => renderToStaticMarkup(createElement(InvoiceTable, { items }));

test("table: a row shows number (linked to its page), customer, subscription, period, dates, money and status", () => {
  const h = table([row()]);
  assert.ok(h.includes('href="/invoices/r1"'));
  for (const s of ["INV-0007", "Asha Rao", "asha@example.com", "SUB-001", "1 Jan 2020 to 31 Jan 2020", "31 Jan 2020", "15 Feb 2020", "12,744.00", "Confirmed"]) assert.ok(h.includes(s), `missing "${s}"`);
});

test("table: overdue rows are red with the days, others are not", () => {
  const h = table([row({ id: "late", overdue: true, daysOverdue: 12 }), row({ id: "ok", number: "INV-0008" })]);
  assert.ok(h.includes("12 days overdue") && h.includes("Overdue") && h.includes("text-destructive"));
  assert.equal(h.split("overdue").length - 1, 1); // only the late row mentions it
  assert.ok(!table([row()]).includes("text-destructive"));
});

test("table: cancelled shows no outstanding amount, paid shows 0.00", () => {
  assert.match(table([row({ status: "CANCELLED" })]), /12,744\.00<\/td><td[^>]*>-<\/td>/);
  assert.match(table([row({ status: "PAID", paid: "12744.00", outstanding: "0.00" })]), /12,744\.00<\/td><td[^>]*>0\.00<\/td>/);
});

test("table: customer names and emails are escaped, and the table is read-only (links only, no buttons or forms)", () => {
  const h = table([row({ customer: { id: "c", name: "<script>alert(1)</script>", email: '"><img src=x onerror=1>' } })]);
  assert.ok(!h.includes("<script") && !/<img/.test(h));
  for (const tag of ["<button", "<form", "<input"]) assert.ok(!h.includes(tag), `found ${tag}`);
});

// ---------- the print sheet ----------
const sheet = (i: InvoiceDetail, printedOn = "2026-10-31T09:15:00.000Z") => renderToStaticMarkup(createElement(PrintSheet, { invoice: i, printedOn }));

test("print sheet: brand header, the whole invoice, and a footer with the number and the print date", () => {
  const h = sheet(inv());
  for (const s of ["Brightloop", "INV-0042", "Asha Rao", "Pro plan", "Support add-on", "12,744.00", "Amount due"]) assert.ok(h.includes(s), `missing "${s}"`);
  assert.ok(h.includes("INV-0042 &middot; Printed on 31 Oct 2026") || h.includes("INV-0042 · Printed on 31 Oct 2026"), "footer");
  assert.ok(h.includes("print-sheet"), "print CSS hooks onto .print-sheet");
});

test("print sheet: the print date is the UTC day, even just before midnight", () => {
  assert.ok(sheet(inv(), "2026-12-31T23:59:59.000Z").includes("Printed on 31 Dec 2026"));
});

test("print sheet: no buttons, forms or links on paper, and customer text is escaped", () => {
  const h = sheet(inv({ customer: { id: "c", name: "<script>alert(1)</script>", email: "x@y.z" } }));
  for (const tag of ["<button", "<form", "<input", "<a ", "<script"]) assert.ok(!h.includes(tag), `found ${tag}`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n").join("\n       ")}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
