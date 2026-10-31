"use client";
import { signOut } from "next-auth/react";

export default function SignOut() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })} className="mt-1 block underline">
      Sign out
    </button>
  );
}
