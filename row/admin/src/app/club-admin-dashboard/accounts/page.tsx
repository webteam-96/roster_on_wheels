"use client";

/**
 * Club Admin Dashboard › Accounts (gap agent 2026-11-19, api/clubs/{id}/accounts). The club's books: bank balances
 * and quick money in / out for the treasurer, the double-entry journal (posted entries are reversed, never edited),
 * the chart of accounts, payees with payment vouchers, bank reconciliation, and the reports (profit and loss, balance
 * sheet, budget against actual, dues owed by age) with CSV, Excel and PDF downloads. Paid membership dues post themselves.
 */

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import { getClubAccounts, getClubAccountsSummary, getClubVendors, type ClubAccount, type ClubAccountsSummary, type ClubVendor } from "@/services/api";
import { ChartTab, EntryTable, JournalTab, QuickEntry, ReportsTab, errorText } from "@/components/club-accounts/AccountsParts";
import { ReconcileTab, VendorsTab } from "@/components/club-accounts/AccountsParts2";

export default function ClubAccountsPage() {
  const { selectedClubId: clubId } = useAuth();
  const fmt = useFormat();
  const [summary, setSummary] = useState<ClubAccountsSummary | null>(null);
  const [accounts, setAccounts] = useState<ClubAccount[] | null>(null);
  const [vendors, setVendors] = useState<ClubVendor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!clubId) return;
    Promise.all([getClubAccountsSummary(clubId), getClubAccounts(clubId), getClubVendors(clubId)])
      .then(([s, a, v]) => { setSummary(s); setAccounts(a); setVendors(v); setLoadError(null); })
      .catch((err) => setLoadError(errorText(err, "Could not load the club's accounts.")));
  }, [clubId]);

  useEffect(() => { setSummary(null); setAccounts(null); setVendors(null); reload(); }, [reload]);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Accounts</h2>
        <p className="text-base text-muted-foreground">
          The club's books in double entry. Paid membership dues are posted for you. A posted entry is never changed: reverse it and post it again.
        </p>
      </div>

      {loadError ? (
        <Card><CardContent className="p-5 text-sm text-destructive">{loadError}</CardContent></Card>
      ) : !summary || !accounts || !vendors ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <TableSkeleton rows={5} />
        </div>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="journal">Journal</TabsTrigger>
            <TabsTrigger value="reconcile">Reconcile</TabsTrigger>
            <TabsTrigger value="payees">Payees</TabsTrigger>
            <TabsTrigger value="chart">Chart of accounts</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {summary.banks.map((b) => (
                <div key={b.id} className="rounded-md border bg-card p-4">
                  <p className="text-sm text-muted-foreground">{b.name}{b.accountLast4 ? ` ending ${b.accountLast4}` : ""}</p>
                  <p className="text-xl font-semibold tabular-nums">{fmt.money(b.balance)}</p>
                </div>
              ))}
              <div className="rounded-md border bg-card p-4">
                <p className="text-sm text-muted-foreground">
                  {summary.yearLabel ? `Surplus in ${summary.yearLabel}` : "Surplus this year"}
                </p>
                <p className={`text-xl font-semibold tabular-nums ${summary.yearNet < 0 ? "text-destructive" : ""}`}>{fmt.money(summary.yearNet)}</p>
                <p className="text-xs text-muted-foreground">
                  In {fmt.money(summary.yearIncome)}, out {fmt.money(summary.yearExpenses)}
                </p>
              </div>
            </section>
            <QuickEntry clubId={clubId} accounts={accounts} vendors={vendors} onSaved={reload} onError={setError} />
            <section className="space-y-3">
              <h3 className="text-lg font-semibold">Latest entries</h3>
              {summary.recent.length === 0 ? (
                <Card><CardContent className="p-5 text-sm text-muted-foreground">Nothing posted yet. Record money in or out above, or post an opening balance in the Journal tab.</CardContent></Card>
              ) : (
                <EntryTable entries={summary.recent}
                  voucher={{ clubId, assetIds: new Set(accounts.filter((a) => a.type === "asset").map((a) => a.id)), onError: setError }} />
              )}
            </section>
          </TabsContent>

          <TabsContent value="journal">
            <JournalTab clubId={clubId} accounts={accounts} onChanged={reload} onError={setError} />
          </TabsContent>

          <TabsContent value="reconcile">
            <ReconcileTab clubId={clubId} accounts={accounts} onError={setError} />
          </TabsContent>

          <TabsContent value="payees">
            <VendorsTab clubId={clubId} vendors={vendors} onChanged={reload} onError={setError} />
          </TabsContent>

          <TabsContent value="chart">
            <ChartTab clubId={clubId} accounts={accounts} onChanged={reload} onError={setError} />
          </TabsContent>

          <TabsContent value="reports">
            <ReportsTab clubId={clubId} accounts={accounts} onError={setError} />
          </TabsContent>
        </Tabs>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
