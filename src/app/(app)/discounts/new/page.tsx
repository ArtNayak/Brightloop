import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import DiscountEditor from "../discount-editor";

export default async function NewDiscountPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/discounts");
  const [products, subscriptions] = await Promise.all([
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 1000, select: { id: true, name: true } }),
    db.subscription.findMany({ orderBy: { createdAt: "desc" }, take: 1000, select: { id: true, number: true, customer: { select: { name: true } } } }),
  ]);
  return <div className="mx-auto max-w-3xl space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">New discount</h1><p className="text-sm text-muted-foreground">Create a fixed or percentage rule for billing.</p></div><Button variant="outline" render={<Link href="/discounts" />}>Back to discounts</Button></div><DiscountEditor products={products} subscriptions={subscriptions} /></div>;
}
