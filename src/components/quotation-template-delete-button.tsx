"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export default function QuotationTemplateDeleteButton({ id, name, used }: { id: string; name: string; used: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function remove() {
    if (used || !window.confirm(`Delete template “${name}”?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/quotation-templates/${id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not delete template");
      toast.success("Template deleted"); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete template"); }
    finally { setBusy(false); }
  }
  return <Button size="sm" variant="outline" disabled={busy || used} title={used ? "This template is linked to a subscription" : undefined} onClick={remove}>{busy ? "Deleting…" : "Delete"}</Button>;
}
