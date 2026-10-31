import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { availabilityStatus } from "@/lib/catalog/plans";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PlanEditor from "../plan-editor";

export default async function PlanDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { id } = await params;
  const plan = await db.plan.findUnique({ where: { id }, select: { id: true, name: true, price: true, period: true, minQuantity: true, startDate: true, endDate: true, autoClose: true, closable: true, pausable: true, renewable: true, _count: { select: { subscriptions: true } } } });
  if (!plan) notFound();
  const data = { ...plan, price: plan.price.toString(), startDate: plan.startDate.toISOString().slice(0, 10), endDate: plan.endDate?.toISOString().slice(0, 10) ?? "" };
  const availability = availabilityStatus(plan);
  return <div className="mx-auto max-w-3xl space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{plan.name}</h1><div className="mt-2 flex items-center gap-2"><Badge variant={availability === "Available" ? "default" : "secondary"}>{availability}</Badge><span className="text-sm text-muted-foreground">{plan._count.subscriptions} subscription{plan._count.subscriptions === 1 ? "" : "s"}</span></div></div><Button variant="outline" render={<Link href="/plans" />}>Back to plans</Button></div><PlanEditor plan={data} canManage={session.user.role === "ADMIN"} hasSubscriptions={plan._count.subscriptions > 0} /></div>;
}
