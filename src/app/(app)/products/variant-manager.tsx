"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Variant = { id: string; attribute: string; value: string; extraPrice: string; finalPrice: string; inUse: boolean };

export default function VariantManager({ productId, variants, canManage }: { productId: string; variants: Variant[]; canManage: boolean }) {
  const router = useRouter();
  const [attribute, setAttribute] = useState("");
  const [value, setValue] = useState("");
  const [extraPrice, setExtraPrice] = useState("0.00");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ attribute: "", value: "", extraPrice: "" });
  const [pending, setPending] = useState(false);

  async function request(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Variant request failed");
    return result;
  }
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    try { await request(`/api/products/${productId}/variants`, "POST", { attribute, value, extraPrice }); setAttribute(""); setValue(""); setExtraPrice("0.00"); toast.success("Variant added"); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to add variant"); } finally { setPending(false); }
  }
  function startEdit(variant: Variant) { setEditing(variant.id); setDraft({ attribute: variant.attribute, value: variant.value, extraPrice: variant.extraPrice }); }
  async function save(id: string) {
    setPending(true);
    try { await request(`/api/products/${productId}/variants/${id}`, "PATCH", draft); setEditing(null); toast.success("Variant updated"); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update variant"); } finally { setPending(false); }
  }
  async function remove(variant: Variant) {
    if (!window.confirm(`Remove ${variant.attribute}: ${variant.value}?`)) return;
    setPending(true);
    try { await request(`/api/products/${productId}/variants/${variant.id}`, "DELETE"); toast.success("Variant removed"); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove variant"); } finally { setPending(false); }
  }
  const money = (price: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(price));
  return <Card><CardHeader><CardTitle>Variants</CardTitle><CardDescription>Each final price is the product sales price plus its variant surcharge.</CardDescription></CardHeader><CardContent className="space-y-5">
    {canManage && <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end"><div className="space-y-2"><Label htmlFor="variant-attribute">Attribute</Label><Input id="variant-attribute" value={attribute} onChange={(e) => setAttribute(e.target.value)} maxLength={60} placeholder="Brand" required /></div><div className="space-y-2"><Label htmlFor="variant-value">Value</Label><Input id="variant-value" value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} placeholder="Odoo" required /></div><div className="space-y-2"><Label htmlFor="variant-price">Extra price</Label><Input id="variant-price" type="number" min="0" step="0.01" value={extraPrice} onChange={(e) => setExtraPrice(e.target.value)} required /></div><Button type="submit" disabled={pending || !attribute.trim() || !value.trim()}>Add variant</Button></form>}
    <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Attribute</TableHead><TableHead>Value</TableHead><TableHead>Extra price</TableHead><TableHead>Final price</TableHead>{canManage && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader><TableBody>{variants.length === 0 ? <TableRow><TableCell colSpan={canManage ? 5 : 4} className="py-8 text-center text-muted-foreground">No variants configured.</TableCell></TableRow> : variants.map((variant) => <TableRow key={variant.id}><TableCell>{editing === variant.id ? <Input aria-label="Variant attribute" value={draft.attribute} onChange={(e) => setDraft({ ...draft, attribute: e.target.value })} /> : variant.attribute}</TableCell><TableCell>{editing === variant.id ? <Input aria-label="Variant value" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /> : variant.value}</TableCell><TableCell>{editing === variant.id ? <Input aria-label="Variant extra price" type="number" min="0" step="0.01" value={draft.extraPrice} onChange={(e) => setDraft({ ...draft, extraPrice: e.target.value })} /> : money(variant.extraPrice)}</TableCell><TableCell className="font-medium">{money(variant.finalPrice)}</TableCell>{canManage && <TableCell><div className="flex justify-end gap-2">{editing === variant.id ? <><Button size="sm" disabled={pending || !draft.attribute.trim() || !draft.value.trim() || !draft.extraPrice} onClick={() => save(variant.id)}>Save</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(null)}>Cancel</Button></> : <><Button size="sm" variant="outline" disabled={pending} onClick={() => startEdit(variant)}>Edit</Button><Button size="sm" variant="destructive" disabled={pending} onClick={() => remove(variant)}>Remove</Button></>}</div></TableCell>}</TableRow>)}</TableBody></Table></div>
    {!canManage && <p className="text-sm text-muted-foreground">Staff can view variants. Only administrators can make changes.</p>}
  </CardContent></Card>;
}

