import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { getTemplateEditorData, QuotationTemplateEditor } from "../../template-editor-data";

export default async function EditQuotationTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions); if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { plans, products, template } = await getTemplateEditorData((await params).id);
  if (!template) notFound();
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Edit {template.name}</h1><p className="text-sm text-muted-foreground">Existing subscriptions keep their captured line items.</p></div><Button variant="outline" render={<Link href="/subscriptions/templates" />}>Back</Button></div><QuotationTemplateEditor plans={plans} products={products} template={template} /></div>;
}
