"use client";

import { IconButton } from "@/components/ui/icon-button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Users, Search, Plus, ExternalLink, Edit3, Trash2,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { getClubAdminDashboardBod, deleteBoardDirector } from "@/services/api";
import type {
  ClubAdminDashboardBodResponse,
  ClubAdminDashboardBodRow,
} from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import { ListPageSkeleton } from "@/components/row/AppKit";
import OfficerProgressionPanel from "@/components/OfficerProgressionPanel";

function designationChipStyle(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("president")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (n.includes("secretary")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (n.includes("treasurer")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (n.includes("sergeant")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (n.includes("foundation")) return "bg-slate-50 text-slate-700 border-slate-200";
  if (n.includes("community") || n.includes("club service")) return "bg-teal-50 text-teal-700 border-teal-200";
  if (n.includes("public image")) return "bg-orange-50 text-orange-700 border-orange-200";
  if (n.includes("membership")) return "bg-slate-50 text-slate-700 border-slate-200";
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
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }) /* BOM: Excel reads UTF-8 */;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `board-of-directors-${yearLabel || "all"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardBodPage() {
  const { selectedClubId, user, isSuperAdmin, isAdmin } = useAuth();
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

  // ⚠️ useRotaryYears() is a hook, so it must be called on EVERY render — it
  // cannot live below the early returns further down, or React sees a different
  // number of hooks once the data arrives. clubId is read defensively for the
  // same reason: this runs before `data` exists.
  const { years, currentYearId } = useRotaryYears();
  const boardClubId = data?.club?.clubId ?? 0;
  const viewingYearId = yearId ?? currentYearId;
  const boardYearRights = clubYearRights(user?.scopedRoles, boardClubId);
  const isBoardAdmin = isSuperAdmin || isAdmin;
  const canManage = isBoardAdmin && canEditYear(boardYearRights, viewingYearId, isSuperAdmin);
  const editableYears = heldYearLabels(boardYearRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));
  const viewingYearLabel = years.find((y) => y.id === viewingYearId)?.yearLabel;

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
      {isBoardAdmin && !canManage && (
        <ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} className="mb-4" />
      )}

      {/* Cards "Executive Roles", "Service Chairs", "Growth & Outreach" removed
          per user request (2026-06-12). Only Board Members retained. */}
      <div className="grid grid-cols-1 gap-4 max-w-md">
        <KpiCard title="Board Members" value={fmtInt(data.boardMembers)} subtitle={`RY ${data.selectedYearLabel || "–"}`} icon={Users} color="blue" />
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">Board of Directors</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {data.club.clubName} · executive board roster
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Local year dropdown removed — use the global topbar year selector. */}
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 sm:w-48"
              />
            </div>
            <Button
              type="button"
              onClick={() => exportToCsv(filtered, data.selectedYearLabel)}
              variant="outline" size="sm"
            >
              <ExternalLink size={13} /> Export CSV
            </Button>
            {canManage && (
              <Link
                href={addUrl}
                className="row-btn row-btn-primary"
              >
                <Plus size={13} /> Add
              </Link>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3 text-left w-10">Sr</TableHead>
                <TableHead className="px-3 text-left">Name</TableHead>
                <TableHead className="px-3 text-left">Designation</TableHead>
                <TableHead className="px-3 text-left">Mobile Number</TableHead>
                <TableHead className="px-3 text-left">Email</TableHead>
                {canManage && <TableHead className="px-3 text-right w-20 whitespace-nowrap">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {filtered.map((r, i) => (
                <TableRow key={r.id} className="hover:bg-blue-50/40">
                  <TableCell className="px-3 py-2 text-slate-500">{r.sr ?? i + 1}</TableCell>
                  <TableCell className="px-3 py-2 font-medium text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {!r.isMember && (
                        <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          Non-Member
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${designationChipStyle(r.designation)}`}>
                      {r.designation || "–"}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{r.mobile ?? "–"}</TableCell>
                  <TableCell className="px-3 py-2 text-xs text-slate-600">{r.email ?? "–"}</TableCell>
                  {canManage && (
                    <TableCell className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link
                          href={`/clubs/${clubId}/board-of-directors/v2/${r.id}/edit?returnTo=${returnTo}`}
                          className="row-icon-btn"
                          title="Edit"
                        >
                          <Edit3 size={14} />
                        </Link>
                        <IconButton
                          type="button"
                          onClick={() => handleDeleteDirector(r)}
                          disabled={deletingId === r.id}
                          aria-label="Delete board member"
                          title="Delete board member"
                        >
                          {deletingId === r.id
                            ? <RotaryLoader size="sm" />
                            : <Trash2 size={14} />}
                        </IconButton>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                    No board positions match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          {filtered.length} board position{filtered.length === 1 ? "" : "s"} · {data.selectedYearLabel}
        </div>
      </Card>

      {/* Officer progression (gap agent): naming the nominee needs current-year rights; the API checks every step. */}
      <OfficerProgressionPanel scope="club" scopeId={clubId}
        canManage={isBoardAdmin && canEditYear(boardYearRights, currentYearId, isSuperAdmin)} />
    </div>
  );
}
