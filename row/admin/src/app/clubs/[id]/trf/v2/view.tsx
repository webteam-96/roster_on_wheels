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

import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { DollarSign, TrendingUp, Heart, Award, Globe, Search, Plus, Edit3, Trash2, AlertTriangle } from "@/components/icons";
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
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import { stripBase } from "@/lib/basePath";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
function fundChipStyle(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("annual"))    return "bg-blue-50 text-blue-700 border-blue-200";
  if (n.includes("polio"))     return "bg-slate-50 text-slate-700 border-slate-200";
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

  // A TRF contribution belongs to the Rotary year it was recorded under, and
  // this page has its own year selector — so the selected year decides.
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const isClubAdmin = isSuperAdmin || isAdmin;
  const canManage = isClubAdmin && canEditYear(yearRights, selectedYearId, isSuperAdmin);
  const editableYears = heldYearLabels(yearRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));
  const viewingYearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel;
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
    ? encodeURIComponent(stripBase(window.location.pathname) + window.location.search)
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
      {!canManage && selectedYearId && (
        <ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} className="mb-4" />
      )}

      {/* Header + summary band — standalone route only. When embedded on the Foundation
          page, the page provides the header, so we show ONLY the 4 KPI cards + the listing. */}
      {!embedded && (
        <>
          <PageHeader title="TRF Contributions" description={<>RY {yearLabel} · {clubName || "–"}</>} back={backUrl} />

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
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">Contribution Records</h3>
            <p className="text-xs text-slate-500 mt-0.5">Donor-wise contributions to The Rotary Foundation · {yearLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Year filter — hidden when embedded (the global dashboard year drives it). */}
            {!embedded && (
              <NativeSelect
                value={selectedYearId ?? ""}
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                disabled={isFrozenYear}
                className="disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed w-auto"
              >
                {years.length === 0 && <option value="">No years</option>}
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search donor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 sm:w-48"
              />
            </div>
            {canManage && (
              <Link
                href={addUrl}
                className="row-btn row-btn-primary"
              >
                <Plus size={13} /> Add Contribution
              </Link>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <SkeletonRows />
          ) : (
            <Table className="min-w-[640px] md:min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left w-10">Sr</TableHead>
                  <TableHead className="text-left">Member Name</TableHead>
                  <TableHead className="text-left">Fund</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-left">Currency</TableHead>
                  <TableHead className="text-left">Date</TableHead>
                  {/* One column, and it hides with the body cells below.
                      Two separate Edit/Delete headers left empty columns
                      behind on a read-only year. */}
                  {canManage && <TableHead className="text-right w-20 whitespace-nowrap">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedFiltered.map((c, i) => {
                  const fundLabel = c.fundType === "Others" ? (c.otherFundName || "Others") : (c.fundType || "–");
                  return (
                    <TableRow key={c.id}>
                      <TableCell>{pageStart + i + 1}</TableCell>
                      <TableCell className="font-medium">{c.donorName || "–"}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${fundChipStyle(fundLabel)}`}>
                          {fundLabel}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(c.amountUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-xs">USD</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(c.trfDate)}</TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            <Link
                              href={`/clubs/${clubId}/trf/v2/${c.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}${cmrQuery}`}
                              className="row-icon-btn"
                              title="Edit"
                              aria-label="Edit contribution"
                            >
                              <Edit3 size={14} />
                            </Link>
                            <IconButton
                              type="button"
                              onClick={() => setDeleteTarget(c)}
                              className="hover:text-red-700"
                              title="Delete"
                              aria-label="Delete contribution"
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center text-muted-foreground">
                      {search ? "No contributions match your search." : "No TRF contributions for this year."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
      </Card>

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
