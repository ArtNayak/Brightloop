import { db } from "@/lib/db";
import QuotationTemplateEditor from "@/components/quotation-template-editor";

export async function getTemplateEditorData(templateId?: string) {
  const [plans, products, template] = await Promise.all([
    db.plan.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, minQuantity: true, period: true } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }], select: { id: true, attribute: true, value: true } } } }),
    templateId ? db.quotationTemplate.findUnique({ where: { id: templateId }, include: { lines: { select: { productId: true, variantId: true, quantity: true } } } }) : null,
  ]);
  return { plans, products, template };
}

export { QuotationTemplateEditor };
