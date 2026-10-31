import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import SubscriptionForm from "@/components/subscription-form";

export default async function EditSubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { id } = await params;
  const [subscription, customers, plans, products] = await Promise.all([
    db.subscription.findUnique({ where: { id }, include: { customer: true, lines: true } }),
    db.user.findMany({ where: { role: "CUSTOMER" }, orderBy: { name: "asc" }, take: 25, select: { id: true, name: true, email: true } }),
    db.plan.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, price: true, period: true, minQuantity: true } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 100, include: { tax: { select: { ratePercent: true } }, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }] } } }),
  ]);
  if (!subscription) notFound(); if (subscription.status !== "DRAFT") redirect(`/subscriptions/${id}`);
  const allCustomers = customers.some((customer) => customer.id === subscription.customerId) ? customers : [{ id: subscription.customer.id, name: subscription.customer.name, email: subscription.customer.email }, ...customers];
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Edit {subscription.number}</h1><p className="text-sm text-muted-foreground">Only draft subscriptions can be edited.</p></div><SubscriptionForm id={id} customers={allCustomers} plans={plans.map((plan) => ({ id: plan.id, name: plan.name, price: plan.price.toString(), period: plan.period, minQuantity: plan.minQuantity }))} products={products.map((product) => ({ id: product.id, name: product.name, salesPrice: product.salesPrice.toString(), taxId: product.taxId, taxPercent: product.tax?.ratePercent.toString() ?? "0", variants: product.variants.map((variant) => ({ id: variant.id, attribute: variant.attribute, value: variant.value, extraPrice: variant.extraPrice.toString() })) }))} initial={{ customerId: subscription.customerId, planId: subscription.planId, startDate: subscription.startDate.toISOString().slice(0, 10), expiryDate: subscription.expiryDate?.toISOString().slice(0, 10) ?? "", paymentTerms: subscription.paymentTerms ?? "IMMEDIATE", templateId: subscription.templateId, lines: subscription.lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? "", quantity: line.quantity })) }} /></div>;
}
