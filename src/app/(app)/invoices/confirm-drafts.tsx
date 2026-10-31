"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// "Confirm all drafts": one request, however many drafts there are. Asks first, because it changes every draft.
export default function ConfirmDrafts({ drafts }: { drafts: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (drafts === 0) return null;

  async function confirmAll() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/invoices/confirm-drafts", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) toast.error(typeof body?.error === "string" ? body.error : `Something went wrong (HTTP ${res.status})`);
      else {
        toast.success(`Confirmed ${body.confirmed} invoice${body.confirmed === 1 ? "" : "s"}`);
        setOpen(false);
      }
      router.refresh();
    } catch {
      toast.error("Could not reach the server, please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Confirm all drafts ({drafts})</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm all draft invoices?</DialogTitle>
            <DialogDescription>
              Every draft invoice ({drafts} right now) becomes confirmed, which means it can be sent to the customer and paid. This can&apos;t be undone in bulk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Not yet
            </Button>
            <Button disabled={busy} onClick={confirmAll}>
              {busy ? "Confirming..." : "Confirm all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
