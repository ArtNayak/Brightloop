import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import PlanEditor from "../plan-editor";

export default async function NewPlanPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/plans");
  return <div className="mx-auto max-w-3xl space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">New plan</h1><p className="text-sm text-muted-foreground">Set its price, availability and subscription behavior.</p></div><Button variant="outline" render={<Link href="/plans" />}>Back to plans</Button></div><PlanEditor /></div>;
}
