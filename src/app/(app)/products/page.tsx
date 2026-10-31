import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Search = { q?: string; type?: string; active?: string; page?: string };
const currency = (amount: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(amount));

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const filters = await searchParams;
  const q = filters.q?.trim() ?? "";
  const type = filters.type?.trim() ?? "";
  const status = filters.active ?? "all";
  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const pageSize = 25;
  const where = {
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(type ? { type } : {}),
    ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
  };
  const [total, rows, types] = await db.$transaction([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, type: true, salesPrice: true, costPrice: true, active: true, tax: { select: { name: true } } } }),
    db.product.findMany({ distinct: ["type"], orderBy: { type: "asc" }, select: { type: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (status !== "all") params.set("active", status);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return `/products${query ? `?${query}` : ""}`;
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Products</h1><p className="text-sm text-muted-foreground">Catalog items and their sales margins.</p></div>
        <div className="flex gap-2"><Button variant="outline" render={<Link href="/products/taxes" />}>Taxes</Button>{session.user.role === "ADMIN" && <Button render={<Link href="/products/new" />}>New product</Button>}</div>
      </div>
      <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(12rem,1fr)_12rem_12rem_auto] sm:items-end" action="/products">
        <label className="space-y-1 text-sm">Search by name<Input name="q" defaultValue={q} placeholder="Search products" /></label>
        <label className="space-y-1 text-sm">Type<select name="type" defaultValue={type} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="">All types</option>{types.map((row) => <option key={row.type} value={row.type}>{row.type}</option>)}</select></label>
        <label className="space-y-1 text-sm">Status<select name="active" defaultValue={status} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <Button type="submit">Filter</Button>
      </form>
      <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Sales price</TableHead><TableHead>Cost</TableHead><TableHead>Margin</TableHead><TableHead>Tax</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
        {rows.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No products match these filters.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.id}><TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/products/${row.id}`}>{row.name}</Link></TableCell><TableCell>{row.type}</TableCell><TableCell>{currency(row.salesPrice.toString())}</TableCell><TableCell>{currency(row.costPrice.toString())}</TableCell><TableCell>{currency(row.salesPrice.minus(row.costPrice).toString())}</TableCell><TableCell>{row.tax?.name ?? "—"}</TableCell><TableCell><Badge variant={row.active ? "default" : "secondary"}>{row.active ? "Active" : "Inactive"}</Badge></TableCell></TableRow>)}
      </TableBody></Table></div>
      <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{total} product{total === 1 ? "" : "s"} · Page {page} of {pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={href(Math.max(1, page - 1))} />}>Previous</Button><Button variant="outline" size="sm" disabled={page >= pages} render={<Link href={href(Math.min(pages, page + 1))} />}>Next</Button></div></div>
    </div>
  );
}
