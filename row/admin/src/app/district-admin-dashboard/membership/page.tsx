"use client";

/**
 * District Admin Dashboard — Membership page (Wave 13D2)
 * ---------------------------------------------------------------------------
 * Layout (new, per user request 2026-07-03):
 *   1. Global topbar (from DashboardShell) — district + year picker
 *   2. Five-tab strip: Directory · Directors · District Committee ·
 *        Assistant Governors · Clubs
 *   3. TAB CONTENT is the whole page below the tabs.
 *        - Directory tab: 3 KPI cards (Total / New / Terminated) then a
 *          full member listing with grid/table toggle, search, pagination,
 *          MemberDetailDialog — behaviour ported from
 *          /districts/[id]/members so district admins get the same view
 *          inline in their dashboard.
 *        - Role tabs (Directors etc.): existing 3-stat blocks (count,
 *          active, read-only access) reading from the Wave 13A2
 *          DistrictAdminMembershipResponse.TabCounts array.
 *   4. The old "Set District Membership Goal" banner + Section header +
 *      Active Members KPI are removed.
 */

import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Users, UserPlus, UserMinus, Loader2,
  Search, User, MoreHorizontal, ShieldCheck, ShieldOff, X, Eye, CalendarDays,
} from "@/components/icons";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import MemberDetailDialog from "@/components/MemberDetailDialog";
import { DistrictMember } from "@/types/district";
import { PagedResult } from "@/types/member";
import {
  getDistrictMembers, getPhotoUrl,
  assignDistrictAdmin, removeDistrictAdmin, assignDistrictAdminByDistrictAdmin,
  saveAdminYears, adminYearsSavedMessage,
} from "@/services/api";
import AdminYearsDialog from "@/components/AdminYearsDialog";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { districtYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { ListPageSkeleton, SkeletonRows } from "@/components/row/AppKit";

// -----------------------------------------------------------------------------
// Wave 13A2 extended shape (loose-typed — not yet on the strong DTO).
// -----------------------------------------------------------------------------
interface KpiBlock {
  totalMembers?: number;
  activeMembers?: number;
  newThisYear?: number;
  terminated?: number;
  isPending?: boolean;
}
interface TabStat {
  count?: number;
  active?: number;
  percent?: number;
  readOnlyAccess?: number;
  status?: string;
  isPending?: boolean;
}
interface TabsBlock {
  districtCommittee?: TabStat;
  assistantGovernors?: TabStat;
  clubs?: TabStat;
  isPending?: boolean;
}
interface ExtendedMembership {
  kpis?: KpiBlock;
  tabs?: TabsBlock;
}

// Role tabs — keys that map to TabsBlock fields (all except "directory")
type RoleTabKey = "districtCommittee" | "assistantGovernors" | "clubs";
type TabKey = "directory" | RoleTabKey;

const TAB_LABELS: Record<TabKey, string> = {
  directory: "Directory",
  districtCommittee: "District Committee",
  assistantGovernors: "Assistant Governors",
  clubs: "Clubs",
};

const ROLE_TAB_KEYS: RoleTabKey[] = ["districtCommittee", "assistantGovernors", "clubs"];

// Route each role tab to the matching page UNDER /district-admin-dashboard/
// so the target page inherits DistrictAdminDashboardLayoutClient (navy
// sidebar + shell). The tab also carries the CURRENT global yearId so
// the target page inherits the same year filter as the dashboard tab the
// user was just on.
//
// returnTo carries ?tab=<key> so when the user clicks Back on the module page,
// this membership page re-mounts with the tab bar visually selected on the
// module they came from — not reset to Directory (added 2026-07-10).
const DASHBOARD_RETURN_BASE = "/district-admin-dashboard/membership";
function getRoleTabV2Href(k: RoleTabKey, _districtId: number, yearId: string | null): string | null {
  const returnParams = new URLSearchParams();
  returnParams.set("tab", k);
  if (yearId) returnParams.set("yearId", yearId);
  const returnTo = `${DASHBOARD_RETURN_BASE}?${returnParams.toString()}`;

  const params = new URLSearchParams();
  params.set("returnTo", returnTo);
  if (yearId) params.set("yearId", yearId);
  const qs = `?${params.toString()}`;
  switch (k) {
    case "districtCommittee":
      return `/district-admin-dashboard/district-committee${qs}`;
    case "assistantGovernors":
      return `/district-admin-dashboard/ag${qs}`;
    case "clubs":
      return `/district-admin-dashboard/clubs${qs}`;
    default:
      return null;
  }
}

function PendingChip({ label = "Pending" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {label}
    </span>
  );
}

export default function DistrictAdminMembershipPage() {
  const { membership, status } = useDistrictAdminCache();
  const { isSuperAdmin, selectedDistrictId, user } = useAuth();
  // Viewer is a District Admin (this page is already district-admin-guarded, but we
  // gate the make-admin action on the precise scoped role too).
  const isDistrictAdmin = (user?.scopedRoles ?? []).some(
    (r) => r.roleName === "Admin" && r.scope === "district",
  );
  // ── YWAR-DISTRICT-DIRECTORY-REMOVE-ADMIN ────────────────────────────────
  // Remove Admin is guarded server-side by AdminYearGuard.DistrictYearlessAsync
  // (DistrictModulesController RemoveDistrictAdmin), so it needs CURRENT-year
  // district rights — a 2025-26 admin was offered the button and then told
  // "changing it needs admin rights for the current Rotary year".
  //
  // ⚠️ Make Admin is deliberately NOT gated the same way. Its server route
  // (AssignDistrictAdmin) carries no year-less guard on purpose — the years
  // BEING GRANTED decide, clamped to the ones the caller holds, so a past-year
  // admin is meant to appoint for their own year. Hiding it here would take
  // away something that works.
  //
  // `unknown` (an older API that sends no year data) and allYears ride through
  // canEditYearless — silence must never read as a lockout.
  const { years: rotaryYears, currentYearId: currentRotaryYearId } = useRotaryYears();
  const currentRotaryYearLabel =
    rotaryYears.find((y) => y.id === currentRotaryYearId)?.yearLabel ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYearId = searchParams.get("yearId");

  // Read ?tab= from URL to restore the last-clicked tab on return-navigation
  // (see getRoleTabV2Href which embeds it in returnTo). If URL doesn't carry
  // a valid tab key, default to "directory".
  const initialTabFromUrl = (() => {
    const raw = searchParams.get("tab");
    if (raw === "directory") return "directory" as TabKey;
    if (raw && ROLE_TAB_KEYS.includes(raw as RoleTabKey)) return raw as TabKey;
    return "directory" as TabKey;
  })();
  // Role tabs act as navigation links — clicking one navigates away; only
  // Directory content renders inline (always visible below the tab bar).
  // that jump straight to the module's V2 page. If tabs value goes stale
  // after a click (before the route swap paints), we snap it back.
  const [activeTab, setActiveTab] = useState<TabKey>(initialTabFromUrl);

  // Directory-tab local state — mirrors /districts/[id]/members --------------
  const [dirData, setDirData] = useState<PagedResult<DistrictMember> | null>(null);
  const [dirLoading, setDirLoading] = useState(true);
  const [dirPage, setDirPage] = useState(1);
  const [dirSearch, setDirSearch] = useState("");
  const [detailMemberId, setDetailMemberId] = useState<number | null>(null);
  const [roleLoading, setRoleLoading] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const data = membership;
  const ext = data as unknown as ExtendedMembership | undefined;
  const districtIdForApi = selectedDistrictId ?? data?.district.districtId ?? 0;

  // See YWAR-DISTRICT-DIRECTORY-REMOVE-ADMIN above. Keyed off districtIdForApi,
  // NOT selectedDistrictId — that is null for a SuperAdmin whose district comes
  // from the cached payload, and reading rights for district 0 would hide the
  // action from someone who holds it.
  const districtRights = districtYearRights(user?.scopedRoles, districtIdForApi);
  const canRemoveAdmin = canEditYearless(districtRights, currentRotaryYearId, isSuperAdmin);

  const fetchDirectory = useCallback(async (pageNum: number, search: string) => {
    if (!districtIdForApi) return;
    setDirLoading(true);
    try {
      const result = await getDistrictMembers(districtIdForApi, pageNum, 20, search || undefined);
      setDirData(result);
    } catch { /* handled via ErrorAlert if needed */ }
    finally { setDirLoading(false); }
  }, [districtIdForApi]);

  // Load first page when the Directory tab is active (skip when user came
  // back on a role-tab highlight — content isn't rendered so a fetch would
  // be wasted).
  useEffect(() => {
    if (districtIdForApi > 0 && activeTab === "directory" && !dirData) {
      fetchDirectory(1, "");
    }
  }, [districtIdForApi, activeTab, dirData, fetchDirectory]);

  // ── Early returns — AFTER all hooks above (Rules of Hooks) ──────────────
  // District admin rights are per Rotary year — pick them before promoting.
  // ⚠️ Must sit above EVERY early return below: a hook has to run on each
  // render, or React counts a different number once the data arrives.
  const [adminYearTarget, setAdminYearTarget] = useState<{ id: number; name: string; editing?: boolean } | null>(null);

  if (status === "loading" && !membership) {
    return (
      <SkeletonRows />
    );
  }
  if (status === "error" && !membership) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load membership.</div>;
  }
  if (!membership || !data || !ext) return null;

  // ── Resolve KPI values ──────────────────────────────────────────────────
  const kpisPending = ext.kpis?.isPending === true;
  const kpiTotal        = ext.kpis?.totalMembers ?? data.totalMembers;
  const kpiNewThisYear  = ext.kpis?.newThisYear  ?? data.newMembersThisYear;
  const kpiTerminated   = ext.kpis?.terminated   ?? data.terminatedThisYear;

  // Role-tab stats block (Total / Active / Read-Only) was removed on
  // user request — the role tabs now show a single "Open Manager" button
  // that links out to the module's V2 page. No tab-stat resolution needed.

  // ── Directory listing filters/handlers ──────────────────────────────────
  const handleDirSearch = () => {
    setDirPage(1);
    fetchDirectory(1, dirSearch);
  };
  const handleDirKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleDirSearch(); }
  };
  const handleDirPageChange = (newPage: number) => {
    setDirPage(newPage);
    fetchDirectory(newPage, dirSearch);
  };

  const dirItems = dirData?.items ?? [];
  const dirFiltered = dirItems;

  const handleMakeAdmin = (memberId: number, memberName: string) => {
    setAdminYearTarget({ id: memberId, name: memberName });
  };

  const handleConfirmAdminYears = async (picked: { yearIds: number[]; allYears: boolean }) => {
    if (!adminYearTarget) return;
    const { id: memberId, name: memberName } = adminYearTarget;
    setRoleLoading(memberId);
    try {
      // Use the district-admin-scoped endpoint — it authorizes both SuperAdmin and a
      // District Admin of this district, and NEVER grants club access (that stays
      // SuperAdmin-only via the district directory toggle).
      await assignDistrictAdminByDistrictAdmin(districtIdForApi, memberId, picked);
      setAdminYearTarget(null);
      setSuccessMessage(
        picked.allYears
          ? `${memberName} has been made District Admin for all Rotary years.`
          : `${memberName} has been made District Admin for ${picked.yearIds.length} Rotary year${picked.yearIds.length === 1 ? "" : "s"}.`
      );
      fetchDirectory(dirPage, dirSearch);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to assign District Admin role.");
      throw err;   // keeps the dialog open with the reason
    } finally {
      setRoleLoading(null);
    }
  };

  // "Edit Years": same picker, pre-ticked with what they hold; saves in place.
  const handleConfirmEditYears = async (picked: { yearIds: number[]; allYears: boolean }) => {
    if (!adminYearTarget) return;
    const { id: memberId, name: memberName } = adminYearTarget;
    setRoleLoading(memberId);
    try {
      const res = await saveAdminYears({ kind: "district", districtId: districtIdForApi }, memberId, picked);
      setAdminYearTarget(null);
      setSuccessMessage(adminYearsSavedMessage(memberName, res));
      fetchDirectory(dirPage, dirSearch);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update admin years.");
      throw err;
    } finally {
      setRoleLoading(null);
    }
  };

  const handleRemoveAdmin = async (memberId: number, memberName: string) => {
    setRoleLoading(memberId);
    try {
      await removeDistrictAdmin(districtIdForApi, memberId);
      setSuccessMessage(`District Admin role removed from ${memberName}.`);
      fetchDirectory(dirPage, dirSearch);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to remove District Admin role.");
    } finally {
      setRoleLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Full-screen loader while a Make/Remove Admin request is in flight. */}
      {roleLoading !== null && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-slate-950/60">
          <ListPageSkeleton />
          <p className="text-sm font-medium text-slate-100">Updating admin role…</p>
        </div>
      )}
      {/* ── Tabs (moved to top per new design) ───────────────────────────
          Role tabs behave as NAVIGATION LINKS — clicking any of the four
          module tabs jumps straight to its /v2 page (which already carries
          the new navy/gold/slate design and full add/edit/delete UX). The
          Directory tab keeps rendering inline below.                     */}
      <Card className="p-3">
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const key = v as TabKey;
            if (key === "directory") {
              setActiveTab("directory");
              return;
            }
            const href = getRoleTabV2Href(key as RoleTabKey, districtIdForApi, currentYearId);
            if (href) router.push(href);
          }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList
            >
              {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
                <TabsTrigger
                  key={k}
                  value={k}
                >
                  {TAB_LABELS[k]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ── DIRECTORY TAB ─────────────────────────────────────────────
              Only rendered when activeTab === "directory". When user returns
              from a module via returnTo?tab=<key>, activeTab = <key>, the
              tab bar highlights that key and this content is hidden — user
              sees only the tab bar with their last-clicked module marked.
              Clicking the Directory tab surfaces this content back.       */}
          <TabsContent value="directory" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard
                title="Total Members"
                value={kpisPending ? "–" : fmtInt(kpiTotal)}
                subtitle={kpisPending ? "Pending" : "District-wide"}
                icon={Users}
                color="blue"
              />
              <KpiCard
                title="New This Year"
                value={kpisPending ? "–" : fmtInt(kpiNewThisYear)}
                subtitle={kpisPending ? "Pending" : `RY ${data.district.yearLabel}`}
                icon={UserPlus}
                color="teal"
              />
              <KpiCard
                title="Terminated"
                value={kpisPending ? "–" : fmtInt(kpiTerminated)}
                subtitle={kpisPending ? "Pending" : `RY ${data.district.yearLabel}`}
                icon={UserMinus}
                color="red"
              />
            </div>

            {/* YWAR-DISTRICT-DIRECTORY-REMOVE-ADMIN — says why Remove Admin is gone.
                Shown only to someone who would otherwise have had it: without this
                the row's menu just disappears and the page looks broken. */}
            {(isSuperAdmin || isDistrictAdmin) && !canRemoveAdmin && (
              <ViewOnlyBadge
                currentYearOnly={currentRotaryYearLabel}
                currentYearOnlyActions="remove an admin, or add, edit and delete"
              />
            )}

            {/* Search bar — dashboard palette (slate wrapper, navy button) */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by member name, email, or Rotary ID..."
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  onKeyDown={handleDirKeyDown}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleDirSearch}
                  size="sm"
                 
                >
                  <Search className="mr-2 h-4 w-4" />
                  Search
                </Button>
                {dirSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDirSearch(""); setDirPage(1); fetchDirectory(1, ""); }}
                   
                  >
                    <X className="mr-1 h-4 w-4" />Clear
                  </Button>
                )}
              </div>
            </div>

            {dirLoading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}

            {!dirLoading && dirData && dirData.items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="row-h2">No members found</h3>
                <p className="text-muted-foreground mt-2">Try a different search term.</p>
              </div>
            )}

            {!dirLoading && dirData && dirFiltered.length > 0 && (
              <>
                {/* Dashboard-palette table: white card, navy header row with
                    gold underline, slate row hovers. Mirrors the look of the
                    other dashboard listings (Overview leaderboard, Foundation
                    project tables). */}
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="hover:opacity-100 border-b-2 border-marigold"
                        style={{ backgroundColor: "#17458f" }}
                      >
                        <TableHead className="w-12/90"></TableHead>
                        <TableHead>Member Name</TableHead>
                        <TableHead className="hidden md:table-cell">Rotary ID</TableHead>
                        <TableHead className="hidden md:table-cell">Email</TableHead>
                        <TableHead className="hidden lg:table-cell">Phone</TableHead>
                        <TableHead className="hidden lg:table-cell">Club</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead className="w-12/90"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dirFiltered.map((member) => {
                        const photoUrl = getPhotoUrl(member.profilePhotoPath);
                        return (
                          <TableRow
                            key={member.id}
                            className={`hover:bg-slate-50/70 transition-colors cursor-pointer border-slate-100 ${roleLoading === member.id ? "opacity-60 pointer-events-none" : ""}`}
                            onClick={() => setDetailMemberId(member.id)}
                          >
                            <TableCell>
                              <div className="relative h-8 w-8 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                                {photoUrl ? (
                                  <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500">
                                    <User className="h-4 w-4" />
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-semibold text-slate-800">{member.memberName}</TableCell>
                            <TableCell className="hidden md:table-cell text-slate-600 text-sm">{member.rotaryId || "–"}</TableCell>
                            <TableCell className="hidden md:table-cell text-slate-600 text-sm">{member.emailId || "–"}</TableCell>
                            <TableCell className="hidden lg:table-cell text-slate-600 text-sm">{member.primaryMobileNumber || "–"}</TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-slate-500">{member.clubName || "–"}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(() => {
                                  const displayRoles = member.roles?.filter(r => !(r === "Member" && member.roles.some(x => x === "Admin" || x === "Club Admin" || x === "District Admin" || x === "SuperAdmin")));
                                  return displayRoles && displayRoles.length > 0 ? displayRoles.map((role) => (
                                    <Badge
                                      key={role}
                                      variant="outline"
                                      className="text-[10px] font-medium border-slate-200 bg-slate-50 text-slate-700"
                                    >
                                      {role}
                                    </Badge>
                                  )) : (
                                    <Badge
                                      variant="outline" className="border-slate-200 bg-slate-50 text-slate-700"
                                    >
                                      Member
                                    </Badge>
                                  );
                                })()}
                              </div>
                            </TableCell>
                            <TableCell className="w-24 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="inline-flex items-center gap-1.5">
                              {/* View (eye) — ALWAYS shown, outside every permission gate,
                                  mirroring the club Directory tab. The whole row already
                                  opens this dialog, but the cell stops propagation, so
                                  without a button of its own the Actions column rendered
                                  empty for a past-year admin and read as broken. */}
                              <IconButton
                                type="button"
                                onClick={() => setDetailMemberId(member.id)}
                                aria-label={`View details for ${member.memberName}`}
                                
                              >
                                <Eye size={15} />
                              </IconButton>
                              {/* YWAR-DISTRICT-DIRECTORY-REMOVE-ADMIN — the menu holds
                                  exactly one item, so when Remove Admin is hidden the
                                  trigger goes with it rather than opening empty. */}
                              {(isSuperAdmin || isDistrictAdmin) && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {/* A SuperAdmin can also be made this district's Admin (user 2026-10-09) -
                                        the menu used to be empty on their row. Roles no longer conflict. */}
                                    {member.hasDistrictAdminRole ? (
                                      <>
                                        {/* Edit Years follows Make Admin's rule (years being
                                            granted), not Remove Admin's current-year gate. */}
                                        <DropdownMenuItem onClick={() => setAdminYearTarget({ id: member.id, name: member.memberName, editing: true })}>
                                          <CalendarDays className="mr-2 h-4 w-4" />Edit Years
                                        </DropdownMenuItem>
                                        {canRemoveAdmin && (
                                          <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName)}>
                                            <ShieldOff className="mr-2 h-4 w-4" />Remove Admin
                                          </DropdownMenuItem>
                                        )}
                                      </>
                                    ) : (
                                      <DropdownMenuItem onClick={() => handleMakeAdmin(member.id, member.memberName)}>
                                        <ShieldCheck className="mr-2 h-4 w-4" />Make Admin
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
                <Pagination page={dirData.page} totalPages={dirData.totalPages} totalCount={dirData.totalCount} pageSize={dirData.pageSize} onPageChange={handleDirPageChange} />
              </>
            )}
          </TabsContent>

          {/* Role-tab click is intercepted by onValueChange above — it
              navigates to the V2 page instead of switching content, so no
              TabsContent panels are needed here. Directory tab is the
              only tab with inline content (rendered above).              */}
        </Tabs>
      </Card>

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      <MemberDetailDialog memberId={detailMemberId} open={detailMemberId !== null} onClose={() => setDetailMemberId(null)} />

      {adminYearTarget && (
        <AdminYearsDialog
          open
          scope={{ kind: "district", districtId: districtIdForApi }}
          memberId={adminYearTarget.id}
          memberName={adminYearTarget.name}
          confirmLabel={adminYearTarget.editing ? "Save" : "Make District Admin"}
          onCancel={() => setAdminYearTarget(null)}
          onConfirm={adminYearTarget.editing ? handleConfirmEditYears : handleConfirmAdminYears}
        />
      )}
    </div>
  );
}
