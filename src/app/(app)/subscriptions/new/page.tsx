import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { addPeriod } from "@/lib/period";
import SubscriptionForm from "@/components/subscription-form";

export default async function NewSubscriptionPage({ searchParams }: { searchParams: Promise<{ templateId?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { templateId } = await searchParams;
  const [customers, plans, products, template] = await Promise.all([
    db.user.findMany({ where: { role: "CUSTOMER" }, orderBy: { name: "asc" }, take: 25, select: { id: true, name: true, email: true } }),
    db.plan.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, price: true, period: true, minQuantity: true, startDate: true, endDate: true } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 100, include: { tax: { select: { ratePercent: true } }, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }] } } }),
    templateId ? db.quotationTemplate.findUnique({ where: { id: templateId }, include: { lines: true } }) : null,
  ]);
  const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const chosenPlan = template ? plans.find((plan) => plan.id === template.planId) : plans[0];
  const expiry = chosenPlan ? addPeriod(start, chosenPlan.period, 12) : addPeriod(start, "YEARLY");
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">New subscription</h1><p className="text-sm text-muted-foreground">Save the agreement as a draft. Prices are captured from the current catalog.</p></div><SubscriptionForm customers={customers} plans={plans.filter((plan) => plan.endDate === null || plan.endDate >= start).map((plan) => ({ id: plan.id, name: plan.name, price: plan.price.toString(), period: plan.period, minQuantity: plan.minQuantity }))} products={products.map((product) => ({ id: product.id, name: product.name, salesPrice: product.salesPrice.toString(), taxId: product.taxId, taxPercent: product.tax?.ratePercent.toString() ?? "0", variants: product.variants.map((variant) => ({ id: variant.id, attribute: variant.attribute, value: variant.value, extraPrice: variant.extraPrice.toString() })) }))} initial={{ customerId: "", planId: chosenPlan?.id ?? "", startDate: start.toISOString().slice(0, 10), expiryDate: expiry.toISOString().slice(0, 10), paymentTerms: "IMMEDIATE", templateId: template?.id ?? null, lines: template?.lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? "", quantity: line.quantity })) ?? [] }} /></div>;
}
