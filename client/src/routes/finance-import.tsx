import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info, Upload } from "lucide-react";
import { FINANCE_WRITE } from "@dokuma/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-states";
import { FinanceSubnav } from "@/components/finance/finance-subnav";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { cn, formatMoney } from "@/lib/utils";
import {
  commitImport,
  listAccounts,
  previewImport,
  type ImportCommitResult,
  type ImportDryRunResult,
  type ImportPreview,
} from "@/lib/api/finance";

/**
 * The transaction import wizard.
 *
 * Four things about this flow are deliberate and easy to "simplify" wrongly:
 *
 *  1. The same `File` object is held in state for the whole wizard and
 *     re-uploaded on the dry run AND on the commit. The server keeps no state
 *     between calls and re-parses the file each time — that is what guarantees
 *     the committed rows came from a real file rather than from a list the
 *     client could have edited after validation.
 *  2. The dry run is not optional. The import is all-or-nothing, so without it
 *     an operator discovers bad rows one upload at a time.
 *  3. The real commit button stays disabled until `invalid_count === 0`, for
 *     the same reason — a commit with any invalid row writes nothing at all.
 *  4. Nothing here parses or totals an amount. The file's figures go to the
 *     server as text, and the balance that comes back is an exact decimal
 *     string rendered with `formatMoney`.
 *
 * Choosing a different file, or changing the account or the mapping, discards
 * the previous validation: the result no longer describes what would be sent.
 */

/** The server's cap, mirrored here only to avoid a pointless 5MB upload. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const STEPS = ["Upload", "Preview", "Map columns", "Validate & commit"] as const;

/** Radix `SelectItem` rejects `""`, so "unmapped" needs a sentinel value. */
const UNMAPPED = "__unmapped__";

/** A readable label for a snake_case map field, without hard-coding the list. */
function fieldLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Cells arrive as `unknown` — render them without assuming a type. */
function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function errorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ApiRequestError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return fallback;
}

export function FinanceImportPage() {
  useDocumentTitle("Import Transactions");

  const { user } = useAuth();
  const canWrite = user !== null && FINANCE_WRITE.includes(user.role);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Import Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Load a bank or ledger export into an account, after checking every row.
          </p>
        </div>
        <FinanceSubnav />
      </div>

      {canWrite ? <ImportWizard /> : <NoAccessNotice />}
    </div>
  );
}

/**
 * Rendered instead of the form for a read-only finance role. The import routes
 * are `requireRole(FINANCE_WRITE)` server-side, so showing the wizard would
 * only lead to a 403 after the operator had picked a file.
 */
