"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

import { useState, type FormEvent } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, PageHeader, Panel, SkeletonRows, rowTable } from "@/components/row/AppKit";
import { CheckCircle2, Loader2, Search, XCircle } from "@/components/icons";
import { checkMobileLogin, type MobileLoginCheckResult } from "@/services/api";

export default function AppSignInCheckPage() {
  return (
    <ProtectedRoute requireSuperAdmin>
      <AppSignInCheck />
    </ProtectedRoute>
  );
}

/** Would this member get into the app, and which clubs would they see? ROW signs in by email. */
function AppSignInCheck() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MobileLoginCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      setResult(await checkMobileLogin(trimmed));
    } catch (err: any) {
      setError(err?.response?.data?.message || "The check did not run.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        back="/settings"
        title="App Sign-in Check"
        description="Enter a member's email to see if they can sign in to the app, and why not. Nothing is sent to them."
      />

      <Panel title="Member">
        <form onSubmit={check} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="check-email">Email</Label>
            <Input
              id="check-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.org"
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading || !email.trim()} className="sm:min-w-[128px]">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="mr-2 h-4 w-4" aria-hidden />
            )}
            Check
          </Button>
        </form>
      </Panel>

      {error && <ErrorState message={error} onRetry={() => check()} retryLabel="Try again" />}
      {loading && <SkeletonRows rows={3} />}

      {result && (
        <div className="space-y-4" aria-live="polite">
          <section
            className={`row-rise flex items-start gap-3 rounded-xl border px-6 py-5 ${
              result.allowed
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {result.allowed ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              <h2 className="row-h2">
                {result.allowed ? "Can sign in" : "Cannot sign in"}
              </h2>
              <p className="mt-1 text-[14px]">{result.reason ?? "The right password opens the app with the clubs below."}</p>
              {result.member && (
                <p className="mt-2 break-words text-[14px]">
                  <span className="font-semibold">{result.member.name}</span>
                  {result.member.email ? `, ${result.member.email}` : ""} (member {result.member.id})
                </p>
              )}
            </div>
          </section>

          {result.clubs.length > 0 && (
            <section className="row-card row-rise overflow-hidden">
              <h2 className="row-h2 px-6 pb-3 pt-5">
                Clubs in the app ({result.clubs.length})
              </h2>
              <div className={rowTable.wrap}>
                <Table className={`${rowTable.table} w-full`}>
                  <TableHeader className={rowTable.head}>
                    <TableRow>
                      <TableHead className={rowTable.th}>Club</TableHead>
                      <TableHead className={rowTable.th}>District</TableHead>
                      <TableHead className={rowTable.th}>Zone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={rowTable.body}>
                    {result.clubs.map((c) => (
                      <TableRow key={c.clubId} className={rowTable.tr}>
                        <TableCell className={rowTable.td}>{c.clubName}</TableCell>
                        <TableCell className={rowTable.tdMuted}>{c.districtNumber ?? "–"}</TableCell>
                        <TableCell className={rowTable.tdMuted}>{c.zoneName ?? "–"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
