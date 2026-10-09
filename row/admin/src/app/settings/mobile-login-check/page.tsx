"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Smartphone, Search, CheckCircle2, XCircle, AlertCircle, Loader2, User } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { checkMobileLogin, type MobileLoginCheckResult } from "@/services/api";

export default function MobileLoginCheckPage() {
  const { isSuperAdmin } = useAuth();
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MobileLoginCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access Mobile Login Check.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const onCheck = async () => {
    const trimmed = mobile.trim();
    if (!trimmed) {
      setError("Enter a mobile number.");
      setResult(null);
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const data = await checkMobileLogin(trimmed);
      setResult(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Check failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="container mx-auto p-6 max-w-3xl">
        {/* Back link */}
        <div className="mb-4">
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to Settings
            </Button>
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Mobile Login Check</h1>
            <p className="text-sm text-muted-foreground">
              Enter a mobile number to preview what the mobile app would show on login. No OTP is sent.
            </p>
          </div>
        </div>

        {/* Search card */}
        <Card className="mb-4">
          <CardContent className="p-5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Mobile Number
            </label>
            <div className="flex gap-2 mt-2">
              <Input
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="e.g. 9821130855"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCheck();
                }}
                disabled={loading}
                className="flex-1"
              />
              <Button onClick={onCheck} disabled={loading} className="gap-2 min-w-[120px]">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" /> Check
                  </>
                )}
              </Button>
            </div>
            {error && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Result card */}
        {result && (
          <Card>
            <CardContent className="p-5">
              {/* Verdict banner */}
              <div
                className={`rounded-lg border px-4 py-3 mb-4 flex items-start gap-3 ${
                  result.allowed
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {result.allowed ? (
                  <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <div className="font-semibold">
                    {result.allowed
                      ? "Allowed — mobile login would proceed"
                      : "Not allowed — mobile login would be blocked"}
                  </div>
                  {result.reason && (
                    <div className="text-sm mt-1 opacity-90">{result.reason}</div>
                  )}
                </div>
              </div>

              {/* Member info */}
              {result.member ? (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Member
                  </div>
                  <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <User className="h-4 w-4 mt-1 text-slate-500" />
                    <div className="flex-1">
                      <div className="font-medium text-slate-800">{result.member.name}</div>
                      <div className="text-xs text-slate-500">
                        Member ID: {result.member.id}
                        {result.member.email ? ` · ${result.member.email}` : ""}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500 italic">No member record matched.</div>
              )}

              {/* Club list */}
              {result.member && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Clubs visible on mobile app ({result.clubs.length})
                  </div>
                  {result.clubs.length === 0 ? (
                    <div className="text-sm text-slate-500 italic">
                      No active clubs assigned to this member (cannot login on mobile).
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Club</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Code</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">District</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Zone</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {result.clubs.map((c) => (
                            <tr key={c.clubId} className="hover:bg-blue-50/40">
                              <td className="px-3 py-2 font-medium text-slate-800">
                                {c.clubName}{" "}
                                <span className="text-xs text-slate-400">#{c.clubId}</span>
                              </td>
                              <td className="px-3 py-2 text-slate-700">{c.clubCode ?? "—"}</td>
                              <td className="px-3 py-2 text-slate-700">
                                {c.districtNumber ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{c.zoneName ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  );
}
