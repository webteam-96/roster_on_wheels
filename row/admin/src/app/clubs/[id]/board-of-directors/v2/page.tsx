"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * Board of Directors v2 listing — frontend overhaul module.
 *
 * Visual pattern mirrors the Club Admin Dashboard's Board of Directors sub-tab
 * (KPI tiles, colored designation chips, dense table) but the data still comes
 * from the existing v1 endpoints (getBoardOfDirectors + getBoardYearsByClub +
 * deleteBoardDirector + reorderBoardOfDirectors + getClub).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Users, Crown, HandHeart, TrendingUp, Search, Plus, Edit3, Trash2, AlertTriangle, Download, GripVertical, User } from "@/components/icons";
import {
  getClub,
  getBoardOfDirectors,
  getBoardYearsByClub,
  deleteBoardDirector,
  reorderBoardOfDirectors,
  getPhotoUrl,
} from "@/services/api";
import { BoardDirector } from "@/types/boardDirector";
import { RotaryYear } from "@/types/rotaryYear";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";

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

// KPI bucket helpers — mirror the dashboard's groupings.
function isExecutiveRole(name: string): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("president") || n.includes("secretary") || n.includes("treasurer") || n.includes("sergeant");
}
function isServiceChair(name: string): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("foundation") || n.includes("community") || n.includes("club service")
    || n.includes("vocational") || n.includes("international");
}
function isGrowthOutreach(name: string): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("membership") || n.includes("public image") || n.includes("youth") || n.includes("new generation");
}

