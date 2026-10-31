"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPassword() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const email = new FormData(e.currentTarget).get("email");
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setMessage(data.message); // same text for every email, by design
  }

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 rounded bg-card p-6 shadow">
      <h1 className="text-xl font-semibold">Forgot your password?</h1>
      {message ? (
        <p className="text-sm text-green-700 dark:text-green-400">{message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">Enter your email and we&apos;ll send you a link to reset it.</p>
          <input name="email" type="email" placeholder="Email" required className="w-full rounded border p-2" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button className="w-full rounded bg-primary p-2 text-primary-foreground">Send reset link</button>
        </form>
      )}
      <p className="text-sm">
        <Link href="/login" className="underline">Back to sign in</Link>
      </p>
    </main>
  );
}
