import { getServerSession } from "next-auth";
import RunLifecycleButton from "@/components/run-lifecycle-button";
import { authOptions } from "@/lib/auth";

export default async function Page() {
  const session = await getServerSession(authOptions);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">Manage subscription lifecycle and customer agreements.</p>
        </div>
        {session?.user.role === "ADMIN" ? <RunLifecycleButton /> : null}
      </header>
    </section>
  );
}
