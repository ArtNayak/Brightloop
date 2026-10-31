"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Customer = { id: string; name: string; email: string };
type Variant = { id: string; attribute: string; value: string; extraPrice: string };
type Product = { id: string; name: string; salesPrice: string; taxId: string | null; taxPercent: string; variants: Variant[] };
type Plan = { id: string; name: string; price: string; period: string; minQuantity: number };
type Line = { productId: string; variantId: string; quantity: number };
type Initial = { customerId: string; planId: string; startDate: string; expiryDate: string; paymentTerms: string; lines: Line[]; templateId?: string | null };
const terms = [["IMMEDIATE", "Immediate"], ["NET_15", "Net 15"], ["NET_30", "Net 30"], ["NET_45", "Net 45"]];
const money = (value: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value));

export default function SubscriptionForm({ customers: initialCustomers, plans, products, initial, id }: { customers: Customer[]; plans: Plan[]; products: Product[]; initial: Initial; id?: string }) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [customerSearch, setCustomerSearch] = useState(initialCustomers.find((c) => c.id === initial.customerId)?.name ?? "");
  const [planId, setPlanId] = useState(initial.planId);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [expiryDate, setExpiryDate] = useState(initial.expiryDate);
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms);
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines : [{ productId: "", variantId: "", quantity: 1 }]);
  const [busy, setBusy] = useState(false);
  const plan = plans.find((row) => row.id === planId);
  useEffect(() => {
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/subscriptions/customers?q=${encodeURIComponent(customerSearch)}`);
      if (response.ok) {
        const found = await response.json() as Customer[];
        setCustomers(found);
        if (customerId && !found.some((customer) => customer.id === customerId)) {
          const selected = initialCustomers.find((customer) => customer.id === customerId);
          if (selected) setCustomers((current) => [selected, ...current]);
        }
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [customerSearch, customerId, initialCustomers]);
  const totals = useMemo(() => lines.reduce((result, line) => {
    const product = products.find((row) => row.id === line.productId);
    const variant = product?.variants.find((row) => row.id === line.variantId);
    const unit = Math.round((Number(product?.salesPrice ?? 0) + Number(variant?.extraPrice ?? 0)) * 100);
    const amount = unit * line.quantity;
    const tax = Math.round(amount * Number(product?.taxPercent ?? 0) / 100);
    return { subtotal: result.subtotal + amount, tax: result.tax + tax };
  }, { subtotal: 0, tax: 0 }), [lines, products]);
  function changeLine(index: number, patch: Partial<Line>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch, ...(patch.productId ? { variantId: "" } : {}) } : line)); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId) { toast.error("Choose a customer"); return; }
    setBusy(true);
    try {
      const response = await fetch(id ? `/api/subscriptions/${id}` : "/api/subscriptions", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, planId, startDate, expiryDate: expiryDate || null, paymentTerms, templateId: initial.templateId ?? null, lines }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) { toast.error(result?.error ?? "Could not save subscription"); return; }
      toast.success(id ? "Draft updated" : "Draft created");
      router.push(`/subscriptions/${result.id}`);
      router.refresh();
    } catch { toast.error("Could not reach the server"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-4xl space-y-6">
    <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Find customer<Input value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setCustomerId(""); }} placeholder="Name or email" /></label>
      <label className="space-y-1 text-sm">Customer<select required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setCustomerSearch(customers.find((customer) => customer.id === event.target.value)?.name ?? ""); }} className="h-9 w-full rounded-md border bg-background px-2">{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.email})</option>)}</select></label>
      <label className="space-y-1 text-sm">Plan<select required value={planId} onChange={(event) => setPlanId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2"><option value="">Select plan</option>{plans.map((row) => <option key={row.id} value={row.id}>{row.name} · {money(row.price)} / {row.period.toLowerCase()}</option>)}</select></label>
      <label className="space-y-1 text-sm">Payment terms<select value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2">{terms.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm">Start date<Input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label className="space-y-1 text-sm">Expiry date<Input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
    </section>
    <section className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Subscription lines</h2><Button type="button" variant="outline" onClick={() => setLines((current) => [...current, { productId: "", variantId: "", quantity: plan?.minQuantity ?? 1 }])}>Add line</Button></div>
      {lines.map((line, index) => { const product = products.find((row) => row.id === line.productId); const variant = product?.variants.find((row) => row.id === line.variantId); const unit = Number(product?.salesPrice ?? 0) + Number(variant?.extraPrice ?? 0); return <div key={index} className="grid items-end gap-3 border-t pt-3 sm:grid-cols-[2fr_1.5fr_1fr_1fr_auto]">
        <label className="space-y-1 text-sm">Product<select required value={line.productId} onChange={(event) => changeLine(index, { productId: event.target.value })} className="h-9 w-full rounded-md border bg-background px-2"><option value="">Select product</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="space-y-1 text-sm">Variant<select value={line.variantId} onChange={(event) => changeLine(index, { variantId: event.target.value })} disabled={!product?.variants.length} className="h-9 w-full rounded-md border bg-background px-2"><option value="">Standard</option>{product?.variants.map((row) => <option key={row.id} value={row.id}>{row.attribute}: {row.value} (+{money(row.extraPrice)})</option>)}</select></label>
        <label className="space-y-1 text-sm">Quantity<Input type="number" min={plan?.minQuantity ?? 1} value={line.quantity} onChange={(event) => changeLine(index, { quantity: Number(event.target.value) })} /></label>
        <div className="space-y-1 text-sm"><span className="block">Unit price</span><div className="h-9 pt-2">{money(unit.toFixed(2))}</div></div>
        <Button type="button" variant="outline" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</Button>
      </div>; })}
      <div className="space-y-1 border-t pt-3 text-right text-sm"><p>Subtotal: {money((totals.subtotal / 100).toFixed(2))}</p><p>Estimated tax: {money((totals.tax / 100).toFixed(2))}</p><p className="font-semibold">Total: {money(((totals.subtotal + totals.tax) / 100).toFixed(2))} / {plan?.period.toLowerCase() ?? "period"}</p></div>
    </section>
    <div className="flex gap-2"><Button type="submit" disabled={busy || !plans.length || !products.length}>{busy ? "Saving…" : "Save draft"}</Button><Button type="button" variant="outline" onClick={() => router.push("/subscriptions")}>Cancel</Button></div>
  </form>;
}