function exportToCsv(rows: BoardDirector[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Name", "Designation"];
  const lines = rows.map((r, i) => [
    i + 1,
    `"${(r.memberName || "").replace(/"/g, '""')}"`,
    `"${(r.designationName || "").replace(/"/g, '""')}"`,
  ].join(","));
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }) /* BOM: Excel reads UTF-8 */;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `board-of-directors-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BoardOfDirectorsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin, isAG, user } = useAuth();


  const [clubName, setClubName] = useState("");
  const [filterYears, setFilterYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);

  // The board IS the year — each Rotary year has its own directors, and the
  // President/Secretary rows here are what grant those officers their own
  // year's admin rights. So editing a year's board needs that year.
  const boardYearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const isBoardAdmin = isSuperAdmin || isAdmin || isAG;
  const canManage = isBoardAdmin && canEditYear(boardYearRights, selectedYearId, isSuperAdmin);
  const editableYears = heldYearLabels(boardYearRights, filterYears.map((y) => ({ id: y.id, label: y.yearLabel })));
  const [records, setRecords] = useState<BoardDirector[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<BoardDirector | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/board-of-directors/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/board-of-directors/v2/add?returnTo=${returnTo}`;

  // Drag & drop reorder — disabled while a search filter is active (would reorder filtered subset only)
  const { dragProps } = useDragSort(records, setRecords, async (ids) => {
    if (!selectedYearId) return;
    try { await reorderBoardOfDirectors(clubId, selectedYearId, ids); }
    catch { setErrorMessage("Failed to save order."); }
  });

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, boardYrs] = await Promise.all([
          getClub(clubId),
          getBoardYearsByClub(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setFilterYears(boardYrs);
        const currentYear = boardYrs.find((y) => y.isCurrent);
        const defaultYear = currentYear || boardYrs[0];
        if (defaultYear) setSelectedYearId(defaultYear.id);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const fetchRecords = useCallback(async (yearId: number) => {
    setLoadingRecords(true);
    try {
      const bd = await getBoardOfDirectors(clubId, yearId);
      setRecords(bd);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load board of directors.");
    } finally {
      setLoadingRecords(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedYearId) {
      fetchRecords(selectedYearId);
    } else {
      setRecords([]);
    }
  }, [selectedYearId, fetchRecords]);

  const filtered = useMemo<BoardDirector[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      (r.memberName || "").toLowerCase().includes(q) ||
      (r.designationName || "").toLowerCase().includes(q)
    );
  }, [records, search]);

  const yearLabel = filterYears.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  // Aggregate KPIs from the current year's records.
  const boardMembers = records.length;
  const executiveRoles = records.filter((r) => isExecutiveRole(r.designationName)).length;
  const serviceChairs = records.filter((r) => isServiceChair(r.designationName)).length;
  const growthOutreach = records.filter((r) => isGrowthOutreach(r.designationName)).length;

  const refreshAfterDelete = async () => {
    // Refresh filter years (year may have become empty)
    try {
      const boardYrs = await getBoardYearsByClub(clubId);
      setFilterYears(boardYrs);
      if (selectedYearId && boardYrs.some((y) => y.id === selectedYearId)) {
        fetchRecords(selectedYearId);
      } else if (boardYrs.length > 0) {
        const currentYear = boardYrs.find((y) => y.isCurrent);
        const defaultYear = currentYear || boardYrs[0];
        setSelectedYearId(defaultYear.id);
      } else {
        setRecords([]);
        setSelectedYearId(null);
      }
    } catch {
      // ignore — listing will refresh on next year change
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteBoardDirector(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Board director record deleted.");
      await refreshAfterDelete();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete record.");
    }
  };

  return (
    <ProtectedRoute>
      {isBoardAdmin && !canManage && selectedYearId && (
        <ViewOnlyBadge yearLabel={yearLabel} editableYears={editableYears} className="mb-4" />
      )}

      <ClubAdminShell
        pageTitle="Board of Directors"
        pageSubtitle="Year-wise executive board roster"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title="Board of Directors" description={<>RY {yearLabel} · {clubName || "–"}</>} back={`/clubs/${clubId}/dashboard`} />

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Board Members"     value={fmtInt(boardMembers)}     subtitle={`RY ${yearLabel}`}      icon={Users}       color="blue" />
          <KpiCard title="Executive Roles"   value={fmtInt(executiveRoles)}   subtitle="President to Sgt"       icon={Crown}       color="gold" />
          <KpiCard title="Service Chairs"    value={fmtInt(serviceChairs)}    subtitle="Avenue chairs"          icon={HandHeart}   color="green" />
          <KpiCard title="Growth & Outreach" value={fmtInt(growthOutreach)}   subtitle="Membership, PI, Youth"  icon={TrendingUp}  color="purple" />
        </div>

        {/* Table card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">Board of Directors</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "–"} · executive board roster
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={selectedYearId ?? ""}
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                className="w-auto"
              >
                {filterYears.length === 0 && <option value="">No years</option>}
                {filterYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </NativeSelect>
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
                onClick={() => exportToCsv(filtered, yearLabel, clubName || "club")}
                variant="outline" size="sm"
              >
                <Download size={13} /> Export CSV
              </Button>
              {canManage && (
                <Link
                  href={addUrl}
                  className="row-btn row-btn-primary"
                >
                  <Plus size={13} /> Add Board Director
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading || loadingRecords ? (
              <SkeletonRows />
            ) : (
              <Table className="min-w-[640px] md:min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-10">Sr</TableHead>
                    <TableHead className="text-left w-12">Photo</TableHead>
                    <TableHead className="text-left">Name</TableHead>
                    <TableHead className="text-left">Designation</TableHead>
                    {canManage && <TableHead className="text-right w-16">Edit</TableHead>}
                    {canManage && <TableHead className="text-right w-16">Delete</TableHead>}
                    {canManage && <TableHead className="text-center w-16">Sort</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => {
                    const photoUrl = getPhotoUrl(r.profilePhotoPath);
                    const recordsIdx = records.findIndex((rec) => rec.id === r.id);
                    const dragEnabled = canManage && !search;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-slate-500">{i + 1}</TableCell>
                        <TableCell>
                          <div className="relative h-8 w-8 overflow-hidden rounded-full bg-slate-100">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={r.memberName} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-blue-50 text-blue-600">
                                <User className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-slate-800">
                          <span className="inline-flex items-center gap-1.5">
                            {r.memberName}
                            {!r.isMember && (
                              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                Non-Member
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${designationChipStyle(r.designationName)}`}>
                            {r.designationName || "–"}
                          </span>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Link
                              href={`/clubs/${clubId}/board-of-directors/v2/${r.id}/edit?returnTo=${returnTo}`}
                              className="row-icon-btn"
                              aria-label="Edit board director"
                            >
                              <Edit3 size={13} />
                            </Link>
                          </TableCell>
                        )}
                        {canManage && (
                          <TableCell className="text-right">
                            <IconButton
                              type="button"
                              onClick={() => setDeleteTarget(r)}
                              className="hover:text-red-700"
                              aria-label="Delete board director"
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </TableCell>
                        )}
                        {canManage && (
                          <TableCell
                            className="text-center"
                            title={dragEnabled ? "Drag to reorder" : "Clear search to enable reorder"}
                            {...(dragEnabled ? dragProps(recordsIdx) : {})}
                          >
                            <GripVertical className={`h-4 w-4 inline-block ${dragEnabled ? "text-slate-400 cursor-grab" : "text-slate-300 cursor-not-allowed"}`} />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canManage ? 7 : 4} className="text-center text-slate-400">
                        {search
                          ? "No board directors match your search."
                          : filterYears.length === 0
                            ? "No board of directors recorded."
                            : "No records for the selected year."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {filtered.length} board position{filtered.length === 1 ? "" : "s"} · {yearLabel}
          </div>
        </Card>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Board Director"
          description={
            <>Are you sure you want to delete the record for{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.memberName}</span>
              {" "}({deleteTarget?.designationName}, {deleteTarget?.yearLabel})?
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
