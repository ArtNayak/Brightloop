"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { describeBillingRun } from "@/lib/billing/invoice-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// "Run billing" on /invoices. Opening it asks the server how many subscriptions are due (GET), nothing is billed until
// "Run billing now" (POST). Running twice is safe: a period that already has an invoice is never billed again.

type Summary = { created: number; alreadyBilled: number; skipped: number; failed: { subscription: string; error: string }[] };

export default function RunBilling() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);

  async function fail(res: Response) {
    const body = await res.json().catch(() => null);
    setError(typeof body?.error === "string" ? body.error : `Something went wrong (HTTP ${res.status})`);
  }

  async function show(next: boolean) {
    if (running) return; // can't close while a run is in progress
    setOpen(next);
    if (!next) return;
    setDue(null);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/billing/run");
      if (!res.ok) return await fail(res);
      setDue((await res.json()).due);
    } catch {
      setError("Could not reach the server, please try again");
    }
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/billing/run", { method: "POST" });
      if (!res.ok) return await fail(res);
      const summary: Summary = await res.json();
      setResult(summary);
      toast.success(describeBillingRun(summary));
      router.refresh(); // new draft invoices show up in the list
    } catch {
      setError("Could not reach the server, please try again");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => show(true)}>
        Run billing
      </Button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run billing</DialogTitle>
            <DialogDescription>
              Creates a draft invoice for every subscription whose billing date has arrived. Subscriptions already billed for that period are left alone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!result && !error && (
            <p className="text-sm">{due === null ? "Checking what is due..." : `${due} subscription${due === 1 ? " is" : "s are"} due for billing.`}</p>
          )}
          {result && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{describeBillingRun(result)}</p>
              {result.failed.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-red-600">
                  {result.failed.map((f) => (
                    <li key={f.subscription}>
                      {f.subscription}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={running} onClick={() => show(false)}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button disabled={running || due === null || due === 0} onClick={run}>
                {running ? "Billing..." : due === 0 ? "Nothing is due" : "Run billing now"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
