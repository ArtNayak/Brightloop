import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { availabilityStatus } from "@/lib/catalog/plans";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Search = { q?: string; period?: string; page?: string };
const money = (value: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value));
const date = (value: Date) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(value);

export default async function PlansPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const filters = await searchParams;
  const q = filters.q?.trim() ?? "";
  const period = filters.period ?? "";
  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const pageSize = 25;
  const where = { ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}), ...(period ? { period: period as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" } : {}) };
  const [total, plans] = await db.$transaction([
    db.plan.count({ where }),
    db.plan.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, price: true, period: true, minQuantity: true, startDate: true, endDate: true, autoClose: true, closable: true, pausable: true, renewable: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (period) params.set("period", period);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return `/plans${query ? `?${query}` : ""}`;
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Plans</h1><p className="text-sm text-muted-foreground">Billing options and lifecycle behavior for subscriptions.</p></div>{session.user.role === "ADMIN" && <Button render={<Link href="/plans/new" />}>New plan</Button>}</div>
    <form action="/plans" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(12rem,1fr)_12rem_auto] sm:items-end"><label className="space-y-1 text-sm">Search by name<Input name="q" defaultValue={q} placeholder="Search plans" /></label><label className="space-y-1 text-sm">Billing period<select name="period" defaultValue={period} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="">All periods</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label><Button type="submit">Filter</Button></form>
    <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Period</TableHead><TableHead>Min quantity</TableHead><TableHead>Availability</TableHead><TableHead>Behavior</TableHead></TableRow></TableHeader><TableBody>{plans.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No plans match these filters.</TableCell></TableRow> : plans.map((plan) => { const status = availabilityStatus(plan); return <TableRow key={plan.id}><TableCell><Link className="font-medium hover:underline" href={`/plans/${plan.id}`}>{plan.name}</Link></TableCell><TableCell>{money(plan.price.toString())}</TableCell><TableCell>{plan.period.toLowerCase()}</TableCell><TableCell>{plan.minQuantity}</TableCell><TableCell><div className="space-y-1"><Badge variant={status === "Available" ? "default" : "secondary"}>{status}</Badge><div className="text-xs text-muted-foreground">{date(plan.startDate)} · {plan.endDate ? date(plan.endDate) : "No end date"}</div></div></TableCell><TableCell className="whitespace-normal text-xs">{[plan.autoClose && "Auto-close", plan.closable && "Closable", plan.pausable && "Pausable", plan.renewable && "Renewable"].filter(Boolean).join(" · ") || "No lifecycle actions"}</TableCell></TableRow>; })}</TableBody></Table></div>
    <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{total} plan{total === 1 ? "" : "s"} · Page {page} of {totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={makeHref(Math.max(1, page - 1))} />}>Previous</Button><Button variant="outline" size="sm" disabled={page >= totalPages} render={<Link href={makeHref(Math.min(totalPages, page + 1))} />}>Next</Button></div></div>
  </div>;
}
