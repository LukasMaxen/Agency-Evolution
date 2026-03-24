import { AIIntent } from "@/lib/mock-data";
import { INTENT_CONFIG } from "@/lib/ai-analysis";
import { Zap, Flame, HelpCircle, Minus, XCircle } from "lucide-react";

interface Props {
  intent: AIIntent;
  size?: "sm" | "md";
}

const ICONS: Record<string, React.ElementType> = {
  interested_urgent: Zap,
  interested: Flame,
  needs_info: HelpCircle,
  neutral: Minus,
  not_interested: XCircle,
  unsubscribe: XCircle,
};

export function AIBadge({ intent, size = "sm" }: Props) {
  const cfg = INTENT_CONFIG[intent];
  const Icon = ICONS[intent] ?? Minus;
  const isLg = size === "md";

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md font-semibold shrink-0"
      style={{
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        fontSize: isLg ? 11 : 10,
        padding: isLg ? "3px 8px" : "2px 6px",
      }}
    >
      <Icon size={isLg ? 11 : 9} strokeWidth={2.5} />
      {cfg.label}
    </span>
  );
}
