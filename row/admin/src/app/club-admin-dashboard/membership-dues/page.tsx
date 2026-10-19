"use client";

/**
 * Club Admin Dashboard › Club Dues tab
 * --------------------------------------------------------------------------
 * Layout (per user request 2026-06-22):
 *   1. SectionHeader (module name) — top-left
 *      Year dropdown — top-right; lists only years that HAVE dues data
 *      (data-only year filter, per [[feedback-year-dropdown-data-only]])
 *   2. 4 KPI cards — Total Amount / Collected / Pending / Collection Rate
 *      for the selected year
 *   3. Table — one row per dues record for that year (Sr.No., Year, Title,
 *      Paid, Unpaid, Members, Edit, View | Copy URL, Report, Report Link,
 *      GoogleSheet)
 *
 * Year change writes to ?yearId= via router.replace; the global cache
 * (ClubAdminDashboardCacheContext) is wired to useSearchParams("yearId"),
 * so changing the URL triggers a refetch of membershipDues and the KPI
 * row updates automatically. duesSetups (full multi-year list) is fetched
 * once and filtered client-side.
 *
 * No bulk email / search / filter pills here — those belong on
 * the dedicated /clubs/[id]/membership-dues/v2/[duesId]/members page.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Wallet, Pencil, FileSpreadsheet, Users, Plus,
  IndianRupee, BadgeCheck, AlertCircle, TrendingUp,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useAuth } from "@/contexts/AuthContext";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { getMembershipDuesList, exportMembershipDuesReport, getRotaryYears } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import SectionHeader from "@/components/dashboard/SectionHeader";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInr, fmtInrShort } from "@/components/dashboard/formatters";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";

interface DuesSetup {
  id: number;
  rotaryYear?: string;
  purpose?: string;
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  isActive: boolean;
  weblinkUrl?: string;
  googleSheetId?: string;
  createdDate: string;
}

interface RotaryYearOption {
  id: number;
  label: string;
}

export default function ClubAdminMembershipDuesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSuperAdmin } = useAuth();
  const { overview, membershipDues, status, yearId: cacheYearId } = useClubAdminCache();

  const [duesSetups, setDuesSetups] = useState<DuesSetup[]>([]);
  const [allYears, setAllYears] = useState<RotaryYearOption[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);
  // Per-row loader state — replaces the icon with a spinner while the row's
  // action is in flight (Members, Edit navigations + Report download).
  const [membersNavigatingId, setMembersNavigatingId] = useState<number | null>(null);
  const [reportDownloadingId, setReportDownloadingId] = useState<number | null>(null);
  const [editNavigatingId, setEditNavigatingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clubId = membershipDues?.club.clubId ?? overview?.club.clubId ?? null;
  const selectedYearLabel = membershipDues?.club.yearLabel ?? overview?.club.yearLabel ?? null;

  // Fetch the dues setups + the rotary-year master list in parallel. Both are
  // small lookup queries and only need to run once per club load — they don't
  // depend on yearId.
  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    setLoadingExtras(true);
    Promise.all([
      getMembershipDuesList({ clubId }).catch(() => [] as DuesSetup[]),
      getRotaryYears().catch(() => []),
    ])
      .then(([list, years]) => {
        if (cancelled) return;
        if (Array.isArray(list)) setDuesSetups(list as DuesSetup[]);
        if (Array.isArray(years)) {
          setAllYears(years.map((y: any) => ({ id: y.id, label: y.yearLabel })));
        }
      })
      .catch(() => setErrorMessage("Failed to load Club Dues"))
      .finally(() => { if (!cancelled) setLoadingExtras(false); });
    return () => { cancelled = true; };
  }, [clubId]);

  // Year dropdown options = only rotary years that actually have a dues
  // record for this club. Sorted DESC so most-recent year shows on top.
  // Matches the data-only year-filter rule [[feedback-year-dropdown-data-only]].
  const yearOptions = useMemo(() => {
    if (duesSetups.length === 0 || allYears.length === 0) return [] as RotaryYearOption[];
    const labelsWithData = new Set(
      duesSetups.map((d) => d.rotaryYear).filter((v): v is string => !!v),
    );
    return allYears
      .filter((y) => labelsWithData.has(y.label))
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [duesSetups, allYears]);

  // Dues for the currently-selected year — what the table renders.
  const currentYearDues = useMemo(() => {
    if (!selectedYearLabel) return [] as DuesSetup[];
    return duesSetups.filter((d) => d.rotaryYear === selectedYearLabel);
  }, [duesSetups, selectedYearLabel]);

  // yearId backing the dropdown <select>. Computed BEFORE any early-return so
  // hook count stays stable across renders (Rules of Hooks). Falls back to the
  // label→id lookup when the cache hasn't reported a yearId yet.
  const selectedYearId = useMemo(() => {
    if (cacheYearId) return cacheYearId;
    const match = allYears.find((y) => y.label === selectedYearLabel);
    return match?.id ?? 0;
  }, [cacheYearId, allYears, selectedYearLabel]);

  const handleYearChange = (newYearId: number) => {
    // Write to ?yearId= so the global ClubAdminDashboardCacheContext picks
    // up the change and refetches membershipDues — KPIs and yearLabel both
    // update without our page having to manage that state itself.
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("yearId", String(newYearId));
    router.replace(`/club-admin-dashboard/membership-dues?${sp.toString()}`);
  };

  const handleCopyUrl = (item: DuesSetup) => {
    const url = `${window.location.origin}/pay/dues/${item.id}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("URL copied to clipboard.");
  };

  const handleDownloadReport = async (item: DuesSetup) => {
    if (reportDownloadingId !== null) return;
    setReportDownloadingId(item.id);
    try {
      const blob = await exportMembershipDuesReport(item.id);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `membership-dues-${item.id}_${fileTimestamp()}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Failed to download report.");
    } finally {
      setReportDownloadingId(null);
    }
  };

  if (status === "loading" && !membershipDues && !overview) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading Club Dues…" />
      </div>
    );
  }

  if (!clubId) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Unable to resolve club id.
      </div>
    );
  }

  // KPI numbers from the cache (already scoped to the selected yearId).
  // members.length + all counts EXCLUDE honoraries — backend filters them out
  // and reports HonoraryCount separately (shown as a small chip in the "Total
  // Amount" subtitle so admins see the roster size without confusion).
  const totalMembers = membershipDues?.members.length ?? 0;
  const honoraryCount = membershipDues?.honoraryCount ?? 0;
  const paidCount = membershipDues?.paidCount ?? 0;
  const partialCount = membershipDues?.partialCount ?? 0;
  const unpaidCount = membershipDues?.unpaidCount ?? 0;

  // Read totalDue/totalCollected straight from the API response
  // (ClubAdminDashboardService.GetPaymentsAsync) instead of recomputing
  // client-side — the mobile app reads these exact same fields from the same
  // endpoint, so this guarantees web and mobile can never diverge.
  const totalDue = Number(membershipDues?.totalDue ?? 0);
  const totalCollected = Number(membershipDues?.totalCollected ?? 0);
  const pendingAmount = Math.max(0, totalDue - totalCollected);

  // Pending = members who've paid NOTHING toward their fees. Members who've
  // paid something (fully or partially) already count toward Collected below
  // — counting partials in both places would double-count them across the
  // two tiles.
  const pendingCount = unpaidCount;
  // Collected = base amount × fully-paid members, so the subtitle count must
  // match: only paidCount, not partials (partial payments contribute to
  // neither this dollar figure nor this member count).
  const collectedByCount = paidCount;
  const collectionPct = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0;

  return (
    <div className="space-y-6">
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      {/* Header + year selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          title="Club Dues"
          subtitle={selectedYearLabel ? `Rotary Year ${selectedYearLabel}` : "Rotary Year"}
          icon={Wallet}
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Local year dropdown removed — the global rotary-year selector in
              the Club Admin Shell drives ?yearId= for every page, and
              ClubAdminDashboardCacheContext refetches membershipDues whenever
              that URL param changes. Filter below keys off the cached
              membershipDues.club.yearLabel which is always in sync. */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => router.push("/settings/membership-dues/create")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={13} /> Create Dues Setup
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Amount"
          value={fmtInr(totalDue)}
          subtitle={
            `from ${totalMembers} member${totalMembers === 1 ? "" : "s"}` +
            (honoraryCount > 0 ? ` (excludes ${honoraryCount} honorary)` : "")
          }
          icon={IndianRupee}
          color="gold"
        />
        <KpiCard
          title="Collected"
          value={fmtInr(totalCollected)}
          subtitle={`from ${collectedByCount} member${collectedByCount === 1 ? "" : "s"}`}
          icon={BadgeCheck}
          color="green"
        />
        <KpiCard
          title="Pending"
          value={fmtInr(pendingAmount)}
          subtitle={`from ${pendingCount} member${pendingCount === 1 ? "" : "s"}`}
          icon={AlertCircle}
          color="red"
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <TrendingUp size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Collection Rate</p>
              <p className="mt-0.5 text-xl font-bold leading-tight tabular-nums text-slate-800">
                {collectedByCount} of {totalMembers} <span className="text-blue-600">({collectionPct}%)</span>
              </p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${collectionPct}%`, background: "#0067C8" }}
            />
          </div>
        </div>
      </div>

      {/* Dues records table — new-design styling: slate-50 header, light rows */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold w-[60px]">Sr. No.</th>
                <th className="px-3 py-2.5 text-left font-semibold">Year</th>
                <th className="px-3 py-2.5 text-left font-semibold">Title</th>
                <th className="px-3 py-2.5 text-center font-semibold">Paid</th>
                <th className="px-3 py-2.5 text-center font-semibold">Unpaid</th>
                <th className="px-3 py-2.5 text-center font-semibold">Members</th>
                <th className="px-3 py-2.5 text-center font-semibold">Edit</th>
                <th className="px-3 py-2.5 text-center font-semibold">View | Copy URL</th>
                <th className="px-3 py-2.5 text-center font-semibold">Report</th>
                <th className="px-3 py-2.5 text-center font-semibold">Report Link</th>
                <th className="px-3 py-2.5 text-center font-semibold">GoogleSheet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingExtras && currentYearDues.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center">
                    <RotaryLoader size="md" />
                  </td>
                </tr>
              ) : currentYearDues.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                    No Club Dues configured for {selectedYearLabel ?? "the current year"} yet.
                  </td>
                </tr>
              ) : currentYearDues.map((item, index) => (
                <tr key={item.id} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2.5 text-center text-slate-600">{index + 1}</td>
                  <td className="px-3 py-2.5 text-slate-700">{item.rotaryYear ?? ""}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{item.purpose ?? ""}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-emerald-700">{item.paidCount}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-rose-700">{item.unpaidCount}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      title="Open members list"
                      disabled={membersNavigatingId === item.id}
                      onClick={() => {
                        if (membersNavigatingId !== null) return;
                        setMembersNavigatingId(item.id);
                        // Preserve ?yearId= in returnTo so the dashboard cache
                        // sees the same yearId on return and skips a refetch
                        // (otherwise we'd see two "Loading…" flashes).
                        const back = selectedYearId
                          ? `/club-admin-dashboard/membership-dues?yearId=${selectedYearId}`
                          : `/club-admin-dashboard/membership-dues`;
                        const returnTo = encodeURIComponent(back);
                        router.push(`/clubs/${clubId}/membership-dues/v2/${item.id}/members?returnTo=${returnTo}`);
                      }}
                      className="inline-flex items-center justify-center disabled:opacity-60"
                    >
                      {membersNavigatingId === item.id ? (
                        <RotaryLoader size="sm" />
                      ) : (
                        <Users className="h-4 w-4 text-blue-600 hover:text-blue-800" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      title="Edit dues setup"
                      disabled={editNavigatingId === item.id}
                      onClick={() => {
                        if (editNavigatingId !== null) return;
                        setEditNavigatingId(item.id);
                        const back = selectedYearId
                          ? `/club-admin-dashboard/membership-dues?yearId=${selectedYearId}`
                          : `/club-admin-dashboard/membership-dues`;
                        const returnTo = encodeURIComponent(back);
                        router.push(`/clubs/${clubId}/membership-dues/v2/edit/${item.id}?returnTo=${returnTo}`);
                      }}
                      className="inline-flex items-center justify-center disabled:opacity-60"
                    >
                      {editNavigatingId === item.id ? (
                        <RotaryLoader size="sm" />
                      ) : (
                        <Pencil className="h-4 w-4 text-blue-600 hover:text-blue-800" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => window.open(`/pay/dues/${item.id}`, "_blank")}
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(item)}
                        className="text-blue-600 hover:underline"
                      >
                        Copy URL
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      title="Download CSV report"
                      disabled={reportDownloadingId === item.id}
                      onClick={() => handleDownloadReport(item)}
                      className="inline-flex items-center justify-center disabled:opacity-60"
                    >
                      {reportDownloadingId === item.id ? (
                        <RotaryLoader size="sm" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4 text-rose-600 hover:text-rose-800" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}/report/dues/${item.id}`;
                        navigator.clipboard.writeText(url);
                        setSuccessMessage("Report link copied.");
                      }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Copy URL
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {item.googleSheetId ? (
                      <div className="flex flex-col items-center gap-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}
                          className="text-blue-600 hover:underline"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`);
                            setSuccessMessage("Google Sheet URL copied.");
                          }}
                          className="text-blue-600 hover:underline"
                        >
                          Copy URL
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400">, </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
