"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function Login() {
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await signIn("credentials", {
      email: f.get("email"),
      password: f.get("password"),
      redirect: false,
    });
    if (r?.error) setError("Invalid email or password");
    else window.location.href = "/"; // "/" redirects by role
  }

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 rounded bg-white p-6 shadow">
      <h1 className="text-xl font-semibold">Sign in to Brightloop</h1>
      <form onSubmit={submit} className="space-y-3">
        <input name="email" type="email" placeholder="Email" required className="w-full rounded border p-2" />
        <input name="password" type="password" placeholder="Password" required className="w-full rounded border p-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-black p-2 text-white">Sign in</button>
      </form>
      <p className="flex justify-between text-sm">
        <Link href="/register" className="underline">Create account</Link>
        <Link href="/forgot-password" className="underline">Forgot password?</Link>
      </p>
    </main>
  );
}
