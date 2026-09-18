"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsdCompact } from "@/lib/utils";
import type { CashPositionByCurrency } from "@/lib/finance/balances";

/**
 * Deliberate, narrow exception to "no client-side fetching of sensitive
 * tables": the initial render comes entirely from the server (see
 * `initialData` below, computed server-side in finance/page.tsx). This
 * component only re-queries when Supabase Realtime tells it
 * finance_accounts changed, and that realtime subscription — like every
 * other Supabase client call — runs through the signed-in browser session
 * and is subject to the same RLS policies as any other read. A viewer's
 * browser client cannot subscribe to rows it isn't allowed to SELECT.
 */
export function CashPositionPanel({ initialData }: { initialData: CashPositionByCurrency[] }) {
  const [positions, setPositions] = useState(initialData);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function refetch() {
      const { data: accounts } = await supabase
        .from("finance_accounts")
        .select("id, name, type, currency, current_balance")
        .eq("is_active", true)
        .order("currency")
        .order("name");

      const byCurrency = new Map<string, CashPositionByCurrency>();
      for (const acc of (accounts ?? []) as Array<{
        id: string;
        name: string;
        type: string;
        currency: string;
        current_balance: number;
      }>) {
        const bucket = byCurrency.get(acc.currency) ?? { currency: acc.currency, totalBalance: 0, accounts: [] };
        bucket.totalBalance += Number(acc.current_balance);
        bucket.accounts.push({ id: acc.id, name: acc.name, type: acc.type, currentBalance: Number(acc.current_balance) });
        byCurrency.set(acc.currency, bucket);
      }
      setPositions(Array.from(byCurrency.values()));
      setLastUpdated(new Date());
    }

    const channel = supabase
      .channel("finance-accounts-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "finance_accounts" }, () => {
        refetch();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <Card className="rounded-2xl border-teal/30">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif text-lg text-navy">Cash Position</CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-status-green">
          <span className="h-1.5 w-1.5 rounded-full bg-status-green" />
          Live
        </span>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active accounts yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {positions.map((p) => (
              <div key={p.currency} className="rounded-xl border border-border/60 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-steel">{p.currency}</p>
                <p className="mt-1 font-serif text-2xl font-semibold text-navy">{formatUsdCompact(p.totalBalance)}</p>
                <div className="mt-2 space-y-1">
                  {p.accounts.map((a) => (
                    <div key={a.id} className="flex justify-between text-xs text-muted-foreground">
                      <span>{a.name}</span>
                      <span>{formatUsdCompact(a.currentBalance)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {lastUpdated && (
          <p className="mt-3 text-right text-xs text-muted-foreground">Updated {lastUpdated.toLocaleTimeString()}</p>
        )}
      </CardContent>
    </Card>
  );
}
