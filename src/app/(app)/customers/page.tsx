import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { customerSearchWhere } from "@/lib/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const filters = await searchParams; const q = filters.q?.trim() ?? ""; const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1); const pageSize = 25; const where = customerSearchWhere(q);
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, email: true, createdAt: true, _count: { select: { subscriptions: true, invoices: { where: { status: "CONFIRMED" } } } } } }),
    db.user.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize)); const href = (p: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Customers</h1><p className="text-sm text-muted-foreground">Customer accounts, subscriptions, and open invoices.</p></div><Button render={<Link href="/customers/new" />}>Add customer</Button></div>
    <form action="/customers" className="flex max-w-xl gap-2"><Input name="q" defaultValue={q} placeholder="Search name or email" /><Button type="submit" variant="outline">Search</Button></form>
    <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Subscriptions</TableHead><TableHead>Open invoices</TableHead><TableHead>Added</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((row) => <TableRow key={row.id}><TableCell><Link className="font-medium hover:underline" href={`/customers/${row.id}`}>{row.name}</Link></TableCell><TableCell>{row.email}</TableCell><TableCell>{row._count.subscriptions}</TableCell><TableCell>{row._count.invoices}</TableCell><TableCell>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(row.createdAt)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No customers match this search.</TableCell></TableRow>}</TableBody></Table></div>
    <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{total} customer{total === 1 ? "" : "s"} · Page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} render={<Link href={href(Math.max(1, page - 1))} />}>Previous</Button><Button size="sm" variant="outline" disabled={page >= pages} render={<Link href={href(Math.min(pages, page + 1))} />}>Next</Button></div></div>
  </div>;
}
