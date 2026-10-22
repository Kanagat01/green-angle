import { Badge } from "@/components/ui/Badge";
import type { RequestItem } from "@/lib/api/queries";
import type { Tone } from "@/lib/types";

const BADGES: Record<RequestItem["status"], [string, Tone]> = {
  NEW: ["Новая", "neutral"],
  IN_DIALOG: ["В диалоге", "accent"],
  APPROVED: ["Одобрена", "success"],
  REJECTED: ["Отклонена", "danger"],
};

export function ReqBadge({ status }: { status: RequestItem["status"] }) {
  const [text, tone] = BADGES[status];
  return <Badge text={text} tone={tone} />;
}
