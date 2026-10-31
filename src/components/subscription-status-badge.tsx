import { Badge } from "@/components/ui/badge";
import type { SubscriptionStatus } from "@prisma/client";

export function SubscriptionStatusBadge({ status, paused = false }: { status: SubscriptionStatus; paused?: boolean }) {
  return <span className="inline-flex items-center gap-1"><Badge variant={status === "ACTIVE" ? "default" : status === "CLOSED" ? "secondary" : "outline"}>{status}</Badge>{paused && <Badge variant="secondary">Paused</Badge>}</span>;
}
