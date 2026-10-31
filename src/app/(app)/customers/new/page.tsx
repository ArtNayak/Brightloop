import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import CustomerForm from "../customer-form";

export default async function NewCustomerPage() {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Add customer</h1><p className="text-sm text-muted-foreground">Create an account with customer access.</p></div><Button variant="outline" render={<Link href="/customers" />}>Back to customers</Button></div><CustomerForm /></div>;
}
