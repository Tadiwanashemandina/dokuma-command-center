import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrendDirection = "up" | "down" | "flat";

export function TrendArrow({
  direction,
  label,
  goodDirection = "up",
}: {
  direction: TrendDirection;
  label: string;
  /** Which direction counts as "good" for color — some KPIs (e.g. Overdue Tasks) are better going down. */
  goodDirection?: TrendDirection;
}) {
  const isGood = direction === "flat" || direction === goodDirection;
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isGood ? "text-status-green" : "text-status-red"
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
