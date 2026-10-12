"use client";

/**
 * Sub Groups — District Admin dashboard V2 listing.
 * ---------------------------------------------------------------------------
 * Additive port of the V1 page
 *   (src/app/districts/[id]/sub-groups/page.tsx)
 * into the DA dashboard shell.
 *
 * V2 conventions:
 *   - districtId from useAuth().selectedDistrictId (no /districts/[id] param).
 *   - NO module-level year Select — the global rotary year comes in via the
 *     top bar as ?yearId=. When yearId is missing we show a "pick a year"
 *     hint instead of fetching.
 *   - Add / Edit navigate to dedicated sub-routes carrying returnTo (= this
 *     listing URL) + yearId. Back honours ?returnTo=, else the Quick Links
 *     landing.
 *   - Member list per group is shown via inline expand (no separate route).
 *   - Navy #1e3a5f / gold #F7A81B / slate palette, rounded-2xl bg-white cards.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { SubGroup, SubGroupDetail } from "@/types/subGroup";
import {
  getDistrictSubGroups,
  getDistrictSubGroupDetail,
  deleteDistrictSubGroup,
  getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import {
  ArrowLeft, Plus, Pencil, Trash2, Users, User,
  AlertTriangle, ChevronDown, ChevronRight, CalendarClock,
} from "lucide-react";

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export default function DistrictAdminSubGroupsPage() {
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");
  const canManage = isSuperAdmin || isAdmin;

  const listingUrl = withSearch("/district-admin-dashboard/quick-links/sub-groups", { yearId, returnTo });

  const goBack = () => {
    router.push(returnTo || withSearch("/district-admin-dashboard/quick-links", { yearId }));
  };
  const goAdd = () => {
    router.push(withSearch("/district-admin-dashboard/quick-links/sub-groups/add", { yearId, returnTo: listingUrl }));
  };
  const goEdit = (group: SubGroup) => {
    router.push(withSearch(`/district-admin-dashboard/quick-links/sub-groups/${group.id}/edit`, { yearId, returnTo: listingUrl }));
  };

  const [groups, setGroups] = useState<SubGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubGroup | null>(null);

  // Inline member expand
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, SubGroupDetail>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!districtId || !yearId) return;
    setLoading(true);
    try {
      const data = await getDistrictSubGroups(districtId, Number(yearId));
      setGroups(data);
    } catch { setErrorMessage("Failed to load sub groups."); }
    finally { setLoading(false); }
  }, [districtId, yearId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const toggleExpand = async (group: SubGroup) => {
    if (expandedId === group.id) { setExpandedId(null); return; }
    setExpandedId(group.id);
    if (!detailCache[group.id]) {
      setLoadingDetailId(group.id);
      try {
        const detail: SubGroupDetail = await getDistrictSubGroupDetail(districtId, group.id);
        setDetailCache((prev) => ({ ...prev, [group.id]: detail }));
      } catch { setErrorMessage("Failed to load group members."); }
      finally { setLoadingDetailId(null); }
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictSubGroup(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Sub group deleted successfully.");
      fetchGroups();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete sub group.");
    }
  };

  const filteredGroups = groups.filter((g) =>
    !searchQuery.trim() || (g.groupName || "").toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f]">
                <Users size={22} />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">Sub Groups</h2>
                <div className="h-0.5 w-16 bg-[#F7A81B] rounded mt-1.5" />
                <p className="text-sm text-slate-500 mt-1.5">Manage district sub groups and their members</p>
              </div>
            </div>
          </div>
          {canManage && yearId && (
            <Button onClick={goAdd} className="bg-[#1e3a5f] hover:bg-[#152a44] text-white">
              <Plus className="mr-2 h-4 w-4" />Add Sub Group
            </Button>
          )}
        </div>

        {/* No year selected in the top bar */}
        {!yearId && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CalendarClock className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">Select a year to continue</h3>
            <p className="text-slate-500 mt-2 text-sm">Pick a Rotary year in the top bar to view its sub groups.</p>
          </div>
        )}

        {yearId && (
          <>
            {loading && (
              <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
            )}

            {!loading && groups.length > 0 && (
              <div className="flex items-center gap-4 flex-wrap">
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 font-medium">
                  {groups.length} Group{groups.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            )}

            {!loading && groups.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                <Users className="h-12 w-12 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-800">No sub groups yet</h3>
                <p className="text-slate-500 mt-2 text-sm">
                  {canManage ? 'Click "Add Sub Group" to create your first group.' : "No sub groups have been added yet."}
                </p>
              </div>
            )}

            {!loading && groups.length > 0 && (
              <>
                <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search by group name..." />
                {filteredGroups.length === 0 && searchQuery.trim() !== "" ? (
                  <p className="text-slate-500 text-sm py-8 text-center">
                    No results found for &quot;{searchQuery}&quot;
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredGroups.map((group) => {
                      const isExpanded = expandedId === group.id;
                      const detail = detailCache[group.id];
                      const isLoadingDetail = loadingDetailId === group.id;
                      return (
                        <div key={group.id} className="rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden">
                          <div className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f]">
                                <Users className="h-5 w-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{group.groupName}</p>
                                <Badge variant="outline" className="mt-1 border-slate-200 bg-slate-50 text-slate-700">
                                  <Users className="mr-1 h-3 w-3" />
                                  {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleExpand(group)}
                                className="border-slate-200 text-slate-700 hover:bg-slate-50"
                              >
                                {isExpanded ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
                                View Members
                              </Button>
                              {canManage && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => goEdit(group)}
                                    className="border-slate-200 text-slate-700 hover:bg-slate-50"
                                  >
                                    <Pencil className="mr-1 h-4 w-4" />Edit
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDeleteTarget(group)}
                                    className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                  >
                                    <Trash2 className="mr-1 h-4 w-4" />Delete
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                              {isLoadingDetail ? (
                                <div className="flex items-center justify-center py-6"><RotaryLoader size="sm" /></div>
                              ) : detail && detail.members.length === 0 ? (
                                <p className="text-sm text-slate-500 py-2 text-center">No members in this group.</p>
                              ) : detail ? (
                                <div className="space-y-1 max-h-64 overflow-y-auto">
                                  {detail.members.map((member) => {
                                    const photoUrl = getPhotoUrl(member.profilePhotoPath);
                                    return (
                                      <div key={member.memberId} className="flex items-center gap-3 py-1.5">
                                        <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
                                          {photoUrl ? (
                                            <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center bg-[#1e3a5f]/10 text-[#1e3a5f]">
                                              <User className="h-4 w-4" />
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-slate-800 truncate">{member.memberName}</p>
                                          <p className="text-xs text-slate-500 truncate">
                                            {[member.clubName, member.mobileNumber, member.email].filter(Boolean).join(" | ") || "—"}
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-red-500"
          title="Delete Sub Group"
          description={
            <>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-slate-800">{deleteTarget?.groupName}</span>? This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
