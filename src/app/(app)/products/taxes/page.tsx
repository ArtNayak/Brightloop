import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import TaxManager from "./tax-manager";

export default async function TaxesPage() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "STAFF"].includes(session.user.role)) redirect("/");

  const rows = await db.tax.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ratePercent: true,
      active: true,
      _count: { select: { products: true, lines: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Taxes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tax rules assigned to products and copied onto subscription lines.</p>
      </div>
      <TaxManager
        canManage={session.user.role === "ADMIN"}
        taxes={rows.map((tax) => ({
          id: tax.id,
          name: tax.name,
          ratePercent: tax.ratePercent.toString(),
          active: tax.active,
          productsUsing: tax._count.products,
          linesUsing: tax._count.lines,
        }))}
      />
    </div>
  );
}
