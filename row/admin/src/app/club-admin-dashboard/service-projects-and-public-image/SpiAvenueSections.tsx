"use client";

import { LinkButton } from "@/components/ui/text-buttons";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import PillTabs from "@/components/row/PillTabs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Users, Clock4, CalendarDays, Edit3, Trash2, Eye, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProjectDetailModal from "@/components/ProjectDetailModal";
import AlertModal from "@/components/AlertModal";
import AgreeAddButton from "@/components/AgreeAddButton";
import { AGREE_MESSAGES } from "@/lib/agreeMessages";
import { deleteProject } from "@/services/api";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { shortMoney } from "@/lib/currency";
import type {
  ServiceProjectsOverviewResponse,
  ServiceProjectsAvenueDetailResponse,
  ServiceProjectsMeetingRow,
} from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
import { AvenueTab, AVENUE_TABS, avenueBadgeStyle, moneyIcon, attendancePercentChip } from "./spiHelpers";
import { useAvenuePermissions, NonClubAvenueSection, SearchBox } from "./NonClubAvenueSection";

export function AvenueHeader({ club }: { club: ServiceProjectsOverviewResponse["club"] }) {
  return (
    <PageHeader title={<>Service Projects &amp; Public Image</>} description={<>{club.clubName} · RY {club.yearLabel}</>} />
  );
}

// ── Horizontal tab bar ─────────────────────────────────────────────────

export function AvenueTabBar({ active, onChange }: { active: AvenueTab; onChange: (k: AvenueTab) => void }) {
  // Tab bar bg = #17458f (navy blue — same tone the sidebar uses as ACTIVE_TEXT).
  // Inactive tabs = white, active tab = Rotary gold (#F7A81B) with navy text.
  // Container wraps to its own content width (not the whole page); tab font is
  // sized so the labels are easily readable.
  return (
    <PillTabs items={AVENUE_TABS} active={active} onChange={onChange} />
  );
}

// ── "All" — overview KPIs + per-avenue summary table ────────────────────

