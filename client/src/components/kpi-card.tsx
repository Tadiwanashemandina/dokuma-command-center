import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TrendArrow, type TrendDirection } from "@/components/trend-arrow";
import { cn } from "@/lib/utils";

const ACCENT_DOT_CLASS = {
  teal: "bg-teal",
  steel: "bg-steel",
  gold: "bg-gold",
  "status-red": "bg-status-red",
  "status-green": "bg-status-green",
} as const;

export function KpiCard({
  label,
  value,
  unit,
  trend,
  href,
  accent = "teal",
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: TrendDirection; label: string; goodDirection?: TrendDirection };
  href?: string;
  accent?: "teal" | "steel" | "gold" | "status-red" | "status-green";
  className?: string;
}) {
  const content = (
    <Card className={cn("rounded-2xl border-0 bg-navy shadow-sm transition-shadow hover:shadow-md", className)}>
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full", ACCENT_DOT_CLASS[accent])} />
          <p className="text-sm font-medium text-white/60">{label}</p>
        </div>
        <p className="mt-2 text-3xl font-bold text-white">
          {value}
          {unit && <span className="ml-1 text-lg font-normal text-white/50">{unit}</span>}
        </p>
        {trend && (
          <div className="mt-3">
            <TrendArrow direction={trend.direction} label={trend.label} goodDirection={trend.goodDirection} />
          </div>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link to={href}>{content}</Link> : content;
}
