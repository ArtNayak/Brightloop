import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { navItems } from "@/lib/nav-items";
import SignOut from "@/components/sign-out";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 space-y-1 border-r bg-white p-4">
        <p className="mb-4 text-lg font-bold">Brightloop</p>
        {navItems
          .filter((n) => n.roles.includes(session.user.role))
          .map((n) => (
            <Link key={n.href} href={n.href} className="block rounded px-2 py-1 hover:bg-gray-100">
              {n.label}
            </Link>
          ))}
        <div className="pt-4 text-xs text-gray-500">
          {session.user.email} ({session.user.role})
          <SignOut />
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
