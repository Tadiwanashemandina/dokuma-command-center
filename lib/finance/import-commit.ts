import { createServiceRoleClient } from "@/lib/supabase/server";
import type { ImportedRow } from "./import";

/** Split out of import.ts because this is the only function in the Excel
 * import path that needs the service-role client (which transitively pulls
 * in next/headers) — keeping it separate means the client-side import
 * wizard can safely import types/constants from import.ts without Next.js
 * trying to bundle server-only code into the browser. */
export async function commitImport(accountId: string, validRows: ImportedRow[], actorId: string, filename: string) {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("finance_transactions").insert(
    validRows.map((r) => ({
      account_id: accountId,
      date: r.date,
      type: r.type,
      amount: r.amount,
      category: r.category ?? null,
      counterparty: r.counterparty ?? null,
      description: r.description ?? null,
      reference_no: r.reference_no ?? null,
      is_dlap: r.is_dlap,
      dlap_share_pct: r.dlap_share_pct ?? null,
      source: "excel-import" as const,
      created_by: actorId,
    }))
  );
  if (error) throw new Error(`commitImport failed: ${error.message}`);

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: "finance_import",
    entity_type: "finance_transactions",
    entity_id: null,
    metadata: { filename, row_count: validRows.length, account_id: accountId },
  });
}
