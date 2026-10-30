"use client";

/**
 * Terminated Members v2 listing — modernised, dashboard-style layout.
 *
 * Data still comes from the existing v1 API endpoint (getTerminatedMembers +
 * getClub). Listing is server-paginated (pageSize 20, matching v1) — the
 * earlier 100k-rows-per-fetch approach was a regression for large/migrated
 * clubs.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 *
 * Per memory rule "Club termination cascade rules" — terminate from THIS club
 * only. We do not redo the cascade logic; the Add page calls the same
 * `removeClubMember` endpoint that v1 uses, and the backend stamps
 * TerminationDate + TerminationReason on the club_members row.
 *
 * Note on dropped KPIs / Member-Type column: v1 had no KPI tiles on this
 * page. The earlier v2 "Now Member" KPI compared the terminated-row id to
 * the active-row id, which never match after re-admission (a returning
 * member gets a NEW club_members row). Without a backend aggregate (the
 * dashboard's server-computed `data.nowMember`) we cannot derive it
 * correctly here, so the misleading tile + Member-Type column were
 * removed rather than left silently broken.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Search, Plus, Edit3, Download,
} from "@/components/icons";
import { getClub, getTerminatedMembers } from "@/services/api";
import { TerminatedMember } from "@/types/club";
import { useAuth } from "@/contexts/AuthContext";
import { fmtDate } from "@/components/dashboard/formatters";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { SkeletonRows } from "@/components/row/AppKit";

// Chip styling mirrors the Club Admin Dashboard's reasonChip helper.
function reasonChip(reason: string | null | undefined): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("particip")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (r.includes("business") || r.includes("relocat")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (r.includes("personal") || r.includes("health")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (r.includes("transfer")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

// Split full name into first / middle / last (same heuristic the dashboard uses).
function splitName(full: string): { first: string; middle: string; last: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const middle = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
  return { first, middle, last };
}

function exportToCsv(rows: TerminatedMember[], clubName: string) {
  const header = ["Sr", "Member ID", "First Name", "Middle Name", "Last Name", "Admission Date", "Termination Date", "Termination Reason"];
  const lines = rows.map((r, i) => {
    const n = splitName(r.memberName);
    return [
      i + 1,
      `"${r.rotaryId || ""}"`,
      `"${n.first.replace(/"/g, '""')}"`,
      `"${n.middle.replace(/"/g, '""')}"`,
      `"${n.last.replace(/"/g, '""')}"`,
      `"${r.joinedDate ? fmtDate(r.joinedDate) : ""}"`,
      `"${r.terminationDate ? fmtDate(r.terminationDate) : ""}"`,
      `"${(r.terminationReason || "").replace(/"/g, '""')}"`,
    ].join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terminated-members-${clubName.replace(/\s+/g, "-").toLowerCase()}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 20;

export default function TerminatedMembersV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [records, setRecords] = useState<TerminatedMember[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/rotary-network/terminated-members/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/rotary-network/terminated-members/v2/add?returnTo=${returnTo}`;

  // Club name — fetched once.
  useEffect(() => {
    let cancelled = false;
    getClub(clubId)
      .then((club) => { if (!cancelled) setClubName(club.clubName); })
      .catch(() => { /* ignore: listing still works */ });
    return () => { cancelled = true; };
  }, [clubId]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTerminatedMembers(clubId, page, PAGE_SIZE, search || undefined);
      setRecords(result.items);
      setTotalCount(result.totalCount);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string }; message?: string };
      const msg =
        (typeof e.response?.data === "object" && e.response?.data?.message) ||
        (typeof e.response?.data === "string" ? e.response.data : undefined) ||
        e.message ||
        "Failed to load terminated members.";
      setErrorMessage(msg);
      setRecords([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, search]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      // Export uses a single large fetch — same approach as v1's Export Excel.
      // Acceptable because export is a user-initiated, infrequent action,
      // unlike the per-page-render listing fetch.
      const result = await getTerminatedMembers(clubId, 1, 100000, search || undefined);
      exportToCsv(result.items, clubName || "club");
    } catch {
      setErrorMessage("Failed to export terminated members.");
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Terminated Members"
        pageSubtitle="Member termination history"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={`/clubs/${clubId}/rotary-network`}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Terminated Members</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Members terminated or resigned from the club · {clubName || "–"}
              </p>
            </div>
          </div>
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Terminated Member Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "–"} · ordered by termination date
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name, ID, reason…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                  className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-56 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-slate-800 text-white hover:bg-slate-900"
              >
                Search
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || totalCount === 0}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download size={13} /> {exporting ? "Exporting…" : "Export"}
              </button>
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-amber-600 text-white hover:bg-amber-700"
                >
                  <Plus size={13} /> Add (Terminate Member)
                </Link>
              )}
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
                    <th className="px-3 py-2.5 text-left">Member ID</th>
                    <th className="px-3 py-2.5 text-left">First Name</th>
                    <th className="px-3 py-2.5 text-left">Middle Name</th>
                    <th className="px-3 py-2.5 text-left">Last Name</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Admission Date</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Termination Date</th>
                    <th className="px-3 py-2.5 text-left">Termination Reason</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((r, i) => {
                    const n = splitName(r.memberName);
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{r.rotaryId || "–"}</td>
                        <td className="px-3 py-2 text-slate-800 font-medium">{n.first || "–"}</td>
                        <td className="px-3 py-2 text-slate-600">{n.middle || "–"}</td>
                        <td className="px-3 py-2 text-slate-800 font-medium">{n.last || "–"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.joinedDate)}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.terminationDate)}</td>
                        <td className="px-3 py-2">
                          {r.terminationReason ? (
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${reasonChip(r.terminationReason)}`}>
                              {r.terminationReason}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">, </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/rotary-network/terminated-members/v2/${r.id}/edit?returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit termination"
                            >
                              <Edit3 size={13} />
                            </Link>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 9 : 8} className="px-4 py-10 text-center text-slate-400">
                        {search
                          ? "No terminated members match your search."
                          : "No terminated members recorded yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} record{totalCount === 1 ? "" : "s"}
            {search ? ` · matching "${search}"` : ""}
          </div>
        </div>

        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
