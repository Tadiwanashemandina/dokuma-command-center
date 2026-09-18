import { useCallback } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Downloads a CSV the caller has already built.
 *
 * Deliberately dumb: it takes `string[][]` and does no data access and no
 * formatting of its own. The reason is the money rule — every amount arrives
 * from the API as an exact decimal string, and the only correct rendering of
 * one is `formatMoney`. If this component took rows of objects plus accessor
 * functions, the accessors would cross the boundary and sooner or later one of
 * them would reach for `Number()` or `toFixed()` to "tidy" a column, which is
 * exactly the float64 round-trip the string wire format exists to prevent.
 * Keeping the formatting in the page means the CSV shows the same figures the
 * table does, by construction.
 */

export function CsvExportButton({
  filename,
  headers,
  rows,
  disabled,
}: {
  filename: string;
  headers: string[];
  rows: string[][];
  disabled?: boolean;
}) {
  const download = useCallback(() => {
    const csv = [headers, ...rows].map((row) => row.map(quoteField).join(",")).join("\r\n");

    // A BOM so Excel opens the file as UTF-8 rather than the local codepage,
    // which otherwise mangles any non-ASCII counterparty name.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Revoked in a finally so a failed click does not leak the object URL,
      // which would pin the blob in memory for the life of the document.
      URL.revokeObjectURL(url);
    }
  }, [filename, headers, rows]);

  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-xl"
      disabled={disabled || rows.length === 0}
      onClick={download}
    >
      <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Export CSV
    </Button>
  );
}

/**
 * Always quotes. Unconditional quoting is shorter than deciding per field and
 * removes the class of bug where a value that later grows a comma stops being
 * escaped. `"` doubles, per RFC 4180.
 */
function quoteField(value: string): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