function NoAccessNotice() {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <AlertTriangle className="h-7 w-7 text-status-amber" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">You do not have access to importing</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Importing transactions is limited to finance officers and finance managers. You can
            still read every imported transaction on the{" "}
            <Link to="/finance/transactions" className="underline underline-offset-4">
              Transactions
            </Link>{" "}
            page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportWizard() {
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [accountId, setAccountId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<ImportDryRunResult | null>(null);
  const [committed, setCommitted] = useState<ImportCommitResult | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const accounts = useQuery({
    queryKey: ["finance", "accounts"],
    queryFn: () => listAccounts(),
  });

  /** Anything that changes what would be sent invalidates the validation. */
  const discardValidation = () => {
    setDryRun(null);
    setCommitted(null);
    setStepError(null);
  };

  const restart = () => {
    setStep(0);
    setFile(null);
    setFileError(null);
    setPreview(null);
    setAccountId("");
    setMapping({});
    discardValidation();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runPreview = useMutation({
    mutationFn: (chosen: File) => previewImport(chosen),
    onSuccess(result) {
      setPreview(result);
      // Pre-fill any map field whose name matches a header outright; it saves
      // the common case without ever guessing at a near-match.
      const guessed: Record<string, string> = {};
      for (const field of result.map_fields) {
        const exact = result.headers.find(
          (header) => header.trim().toLowerCase() === field.toLowerCase(),
        );
        if (exact !== undefined) guessed[field] = exact;
      }
      setMapping(guessed);
      setStepError(null);
      setStep(1);
    },
    onError(caught) {
      setStepError(errorMessage(caught, "That file could not be read."));
    },
  });

  const validate = useMutation({
    mutationFn: ({ chosen, account }: { chosen: File; account: string }) =>
      // Always dry run first — the import is all-or-nothing.
      commitImport(chosen, account, mapping, true),
    onSuccess(result) {
      if (result.dry_run) {
        setDryRun(result);
        setCommitted(null);
        setStepError(null);
      }
    },
    onError(caught) {
      setDryRun(null);
      setStepError(errorMessage(caught, "Validation failed."));
    },
  });

  const commit = useMutation({
    mutationFn: ({ chosen, account }: { chosen: File; account: string }) =>
      commitImport(chosen, account, mapping, false),
    async onSuccess(result) {
      if (result.dry_run) return;
      setCommitted(result);
      setStepError(null);
      // The ledger moved: transactions, the cash position and everything
      // derived from them are now stale.
      await queryClient.invalidateQueries({ queryKey: ["finance"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["cash-position"] });
    },
    onError(caught) {
      setStepError(errorMessage(caught, "The import could not be committed."));
    },
  });

  const requiredFields = preview?.required_map_fields ?? [];
  const missingRequired = requiredFields.filter(
    (field) => (mapping[field] ?? "") === "",
  );
  const mappingComplete = missingRequired.length === 0 && accountId !== "";

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    setPreview(null);
    setMapping({});
    discardValidation();

    if (chosen === null) {
      setFile(null);
      setFileError(null);
      return;
    }

    if (chosen.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setFileError(
        `That file is ${formatBytes(chosen.size)}. The limit is 5 MB — split the export into smaller files and import them one at a time.`,
      );
      return;
    }

    setFile(chosen);
    setFileError(null);
  };

  return (
    <div className="space-y-6">
      <StepIndicator current={step} />

      <AllOrNothingNote />

      {stepError && (
        <p role="alert" className="rounded-xl bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {stepError}
        </p>
      )}

      {/* ---------------- Step 1 — Upload ---------------- */}
      {step === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 p-6">
            <div className="space-y-1.5">
              <Label htmlFor="import-file">Spreadsheet or CSV</Label>
              <Input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="rounded-xl"
                aria-invalid={fileError !== null}
                aria-describedby="import-file-hint"
                onChange={onFileChange}
              />
              <p id="import-file-hint" className="text-xs text-muted-foreground">
                .xlsx, .xls or .csv, up to 5 MB. Nothing is written at this step — the file is only
                read so you can map its columns.
              </p>
            </div>

            {fileError && (
              <p role="alert" className="text-sm text-status-red">
                {fileError}
              </p>
            )}

            {file && !fileError && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{file.name}</span> ·{" "}
                {formatBytes(file.size)}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                className="rounded-xl"
                disabled={file === null || runPreview.isPending}
                onClick={() => file && runPreview.mutate(file)}
              >
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                {runPreview.isPending ? "Reading…" : "Read file"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 2 — Preview ---------------- */}
      {step === 1 && preview && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{preview.filename}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {preview.row_count} data {preview.row_count === 1 ? "row" : "rows"} ·{" "}
                {formatBytes(preview.size_bytes)} · {preview.headers.length} columns. The first few
                rows are shown so you can confirm this is the right file.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.headers.map((header) => (
                      <TableHead key={header} className="whitespace-nowrap">
                        {header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.map((row, index) => (
                    <TableRow key={index}>
                      {preview.headers.map((header) => (
                        <TableCell key={header} className="whitespace-nowrap text-muted-foreground">
                          {renderCell(row[header])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {preview.sample.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(1, preview.headers.length)}
                        className="text-center text-muted-foreground"
                      >
                        The file has headers but no data rows.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" className="rounded-xl" onClick={restart}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Choose another file
              </Button>
              <Button
                className="rounded-xl"
                disabled={preview.row_count === 0}
                onClick={() => setStep(2)}
              >
                Map columns <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 3 — Map columns ---------------- */}
      {step === 2 && preview && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-5 p-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Map columns</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tell the importer which column in the file holds each field. Date, type and amount
                are required; the rest are optional and are left empty when unmapped.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-account">
                Target account <span className="text-status-red">*</span>
              </Label>
              {accounts.error ? (
                <QueryError
                  error={accounts.error}
                  onRetry={() => void accounts.refetch()}
                  resource="accounts"
                />
              ) : (
                <Select
                  value={accountId}
                  disabled={accounts.isPending}
                  onValueChange={(value) => {
                    setAccountId(value);
                    discardValidation();
                  }}
                >
                  <SelectTrigger id="import-account" className="rounded-xl">
                    <SelectValue
                      placeholder={accounts.isPending ? "Loading accounts…" : "Choose an account"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts.data ?? []).map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name} · {account.currency} ·{" "}
                        {formatMoney(account.current_balance, { currency: account.currency })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                Every row in this file is written to this one account.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {preview.map_fields.map((field) => {
                const required = preview.required_map_fields.includes(field);
                const value = mapping[field] ?? "";

                return (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={`map-${field}`}>
                      {fieldLabel(field)}
                      {required && <span className="ml-1 text-status-red">*</span>}
                    </Label>
                    <Select
                      value={value}
                      onValueChange={(chosen) => {
                        setMapping((current) => {
                          const next = { ...current };
                          // The sentinel means "leave this field unmapped";
                          // Radix forbids an empty-string item value.
                          if (chosen === UNMAPPED) delete next[field];
                          else next[field] = chosen;
                          return next;
                        });
                        discardValidation();
                      }}
                    >
                      <SelectTrigger
                        id={`map-${field}`}
                        className={cn(
                          "rounded-xl",
                          required && value === "" && "border-status-red",
                        )}
                      >
                        <SelectValue placeholder="Not mapped" />
                      </SelectTrigger>
                      <SelectContent>
                        {!required && <SelectItem value={UNMAPPED}>Not mapped</SelectItem>}
                        {preview.headers.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>

            {(missingRequired.length > 0 || accountId === "") && (
              <p className="text-sm text-status-amber">
                {accountId === "" && "Choose a target account. "}
                {missingRequired.length > 0 &&
                  `Still to map: ${missingRequired.map(fieldLabel).join(", ")}.`}
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" className="rounded-xl" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to preview
              </Button>
              <Button
                className="rounded-xl"
                disabled={!mappingComplete}
                onClick={() => {
                  setStep(3);
                  if (file) validate.mutate({ chosen: file, account: accountId });
                }}
              >
                Validate <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 4 — Validate & commit ---------------- */}
      {step === 3 && preview && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-5 p-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Validate &amp; commit</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every row is checked against the mapping before anything is written.
              </p>
            </div>

            {validate.isPending && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Checking {preview.row_count} rows…
              </p>
            )}

            {committed === null && dryRun && (
              <DryRunResult result={dryRun} />
            )}

            {committed && (
              <div className="space-y-3 rounded-xl bg-status-green/10 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-status-green">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Imported {committed.inserted}{" "}
                  {committed.inserted === 1 ? "transaction" : "transactions"}.
                </p>
                <p className="text-sm text-muted-foreground">
                  The account balance is now{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatMoney(committed.current_balance)}
                  </span>
                  .
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild className="rounded-xl">
                    <Link to="/finance/transactions">View transactions</Link>
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={restart}>
                    Import another file
                  </Button>
                </div>
              </div>
            )}

            {committed === null && (
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="outline" className="rounded-xl" onClick={() => setStep(2)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to mapping
                </Button>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    disabled={validate.isPending || file === null}
                    onClick={() => file && validate.mutate({ chosen: file, account: accountId })}
                  >
                    {validate.isPending ? "Checking…" : "Re-check"}
                  </Button>
                  <Button
                    className="rounded-xl"
                    // Enabled only on a clean dry run: one invalid row rejects
                    // the whole import, so there is nothing to gain by trying.
                    disabled={
                      dryRun === null ||
                      dryRun.invalid_count !== 0 ||
                      commit.isPending ||
                      file === null
                    }
                    onClick={() => file && commit.mutate({ chosen: file, account: accountId })}
                  >
                    {commit.isPending
                      ? "Importing…"
                      : `Import ${dryRun?.valid_count ?? 0} rows`}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DryRunResult({ result }: { result: ImportDryRunResult }) {
  const clean = result.invalid_count === 0;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl p-4",
          clean ? "bg-status-green/10" : "bg-status-red/10",
        )}
      >
        {clean ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-red" aria-hidden="true" />
        )}
        <div className="text-sm">
          <p className={cn("font-medium", clean ? "text-status-green" : "text-status-red")}>
            {clean
              ? `All ${result.valid_count} rows are valid.`
              : `${result.invalid_count} of ${result.valid_count + result.invalid_count} rows are invalid.`}
          </p>
          <p className="mt-1 text-muted-foreground">
            {clean
              ? "Nothing has been written yet. Importing will insert them all in one go."
              : "Nothing has been written. Fix these rows in the source file and upload it again — the import cannot proceed while any row is invalid."}
          </p>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Row</TableHead>
                <TableHead>Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.errors.map((row) => (
                <TableRow key={row.row}>
                  <TableCell className="tabular-nums font-medium text-foreground">
                    {row.row}
                  </TableCell>
                  <TableCell className="text-status-red">
                    <ul className="list-inside list-disc space-y-0.5">
                      {row.errors.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Stated on screen rather than only in the docs: an operator who does not know
 * the import is atomic will assume a partial write happened and go looking for
 * half their rows in the ledger.
 */
function AllOrNothingNote() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">This import is all or nothing.</span> If a
        single row fails validation, the entire file is rejected and nothing is written to the
        ledger — there is no partial import to clean up. Validate first, fix the source file, then
        import.
      </p>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Import steps">
      {STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";

        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm",
                state === "current" && "bg-foreground text-background font-medium",
                state === "done" && "bg-muted text-foreground",
                state === "todo" && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums",
                  state === "current"
                    ? "bg-background/20"
                    : state === "done"
                      ? "bg-status-green/20 text-status-green"
                      : "bg-muted",
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
