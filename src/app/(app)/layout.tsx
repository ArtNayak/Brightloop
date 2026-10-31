import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { navItems } from "@/lib/nav-items";
import NavLink from "@/components/nav-link";
import SignOut from "@/components/sign-out";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar p-4">
        {/* The product's mark: an open loop in the one accent colour, with its name and what it does. */}
        <div className="mb-6 flex items-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
            <path d="M20.5 8.5A8.5 8.5 0 1 0 22 13" stroke="var(--chart-1)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="21" cy="5.5" r="2.2" fill="var(--chart-1)" />
          </svg>
          <div className="leading-tight">
            <p className="font-semibold">Brightloop</p>
            <p className="text-xs text-muted-foreground">Subscription billing</p>
          </div>
        </div>
        <nav className="space-y-0.5">
          {navItems
            .filter((n) => n.roles.includes(session.user.role))
            .map((n) => (
              <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
            ))}
        </nav>
        <div className="mt-auto pt-6 text-xs text-muted-foreground">
          <p className="truncate text-foreground">{session.user.email}</p>
          <p>{session.user.role.toLowerCase()}</p>
          <SignOut />
        </div>
      </aside>
      {/* Content eases in on every page: fade + 4px rise, CSS only (no animation library). */}
      <main className="min-w-0 flex-1 animate-in fade-in slide-in-from-bottom-1 p-6 duration-300 lg:p-8">{children}</main>
    </div>
  );
}
