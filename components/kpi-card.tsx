import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { TrendArrow, type TrendDirection } from "@/components/trend-arrow";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  unit,
  trend,
  href,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: TrendDirection; label: string; goodDirection?: TrendDirection };
  href?: string;
  className?: string;
}) {
  const content = (
    <Card
      className={cn(
        "rounded-2xl border-border/60 shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      <CardContent className="p-6">
        <p className="text-sm font-medium text-steel">{label}</p>
        <p className="mt-2 font-serif text-3xl font-semibold text-navy">
          {value}
          {unit && <span className="ml-1 text-lg font-normal text-muted-foreground">{unit}</span>}
        </p>
        {trend && (
          <div className="mt-3">
            <TrendArrow direction={trend.direction} label={trend.label} goodDirection={trend.goodDirection} />
          </div>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
