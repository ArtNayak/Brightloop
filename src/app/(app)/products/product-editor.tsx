"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type TaxOption = { id: string; name: string; ratePercent: string; active?: boolean };
type ProductData = { id: string; name: string; type: string; salesPrice: string; costPrice: string; notes: string | null; active: boolean; taxId: string | null; tax: { name: string; ratePercent: string; active: boolean } | null };

export default function ProductEditor({ product, taxes, canManage = true }: { product?: ProductData; taxes: TaxOption[]; canManage?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(product?.name ?? "");
  const [type, setType] = useState(product?.type ?? "");
  const [salesPrice, setSalesPrice] = useState(product?.salesPrice ?? "");
  const [costPrice, setCostPrice] = useState(product?.costPrice ?? "");
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [taxId, setTaxId] = useState(product?.taxId ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [pending, setPending] = useState(false);
  const editable = canManage;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    setPending(true);
    try {
      const response = await fetch(product ? `/api/products/${product.id}` : "/api/products", {
        method: product ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, salesPrice, costPrice, notes, taxId: taxId || null, ...(product ? { active } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to save product");
      toast.success(product ? "Product updated" : "Product created");
      if (product) router.refresh(); else router.push(`/products/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save product");
    } finally { setPending(false); }
  }

  async function remove() {
    if (!product || !editable || !window.confirm(`Remove ${product.name}? Products used by subscriptions or quotations are deactivated.`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to remove product");
      toast.success(result.action === "deactivated" ? "Product is in use and was deactivated" : "Product deleted");
      router.push("/products");
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove product"); }
    finally { setPending(false); }
  }

  return <Card><CardHeader><CardTitle>Product details</CardTitle><CardDescription>{editable ? "Prices are stored to two decimal places." : "Staff can view catalog details but cannot edit them."}</CardDescription></CardHeader><CardContent><form onSubmit={save} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="product-name">Name</Label><Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required readOnly={!editable} /></div><div className="space-y-2"><Label htmlFor="product-type">Type</Label><Input id="product-type" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} required readOnly={!editable} /></div><div className="space-y-2"><Label htmlFor="sales-price">Sales price</Label><Input id="sales-price" type="number" min="0" step="0.01" inputMode="decimal" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} required readOnly={!editable} /></div><div className="space-y-2"><Label htmlFor="cost-price">Cost price</Label><Input id="cost-price" type="number" min="0" step="0.01" inputMode="decimal" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} required readOnly={!editable} /></div><div className="space-y-2"><Label htmlFor="product-tax">Tax</Label><select id="product-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} disabled={!editable} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="">No tax</option>{taxes.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} ({tax.ratePercent}%){tax.active === false ? " � inactive" : ""}</option>)}</select></div>{product && editable && <label className="flex items-center gap-2 self-end pb-1 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>}</div>
    <div className="space-y-2"><Label htmlFor="product-notes">Notes</Label><Textarea id="product-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} readOnly={!editable} /></div>
    {editable && <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || !name.trim() || !type.trim() || !salesPrice || !costPrice}>{pending ? "Saving�" : product ? "Save changes" : "Create product"}</Button>{product && <Button type="button" variant="destructive" disabled={pending} onClick={remove}>Remove product</Button>}</div>}
  </form></CardContent></Card>;
}
