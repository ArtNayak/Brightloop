"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// One sidebar link. It is a client component only so it can see the current URL and mark itself active
// (a quiet grey pill plus darker text, no coloured bar).
export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
