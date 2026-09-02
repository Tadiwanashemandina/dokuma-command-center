"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type CsvValue = string | number | null | undefined;

function toCsvCell(value: CsvValue): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// Rows are plain, already-formatted arrays built server-side (dates/amounts
// rendered the same way the table shows them) — no accessor functions
// crossing the server/client boundary, just serializable data.
export function CsvExportButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: CsvValue[][];
}) {
  function handleExport() {
    const lines = [headers.map(toCsvCell).join(","), ...rows.map((row) => row.map(toCsvCell).join(","))];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      Export CSV
    </Button>
  );
}
