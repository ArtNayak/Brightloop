import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { unitPrice } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import ProductEditor from "../product-editor";
import VariantManager from "../variant-manager";

export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id }, select: { id: true, name: true, type: true, salesPrice: true, costPrice: true, notes: true, active: true, taxId: true, tax: { select: { name: true, ratePercent: true, active: true } }, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }], select: { id: true, attribute: true, value: true, extraPrice: true, _count: { select: { subLines: true, templateLines: true } } } } } });
  if (!product) notFound();
  const canManage = session.user.role === "ADMIN";
  const taxes = await db.tax.findMany({ where: { OR: [{ active: true }, ...(product.taxId ? [{ id: product.taxId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true, ratePercent: true, active: true } });
  const { variants: _rawVariants, ...plain } = product; // the raw variants hold Decimals; they are passed on as strings below
  const serialized = { ...plain, salesPrice: product.salesPrice.toString(), costPrice: product.costPrice.toString(), tax: product.tax ? { ...product.tax, ratePercent: product.tax.ratePercent.toString() } : null };
  const variants = product.variants.map((variant) => ({ id: variant.id, attribute: variant.attribute, value: variant.value, extraPrice: variant.extraPrice.toString(), finalPrice: unitPrice(product, variant).toString(), inUse: variant._count.subLines > 0 || variant._count.templateLines > 0 }));
  return <div className="mx-auto max-w-4xl space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{product.name}</h1><p className="text-sm text-muted-foreground">Product details and variants.</p></div><Button variant="outline" render={<Link href="/products" />}>Back to products</Button></div><ProductEditor product={serialized} taxes={taxes.map((tax) => ({ ...tax, ratePercent: tax.ratePercent.toString() }))} canManage={canManage} /><VariantManager productId={product.id} variants={variants} canManage={canManage} /></div>;
}


