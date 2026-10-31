import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getServerSession as sessionCall } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { discountStatus, type DiscountStatus } from "@/lib/discount-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Search = { q?: string; status?: string; page?: string };
const date = (value: Date) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(value);
const amount = (value: string, type: string) => type === "PERCENTAGE" ? `${value}%` : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value));
const statuses: DiscountStatus[] = ["SCHEDULED", "ACTIVE", "EXPIRED", "EXHAUSTED"];

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const filters = await searchParams;
  const q = filters.q?.trim() ?? "";
  const status = filters.status ?? "ALL";
  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const matches = await db.discount.findMany({ where: q ? { name: { contains: q, mode: "insensitive" } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, value: true, minPurchase: true, minQuantity: true, startDate: true, endDate: true, usageLimit: true, timesUsed: true, scope: true, productId: true, subscriptionId: true, product: { select: { name: true } }, subscription: { select: { number: true } } } });
  const filtered = matches.filter((discount) => status === "ALL" || statuses.includes(status as DiscountStatus) && discountStatus(discount) === status);
  const total = filtered.length;
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const href = (nextPage: number) => { const params = new URLSearchParams(); if (q) params.set("q", q); if (status !== "ALL") params.set("status", status); if (nextPage > 1) params.set("page", String(nextPage)); const query = params.toString(); return `/discounts${query ? `?${query}` : ""}`; };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Discounts</h1><p className="text-sm text-muted-foreground">Rules applied by billing when an invoice is created.</p></div>{session.user.role === "ADMIN" && <Button render={<Link href="/discounts/new" />}>New discount</Button>}</div>
    <form action="/discounts" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(12rem,1fr)_14rem_auto] sm:items-end"><label className="space-y-1 text-sm">Search by name<Input name="q" defaultValue={q} placeholder="Search discount rules" /></label><label className="space-y-1 text-sm">Status<select name="status" defaultValue={status} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="ALL">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item[0] + item.slice(1).toLowerCase()}</option>)}</select></label><Button type="submit">Filter</Button></form>
    <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead><TableHead>Used</TableHead><TableHead>Scope</TableHead><TableHead>Dates</TableHead></TableRow></TableHeader><TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No discounts match these filters.</TableCell></TableRow> : rows.map((row) => { const currentStatus = discountStatus(row); return <TableRow key={row.id}><TableCell><Link className="font-medium hover:underline" href={`/discounts/${row.id}`}>{row.name}</Link><div className="text-xs text-muted-foreground">{row.type === "FIXED" ? "Fixed amount" : "Percentage"}</div></TableCell><TableCell>{amount(row.value.toString(), row.type)}</TableCell><TableCell><Badge variant={currentStatus === "ACTIVE" ? "default" : "secondary"}>{currentStatus[0] + currentStatus.slice(1).toLowerCase()}</Badge></TableCell><TableCell>{row.timesUsed} / {row.usageLimit ?? "Unlimited"}</TableCell><TableCell><div>{row.scope === "PRODUCT" ? "Product" : "Subscription"}</div><div className="text-xs text-muted-foreground">{row.scope === "PRODUCT" ? row.product?.name ?? "Product unavailable" : row.subscription?.number ?? "All subscriptions"}</div></TableCell><TableCell className="whitespace-normal text-xs">{date(row.startDate)} â€“ {row.endDate ? date(row.endDate) : "No end date"}</TableCell></TableRow>; })}</TableBody></Table></div>
    <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{total} discount{total === 1 ? "" : "s"} Â· Page {page} of {pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={href(Math.max(1, page - 1))} />}>Previous</Button><Button variant="outline" size="sm" disabled={page >= pages} render={<Link href={href(Math.min(pages, page + 1))} />}>Next</Button></div></div>
    {session.user.role === "STAFF" && <p className="text-sm text-muted-foreground">Staff can view discount rules. Only administrators can make changes.</p>}
  </div>;
}
