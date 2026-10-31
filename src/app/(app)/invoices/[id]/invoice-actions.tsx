"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { InvoiceAction } from "@/lib/billing/invoice-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The buttons on /invoices/[id]. `actions` comes from invoiceActions(), decided on the server. Each button calls the
// invoice API and refreshes the page; the API still refuses anything not allowed (409), and we show its message.
// `paymentSlot` is where P1's <RecordPaymentDialog /> goes. Until it exists nothing is shown for "Record payment".

type Props = { id: string; number: string; actions: InvoiceAction[]; paymentSlot?: React.ReactNode };

export default function InvoiceActions({ id, number, actions, paymentSlot }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [askCancel, setAskCancel] = useState(false);

  async function run(action: "confirm" | "send" | "cancel", done: string) {
    if (busy) return; // one request at a time: a double click can't fire twice
    setBusy(action);
    try {
      const res = await fetch(`/api/invoices/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(typeof body?.error === "string" ? body.error : `Something went wrong (HTTP ${res.status})`);
      } else {
        toast.success(done);
        setAskCancel(false);
      }
      router.refresh(); // also after an error: the invoice may have changed under us
    } catch {
      toast.error("Could not reach the server, please try again");
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes("confirm") && (
        <Button disabled={busy !== null} onClick={() => run("confirm", `${number} confirmed`)}>
          {busy === "confirm" ? "Confirming..." : "Confirm invoice"}
        </Button>
      )}
      {actions.includes("send") && (
        <Button variant="outline" disabled={busy !== null} onClick={() => run("send", `${number} sent to the customer`)}>
          {busy === "send" ? "Sending..." : "Send to customer"}
        </Button>
      )}
      {actions.includes("recordPayment") && paymentSlot}
      {actions.includes("cancel") && (
        <>
          <Button variant="destructive" disabled={busy !== null} onClick={() => setAskCancel(true)}>
            Cancel invoice
          </Button>
          <Dialog open={askCancel} onOpenChange={(open) => !busy && setAskCancel(open)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel {number}?</DialogTitle>
                <DialogDescription>
                  The customer will no longer owe this invoice, and this billing period is not billed again. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={busy !== null} onClick={() => setAskCancel(false)}>
                  Keep invoice
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={() => run("cancel", `${number} cancelled`)}>
                  {busy === "cancel" ? "Cancelling..." : "Cancel invoice"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
