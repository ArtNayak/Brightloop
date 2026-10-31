"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CustomerForm() {
  const router = useRouter(); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password, role: "ADMIN" }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not create customer");
      toast.success("Customer created"); router.push(`/customers/${result.id}`); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create customer"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="max-w-xl space-y-4 rounded-lg border p-5"><div className="space-y-2"><Label htmlFor="customer-name">Name</Label><Input id="customer-name" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="customer-email">Email</Label><Input id="customer-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="customer-password">Temporary password</Label><Input id="customer-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={9} required /><p className="text-xs text-muted-foreground">Use more than 8 characters with an uppercase letter, a lowercase letter, and a special character.</p></div><div className="flex gap-2"><Button type="submit" disabled={busy || !name.trim() || !email.trim() || !password}>{busy ? "Creating…" : "Create customer"}</Button><Button type="button" variant="outline" onClick={() => router.push("/customers")}>Cancel</Button></div></form>;
}
