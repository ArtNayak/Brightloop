"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type LifecycleResult = { activated: number; closed: number; error?: string };

export default function RunLifecycleButton() {
  const [running, setRunning] = useState(false);
  const router = useRouter();

  async function run() {
    setRunning(true);
    try {
      const response = await fetch("/api/jobs/lifecycle", { method: "POST" });
      const result = (await response.json().catch(() => null)) as LifecycleResult | null;
      if (!response.ok) {
        toast.error(result?.error ?? "Could not run subscription lifecycle");
        return;
      }

      const activated = result?.activated ?? 0;
      const closed = result?.closed ?? 0;
      toast.success(`Lifecycle complete: ${activated} activated, ${closed} closed`);
      router.refresh();
    } catch {
      toast.error("Could not reach the lifecycle job");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button type="button" onClick={run} disabled={running}>
      {running ? "Running lifecycle…" : "Run lifecycle now"}
    </Button>
  );
}
