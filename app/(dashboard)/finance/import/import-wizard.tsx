"use client";

import { useState } from "react";
import { previewImportAction, commitImportAction, type PreviewResult, type CommitResult } from "./actions";
import { ALL_MAP_FIELDS, REQUIRED_MAP_FIELDS, type MapField, type ColumnMapping } from "@/lib/finance/import-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FIELD_LABELS: Record<MapField, string> = {
  date: "Date",
  type: "Type (debit/credit)",
  amount: "Amount",
  category: "Category",
  counterparty: "Counterparty",
  description: "Description",
  reference_no: "Reference No.",
  is_dlap: "Is DLAP",
  dlap_share_pct: "DLAP Share %",
};

type Step = "upload" | "map" | "preview";

export function ImportWizard({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; errors: string[] }[] | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await previewImportAction(fd);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview(res);
    setStep("map");
  }

  function updateMapping(field: MapField, column: string) {
    setMapping((prev) => ({ ...prev, [field]: column === "__none__" ? undefined : column }));
  }

  function canProceedToPreview() {
    return REQUIRED_MAP_FIELDS.every((f) => !!mapping[f]) && !!accountId;
  }

  async function handleCommit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setRowErrors(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("account_id", accountId);
    for (const field of ALL_MAP_FIELDS) {
      if (mapping[field]) fd.set(`map_${field}`, mapping[field]!);
    }
    const res = await commitImportAction(fd);
    setLoading(false);
    setResult(res);
    if (!res.ok) {
      setError(res.error);
      setRowErrors(res.rowErrors ?? null);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping({});
    setError(null);
    setRowErrors(null);
    setResult(null);
  }

  if (result?.ok) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-6">
          <p className="text-sm text-status-green">
            Imported {result.inserted} transaction{result.inserted === 1 ? "" : "s"} successfully.
          </p>
          <Button onClick={reset} className="bg-navy hover:bg-navy/90">
            Import Another File
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-6 p-6">
        <div className="flex gap-2 text-xs font-medium text-muted-foreground">
          <span className={step === "upload" ? "text-navy" : ""}>1. Upload</span>
          <span>→</span>
          <span className={step === "map" ? "text-navy" : ""}>2. Map Columns</span>
          <span>→</span>
          <span className={step === "preview" ? "text-navy" : ""}>3. Preview &amp; Commit</span>
        </div>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">Spreadsheet file (.xlsx, .xls, .csv — max 5MB)</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {error && <p className="text-sm text-status-red">{error}</p>}
            <Button onClick={handleUpload} disabled={!file || loading} className="bg-navy hover:bg-navy/90">
              {loading ? "Reading file…" : "Continue"}
            </Button>
          </div>
        )}

        {step === "map" && preview && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Target Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Which account are these transactions for?" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">
              Found {preview.totalRows} rows and {preview.headers.length} columns. Map each required field to a column
              from your file — required fields are marked with *.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {ALL_MAP_FIELDS.map((field) => (
                <div key={field} className="space-y-2">
                  <Label>
                    {FIELD_LABELS[field]}
                    {(REQUIRED_MAP_FIELDS as readonly string[]).includes(field) && (
                      <span className="text-status-red"> *</span>
                    )}
                  </Label>
                  <Select value={mapping[field] ?? "__none__"} onValueChange={(v) => updateMapping(field, v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not mapped</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-status-red">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={() => setStep("preview")}
                disabled={!canProceedToPreview()}
                className="bg-navy hover:bg-navy/90"
              >
                Preview
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Showing the first {preview.previewRows.length} of {preview.totalRows} rows as they will be imported.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    {ALL_MAP_FIELDS.filter((f) => mapping[f]).map((f) => (
                      <TableHead key={f}>{FIELD_LABELS[f]}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.previewRows.map((row, i) => (
                    <TableRow key={i}>
                      {ALL_MAP_FIELDS.filter((f) => mapping[f]).map((f) => (
                        <TableCell key={f} className="text-xs">
                          {String(row[mapping[f]!] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {error && (
              <div className="space-y-2">
                <p className="text-sm text-status-red">{error}</p>
                {rowErrors && (
                  <ul className="max-h-40 list-inside list-disc overflow-y-auto text-xs text-status-red">
                    {rowErrors.map((re) => (
                      <li key={re.row}>
                        Row {re.row}: {re.errors.join("; ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button onClick={handleCommit} disabled={loading} className="bg-navy hover:bg-navy/90">
                {loading ? "Importing…" : `Import ${preview.totalRows} Rows`}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
