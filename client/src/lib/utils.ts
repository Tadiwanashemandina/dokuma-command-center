import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Ported verbatim from the legacy `lib/utils.ts`. Every component copied from
 * `components/` calls `cn()`, and the formatters below back the KPI cards and
 * tables, so keeping the same names and behavior means those files port with
 * no edits beyond their imports.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "$4.2m" / "$480k" / "$1,234" style compact USD formatting for KPI cards. */
export function formatUsdCompact(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toLocaleString("en-US")}`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
