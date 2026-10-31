"use client";
import { useState } from "react";
import Link from "next/link";

export default function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const password = new FormData(e.currentTarget).get("password");
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) return setError((await res.json()).error);
    setDone(true);
  }

  if (done) {
    return (
      <p className="text-sm text-green-700">
        Password changed. <Link href="/login" className="underline">Sign in</Link> with your new password.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input name="password" type="password" placeholder="New password" required className="w-full rounded border p-2" />
      <p className="text-xs text-muted-foreground">More than 8 characters, with an uppercase letter, a lowercase letter and a special character.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button className="w-full rounded bg-primary p-2 text-primary-foreground">Change password</button>
    </form>
  );
}
