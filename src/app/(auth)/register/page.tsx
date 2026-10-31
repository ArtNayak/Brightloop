"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function Register() {
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get("name"), email: f.get("email"), password: f.get("password") };
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return setError((await res.json()).error);
    await signIn("credentials", { ...body, redirect: false });
    window.location.href = "/";
  }

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 rounded bg-card p-6 shadow">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <form onSubmit={submit} className="space-y-3">
        <input name="name" placeholder="Name" required className="w-full rounded border p-2" />
        <input name="email" type="email" placeholder="Email" required className="w-full rounded border p-2" />
        <input name="password" type="password" placeholder="Password" required className="w-full rounded border p-2" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button className="w-full rounded bg-primary p-2 text-primary-foreground">Sign up</button>
      </form>
      <p className="text-sm">
        <Link href="/login" className="underline">Already have an account?</Link>
      </p>
    </main>
  );
}
