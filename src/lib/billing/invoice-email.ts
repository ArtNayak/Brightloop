// The email a customer gets when staff click "Send invoice". Pure: takes plain strings, returns subject + HTML.
// Customer names and line descriptions are user-controlled, so every dynamic value is escaped.

export type EmailInvoice = {
  number: string;
  customerName: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  paid: string;
  outstanding: string;
  lines: { description: string; quantity: number; unitPrice: string; taxPercent: string; discountAmount: string; amount: string }[];
};

export function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;
const cell = "padding:6px 10px;border-bottom:1px solid #e5e5e5;";

export function invoiceEmail(inv: EmailInvoice, link: string): { subject: string; html: string } {
  // the link goes into an href: only plain web links are allowed
  if (!/^https?:\/\//i.test(link)) throw new Error("Invoice link must be http(s)");

  const rows = inv.lines
    .map(
      (l) => `<tr>
        <td style="${cell}">${e(l.description)}</td>
        <td style="${cell}text-align:right">${l.quantity}</td>
        <td style="${cell}text-align:right">${e(l.unitPrice)}</td>
        <td style="${cell}text-align:right">${e(l.discountAmount)}</td>
        <td style="${cell}text-align:right">${e(l.taxPercent)}%</td>
        <td style="${cell}text-align:right">${e(l.amount)}</td>
      </tr>`,
    )
    .join("");
  const total = (label: string, value: string, bold = false) =>
    `<tr><td colspan="5" style="${cell}text-align:right${bold ? ";font-weight:bold" : ""}">${label}</td><td style="${cell}text-align:right${bold ? ";font-weight:bold" : ""}">${e(value)}</td></tr>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#171717;max-width:640px">
  <h2 style="margin:0 0 4px">Invoice ${e(inv.number)}</h2>
  <p style="margin:0 0 16px;color:#525252">Hello ${e(inv.customerName)}, here is your invoice from Brightloop.</p>
  <p style="margin:0 0 16px">Billing period: ${e(inv.periodStart)} to ${e(inv.periodEnd)}<br>
  Issued: ${e(inv.issueDate)} &middot; <strong>Due: ${e(inv.dueDate)}</strong></p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr style="background:#f5f5f5;text-align:left">
      <th style="${cell}">Item</th><th style="${cell}text-align:right">Qty</th><th style="${cell}text-align:right">Unit price</th>
      <th style="${cell}text-align:right">Discount</th><th style="${cell}text-align:right">Tax</th><th style="${cell}text-align:right">Amount</th>
    </tr></thead>
    <tbody>${rows}
      ${total("Subtotal", inv.subtotal)}
      ${total("Discount", `-${inv.discountTotal}`)}
      ${total("Tax", inv.taxTotal)}
      ${total("Total", inv.total, true)}
      ${total("Paid", inv.paid)}
      ${total("Amount due", inv.outstanding, true)}
    </tbody>
  </table>
  <p style="margin:20px 0"><a href="${e(link)}" style="background:#171717;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">View invoice</a></p>
</div>`;

  return { subject: `Invoice ${inv.number} from Brightloop`, html };
}
