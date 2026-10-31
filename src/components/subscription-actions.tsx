"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const labels: Record<string, string> = { send_quote: "Send quote", confirm: "Confirm", activate: "Activate", pause: "Pause", resume: "Resume", close: "Close", renew: "Renew" };

export default function SubscriptionActions({ id, actions }: { id: string; actions: string[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function run(action: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/subscriptions/${id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) { toast.error(result?.error ?? "Could not update subscription"); return; }
      toast.success(`Subscription ${labels[action]?.toLowerCase() ?? "updated"}`); router.refresh();
    } catch { toast.error("Could not reach the server"); }
    finally { setBusy(false); }
  }
  return <>{actions.map((action) => <Button key={action} disabled={busy} variant={action === "close" ? "destructive" : "default"} onClick={() => run(action)}>{labels[action] ?? action}</Button>)}</>;
}
