"use client";

/**
 * SuperAdmin › Settings › Currency.
 * --------------------------------------------------------------------------
 * Sets each district's default currency (INR/LKR/NPR/USD) — pre-selected on the
 * currency dropdown when a club in that district adds a project, and overridable
 * per-project either way. Every district defaults to INR until a SuperAdmin changes it.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BadgeDollarSign, Check, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { getDistricts, updateDistrictDefaultCurrency } from "@/services/api";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { DistrictListItem } from "@/types/district";

export default function CurrencySettingsPage() {
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<DistrictListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDistricts(1, 9999, search.trim() || undefined, 1);
      setRows((res.items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
    } catch {
      setErrorMessage("Could not load districts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (district: DistrictListItem, currency: string) => {
    setRows((prev) => prev.map((r) => (r.id === district.id ? { ...r, defaultCurrency: currency } : r)));
    setSavingId(district.id);
    try {
      await updateDistrictDefaultCurrency(district.id, currency);
      setSavedId(district.id);
      setTimeout(() => setSavedId((id) => (id === district.id ? null : id)), 1500);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save currency.");
      // Revert on failure
      setRows((prev) => prev.map((r) => (r.id === district.id ? { ...r, defaultCurrency: district.defaultCurrency } : r)));
    } finally {
      setSavingId(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BadgeDollarSign className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Currency</h2>
              <p className="text-muted-foreground text-base">Set each district&apos;s default currency for project-add forms</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search district number…" className="pl-8" />
        </div>

        {loading ? (
          <RotaryLoader />
        ) : (
          <div className="overflow-x-auto border rounded-lg bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">District</th>
                  <th className="px-4 py-2.5 text-left">Zone</th>
                  <th className="px-4 py-2.5 text-left">Country</th>
                  <th className="px-4 py-2.5 text-left w-56">Default Currency</th>
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-blue-50/40">
                    <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">District {d.districtNumber}</td>
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{d.zoneName || "—"}</td>
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{d.country || "—"}</td>
                    <td className="px-4 py-2">
                      <select
                        value={d.defaultCurrency || "INR"}
                        onChange={(e) => handleChange(d, e.target.value)}
                        disabled={savingId === d.id}
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
                      >
                        {CURRENCY_OPTIONS.map((c) => (
                          <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {savingId === d.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                      {savedId === d.id && <Check className="h-4 w-4 text-emerald-600" />}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No districts found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
