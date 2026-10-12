"use client";

/**
 * Sub Groups — Add form (District Admin dashboard V2).
 * ---------------------------------------------------------------------------
 * Additive port of the V1 add dialog
 *   (src/app/districts/[id]/sub-groups/page.tsx — Add/Edit dialog)
 * as a dedicated route under the DA dashboard shell.
 *
 *   - districtId from useAuth().selectedDistrictId; yearId from ?yearId=.
 *   - NO year Select — the group is created against the top-bar year.
 *   - Save / Cancel / Back honour ?returnTo=, else the Quick Links Sub Groups
 *     listing (with yearId preserved).
 *   - Navy #1e3a5f / gold #F7A81B / slate palette.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { SubGroupMember } from "@/types/subGroup";
import {
  createDistrictSubGroup,
  getDistrictSubGroupMembers,
  getPhotoUrl,
  getRotaryYears,
} from "@/services/api";
import { RotaryYear } from "@/types/rotaryYear";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Search, X, User } from "lucide-react";

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export default function DistrictAdminAddSubGroupPage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");

  const fallback = withSearch("/district-admin-dashboard/quick-links/sub-groups", { yearId });
  const goBack = () => router.push(returnTo || fallback);

  const [groupName, setGroupName] = useState("");
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>(yearId ?? "");
  const [allMembers, setAllMembers] = useState<SubGroupMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set());
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!districtId) return;
    setLoadingMembers(true);
    try {
      const m: SubGroupMember[] = await getDistrictSubGroupMembers(districtId);
      setAllMembers(m);
    } catch { setErrorMessage("Failed to load members."); }
    finally { setLoadingMembers(false); }
  }, [districtId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    (async () => {
      try {
        const y = await getRotaryYears();
        setYears(y);
        if (!selectedYearId) {
          const cur = y.find((r) => r.isCurrent);
          if (cur) setSelectedYearId(String(cur.id));
        }
      } catch {
        // silent — Year select just stays empty; save-time guard will show a message.
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LEFT (Available): keep one row PER member-club membership so if a member
  // is in N clubs they appear N times — user can see & search each club.
  // Token-based search: "john smit" matches "John Smith"; extra spaces
  // collapsed; club name is searchable too.
  const availableMembers = useMemo(() => {
    const available = allMembers.filter((m) => !selectedMemberIds.has(m.memberId));
    const raw = memberSearchQuery.trim().toLowerCase();
    if (!raw) return available;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return available.filter((m) => {
      const hay = [m.memberName, m.mobileNumber, m.email, m.clubName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/\s+/g, " ");
      return tokens.every((t) => hay.includes(t));
    });
  }, [allMembers, selectedMemberIds, memberSearchQuery]);

  // RIGHT (Selected): dedupe by memberId — one row per person, with all
  // their club names joined, so selecting any one club row promotes just
  // one entry to the Selected list.
  const selectedMembers = useMemo(() => {
    const map = new Map<number, SubGroupMember & { clubNames: string[] }>();
    for (const m of allMembers) {
      if (!selectedMemberIds.has(m.memberId)) continue;
      const existing = map.get(m.memberId);
      if (existing) {
        if (m.clubName && !existing.clubNames.includes(m.clubName)) existing.clubNames.push(m.clubName);
      } else {
        map.set(m.memberId, { ...m, clubNames: m.clubName ? [m.clubName] : [] });
      }
    }
    return Array.from(map.values());
  }, [allMembers, selectedMemberIds]);

  const toggleMember = (memberId: number) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    });
  };
  const removeMember = (memberId: number) => {
    setSelectedMemberIds((prev) => { const next = new Set(prev); next.delete(memberId); return next; });
  };
  const selectAllAvailable = (checked: boolean) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (checked) availableMembers.forEach((m) => next.add(m.memberId));
      else availableMembers.forEach((m) => next.delete(m.memberId));
      return next;
    });
  };

  const handleSave = async () => {
    if (!groupName.trim()) { setErrorMessage("Please enter a group name."); return; }
    if (!selectedYearId) { setErrorMessage("Please select a Rotary year."); return; }
    if (selectedMemberIds.size === 0) { setErrorMessage("Please select at least one member."); return; }
    setSaving(true);
    try {
      await createDistrictSubGroup(districtId, {
        yearId: Number(selectedYearId),
        groupName: groupName.trim(),
        memberIds: Array.from(selectedMemberIds),
      });
      setSuccessMessage("Sub group created successfully.");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save sub group.");
      setSaving(false);
    }
  };

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* ── Header ─────────────────────────────────────────────────── */}
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
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">Add Sub Group</h2>
            <div className="h-0.5 w-16 bg-[#F7A81B] rounded mt-1.5" />
            <p className="text-sm text-slate-500 mt-1.5">Create a new sub group and add members</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 shadow-sm bg-white p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Group Name *</Label>
              <Input
                className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                placeholder="Enter group name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Rotary Year *</Label>
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-700 text-sm font-medium">Members *</Label>
            {loadingMembers ? (
              <div className="flex items-center justify-center py-8"><RotaryLoader size="md" /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Available */}
                <div className="border border-slate-200 rounded-md flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-700">Available Members</span>
                      <span className="text-xs text-slate-500">{availableMembers.length} available</span>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        placeholder="Search..."
                        value={memberSearchQuery}
                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                        className="pl-8 h-8 text-sm border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                      />
                      {memberSearchQuery && (
                        <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setMemberSearchQuery("")}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {availableMembers.length > 0 && (
                    <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-2">
                      <Checkbox
                        id="selectAll"
                        checked={availableMembers.length > 0 && availableMembers.every((m) => selectedMemberIds.has(m.memberId))}
                        onCheckedChange={(checked) => selectAllAvailable(!!checked)}
                      />
                      <label htmlFor="selectAll" className="text-xs font-medium cursor-pointer text-slate-600">
                        Select All ({availableMembers.length})
                      </label>
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto max-h-[320px]">
                    {availableMembers.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-sm text-slate-500">
                        {memberSearchQuery ? "No members match search" : "No available members"}
                      </div>
                    ) : (
                      availableMembers.map((member, idx) => {
                        const photoUrl = getPhotoUrl(member.profilePhotoPath);
                        return (
                          <div
                            key={`${member.memberId}-${member.clubName ?? "_"}-${idx}`}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-100 last:border-b-0"
                            onClick={() => toggleMember(member.memberId)}
                          >
                            <Checkbox
                              checked={selectedMemberIds.has(member.memberId)}
                              onCheckedChange={() => toggleMember(member.memberId)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
                              {photoUrl ? (
                                <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[#1e3a5f]/10 text-[#1e3a5f]">
                                  <User className="h-3.5 w-3.5" />
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
                      })
                    )}
                  </div>
                </div>

                {/* Selected */}
                <div className="border border-slate-200 rounded-md flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">Selected Members</span>
                    <Badge variant="outline" className="text-xs border-slate-200 bg-white text-slate-700">{selectedMemberIds.size} selected</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[366px]">
                    {selectedMembers.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-sm text-slate-500">No members selected</div>
                    ) : (
                      selectedMembers.map((member) => {
                        const photoUrl = getPhotoUrl(member.profilePhotoPath);
                        return (
                          <div key={member.memberId} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0">
                            <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
                              {photoUrl ? (
                                <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[#1e3a5f]/10 text-[#1e3a5f]">
                                  <User className="h-3.5 w-3.5" />
                                </div>
                              )}
                            </div>
                            <span className="text-sm font-medium flex-1 truncate text-slate-800">{member.memberName}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-red-600" onClick={() => removeMember(member.memberId)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={goBack} disabled={saving} className="border-slate-200 text-slate-700 hover:bg-slate-50">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !groupName.trim() || !selectedYearId || selectedMemberIds.size === 0}
              className="bg-[#1e3a5f] hover:bg-[#152a44] text-white disabled:bg-slate-300 disabled:text-slate-500"
            >
              {saving ? "Saving..." : "Create"}
            </Button>
          </div>
        </div>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={goBack} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
