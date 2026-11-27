import { Badge } from "@/components/ui/badge";

const LOOK: Record<string, string> = {
  Published: "bg-green-100 text-green-800",
  Expired: "bg-red-100 text-red-800",
  Unpublished: "bg-amber-100 text-amber-900",
};

/** Published / Unpublished / Expired of an announcement, event, document or newsletter. */
export default function PublishStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={LOOK[status]}>{status}</Badge>;
}
