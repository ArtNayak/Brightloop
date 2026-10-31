import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import ProductEditor from "../product-editor";

export default async function NewProductPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/products");
  const taxes = await db.tax.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, ratePercent: true } });
  return <div className="mx-auto max-w-3xl space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">New product</h1><p className="text-sm text-muted-foreground">Create a catalog item and assign an optional tax rule.</p></div><Button variant="outline" render={<Link href="/products" />}>Back to products</Button></div><ProductEditor taxes={taxes.map((tax) => ({ ...tax, ratePercent: tax.ratePercent.toString() }))} /></div>;
}
