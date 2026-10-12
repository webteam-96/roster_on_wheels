"use client";

/**
 * Past Presidents v2 listing — modernised, dashboard-style layout.
 *
 * Visuals mirror the Club Admin Dashboard's Directory + Board of Directors
 * tabs (KPI tiles, dense table, per-row edit pencil) but the data still comes
 * from the existing v1 API endpoints (getPastPresidents + getRotaryYears +
 * getClub + getClubMembers for "still active" lookup).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Crown, Users, UserCheck, UserX, CalendarRange, CalendarClock, Loader2,
  Search, Plus, Edit3, Trash2, User, AlertTriangle,
} from "lucide-react";
import {
  getClub,
  getClubMembers,
  getPastPresidents,
  deletePastPresident,
  getPhotoUrl,
} from "@/services/api";
import { PastPresident } from "@/types/pastPresident";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

export default function PastPresidentsV2ListingPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [records, setRecords] = useState<PastPresident[]>([]);
  const [activeMemberIds, setActiveMemberIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedYearId, setSelectedYearId] = useState<number | "all">("all");

  const [deleteTarget, setDeleteTarget] = useState<PastPresident | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/past-presidents/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/past-presidents/v2/add?returnTo=${returnTo}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const PAGE_SIZE = 500;
      const [club, pp, firstPage] = await Promise.all([
        getClub(clubId),
        getPastPresidents(clubId),
        // First page — we only need IDs to mark "still active".
        getClubMembers(clubId, 1, PAGE_SIZE).catch(() => ({
          items: [] as { id: number; membershipActive: boolean }[],
          totalCount: 0,
          page: 1,
          pageSize: PAGE_SIZE,
          totalPages: 1,
        })),
      ]);
      setClubName(club.clubName);
      setRecords(pp);

      // Map memberId → active in current club. searchClubMembers returns
      // active+ex-members at create-time; here we only flag the still-active ones.
      // Fix: clubs with more than PAGE_SIZE active members would silently
      // mis-label past-presidents on page 2+ as "Past Member". Walk every
      // page so the active-set is complete.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allMembers: any[] = [...(firstPage.items as any[])];
      const totalPages = firstPage.totalPages || 1;
      if (totalPages > 1) {
        const extraPages = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            getClubMembers(clubId, i + 2, PAGE_SIZE).catch(() => ({
              items: [] as { id: number; membershipActive: boolean }[],
            })),
          ),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extraPages.forEach((p) => allMembers.push(...((p.items || []) as any[])));
      }
      const ids = new Set<number>();
      allMembers.forEach((m) => {
        if (m.membershipActive) ids.add(m.id);
      });
      setActiveMemberIds(ids);
      // Note: non-member entries (memberId === null) won't match the active set —
      // they're rendered as "Non-Member" rather than "Past Member".
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string } };
      const msg =
        (typeof e.response?.data === "object" && e.response?.data?.message) ||
        (typeof e.response?.data === "string" ? e.response.data : undefined) ||
        "Failed to load past presidents.";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Years dropdown — data-only (memory rule: never pad year dropdowns).
  const yearOptions = useMemo(() => {
    const map = new Map<number, string>();
    records.forEach((r) => map.set(r.yearId, r.yearLabel));
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [records]);

  const filtered = useMemo<PastPresident[]>(() => {
    let rows = records;
    if (selectedYearId !== "all") {
      rows = rows.filter((r) => r.yearId === selectedYearId);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        (r.memberName || "").toLowerCase().includes(q) ||
        (r.yearLabel || "").toLowerCase().includes(q) ||
        (r.memberId != null && String(r.memberId).includes(q)),
      );
    }
    // Most-recent year first by label string (yearLabel is "YYYY-YY" so lexical sort works).
    return [...rows].sort((a, b) => (b.yearLabel || "").localeCompare(a.yearLabel || ""));
  }, [records, search, selectedYearId]);

  // KPI aggregates
  const totalPp = records.length;
  // Member-vs-Non-Member counts (driven by the new IsMember field from backend).
  const memberCount = records.filter((r) => r.isMember).length;
  const nonMemberCount = records.filter((r) => !r.isMember).length;
  const yearsRepresented = useMemo(() => {
    const s = new Set<number>();
    records.forEach((r) => s.add(r.yearId));
    return s.size;
  }, [records]);
  const mostRecentYear = useMemo(() => {
    if (records.length === 0) return "—";
    return [...records]
      .map((r) => r.yearLabel || "")
      .sort((a, b) => b.localeCompare(a))[0] || "—";
  }, [records]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePastPresident(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Past president record deleted.");
      fetchAll();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete record.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Past Presidents"
        pageSubtitle="Year-wise past presidents"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={`/clubs/${clubId}/dashboard`}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Past Presidents</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Historical record of club presidents · {clubName || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard
            title="Total Past Presidents"
            value={fmtInt(totalPp)}
            subtitle="All-time"
            icon={Crown}
            color="gold"
          />
          <KpiCard
            title="Member Entries"
            value={fmtInt(memberCount)}
            subtitle="Linked to member record"
            icon={UserCheck}
            color="green"
          />
          <KpiCard
            title="Non-Member Entries"
            value={fmtInt(nonMemberCount)}
            subtitle="Free-text historical"
            icon={UserX}
            color="purple"
          />
          <KpiCard
            title="Years Represented"
            value={fmtInt(yearsRepresented)}
            subtitle="Unique Rotary years"
            icon={CalendarRange}
            color="blue"
          />
          <KpiCard
            title="Most Recent Year"
            value={mostRecentYear}
            subtitle="Latest on record"
            icon={CalendarClock}
            color="purple"
          />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Past President Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "—"} · ordered by Rotary year
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedYearId === "all" ? "" : String(selectedYearId)}
                onChange={(e) => setSelectedYearId(e.target.value === "" ? "all" : Number(e.target.value))}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Years</option>
                {yearOptions.map((y) => (
                  <option key={y.id} value={y.id}>{y.label}</option>
                ))}
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={13} /> Add Past President
                </Link>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="animate-spin mr-2" size={16} /> Loading past presidents…
            </div>
          ) : (
            <>
              {/* Mobile card view (<sm) — replaces horizontally scrolling table */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filtered.map((r) => {
                  const photoUrl = getPhotoUrl(r.profilePhotoPath);
                  const isActive = r.memberId != null && activeMemberIds.has(r.memberId);
                  const isNonMember = !r.isMember;
                  return (
                    <div
                      key={r.id}
                      className={`px-4 py-3 flex items-center gap-3 ${isNonMember ? "bg-slate-100" : ""}`}
                    >
                      {photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photoUrl}
                          alt={r.memberName}
                          className="w-11 h-11 rounded-full object-cover border border-slate-200 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200 flex-shrink-0">
                          <User size={18} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 truncate">{r.memberName}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{r.yearLabel}</span>
                          {r.memberId != null && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span>#{r.memberId}</span>
                            </>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {/* Member vs Non-Member chip — primary distinction */}
                          <span
                            className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${
                              r.isMember
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {r.isMember ? "Member" : "Non-Member"}
                          </span>
                          {/* Secondary status only for members — still active in club today? */}
                          {r.isMember && (
                            <span
                              className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                                isActive
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-slate-50 text-slate-600 border-slate-200"
                              }`}
                            >
                              {isActive ? "Active Member" : "Past Member"}
                            </span>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Link
                            href={`/clubs/${clubId}/past-presidents/v2/${r.id}/edit?returnTo=${returnTo}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label="Edit past president"
                          >
                            <Edit3 size={14} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(r)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            aria-label="Delete past president"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-4 py-10 text-center text-slate-400 text-sm">
                    {search || selectedYearId !== "all"
                      ? "No past presidents match your filters."
                      : "No past presidents recorded yet."}
                  </div>
                )}
              </div>

              {/* Desktop table view (sm+) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-12">Photo</th>
                    <th className="px-3 py-2.5 text-left">Name</th>
                    <th className="px-3 py-2.5 text-left">Year</th>
                    <th className="px-3 py-2.5 text-left">Member ID</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => {
                    const photoUrl = getPhotoUrl(r.profilePhotoPath);
                    const isActive = r.memberId != null && activeMemberIds.has(r.memberId);
                    const isNonMember = !r.isMember;
                    return (
                      <tr
                        key={r.id}
                        className={`${isNonMember ? "bg-slate-100" : ""} hover:bg-blue-50/40`}
                      >
                        <td className="px-3 py-2">
                          {photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photoUrl}
                              alt={r.memberName}
                              className="w-9 h-9 rounded-full object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200">
                              <User size={16} />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{r.memberName}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.yearLabel}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                          {r.memberId != null ? `#${r.memberId}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                                r.isMember
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {r.isMember ? "Member" : "Non-Member"}
                            </span>
                            {r.isMember && (
                              <span
                                className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                                  isActive
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-slate-50 text-slate-600 border-slate-200"
                                }`}
                              >
                                {isActive ? "Active" : "Past"}
                              </span>
                            )}
                          </div>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/past-presidents/v2/${r.id}/edit?returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit past president"
                            >
                              <Edit3 size={13} />
                            </Link>
                          </td>
                        )}
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(r)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                              aria-label="Delete past president"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 7 : 5} className="px-4 py-10 text-center text-slate-400">
                        {search || selectedYearId !== "all"
                          ? "No past presidents match your filters."
                          : "No past presidents recorded yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
          )}

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
            {selectedYearId !== "all" && yearOptions.find((y) => y.id === selectedYearId)
              ? ` · ${yearOptions.find((y) => y.id === selectedYearId)!.label}`
              : ""}
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Past President"
          description={
            <>
              Are you sure you want to delete the record for{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.memberName}</span>{" "}
              ({deleteTarget?.yearLabel})?
            </>
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
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
