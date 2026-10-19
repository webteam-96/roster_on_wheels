"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Building2, Users, Download, Loader2, Copy } from "@/components/icons";
import { getRotaryOrgSyncSummary, downloadClubSyncReport, getDuplicateCount, getClubSyncDistricts } from "@/services/api";

import { appLocale } from "@/lib/appFormat";
export default function RotaryOrgPage() {
  const { isSuperAdmin } = useAuth();
  const [summary, setSummary] = useState<{
    syncClubs: number; nonSyncClubs: number; totalMembers: number;
    countryBreakdown?: { country: string; syncClubs: number; nonSyncClubs: number }[];
  } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [dupCount, setDupCount] = useState<{ total: number; mobile: number; email: number; both: number } | null>(null);
  const [syncDistricts, setSyncDistricts] = useState<{ id: number; districtNumber: string; zoneName: string | null }[]>([]);
  const [selectedSyncDistrict, setSelectedSyncDistrict] = useState<string>("all"); // "all" or a district id

  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      try {
        setSummary(await getRotaryOrgSyncSummary());
      } catch {
        /* leave counts blank on failure — the cards still work as navigation */
      } finally {
        setLoadingSummary(false);
      }
    })();
    getDuplicateCount().then(setDupCount).catch(() => { /* count is best-effort */ });
    getClubSyncDistricts().then(setSyncDistricts).catch(() => { /* dropdown is best-effort */ });
  }, [isSuperAdmin]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      if (selectedSyncDistrict === "all") {
        await downloadClubSyncReport();
      } else {
        const d = syncDistricts.find((x) => String(x.id) === selectedSyncDistrict);
        await downloadClubSyncReport(Number(selectedSyncDistrict), d?.districtNumber);
      }
    } catch {
      setDownloadError("Failed to download report.");
    } finally {
      setDownloading(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const fmt = (n: number | undefined) => (n == null ? "–" : n.toLocaleString(appLocale()));

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Rotary.org Manual Sync</h2>
            <p className="text-muted-foreground text-base">Side-by-side comparison and manual sync: auto sync runs daily, this is for one-off corrections</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-5xl">
          {/* Club Sync */}
          <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <Link href="/settings/rotary-org/clubs" className="flex flex-col items-center gap-3 cursor-pointer">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Building2 className="h-7 w-7" />
                </div>
                <h3 className="text-lg font-semibold text-primary">Club Sync</h3>
                <p className="text-sm text-muted-foreground">Compare and manually sync clubs between ROW and Rotary.org by district</p>
              </Link>

              {/* Counts */}
              <div className="flex items-center justify-center gap-2 w-full mt-1">
                <div className="flex-1 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <div className="text-xs text-green-700">Synced Clubs</div>
                  <div className="text-lg font-bold text-green-800">
                    {loadingSummary ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : fmt(summary?.syncClubs)}
                  </div>
                </div>
                <div className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="text-xs text-amber-700">Non-Sync Clubs</div>
                  <div className="text-lg font-bold text-amber-800">
                    {loadingSummary ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : fmt(summary?.nonSyncClubs)}
                  </div>
                </div>
              </div>

              {/* District scope for the download — "All Districts" or a single one. */}
              <select
                value={selectedSyncDistrict}
                onChange={(e) => setSelectedSyncDistrict(e.target.value)}
                className="w-full mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                aria-label="District for the club sync report"
              >
                <option value="all">All Districts</option>
                {syncDistricts.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.districtNumber}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading} className="mt-1">
                {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                {downloading ? "Preparing…" : "Download Excel Report"}
              </Button>
              {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
            </CardContent>
          </Card>

          {/* Member Sync */}
          <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <Link href="/settings/rotary-org/members" className="flex flex-col items-center gap-3 cursor-pointer">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="h-7 w-7" />
                </div>
                <h3 className="text-lg font-semibold text-primary">Member Sync</h3>
                <p className="text-sm text-muted-foreground">Compare and manually sync members between ROW and Rotary.org by club</p>
              </Link>

              <div className="w-full mt-1">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <div className="text-xs text-blue-700">Total Members</div>
                  <div className="text-lg font-bold text-blue-800">
                    {loadingSummary ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : fmt(summary?.totalMembers)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Duplicate Mobile / Email — grouped with Member Sync since it resolves member mobile/email
              collisions. Merge true duplicates or "keep both" for shared contacts. */}
          <Link href="/settings/rotary-org/duplicates" className="block h-full">
            <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md cursor-pointer">
              <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <Copy className="h-7 w-7" />
                </div>
                <h3 className="text-lg font-semibold text-primary">Duplicate Mobile / Email</h3>
                <p className="text-sm text-muted-foreground">Members sharing a mobile or email (one holds it as primary, the other as secondary): compare side-by-side, then merge or keep both.</p>
                {dupCount && (
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                    <span className="rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-2.5 py-0.5">{dupCount.total.toLocaleString(appLocale())} to review</span>
                    <span className="rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-xs px-2.5 py-0.5">Mobile {dupCount.mobile}</span>
                    <span className="rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-xs px-2.5 py-0.5">Email {dupCount.email}</span>
                    <span className="rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-xs px-2.5 py-0.5">Both {dupCount.both}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Club Sync by region — India / Nepal / Sri Lanka / Other Zones (excludes the 3 special
            districts + Zone 0, same as the totals above). */}
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            <h3 className="text-base font-semibold text-primary mb-1">Club Sync by Region</h3>
            <p className="text-xs text-muted-foreground mb-4">Synced vs non-synced clubs per region (excludes the 3 manually-managed districts and Zone 0).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Region</th>
                    <th className="py-2 px-4 font-medium text-right">Synced Clubs</th>
                    <th className="py-2 pl-4 font-medium text-right">Non-Sync Clubs</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingSummary ? (
                    <tr><td colSpan={3} className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></td></tr>
                  ) : (summary?.countryBreakdown ?? []).map((row) => (
                    <tr key={row.country} className="border-b">
                      <td className="py-2 pr-4 font-medium">{row.country}</td>
                      <td className="py-2 px-4 text-right font-semibold text-green-700">{fmt(row.syncClubs)}</td>
                      <td className="py-2 pl-4 text-right font-semibold text-amber-700">{fmt(row.nonSyncClubs)}</td>
                    </tr>
                  ))}
                </tbody>
                {!loadingSummary && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50">
                      <td className="py-2 pr-4 font-bold">Total</td>
                      <td className="py-2 px-4 text-right font-bold text-green-800">{fmt(summary?.syncClubs)}</td>
                      <td className="py-2 pl-4 text-right font-bold text-amber-800">{fmt(summary?.nonSyncClubs)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
