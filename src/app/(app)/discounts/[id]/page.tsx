import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { discountStatus } from "@/lib/discount-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DiscountEditor from "../discount-editor";

export default async function DiscountDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { id } = await params;
  const discount = await db.discount.findUnique({ where: { id }, select: { id: true, name: true, type: true, value: true, minPurchase: true, minQuantity: true, startDate: true, endDate: true, usageLimit: true, timesUsed: true, scope: true, productId: true, subscriptionId: true } });
  if (!discount) notFound();
  const [products, subscriptions] = await Promise.all([
    db.product.findMany({ where: { OR: [{ active: true }, ...(discount.productId ? [{ id: discount.productId }] : [])] }, orderBy: { name: "asc" }, take: 1000, select: { id: true, name: true, active: true } }),
    db.subscription.findMany({ orderBy: { createdAt: "desc" }, take: 1000, select: { id: true, number: true, customer: { select: { name: true } } } }),
  ]);
  const data = { ...discount, value: discount.value.toString(), minPurchase: discount.minPurchase?.toString() ?? "", startDate: discount.startDate.toISOString().slice(0, 10), endDate: discount.endDate?.toISOString().slice(0, 10) ?? "", usageLimit: discount.usageLimit?.toString() ?? "", minQuantity: discount.minQuantity?.toString() ?? "" };
  const status = discountStatus(discount);
  return <div className="mx-auto max-w-3xl space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{discount.name}</h1><div className="mt-2 flex items-center gap-2"><Badge variant={status === "ACTIVE" ? "default" : "secondary"}>{status[0] + status.slice(1).toLowerCase()}</Badge><span className="text-sm text-muted-foreground">Used {discount.timesUsed}{discount.usageLimit === null ? " times � unlimited" : ` of ${discount.usageLimit}`}</span></div></div><Button variant="outline" render={<Link href="/discounts" />}>Back to discounts</Button></div><DiscountEditor discount={data} products={products} subscriptions={subscriptions} canManage={session.user.role === "ADMIN"} /></div>;
}
