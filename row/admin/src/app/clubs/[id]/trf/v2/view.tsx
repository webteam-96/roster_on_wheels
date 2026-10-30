"use client";

/**
 * TRF Contributions v2 — embeddable listing view.
 *
 * Named export used inline by the Club Admin Foundation page (embedded) AND by the
 * route page.tsx (standalone, wrapped in ClubAdminShell). Data flows through the v1
 * API surface (getTrfContributions / getTrfFunds / getTrfYears). Amounts are
 * USD (no currency conversion). Add / Edit route to the shared v2 add/edit form with a
 * returnTo = the current page URL, so after save the user comes back to wherever they
 * are (Foundation tab when embedded, the standalone TRF page otherwise). CMR round-trips
 * (?from=cmr&yearId=&month=) still work when this view is on the standalone route.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  DollarSign, TrendingUp, Heart, Award, Globe, Loader2, Search, Plus, Edit3, Trash2,
  ArrowLeft, AlertTriangle,
} from "@/components/icons";
import {
  getClub,
  getTrfYears,
  getTrfFunds,
  getTrfContributions,
  deleteTrfContribution,
} from "@/services/api";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { TrfContribution, TrfFund } from "@/types/trfContribution";
import { ReportYear } from "@/types/clubMonthlyReport";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtDate, ROTARY_BLUE } from "@/components/dashboard/formatters";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { SkeletonRows } from "@/components/row/AppKit";

function fundChipStyle(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("annual"))    return "bg-blue-50 text-blue-700 border-blue-200";
  if (n.includes("polio"))     return "bg-violet-50 text-violet-700 border-violet-200";
  if (n.includes("endowment")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (n.includes("other"))     return "bg-slate-50 text-slate-700 border-slate-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function fmtUsd(n: number): string {
  return "$" + (n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function TrfV2View({ clubId: propClubId, embedded = false, yearId: globalYearId = null }: { clubId?: number; embedded?: boolean; yearId?: number | null } = {}) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);

  // CMR round-trip context (standalone route only): ?from=cmr freezes the year and
  // (optionally) month so the entry maps back into the same monthly-report cell.
  const fromParam = searchParams.get("from");
  const yearIdParam = searchParams.get("yearId");
  const monthParam = searchParams.get("month");
  const isFromCmrMonth = fromParam === "cmr" && !!yearIdParam && !!monthParam;
  const isFrozenYear = fromParam === "cmr" && !!yearIdParam;

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const cmrOn = useFeatureLoadedOn("club_monthly_report");
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [funds, setFunds] = useState<TrfFund[]>([]);
  const [contributions, setContributions] = useState<TrfContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const [deleteTarget, setDeleteTarget] = useState<TrfContribution | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // returnTo for the add/edit links — the CURRENT page URL. Embedded on the Foundation
  // tab → returns to Foundation; on the standalone route → returns here (with ?from=cmr).
  const returnTo = typeof window !== "undefined"
    ? encodeURIComponent(window.location.pathname + window.location.search)
    : encodeURIComponent(`/clubs/${clubId}/trf/v2`);

  const cmrQuery = isFromCmrMonth
    ? `&from=cmr&yearId=${yearIdParam}&month=${monthParam}`
    : "";
  const addUrl = `/clubs/${clubId}/trf/v2/add?returnTo=${returnTo}${cmrQuery}`;

  // Back link (standalone only): CMR-with-month → wizard step, CMR-only → CMR landing,
  // otherwise → club dashboard.
  const backUrl = isFromCmrMonth
    ? `/clubs/${clubId}/club-monthly-report/${yearIdParam}/${monthParam}?step=trf`
    : fromParam === "cmr"
      ? `/clubs/${clubId}/club-monthly-report`
      : `/clubs/${clubId}/dashboard`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, yearsData, fundsData] = await Promise.all([
          getClub(clubId),
          getTrfYears(clubId, cmrOn),
          getTrfFunds(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setYears(yearsData);
        setFunds(fundsData.filter((f) => f.isActive));
        // Embedded (Foundation tab) → follow the GLOBAL dashboard year. Otherwise use the
        // CMR-pinned year, then the current rotary year.
        if (globalYearId != null && yearsData.some((y) => y.id === globalYearId)) {
          setSelectedYearId(globalYearId);
        } else if (yearIdParam && yearsData.some((y) => y.id === Number(yearIdParam))) {
          setSelectedYearId(Number(yearIdParam));
        } else {
          const current = yearsData.find((y) => y.isCurrent);
          setSelectedYearId(current ? current.id : yearsData[0]?.id ?? null);
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, yearIdParam, globalYearId, cmrOn]);

  // When embedded, follow the global dashboard year as it changes in the topbar.
  useEffect(() => {
    if (globalYearId != null) setSelectedYearId(globalYearId);
  }, [globalYearId]);

  const fetchContributions = useCallback(async () => {
    if (!selectedYearId) return;
    setLoading(true);
    try {
      const data = await getTrfContributions(clubId, selectedYearId);
      setContributions(data);
    } catch {
      setContributions([]);
    } finally {
      setLoading(false);
    }
  }, [clubId, selectedYearId]);

  useEffect(() => { fetchContributions(); }, [fetchContributions]);

  const filtered = useMemo<TrfContribution[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contributions;
    return contributions.filter((c) => {
      const fundLabel = c.fundType === "Others" ? (c.otherFundName || "Others") : c.fundType;
      const dateStr = c.trfDate ? fmtDate(c.trfDate).toLowerCase() : "";
      return (
        (c.donorName || "").toLowerCase().includes(q) ||
        (fundLabel || "").toLowerCase().includes(q) ||
        String(c.amountUSD ?? "").includes(q) ||
        dateStr.includes(q)
      );
    });
  }, [contributions, search]);

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  const totalContrib = contributions.reduce((sum, c) => sum + (c.amountUSD || 0), 0);
  const sumWhere = (pred: (t: string) => boolean) =>
    contributions.filter((c) => pred((c.fundType || "").toLowerCase())).reduce((s, c) => s + (c.amountUSD || 0), 0);
  const annualFundTotal   = sumWhere((t) => t.includes("annual"));
  const polioFundTotal    = sumWhere((t) => t.includes("polio"));
  const endowmentTotal    = sumWhere((t) => t.includes("endowment"));
  const globalGrantTotal  = sumWhere((t) => t.includes("global") || t.includes("grant"));
  // Others = everything not in the four named funds above.
  const othersTotal = Math.max(0, totalContrib - annualFundTotal - polioFundTotal - endowmentTotal - globalGrantTotal);

  useEffect(() => { setCurrentPage(1); }, [search, selectedYearId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paginatedFiltered = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTrfContribution(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Contribution deleted successfully.");
      fetchContributions();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete contribution.");
    }
  };

  return (
    <div className="space-y-5">
      {/* Header + summary band — standalone route only. When embedded on the Foundation
          page, the page provides the header, so we show ONLY the 4 KPI cards + the listing. */}
      {!embedded && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Link
                href={backUrl}
                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-slate-800">TRF Contributions</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  RY {yearLabel} · {clubName || "–"}
                </p>
              </div>
            </div>
          </div>

          <div
            className="rounded-xl p-5 text-white"
            style={{ background: ROTARY_BLUE }}
          >
            <div className="flex items-center gap-3 mb-2">
              <Heart className="h-5 w-5" />
              <p className="text-sm font-extrabold">RY {yearLabel} TRF Summary</p>
            </div>
            <p className="text-3xl font-extrabold tracking-tight">{fmtUsd(totalContrib)}</p>
            <p className="text-xs opacity-80 mt-1">Total contributions across all fund types</p>
          </div>
        </>
      )}

      {/* KPI row — 6 fund cards (USD). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Total Contributions" value={fmtUsd(totalContrib)}     subtitle="USD · all funds"  icon={DollarSign} color="gold" />
        <KpiCard title="Annual"              value={fmtUsd(annualFundTotal)}  subtitle="Annual Fund"      icon={TrendingUp} color="blue" />
        <KpiCard title="Polio"               value={fmtUsd(polioFundTotal)}   subtitle="PolioPlus"        icon={Heart}      color="purple" />
        <KpiCard title="Endowment"           value={fmtUsd(endowmentTotal)}   subtitle="Endowment Fund"   icon={Award}      color="gold" />
        <KpiCard title="Global Grant"        value={fmtUsd(globalGrantTotal)} subtitle="Global Grants"    icon={Globe}      color="green" />
        <KpiCard title="Others"              value={fmtUsd(othersTotal)}      subtitle="Other funds"      icon={DollarSign} color="red" />
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Contribution Records</h3>
            <p className="text-xs text-slate-500 mt-0.5">Donor-wise contributions to The Rotary Foundation · {yearLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Year filter — hidden when embedded (the global dashboard year drives it). */}
            {!embedded && (
              <select
                value={selectedYearId ?? ""}
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                disabled={isFrozenYear}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42] disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {years.length === 0 && <option value="">No years</option>}
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </select>
            )}
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search donor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <Link
              href={addUrl}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
            >
              <Plus size={13} /> Add Contribution
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <SkeletonRows />
          ) : (
            <table className="w-full min-w-[640px] md:min-w-full text-sm">
              <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                <tr>
                  <th className="px-3 py-2.5 text-left w-10">Sr</th>
                  <th className="px-3 py-2.5 text-left">Member Name</th>
                  <th className="px-3 py-2.5 text-left">Fund</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5 text-left">Currency</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right w-16">Edit</th>
                  <th className="px-3 py-2.5 text-right w-16">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedFiltered.map((c, i) => {
                  const fundLabel = c.fundType === "Others" ? (c.otherFundName || "Others") : (c.fundType || "–");
                  return (
                    <tr key={c.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 text-slate-500">{pageStart + i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{c.donorName || "–"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${fundChipStyle(fundLabel)}`}>
                          {fundLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700 tabular-nums">
                        {(c.amountUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">USD</td>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(c.trfDate)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/clubs/${clubId}/trf/v2/${c.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}${cmrQuery}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                          aria-label="Edit contribution"
                        >
                          <Edit3 size={13} />
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(c)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                          aria-label="Delete contribution"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      {search ? "No contributions match your search." : "No TRF contributions for this year."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>{filtered.length} contribution{filtered.length === 1 ? "" : "s"} · {yearLabel}</span>
          <span className="font-semibold text-slate-700">Total: {fmtUsd(totalContrib)}</span>
        </div>
        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100">
            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalCount={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Contribution"
        description={
          <>Are you sure you want to delete the contribution from <span className="font-semibold text-foreground">{deleteTarget?.donorName}</span>? This action cannot be undone.</>
        }
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
