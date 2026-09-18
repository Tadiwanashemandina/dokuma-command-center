import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ArrowLink({
  href,
  children,
  className,
  circleClassName,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  circleClassName?: string;
}) {
  return (
    <Link to={href} className={cn("group inline-flex items-center gap-2 text-sm font-medium text-navy", className)}>
      {children}
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-transform group-hover:translate-x-0.5",
          circleClassName
        )}
      >
        <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}
