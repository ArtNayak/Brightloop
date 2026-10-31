import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingTaxes() {
  return (
    <div role="status" aria-label="Loading tax rules" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
