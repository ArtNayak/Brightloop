"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Period = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
type PlanData = { id: string; name: string; price: string; period: Period; minQuantity: number; startDate: string; endDate: string; autoClose: boolean; closable: boolean; pausable: boolean; renewable: boolean };
const flags = [
  ["autoClose", "Auto-close at end date", "Automatically close subscriptions when their plan reaches its end date."],
  ["closable", "Can close early", "Allow a subscription on this plan to be closed before its end date."],
  ["pausable", "Can pause", "Allow a subscription on this plan to be paused."],
  ["renewable", "Can renew", "Allow a subscription on this plan to be renewed."],
] as const;

export default function PlanEditor({ plan, canManage = true, hasSubscriptions = false }: { plan?: PlanData; canManage?: boolean; hasSubscriptions?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(plan?.name ?? "");
  const [price, setPrice] = useState(plan?.price ?? "");
  const [period, setPeriod] = useState<Period>(plan?.period ?? "MONTHLY");
  const [minQuantity, setMinQuantity] = useState(String(plan?.minQuantity ?? 1));
  const [startDate, setStartDate] = useState(plan?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(plan?.endDate ?? "");
  const [behavior, setBehavior] = useState({ autoClose: plan?.autoClose ?? false, closable: plan?.closable ?? true, pausable: plan?.pausable ?? false, renewable: plan?.renewable ?? true });
  const [pending, setPending] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManage) return; setPending(true);
    try {
      const response = await fetch(plan ? `/api/plans/${plan.id}` : "/api/plans", { method: plan ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, price, period, minQuantity, startDate, endDate: endDate || null, ...behavior }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to save plan");
      toast.success(plan ? "Plan updated" : "Plan created");
      if (plan) router.refresh(); else router.push(`/plans/${result.id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save plan"); }
    finally { setPending(false); }
  }
  const readOnly = !canManage;
  return <Card><CardHeader><CardTitle>Plan setup</CardTitle><CardDescription>{readOnly ? "Staff can view plan details but cannot change them." : "Availability dates are inclusive calendar days in UTC."}</CardDescription></CardHeader><CardContent><form onSubmit={save} className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="plan-name">Name</Label><Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="plan-price">Price</Label><Input id="plan-price" type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="plan-period">Billing period</Label><select id="plan-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} disabled={readOnly || hasSubscriptions} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select>{hasSubscriptions && <p className="text-xs text-muted-foreground">Billing period is locked after subscriptions use this plan.</p>}</div><div className="space-y-2"><Label htmlFor="plan-min-quantity">Minimum quantity</Label><Input id="plan-min-quantity" type="number" min="1" step="1" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="plan-start">Available from</Label><Input id="plan-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required readOnly={readOnly} /></div><div className="space-y-2"><Label htmlFor="plan-end">Available until (optional)</Label><Input id="plan-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} readOnly={readOnly} /></div></div>
    <fieldset className="space-y-4 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Subscription behavior</legend>{flags.map(([key, title, description]) => <label key={key} className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={behavior[key]} disabled={readOnly} onChange={(e) => setBehavior({ ...behavior, [key]: e.target.checked })} /><span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{description}</span></span></label>)}</fieldset>
    {canManage && <Button type="submit" disabled={pending || !name.trim() || !price || !startDate || Number(minQuantity) < 1 || (!!endDate && endDate <= startDate)}>{pending ? "Saving…" : plan ? "Save changes" : "Create plan"}</Button>}
  </form></CardContent></Card>;
}

