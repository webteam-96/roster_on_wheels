"use client";

/**
 * Potential Members v2 listing — part of the frontend overhaul.
 *
 * Visual style mirrors the Club Admin Dashboard "Rotary Network" tab
 * (KPI tiles, dense table, soft hover, chip-styled badges) but the
 * data comes from the existing v1 API surface
 * (getPotentialMembers + getClub). No backend changes.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 *
 * Note: the API DTO only exposes id/clubId/name/email/mobileNumber/
 * referenceDetails. There is no referrer-name or date-added field
 * exposed, so the listing surfaces what's actually available rather
 * than fabricating columns.
 */

import { IconButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { UserPlus, Mail, Phone, AlertCircle, Search, Plus, Edit3, Trash2, AlertTriangle, UserCheck } from "@/components/icons";
import {
  getClub,
  getPotentialMembers,
  deletePotentialMember,
  convertPotentialMember,
} from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { CONTACTS_FEATURE, PROSPECT_STAGES, errorText, label } from "@/lib/contacts";
import { PotentialMember } from "@/types/potentialMember";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import Pagination from "@/components/Pagination";

import { ClearButton } from "@/components/ui/text-buttons"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
const KPI_PAGE_SIZE = 1000;
const LIST_PAGE_SIZE = 20;

export default function PotentialMembersV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [allForKpis, setAllForKpis] = useState<PotentialMember[]>([]);
  const [members, setMembers] = useState<PotentialMember[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<PotentialMember | null>(null);
  // Prospect pipeline (feature contacts_growth): stage filter and one-click conversion to a member.
  const pipelineOn = useFeatureOn(CONTACTS_FEATURE);
  const [stage, setStage] = useState("");
  const [convertTarget, setConvertTarget] = useState<PotentialMember | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/rotary-network/potential-members/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/rotary-network/potential-members/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function fetchClub() {
      try {
        const club = await getClub(clubId);
        if (!cancelled) setClubName(club.clubName);
      } catch {
        // non-fatal
      }
    }
    fetchClub();
    return () => { cancelled = true; };
  }, [clubId]);

  // Aggregate fetch for KPI tiles — pulls a large page so the tiles reflect
  // the entire dataset for the club, not just the current paged slice.
  const fetchKpiBucket = useCallback(async () => {
    try {
      const result = await getPotentialMembers(clubId, 1, KPI_PAGE_SIZE, undefined);
      setAllForKpis(result.items);
    } catch {
      setAllForKpis([]);
    }
  }, [clubId]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPotentialMembers(clubId, page, LIST_PAGE_SIZE, search || undefined, stage || undefined);
      setMembers(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setMembers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, search, stage]);

  useEffect(() => { fetchKpiBucket(); }, [fetchKpiBucket]);
  useEffect(() => { fetchPage(); }, [fetchPage]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE));

  // KPI aggregates from the full bucket.
  const kpis = useMemo(() => {
    const total = allForKpis.length;
    const withEmail = allForKpis.filter((m) => !!(m.email && m.email.trim())).length;
    const withMobile = allForKpis.filter((m) => !!(m.mobileNumber && m.mobileNumber.trim())).length;
    const withoutContact = allForKpis.filter((m) =>
      !(m.email && m.email.trim()) && !(m.mobileNumber && m.mobileNumber.trim())
    ).length;
    return { total, withEmail, withMobile, withoutContact };
  }, [allForKpis]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePotentialMember(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Potential member deleted successfully.");
      fetchPage();
      fetchKpiBucket();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete potential member.");
    }
  };

  // Creates the member through the member add path (duplicate checks included) and marks the prospect inducted.
  const handleConvert = async () => {
    const target = convertTarget;
    setConvertTarget(null);
    if (!target) return;
    try {
      await convertPotentialMember(clubId, target.id);
      setSuccessMessage(`${target.name} is now a member of the club.`);
      fetchPage();
      fetchKpiBucket();
    } catch (err) {
      setErrorMessage(errorText(err, "Could not add this prospect as a member."));
    }
  };

  const columnCount = 5 + (pipelineOn ? 2 : 0) + (canManage ? 2 : 0) + (canManage && pipelineOn ? 1 : 0);

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Potential Members"
        pageSubtitle="Prospective members"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title="Potential Members" description={<>Prospective members for {clubName || "this club"}</>} back={`/clubs/${clubId}/rotary-network`} />

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Potential"   value={fmtInt(kpis.total)}          subtitle="All records"          icon={UserPlus}    color="blue"   />
          <KpiCard title="With Email"        value={fmtInt(kpis.withEmail)}      subtitle="Reachable by email"   icon={Mail}        color="green"  />
          <KpiCard title="With Mobile"       value={fmtInt(kpis.withMobile)}     subtitle="Reachable by phone"   icon={Phone}       color="gold"   />
          <KpiCard title="Without Contact"   value={fmtInt(kpis.withoutContact)} subtitle="No email or mobile"   icon={AlertCircle} color="red"    />
        </div>

        {/* Table card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">Potential Members</h3>
              <p className="text-xs text-slate-500 mt-0.5">Prospective members the club may invite to join</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search name, email or mobile…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-7 pr-7 sm:w-64"
                />
                {searchInput && (
                  <ClearButton
                    type="button"
                    onClick={clearSearch}
                     aria-label="Clear search">
                    ×
                  </ClearButton>
                )}
              </div>
              <Button
                type="button"
                onClick={handleSearch}
                variant="outline" size="sm"
              >
                Search
              </Button>
              {pipelineOn && (
                <NativeSelect
                  aria-label="Stage"
                  value={stage}
                  onChange={(e) => { setPage(1); setStage(e.target.value); }}
                  className="w-auto"
                >
                  <option value="">All stages</option>
                  {PROSPECT_STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </NativeSelect>
              )}
              {canManage && pipelineOn && (
                <Link
                  href={`/clubs/${clubId}/rotary-network/potential-members/v2/follow-ups`}
                  className="row-btn row-btn-secondary"
                >
                  Follow-ups and notifications
                </Link>
              )}
              {canManage && (
                <Link
                  href={addUrl}
                  className="row-btn row-btn-primary"
                >
                  <Plus size={13} /> Add Potential Member
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="space-y-3 p-4" aria-label="Loading potential members">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : (
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-12">Sr</TableHead>
                    <TableHead className="text-left">Name</TableHead>
                    <TableHead className="text-left">Email</TableHead>
                    <TableHead className="text-left">Mobile</TableHead>
                    <TableHead className="text-left">Reference Details</TableHead>
                    {pipelineOn && <TableHead className="text-left">Stage</TableHead>}
                    {pipelineOn && <TableHead className="text-left">Owner</TableHead>}
                    {canManage && pipelineOn && <TableHead className="text-right w-24">Member</TableHead>}
                    {canManage && <TableHead className="text-right w-16">Edit</TableHead>}
                    {canManage && <TableHead className="text-right w-16">Delete</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m, i) => (
                    <TableRow key={m.id}>
                      <TableCell>{(page - 1) * LIST_PAGE_SIZE + i + 1}</TableCell>
                      <TableCell className="font-medium">{m.name || "–"}</TableCell>
                      <TableCell>{m.email || <span className="text-slate-400">–</span>}</TableCell>
                      <TableCell className="whitespace-nowrap">{m.mobileNumber || <span className="text-slate-400">–</span>}</TableCell>
                      <TableCell className="max-w-[320px] truncate" title={m.referenceDetails || ""}>
                        {m.referenceDetails || <span className="text-slate-400">–</span>}
                      </TableCell>
                      {pipelineOn && (
                        <TableCell className="whitespace-nowrap" title={m.notes || ""}>{label(m.stage)}</TableCell>
                      )}
                      {pipelineOn && <TableCell>{m.ownerName || "-"}</TableCell>}
                      {canManage && pipelineOn && (
                        <TableCell className="text-right">
                          {m.convertedMemberId ? (
                            <span className="text-xs text-emerald-700">Member</span>
                          ) : (
                            <Button
                              type="button"
                              onClick={() => setConvertTarget(m)}
                              variant="outline" size="sm"
                            >
                              <UserCheck size={13} /> Make member
                            </Button>
                          )}
                        </TableCell>
                      )}
                      {canManage && (
                        <TableCell className="text-right">
                          <Link
                            href={`/clubs/${clubId}/rotary-network/potential-members/v2/${m.id}/edit?returnTo=${returnTo}`}
                            className="row-icon-btn"
                            aria-label="Edit potential member"
                          >
                            <Edit3 size={13} />
                          </Link>
                        </TableCell>
                      )}
                      {canManage && (
                        <TableCell className="text-right">
                          <IconButton
                            type="button"
                            onClick={() => setDeleteTarget(m)}
                            className="hover:text-red-700"
                            aria-label="Delete potential member"
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={columnCount} className="py-10 text-center text-muted-foreground">
                        {search ? "No potential members match your search." : "No potential members for this club yet."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Footer / pagination */}
          <div className="px-5 py-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
            <span>
              {totalCount} potential member{totalCount === 1 ? "" : "s"}
              {search ? " (filtered)" : ""}
            </span>
          </div>
          {totalPages > 1 && <div className="px-5 py-3 border-t border-slate-100"><Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={LIST_PAGE_SIZE} onPageChange={setPage} /></div>}
        </Card>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Potential Member"
          description={
            <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? This action cannot be undone.</>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <AlertModal
          open={!!convertTarget}
          onOpenChange={(o) => !o && setConvertTarget(null)}
          icon={UserCheck}
          iconClassName="text-azure"
          title="Make member"
          description={
            <>Add <span className="font-semibold text-foreground">{convertTarget?.name}</span> to the club as a member, with the details on this record? The usual duplicate checks on email and mobile apply.</>
          }
          confirmLabel="Make member"
          confirmClassName="bg-azure text-white hover:bg-mint-ink"
          onConfirm={handleConvert}
          cancelLabel="Cancel"
          onCancel={() => setConvertTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