export function OverviewSection({ overview }: { overview: ServiceProjectsOverviewResponse }) {
  const k = overview.kpis;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard title="Total Projects"       value={fmtInt(k.totalProjects)}       subtitle="Across all avenues"  icon={Briefcase}    color="blue" />
        <KpiCard title="Total Beneficiaries"  value={fmtInt(k.totalBeneficiaries)}  subtitle="Lives impacted"      icon={Users}        color="green" />
        <KpiCard title="Total Project Cost"   value={shortMoney(Number(k.totalCost), overview.targetCurrency)} subtitle="Amount invested"     icon={moneyIcon(overview.targetCurrency)}  color="gold" />
        <KpiCard title="Man Hours"            value={fmtInt(k.totalManHours)}       subtitle="Volunteer time"      icon={Clock4}       color="purple" />
        <KpiCard title="Meetings Held"        value={fmtInt(k.meetingsHeld)}        subtitle="Club service"        icon={CalendarDays} color="blue" />
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="row-h3">All Avenues</h3>
          <p className="text-xs text-slate-500 mt-0.5">Summary by avenue · {overview.selectedYearLabel}</p>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 text-left">Avenue</TableHead>
                <TableHead className="px-4 text-right">Projects</TableHead>
                <TableHead className="px-4 text-right">Beneficiaries</TableHead>
                <TableHead className="px-4 text-right">Cost</TableHead>
                <TableHead className="px-4 text-right">Man-Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {overview.avenues.map((a) => (
                <TableRow key={a.avenueKey} className="hover:bg-blue-50/40">
                  <TableCell className="px-4 py-2">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${avenueBadgeStyle(a.avenueKey)}`}>
                      {a.avenueName}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right font-medium text-slate-800">{fmtInt(a.projects)}</TableCell>
                  <TableCell className="px-4 py-2 text-right text-slate-600">{a.beneficiaries > 0 ? fmtInt(a.beneficiaries) : "–"}</TableCell>
                  <TableCell className="px-4 py-2 text-right text-slate-600">{a.cost > 0 ? shortMoney(Number(a.cost), overview.targetCurrency) : "–"}</TableCell>
                  <TableCell className="px-4 py-2 text-right text-slate-600">{a.manHours > 0 ? fmtInt(a.manHours) : "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ── Per-avenue section ─────────────────────────────────────────────────

export function AvenueSection({
  tab, data, loading, yearId, clubId, onRefresh,
}: {
  tab: AvenueTab;
  data: ServiceProjectsAvenueDetailResponse | null;
  loading: boolean;
  yearId: number | null;
  clubId: number;
  onRefresh: () => Promise<void> | void;
}) {
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }
  if (!data) return null;

  if (tab === "club_service") {
    return <ClubServiceSection data={data} yearId={yearId} clubId={clubId} onRefresh={onRefresh} />;
  }
  return <NonClubAvenueSection data={data} yearId={yearId} clubId={clubId} onRefresh={onRefresh} />;
}

// ── Club Service: meetings ─────────────────────────────────────────────

export function ClubServiceSection({
  data, yearId, clubId, onRefresh,
}: {
  data: ServiceProjectsAvenueDetailResponse;
  yearId: number | null;
  clubId: number;
  onRefresh: () => Promise<void> | void;
}) {
  const { canManage, editableYears, viewingYearLabel } =
    useAvenuePermissions(clubId, data.selectedYearId ?? yearId, data.availableYears);
  const k = data.kpis;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [deleteTarget, setDeleteTarget] = useState<ServiceProjectsMeetingRow | null>(null);
  // Read-only popup: the whole meeting, its documents and its photos (user 2026-10-05).
  const [viewTarget, setViewTarget] = useState<ServiceProjectsMeetingRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Shown as a page-level overlay between "user confirms Delete" and "list refresh done"
  // so the user sees a spinner rather than a silent gap while the API call + refetch run.
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const effectiveYearId = data.selectedYearId ?? yearId ?? 0;
    if (!effectiveYearId) {
      setDeleteError("Could not resolve the Rotary year for this record.");
      return;
    }
    setIsDeleting(true);
    try {
      await deleteProject(clubId, effectiveYearId, deleteTarget.id);
      setDeleteTarget(null);
      await onRefresh();
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setDeleteError(err?.response?.data?.message || "Failed to delete meeting.");
    } finally {
      setIsDeleting(false);
    }
  };

  const filtered = useMemo<ServiceProjectsMeetingRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.meetings;
    return data.meetings.filter((m) =>
      m.title.toLowerCase().includes(q) ||
      m.meetingType.toLowerCase().includes(q) ||
      m.date.toLowerCase().includes(q)
    );
  }, [data.meetings, search]);

  // Reset to page 1 when filter inputs change
  useEffect(() => { setPage(1); }, [search, data.selectedYearId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  // Encode the active tab in returnTo so V2 form Save/Back returns to this tab.
  const returnTo = encodeURIComponent(
    "/club-admin-dashboard/service-projects-and-public-image?tab=club_service",
  );
  // The year goes with it: the photo upload needs it, or a past-year admin is
  // allowed to add the project but refused its picture (uploadProjectImage).
  const addUrl = `/clubs/${clubId}/club-service/v2/add?returnTo=${returnTo}${(data.selectedYearId ?? yearId) ? `&yearId=${data.selectedYearId ?? yearId}` : ""}`;

  return (
    <div className="space-y-5">
      {!canManage && (
        <ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} />
      )}
      {/* Club Service KPIs — "Avg Attendance Stayed" and "Members on Roll"
          removed per user request 2026-06-12 (item #10). */}
      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
        <KpiCard title="Meetings Held"   value={fmtInt(k.meetingsHeld ?? 0)}                           subtitle={`RY ${data.selectedYearLabel || "–"}`} icon={CalendarDays} color="blue" />
        <KpiCard title="Avg Attendance"  value={`${Math.round(Number(k.avgAttendancePercent ?? 0))}%`} subtitle="Across meetings"                       icon={Users}        color="green" />
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">Club Service</h3>
            <p className="text-xs text-slate-500 mt-0.5">Meeting record · {data.selectedYearLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Local YearSelect removed — use global topbar year selector. */}
            <SearchBox value={search} onChange={setSearch} />
            {canManage && (
              <AgreeAddButton message={AGREE_MESSAGES.club_service} href={addUrl} label="Add Club Service" />
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3 text-left w-10">Sr</TableHead>
                <TableHead className="px-3 text-left">Date</TableHead>
                <TableHead className="px-3 text-left">Meeting Type</TableHead>
                <TableHead className="px-3 text-left">Type</TableHead>
                <TableHead className="px-3 text-left">Attendance</TableHead>
                <TableHead className="px-3 text-left">Att %</TableHead>
                {/* One actions column. Delete used to be its own <TableHead>, which left a
                    header with nothing under it whenever the year was read-only. */}
                <TableHead className="px-3 text-right w-24 whitespace-nowrap">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {visibleRows.map((m, i) => (
                <TableRow key={m.id} className="hover:bg-blue-50/40">
                  <TableCell className="px-3 py-2 text-slate-500">{m.sr ?? (safePage - 1) * PAGE_SIZE + i + 1}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(m.date)}</TableCell>
                  <TableCell className="px-3 py-2">
                    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {m.meetingType || "–"}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-slate-700">{m.title || "–"}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600" title={`${m.attendance} of ${m.membersOnRoll || 0} ${m.attendanceBase || "Total Members"}`}>
                    {m.attendance}/{m.membersOnRoll || "–"}
                    {m.attendanceBase === "BOD Members" && (
                      <span className="ml-1 text-[10px] text-slate-400">BOD</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${attendancePercentChip(Number(m.attendancePercent))}`}>
                      {Number(m.attendancePercent).toFixed(2)}%
                    </span>
                  </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* View is always offered — a year you cannot edit is still a
                            year you can read. Opens in place so the year selector and
                            filters stay as the context you are reading the row in. */}
                        <IconButton
                          type="button"
                          onClick={() => setViewTarget(m)}
                          title="View"
                        >
                          <Eye size={14} />
                        </IconButton>
                        {canManage && (
                          <Link
                            href={`/clubs/${clubId}/club-service/v2/${m.id}/edit?returnTo=${returnTo}&yearId=${data.selectedYearId ?? yearId ?? ""}`}
                            className="row-icon-btn"
                            title="Edit"
                          >
                            <Edit3 size={14} />
                          </Link>
                        )}
                        {canManage && (
                          <IconButton
                            type="button"
                            onClick={() => setDeleteTarget(m)}
                            className="hover:text-red-700"
                            title="Delete"
                            aria-label="Delete meeting"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </div>
                    </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-slate-400">No meetings recorded.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-slate-100"><Pagination page={safePage} totalPages={totalPages} totalCount={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>
        )}
      </Card>

      {/* Read-only detail popup. The attendance figures are handed over so the popup prints exactly
          what the row shows - BOD meetings against the board, everything else against the roll. */}
      <ProjectDetailModal
        clubId={clubId}
        yearId={Number(data.selectedYearId ?? yearId ?? 0)}
        projectId={viewTarget?.id ?? null}
        onClose={() => setViewTarget(null)}
        attendance={viewTarget ? {
          attended: viewTarget.attendance,
          base: viewTarget.membersOnRoll,
          baseLabel: viewTarget.attendanceBase || "Total Members",
          percent: Number(viewTarget.attendancePercent),
        } : null}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Meeting"
        description={<>
          Are you sure you want to delete this meeting
          {deleteTarget?.title ? <>: <span className="font-semibold text-foreground">{deleteTarget.title}</span></> : null}?
          This action cannot be undone.
        </>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleConfirmDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />

      {deleteError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 shadow-lg">
          {deleteError}
          <LinkButton className="ml-2" onClick={() => setDeleteError(null)}>Dismiss</LinkButton>
        </div>
      )}

      {isDeleting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40">
          <div className="flex items-center gap-3 rounded-lg bg-card px-5 py-4 shadow-xl">
            <RotaryLoader size="sm" />
            <span className="text-sm font-semibold text-slate-700">Deleting…</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Non-Club avenues: one-time / ongoing projects ──────────────────────


/**
 * Whether this dashboard section is editable for the year on screen.
 *
 * Admin rights are per Rotary year, so being a Club Admin is not enough — the
 * selected year has to be one this member holds. `canView` stays true either
 * way: a year you cannot edit is still a year you can read, and without it the
 * row loses its only way into the record.
 */
