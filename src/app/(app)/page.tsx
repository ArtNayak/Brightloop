import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const s = await getServerSession(authOptions);
  redirect(s?.user.role === "CUSTOMER" ? "/portal" : "/reports");
}
