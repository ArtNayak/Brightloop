"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Plan = { id: string; name: string; minQuantity: number; period: string };
type Product = { id: string; name: string; variants: { id: string; attribute: string; value: string }[] };
type TemplateLine = { productId: string; variantId: string; quantity: number };
type Existing = { id: string; name: string; validityDays: number; planId: string; lines: { productId: string; variantId: string | null; quantity: number }[] };

export default function QuotationTemplateEditor({ plans, products, template }: { plans: Plan[]; products: Product[]; template?: Existing }) {
  const router = useRouter();
  const [name, setName] = useState(template?.name ?? "");
  const [validityDays, setValidityDays] = useState(template?.validityDays ?? 30);
  const [planId, setPlanId] = useState(template?.planId ?? plans[0]?.id ?? "");
  const [lines, setLines] = useState<TemplateLine[]>(template?.lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? "", quantity: line.quantity })) ?? [{ productId: "", variantId: "", quantity: 1 }]);
  const [busy, setBusy] = useState(false);
  const plan = plans.find((item) => item.id === planId);
  function updateLine(index: number, patch: Partial<TemplateLine>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch, ...(patch.productId ? { variantId: "" } : {}) } : line)); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch(template ? `/api/quotation-templates/${template.id}` : "/api/quotation-templates", { method: template ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, validityDays, planId, lines }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not save quotation template");
      toast.success(template ? "Template updated" : "Template created"); router.push("/subscriptions/templates"); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save quotation template"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-4xl space-y-5">
    <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"><label className="space-y-1 text-sm">Template name<Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="space-y-1 text-sm">Valid for (days)<Input required type="number" min={1} max={3650} value={validityDays} onChange={(event) => setValidityDays(Number(event.target.value))} /></label><label className="space-y-1 text-sm">Plan<select required value={planId} onChange={(event) => setPlanId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2">{plans.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.period.toLowerCase()})</option>)}</select></label></section>
    <section className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Included products</h2><Button type="button" variant="outline" onClick={() => setLines((current) => [...current, { productId: "", variantId: "", quantity: plan?.minQuantity ?? 1 }])}>Add line</Button></div>{lines.map((line, index) => { const product = products.find((item) => item.id === line.productId); return <div key={index} className="grid gap-3 border-t pt-3 sm:grid-cols-[2fr_1.5fr_1fr_auto]"><label className="space-y-1 text-sm">Product<select required value={line.productId} onChange={(event) => updateLine(index, { productId: event.target.value })} className="h-9 w-full rounded-md border bg-background px-2"><option value="">Select product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="space-y-1 text-sm">Variant<select value={line.variantId} onChange={(event) => updateLine(index, { variantId: event.target.value })} disabled={!product?.variants.length} className="h-9 w-full rounded-md border bg-background px-2"><option value="">Standard</option>{product?.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.attribute}: {variant.value}</option>)}</select></label><label className="space-y-1 text-sm">Quantity<Input type="number" min={plan?.minQuantity ?? 1} value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></label><Button type="button" variant="outline" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</Button></div>; })}</section>
    <div className="flex gap-2"><Button type="submit" disabled={busy || !plans.length || !products.length}>{busy ? "Saving…" : template ? "Save changes" : "Create template"}</Button><Button type="button" variant="outline" onClick={() => router.push("/subscriptions/templates")}>Cancel</Button></div>
  </form>;
}
