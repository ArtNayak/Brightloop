import { Skeleton } from "@/components/ui/skeleton";

export default function ProductDetailsLoading() {
  return <div className="mx-auto max-w-4xl space-y-6"><Skeleton className="h-10 w-56" /><Skeleton className="h-80 w-full" /><Skeleton className="h-64 w-full" /></div>;
}
