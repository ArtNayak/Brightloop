import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { getTemplateEditorData, QuotationTemplateEditor } from "../template-editor-data";

export default async function NewQuotationTemplatePage() {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { plans, products } = await getTemplateEditorData();
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">New quotation template</h1><p className="text-sm text-muted-foreground">Choose a plan and reusable products.</p></div><Button variant="outline" render={<Link href="/subscriptions/templates" />}>Back</Button></div><QuotationTemplateEditor plans={plans} products={products} /></div>;
}
