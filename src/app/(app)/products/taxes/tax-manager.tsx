"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TaxRow = {
  id: string;
  name: string;
  ratePercent: string;
  active: boolean;
  productsUsing: number;
  linesUsing: number;
};

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Tax request failed");
  return body;
}

export default function TaxManager({ taxes, canManage }: { taxes: TaxRow[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ratePercent, setRatePercent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRate, setDraftRate] = useState("");
  const [pending, setPending] = useState(false);

  async function createTax(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await request("/api/taxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ratePercent }),
      });
      setName("");
      setRatePercent("");
      toast.success("Tax rule created");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create tax");
    } finally {
      setPending(false);
    }
  }

  function startEdit(tax: TaxRow) {
    setEditingId(tax.id);
    setDraftName(tax.name);
    setDraftRate(tax.ratePercent);
  }

  async function saveEdit(id: string) {
    setPending(true);
    try {
      await request(`/api/taxes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName, ratePercent: draftRate }),
      });
      setEditingId(null);
      toast.success("Tax rule updated");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update tax");
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(tax: TaxRow) {
    setPending(true);
    try {
      await request(`/api/taxes/${tax.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !tax.active }),
      });
      toast.success(tax.active ? "Tax rule deactivated" : "Tax rule activated");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update tax status");
    } finally {
      setPending(false);
    }
  }

  async function remove(tax: TaxRow) {
    const used = tax.productsUsing + tax.linesUsing > 0;
    const action = used ? "deactivate" : "delete";
    if (!window.confirm(`Remove ${tax.name}? This will ${action} the tax rule.`)) return;
    setPending(true);
    try {
      const result = await request(`/api/taxes/${tax.id}`, { method: "DELETE" });
      toast.success(result.action === "deactivated" ? "Tax is in use and was deactivated" : "Tax rule deleted");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove tax");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Add a tax rule</CardTitle>
            <CardDescription>Rates are stored to two decimal places and can range from 0% to 100%.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createTax} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="new-tax-name">Name</Label>
                <Input id="new-tax-name" name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-tax-rate">Rate (%)</Label>
                <Input id="new-tax-rate" name="ratePercent" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={ratePercent} onChange={(event) => setRatePercent(event.target.value)} required />
              </div>
              <Button type="submit" disabled={pending}>Add tax</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Used by</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {taxes.length === 0 ? (
              <TableRow><TableCell colSpan={canManage ? 5 : 4} className="py-8 text-center text-muted-foreground">No tax rules yet.</TableCell></TableRow>
            ) : taxes.map((tax) => (
              <TableRow key={tax.id}>
                <TableCell>
                  {canManage && editingId === tax.id ? (
                    <Input aria-label={`Name for ${tax.name}`} value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={80} />
                  ) : tax.name}
                </TableCell>
                <TableCell>
                  {canManage && editingId === tax.id ? (
                    <Input aria-label={`Rate for ${tax.name}`} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draftRate} onChange={(event) => setDraftRate(event.target.value)} />
                  ) : `${tax.ratePercent}%`}
                </TableCell>
                <TableCell><Badge variant={tax.active ? "default" : "secondary"}>{tax.active ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell>{tax.productsUsing} product{tax.productsUsing === 1 ? "" : "s"}, {tax.linesUsing} subscription line{tax.linesUsing === 1 ? "" : "s"}</TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {editingId === tax.id ? (
                        <>
                          <Button size="sm" disabled={pending || !draftName.trim() || !draftRate} onClick={() => saveEdit(tax.id)}>Save</Button>
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditingId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => startEdit(tax)}>Edit</Button>
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => toggleActive(tax)}>{tax.active ? "Deactivate" : "Activate"}</Button>
                          <Button size="sm" variant="destructive" disabled={pending} onClick={() => remove(tax)}>Remove</Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!canManage && <p className="text-sm text-muted-foreground">Staff can view tax rules. Only administrators can make changes.</p>}
    </div>
  );
}
