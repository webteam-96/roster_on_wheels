"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Users, Search, Plus, ExternalLink, Edit3, Trash2,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useAuth } from "@/contexts/AuthContext";
import { getClubAdminDashboardBod, deleteBoardDirector } from "@/services/api";
import type {
  ClubAdminDashboardBodResponse,
  ClubAdminDashboardBodRow,
} from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import { ListPageSkeleton } from "@/components/row/AppKit";

function designationChipStyle(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("president")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (n.includes("secretary")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (n.includes("treasurer")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (n.includes("sergeant")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (n.includes("foundation")) return "bg-purple-50 text-purple-700 border-purple-200";
  if (n.includes("community") || n.includes("club service")) return "bg-teal-50 text-teal-700 border-teal-200";
  if (n.includes("public image")) return "bg-orange-50 text-orange-700 border-orange-200";
  if (n.includes("membership")) return "bg-violet-50 text-violet-700 border-violet-200";
  if (n.includes("youth") || n.includes("new generation")) return "bg-pink-50 text-pink-700 border-pink-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function exportToCsv(rows: ClubAdminDashboardBodRow[], yearLabel: string) {
  const header = ["Sr", "Name", "Designation", "Mobile", "Email"];
  const lines = rows.map((r) => [
    r.sr,
    `"${r.name.replace(/"/g, '""')}"`,
    `"${r.designation.replace(/"/g, '""')}"`,
    r.mobile ?? "",
    r.email ?? "",
  ].join(","));
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `board-of-directors-${yearLabel || "all"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardBodPage() {
  const { selectedClubId } = useAuth();
  const searchParams = useSearchParams();
  // Year now comes from the global topbar selector via URL ?yearId=. No local
  // dropdown on this page — point #4 of the 2026-06-12 cleanup.
  const urlYearStr = searchParams.get("yearId");
  const yearId = urlYearStr ? parseInt(urlYearStr, 10) || null : null;

  const [data, setData] = useState<ClubAdminDashboardBodResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Reload tick — bump to refetch the dashboard after a successful delete.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getClubAdminDashboardBod(yearId, selectedClubId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load Board of Directors."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [yearId, reloadTick, selectedClubId]);

  const handleDeleteDirector = async (row: ClubAdminDashboardBodRow) => {
    if (!data) return;
    const name = row.name || "this board member";
    if (!window.confirm(`Delete ${name}? This action cannot be undone.`)) return;
    try {
      setDeletingId(row.id);
      await deleteBoardDirector(data.club.clubId, row.id);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to delete board member.");
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.directors;
    return data.directors.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.designation.toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const clubId = data.club.clubId;
  // The existing module page handles add/edit/delete — we link out there and
  // pass returnTo so a future enhancement can send users back here on save.
  const returnTo = encodeURIComponent("/club-admin-dashboard/dashboard/board-of-directors");
  const addUrl = `/clubs/${clubId}/board-of-directors/v2/add?returnTo=${returnTo}`;

  return (
    <div className="space-y-5">
      {/* Cards "Executive Roles", "Service Chairs", "Growth & Outreach" removed
          per user request (2026-06-12). Only Board Members retained. */}
      <div className="grid grid-cols-1 gap-4 max-w-md">
        <KpiCard title="Board Members" value={fmtInt(data.boardMembers)} subtitle={`RY ${data.selectedYearLabel || "–"}`} icon={Users} color="blue" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Board of Directors</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {data.club.clubName} · executive board roster
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Local year dropdown removed — use the global topbar year selector. */}
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <button
              type="button"
              onClick={() => exportToCsv(filtered, data.selectedYearLabel)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={13} /> Export to Excel
            </button>
            <Link
              href={addUrl}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
            >
              <Plus size={13} /> Add
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] md:min-w-full text-sm">
            <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
              <tr>
                <th className="px-3 py-2.5 text-left w-10">Sr</th>
                <th className="px-3 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Designation</th>
                <th className="px-3 py-2.5 text-left">Mobile Number</th>
                <th className="px-3 py-2.5 text-left">Email</th>
                <th className="px-3 py-2.5 text-right w-16">Edit</th>
                <th className="px-3 py-2.5 text-right w-16">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r, i) => (
                <tr key={r.id} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 text-slate-500">{r.sr ?? i + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {!r.isMember && (
                        <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          Non-Member
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${designationChipStyle(r.designation)}`}>
                      {r.designation || "–"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{r.mobile ?? "–"}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.email ?? "–"}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/clubs/${clubId}/board-of-directors/v2/${r.id}/edit?returnTo=${returnTo}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                    >
                      <Edit3 size={13} />
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleDeleteDirector(r)}
                      disabled={deletingId === r.id}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50"
                      aria-label="Delete board member"
                      title="Delete board member"
                    >
                      {deletingId === r.id
                        ? <RotaryLoader size="sm" />
                        : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No board positions match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          {filtered.length} board position{filtered.length === 1 ? "" : "s"} · {data.selectedYearLabel}
        </div>
      </div>
    </div>
  );
}
