import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listQuotationTemplates } from "@/lib/quotation-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import QuotationTemplateDeleteButton from "@/components/quotation-template-delete-button";

export default async function QuotationTemplatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");
  const { q = "" } = await searchParams;
  const templates = await listQuotationTemplates(q);
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Quotation templates</h1><p className="text-sm text-muted-foreground">Reusable plans and product lines for customer quotes.</p></div><div className="flex gap-2"><Button variant="outline" render={<Link href="/subscriptions" />}>Subscriptions</Button><Button render={<Link href="/subscriptions/templates/new" />}>New template</Button></div></div>
    <form action="/subscriptions/templates" className="flex max-w-xl gap-2"><Input name="q" defaultValue={q} placeholder="Search templates or plans" /><Button type="submit" variant="outline">Search</Button></form>
    <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Plan</TableHead><TableHead>Validity</TableHead><TableHead>Lines</TableHead><TableHead>Subscriptions</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{templates.length ? templates.map((template) => <TableRow key={template.id}><TableCell className="font-medium">{template.name}</TableCell><TableCell>{template.plan.name} ({template.plan.period.toLowerCase()})</TableCell><TableCell>{template.validityDays} days</TableCell><TableCell>{template._count.lines}</TableCell><TableCell>{template._count.subscriptions}</TableCell><TableCell><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" render={<Link href={`/subscriptions/templates/${template.id}/edit`} />}>Edit</Button><Button size="sm" render={<Link href={`/subscriptions/new?templateId=${template.id}`} />}>Use template</Button><QuotationTemplateDeleteButton id={template.id} name={template.name} used={template._count.subscriptions > 0} /></div></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No quotation templates found.</TableCell></TableRow>}</TableBody></Table></div>
  </div>;
}
