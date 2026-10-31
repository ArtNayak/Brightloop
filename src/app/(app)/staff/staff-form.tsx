"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Small form at the top of /staff. On success we clear it and refresh so the new person shows in the table.
export default function StaffForm() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget;
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!res.ok) return setError((await res.json()).error);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border p-4">
      <p className="font-medium">Add a staff member</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input name="name" placeholder="Full name" required />
        <Input name="email" type="email" placeholder="Email" required />
        <Input name="password" type="password" placeholder="Temporary password" required />
      </div>
      <p className="text-xs text-gray-600">
        More than 8 characters, with an uppercase letter, a lowercase letter and a special character. Share it with them
        in person.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit">Create staff account</Button>
    </form>
  );
}
