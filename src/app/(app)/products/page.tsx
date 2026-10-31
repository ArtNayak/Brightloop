import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Page() {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold">Products</h1>
      <Button render={<Link href="/products/taxes" />}>Taxes</Button>
    </div>
  );
}
