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

/**
 * Formats an exact decimal money STRING for display.
 *
 * Distinct from `formatUsd` above, which takes a `number` and exists for the
 * KPI cards whose figures arrive that way. Every amount from `/api/finance`
 * arrives as an exact decimal string — `"1250.50"` — and passing it through
 * `Number()` to reuse the older formatter would undo, at the very last step,
 * the precision the Decimal128 column and the string wire format were chosen
 * to preserve.
 *
 * Grouping is applied to the integer part by hand rather than via
 * `toLocaleString`, because that would require the float conversion this is
 * here to avoid. The fractional part is passed through untouched.
 */
export function formatMoney(
  value: string | null | undefined,
  options: { currency?: string | null; decimals?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";

  const showDecimals = options.decimals ?? true;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = showDecimals ? `.${fraction.padEnd(2, "0").slice(0, 2)}` : "";

  const symbol = options.currency ? `${options.currency} ` : "$";
  return `${negative ? "−" : ""}${symbol}${grouped}${decimals}`;
}

/**
 * Compact form for headline tiles — "$4.2m", "$480k".
 *
 * Takes the same exact string and only converts to a number AFTER deciding the
 * magnitude bucket, where the value is being deliberately rounded to one
 * decimal place anyway and the precision is intentionally discarded. Never use
 * this where the exact figure matters.
 */
export function formatMoneyCompact(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  const negative = value.startsWith("-");
  const [whole = "0"] = (negative ? value.slice(1) : value).split(".");
  const sign = negative ? "−" : "";

  if (whole.length > 6) return `${sign}$${(Number(whole) / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (whole.length > 3) return `${sign}$${(Number(whole) / 1_000).toFixed(0)}k`;
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** A percentage that may legitimately be null — "no budget", not "0%". */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(decimals)}%`;
}
