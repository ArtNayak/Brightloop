"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// A "Record payment" button that opens a small form. Drop it on any invoice row or page:
//   <RecordPaymentDialog invoiceId={invoice.id} outstanding="1180.00" />
// `outstanding` is what the amount box starts with (staff can lower it for a part payment).
export function RecordPaymentDialog({ invoiceId, outstanding }: { invoiceId: string; outstanding: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  // The server compares against UTC dates, so offer the same "today" and don't let people pick later.
  const today = new Date().toISOString().slice(0, 10);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, ...Object.fromEntries(new FormData(e.currentTarget)) }),
    });
    if (!res.ok) return setError((await res.json()).error);
    setOpen(false);
    router.refresh(); // the page shows the new balance / PAID status
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Record payment</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="method">Method</Label>
              {/* a plain select is enough here and works everywhere */}
              <select id="method" name="method" required defaultValue="" className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm">
                <option value="" disabled>Choose…</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="UPI">UPI</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount">Amount (owed: {outstanding})</Label>
              <Input id="amount" name="amount" inputMode="decimal" defaultValue={outstanding} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="paidAt">Date received</Label>
              <Input id="paidAt" name="paidAt" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" name="note" maxLength={500} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit">Save payment</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
