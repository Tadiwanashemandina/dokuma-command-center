import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/types/database.types";

const STATUS_STYLES: Record<ProjectStatus, string> = {
  green: "bg-status-green/15 text-status-green hover:bg-status-green/15",
  amber: "bg-status-amber/15 text-status-amber hover:bg-status-amber/15",
  red: "bg-status-red/15 text-status-red hover:bg-status-red/15",
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <Badge className={cn("rounded-full border-0 font-medium", STATUS_STYLES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
