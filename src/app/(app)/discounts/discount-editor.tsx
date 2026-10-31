"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type DiscountType = "FIXED" | "PERCENTAGE";
type DiscountScope = "PRODUCT" | "SUBSCRIPTION";
type ProductOption = { id: string; name: string; active?: boolean };
type SubscriptionOption = { id: string; number: string; customer: { name: string } };
type DiscountData = { id: string; name: string; type: DiscountType; value: string; minPurchase: string; minQuantity: string; startDate: string; endDate: string; usageLimit: string; scope: DiscountScope; productId: string | null; subscriptionId: string | null; timesUsed: number };

export default function DiscountEditor({ discount, products, subscriptions, canManage = true }: { discount?: DiscountData; products: ProductOption[]; subscriptions: SubscriptionOption[]; canManage?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(discount?.name ?? "");
  const [type, setType] = useState<DiscountType>(discount?.type ?? "PERCENTAGE");
  const [value, setValue] = useState(discount?.value ?? "");
  const [minPurchase, setMinPurchase] = useState(discount?.minPurchase ?? "");
  const [minQuantity, setMinQuantity] = useState(discount?.minQuantity ?? "");
  const [startDate, setStartDate] = useState(discount?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(discount?.endDate ?? "");
  const [usageLimit, setUsageLimit] = useState(discount?.usageLimit ?? "");
  const [scope, setScope] = useState<DiscountScope>(discount?.scope ?? "PRODUCT");
  const [productId, setProductId] = useState(discount?.productId ?? "");
  const [subscriptionId, setSubscriptionId] = useState(discount?.subscriptionId ?? "");
  const [pending, setPending] = useState(false);
  const used = (discount?.timesUsed ?? 0) > 0;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setPending(true);
    try {
      const payload = {
        name, value, minPurchase: minPurchase || null, minQuantity: minQuantity || null,
        startDate, endDate: endDate || null, usageLimit: usageLimit || null,
        productId: scope === "PRODUCT" ? productId || null : null,
        subscriptionId: scope === "SUBSCRIPTION" ? subscriptionId || null : null,
        ...(!used ? { type, scope } : {}),
      };
      const response = await fetch(discount ? `/api/discounts/${discount.id}` : "/api/discounts", {
        method: discount ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to save discount");
      toast.success(discount ? "Discount updated" : "Discount created");
      if (discount) router.refresh(); else router.push(`/discounts/${result.id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save discount"); }
    finally { setPending(false); }
  }

  async function remove() {
    if (!discount || !canManage || !window.confirm(`Delete discount ${discount.name}?`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/discounts/${discount.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to delete discount");
      toast.success("Discount deleted");
      router.push("/discounts");
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete discount"); }
    finally { setPending(false); }
  }

  const readOnly = !canManage;
  return <Card><CardHeader><CardTitle>Discount rule</CardTitle><CardDescription>{readOnly ? "Staff can view discount rules but cannot change them." : used ? "This rule has been used; its type and scope are locked to protect billing history." : "Billing applies eligible discount rules when invoices are generated."}</CardDescription></CardHeader><CardContent><form onSubmit={save} className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="discount-name">Name</Label><Input id="discount-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="discount-type">Type</Label><select id="discount-type" value={type} onChange={(e) => setType(e.target.value as DiscountType)} disabled={readOnly || used} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></div><div className="space-y-2"><Label htmlFor="discount-value">{type === "PERCENTAGE" ? "Percentage (%)" : "Amount"}</Label><Input id="discount-value" type="number" min={type === "PERCENTAGE" ? "0.01" : "0.01"} max={type === "PERCENTAGE" ? "100" : undefined} step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="discount-scope">Scope</Label><select id="discount-scope" value={scope} onChange={(e) => { const next = e.target.value as DiscountScope; setScope(next); if (next === "PRODUCT") setSubscriptionId(""); else setProductId(""); }} disabled={readOnly || used} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="PRODUCT">Product</option><option value="SUBSCRIPTION">Subscription</option></select></div>
      {scope === "PRODUCT" ? <div className="space-y-2 sm:col-span-2"><Label htmlFor="discount-product">Product</Label><select id="discount-product" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={readOnly} required className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="">Choose a product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.active === false ? " (inactive)" : ""}</option>)}</select></div> : <div className="space-y-2 sm:col-span-2"><Label htmlFor="discount-subscription">Subscription (optional)</Label><select id="discount-subscription" value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} disabled={readOnly} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="">All subscriptions</option>{subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.number} � {subscription.customer.name}</option>)}</select></div>}
      <div className="space-y-2"><Label htmlFor="discount-min-purchase">Minimum purchase (optional)</Label><Input id="discount-min-purchase" type="number" min="0" step="0.01" value={minPurchase} onChange={(e) => setMinPurchase(e.target.value)} readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="discount-min-quantity">Minimum quantity (optional)</Label><Input id="discount-min-quantity" type="number" min="1" step="1" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="discount-start">Start date</Label><Input id="discount-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="discount-end">End date (optional)</Label><Input id="discount-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="discount-usage">Usage limit (optional)</Label><Input id="discount-usage" type="number" min="1" step="1" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} readOnly={readOnly} /><p className="text-xs text-muted-foreground">Leave empty for unlimited uses.</p></div></div>
    {canManage && <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || !name.trim() || !value || !startDate || (scope === "PRODUCT" && !productId) || (!!endDate && endDate <= startDate)}>{pending ? "Saving�" : discount ? "Save changes" : "Create discount"}</Button>{discount && <Button type="button" variant="destructive" disabled={pending} onClick={remove}>Delete discount</Button>}</div>}
  </form></CardContent></Card>;
}
