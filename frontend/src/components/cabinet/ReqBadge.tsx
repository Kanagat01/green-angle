import { Badge } from "@/components/ui/Badge";
import type { Request, Tone } from "@/lib/types";

const BADGES: Record<Request["status"], [string, Tone]> = {
  new: ["Новая", "neutral"],
  dialog: ["В диалоге", "accent"],
  approved: ["Одобрена", "success"],
  rejected: ["Отклонена", "danger"],
};

export function ReqBadge({ req }: { req: Request }) {
  const [text, tone] = BADGES[req.status];
  return <Badge text={text} tone={tone} />;
}
