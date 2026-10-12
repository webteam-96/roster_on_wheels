"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  getGoalRoleAssignments, createGoalRoleAssignment, revokeGoalRoleAssignment,
  sendGoalRoleAssignmentEmails, downloadGoalRoleAssignments,
  changeGoalRoleAssignment, sendGoalRoleCredentials, getAssignedDirectorZones, addGoalRoleHolder,
  getZones, getDistricts,
  getRotaryYears, importGoalFoundationMonthly, importGoalFoundationClub,
  downloadGoalFoundationSample, downloadGoalFoundationClubSample, convertGoalFoundationClubFile,
  getGoalDesignations, searchGoalZoneMembers, searchGoalMembers,
} from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";
import { fileTimestamp } from "@/lib/dateUtils";
import type { GoalFoundationImportResultDto } from "@/types/goalSetting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Search, UserPlus, UserMinus, Target, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Settings2, Mail, Download, UserCog, Plus, X } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import MemberContactCardDialog from "@/components/MemberContactCardDialog";
import GoalReadonlyViewer from "@/components/GoalReadonlyViewer";
import type {
  GoalRoleAssignmentDto, GoalRoleType, GoalDesignationDto,
} from "@/types/goalSetting";
import type { ZoneListItem } from "@/types/zone";
import type { DistrictListItem } from "@/types/district";

const RI = "AllCategoryAllDistrictsFewZones";
const ZC = "AllDistrictsOneCategoryOneZone";
const DA = "FewDistrictsOneCategoryOneZone";

type PickedMember = { id: number; name: string } | null;

// ── Member search widget (each Add form gets its own, so searches never collide). Scoped to the
//    selected zone(s): pass `zoneIds` and it only searches members of those zones. With an empty
//    zoneIds it prompts to pick a zone first (rather than dumping every member). Type 2+ chars →
//    debounced search; click a row to select. ─────────────────────────────────────────────────
function MemberPicker({
  selected, onSelect, onClear, zoneIds, global = false, placeholder = "Search members in the selected zone(s)…",
}: {
  selected: PickedMember;
  onSelect: (m: { id: number; name: string }) => void;
  onClear: () => void;
  zoneIds: number[];
  // global = search EVERY member (any zone). Used where the holder need not belong to the zone —
  // e.g. an RI Director (a zone-4 member can cover zone 5/6) and the "Change member" dialog.
  global?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const zoneKey = (zoneIds || []).join(",");

  useEffect(() => {
    const s = q.trim();
    if (selected || (!global && zoneIds.length === 0) || s.length < 2) { setRows([]); setBusy(false); return; }
    setBusy(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try { const r = global ? await searchGoalMembers(s) : await searchGoalZoneMembers(zoneIds, s); if (!cancelled) setRows(r || []); }
      catch { if (!cancelled) setRows([]); }
      finally { if (!cancelled) setBusy(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selected, zoneKey, global]);

  if (selected) {
    return (
      <div className="flex items-center gap-2 border rounded-lg px-3 py-2 w-fit">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-medium">{selected.name}</span>
        <Button variant="ghost" size="sm" onClick={() => { setQ(""); onClear(); }}>Change</Button>
      </div>
    );
  }
  if (!global && zoneIds.length === 0) {
    return <p className="text-xs text-amber-600">Select the zone(s) first — then this zone&apos;s members load here.</p>;
  }
  return (
    <div>
      <div className="relative max-w-lg">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        {busy && <span className="absolute right-2.5 top-1/2 -translate-y-1/2"><RotaryLoader size="sm" /></span>}
      </div>
      {rows.length > 0 && (
        <div className="border rounded-lg overflow-x-auto mt-2 max-h-56 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Member</TableHead>
                <TableHead>Club · District</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m: any) => {
                const clubDist = [m.clubName, m.districtNumber ? `D ${m.districtNumber}` : null].filter(Boolean).join(" · ");
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer hover:bg-blue-50"
                    onClick={() => { onSelect({ id: m.id, name: clubDist ? `${m.memberName} (${clubDist})` : m.memberName }); setQ(""); setRows([]); }}
                  >
                    <TableCell className="font-medium text-blue-700">{m.memberName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{clubDist || "—"}</TableCell>
                    <TableCell className="text-sm">{m.emailId}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function GoalSettingRolesPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [assignments, setAssignments] = useState<GoalRoleAssignmentDto[]>([]);
  const [zones, setZones] = useState<ZoneListItem[]>([]);
  // Zone filter for the ROLE LISTING below (2026-09-16 request): pick a zone to see who is its RI
  // Director / Zone Co-ordinator / District Assistant, per category. null = all zones. View-only.
  const [filterZoneId, setFilterZoneId] = useState<number | null>(null);
  const [syncedDistricts, setSyncedDistricts] = useState<DistrictListItem[]>([]);
  const [allDistricts, setAllDistricts] = useState<DistrictListItem[]>([]);
  const [designations, setDesignations] = useState<GoalDesignationDto[]>([]);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [exportingRoles, setExportingRoles] = useState(false);

  // RI Director create form (top).
  const [riZoneIds, setRiZoneIds] = useState<number[]>([]);
  const [riMember, setRiMember] = useState<PickedMember>(null);

  // "Build under a director" popup.
  const [popupDirectorId, setPopupDirectorId] = useState<number | null>(null);
  const [pcAvenue, setPcAvenue] = useState<string>("");    // category tab
  const [pcZone, setPcZone] = useState<string>("");        // zone button
  const [pcZcMember, setPcZcMember] = useState<PickedMember>(null);
  const [pcDaDistrictIds, setPcDaDistrictIds] = useState<number[]>([]);
  const [pcDaMember, setPcDaMember] = useState<PickedMember>(null);

  // "Change member" dialog — replace the holder (+ edit RI zones / DA districts) WITHOUT revoking.
  const [changeTarget, setChangeTarget] = useState<GoalRoleAssignmentDto | null>(null);
  const [changeMember, setChangeMember] = useState<PickedMember>(null);
  const [changeZoneIds, setChangeZoneIds] = useState<number[]>([]);
  const [changeDistrictIds, setChangeDistrictIds] = useState<number[]>([]);
  const [changeTakenZones, setChangeTakenZones] = useState<number[]>([]); // zones held by OTHER directors
  const [savingChange, setSavingChange] = useState(false);
  const [credId, setCredId] = useState<number | null>(null);              // row currently emailing credentials
  // "+" beside a name → add ANOTHER holder to that same seat (same zones / category / districts).
  const [addHolderTarget, setAddHolderTarget] = useState<GoalRoleAssignmentDto | null>(null);
  const [addHolderMember, setAddHolderMember] = useState<PickedMember>(null);
  const [addingHolder, setAddingHolder] = useState(false);

  // Foundation import.
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [impYearId, setImpYearId] = useState<string>("");
  const [impMonth, setImpMonth] = useState<string>("");   // month the district Excel is for (0/"" = annual only)
  const [impFile, setImpFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<GoalFoundationImportResultDto | null>(null);

  // Club Foundation import (Year → upload the MCR Excel; every district's clubs, matched by Club No).
  const [cfFile, setCfFile] = useState<File | null>(null);
  const [cfMonth, setCfMonth] = useState<string>("");
  const [cfImporting, setCfImporting] = useState(false);
  const [cfResult, setCfResult] = useState<GoalFoundationImportResultDto | null>(null);
  // Convert Rotary.org's raw MCR into our import file (synced clubs only, 2 decimals) - download only.
  const [cfConverting, setCfConverting] = useState(false);
  const convertInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, z, y, dg, sd, ad] = await Promise.all([
        getGoalRoleAssignments(),
        getZones(1, 100),
        getRotaryYears(),
        getGoalDesignations(),
        getDistricts(1, 500, undefined, undefined, undefined, undefined, undefined, true),
        getDistricts(1, 2000),
      ]);
      setAssignments(a);
      setZones(z.items);
      setYears(y);
      setDesignations(dg);
      setSyncedDistricts(sd.items);
      setAllDistricts(ad.items);
      const current = y.find((yr) => yr.isCurrent) || y[0];
      if (current) setImpYearId(String(current.id));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load role assignments.");
    }
  }, []);

  useEffect(() => {
    (async () => { try { await load(); } finally { setLoading(false); } })();
  }, [load]);

  // ── Derivations ────────────────────────────────────────────────────────────────────────────
  const activeAssignments = assignments.filter((a) => a.isActive);

  const isTestZoneName = (name: string | null | undefined) => {
    const n = (name || "").toLowerCase().replace(/\s+/g, "");
    return n.includes("test") || n === "zone0";
  };
  const syncedZoneIds = new Set(syncedDistricts.map((d) => d.fkZoneId).filter((x): x is number => x != null));
  const visibleZones = zones.filter((z) => syncedZoneIds.has(z.id) || isTestZoneName(z.zoneName));
  const districtsOfZone = (zoneIdNum: number) => {
    const zt = isTestZoneName(zones.find((z) => z.id === zoneIdNum)?.zoneName);
    return (zt ? allDistricts : syncedDistricts).filter((d) => d.fkZoneId === zoneIdNum);
  };

  const avenues = Array.from(new Set([...designations].sort((a, b) => a.sortOrder - b.sortOrder).map((d) => d.avenue))).filter((a) => a !== "RI Director");
  const avenueCategoryId = (av: string) => designations.find((d) => d.avenue === av && d.defaultCategoryId != null)?.defaultCategoryId ?? null;
  const zoneNameOf = (id: number) => visibleZones.find((z) => z.id === id)?.zoneName || `Zone ${id}`;

  // Directors + their zones (RI create form only offers zones no other director holds).
  const allDirectors = activeAssignments.filter((a) => a.roleType === RI);
  // The listing honours the zone filter; the "zone already taken" rule below must still look at EVERY
  // director, not just the filtered ones.
  const directors = filterZoneId == null
    ? allDirectors
    : allDirectors.filter((a) => (a.zoneIds || []).includes(filterZoneId));
  const takenDirectorZoneIds = new Set(allDirectors.flatMap((a) => a.zoneIds || []));

  // Who the "Send role emails" button will actually email: everyone visible under the current zone
  // filter. An RI Director matches through its zone list; a Zone Co-ordinator / District Assistant
  // carries a single zoneId. Counted per MEMBER — one person holding two roles gets one email.
  const filteredAssignments = filterZoneId == null
    ? activeAssignments
    : activeAssignments.filter((a) => a.roleType === RI
        ? (a.zoneIds || []).includes(filterZoneId)
        : a.zoneId === filterZoneId);
  const emailRecipientCount = new Set(
    filteredAssignments.filter((a) => (a.memberId ?? 0) > 0).map((a) => a.memberId),
  ).size;

  // Several directors may hold the SAME zones. Group them into one seat so the card — and the whole
  // Zone Co-ordinator / District Assistant tree under it — is rendered ONCE with both names, instead
  // of a duplicate card (and duplicate tree) per person.
  const directorSeats = (() => {
    const map = new Map<string, GoalRoleAssignmentDto[]>();
    for (const d of directors) {
      const k = [...(d.zoneIds || [])].sort((a, b) => a - b).join(",");
      const arr = map.get(k);
      if (arr) arr.push(d); else map.set(k, [d]);
    }
    return Array.from(map.values());
  })();
  const freeDirectorZones = visibleZones.filter((z) => !takenDirectorZoneIds.has(z.id));
  const canAddRi = riZoneIds.length > 0 && !!riMember;

  // ── Popup derivations (for the selected category + zone) ─────────────────────────────────────
  const popupDirector = directors.find((d) => d.id === popupDirectorId) || null;
  const popupDirectorZones = popupDirector ? visibleZones.filter((z) => (popupDirector.zoneIds || []).includes(z.id)) : [];
  const pcCategoryId = avenueCategoryId(pcAvenue);
  const pcZoneNum = pcZone ? Number(pcZone) : null;

  const existingZc = (pcZoneNum != null && pcCategoryId != null)
    ? activeAssignments.find((a) => a.roleType === ZC && a.zoneId === pcZoneNum && a.categoryId === pcCategoryId) || null
    : null;
  const existingDas = (pcZoneNum != null && pcCategoryId != null)
    ? activeAssignments.filter((a) => a.roleType === DA && a.zoneId === pcZoneNum && a.categoryId === pcCategoryId)
    : [];
  const daTakenDistrictNumbers = new Set(existingDas.flatMap((a) => a.districtNumbers || []));
  // EVERY district of the zone is listed, including ones already assigned (2026-09-16 request): picking
  // 3142 again simply adds a SECOND District Assistant for 3142. The DB allows it — its unique key is
  // (assignment, district), not district alone.
  const daFreeDistricts = pcZoneNum != null ? districtsOfZone(pcZoneNum) : [];

  // A zone + avenue may now have SEVERAL co-ordinators (2026-09-16), so an existing one no longer
  // blocks adding another. existingZc is kept only to show who is already there and to gate the DA form.
  const canAddZc = !!pcZone && !!pcAvenue && !!pcZcMember;
  const canAddDa = !!pcZone && !!pcAvenue && pcDaDistrictIds.length > 0 && !!pcDaMember && !!existingZc;

  // ── Add handlers ───────────────────────────────────────────────────────────────────────────
  const addDirector = async () => {
    const des = designations.find((d) => d.roleType === RI);
    if (!des || !canAddRi || !riMember) { setErrorMessage("Pick zones and a member."); return; }
    setCreating(true);
    try {
      const created = await createGoalRoleAssignment({
        memberId: riMember.id, memberNameText: null,
        roleType: RI as GoalRoleType,
        assignmentName: `${des.title} — ${riZoneIds.map(zoneNameOf).join(", ")}`,
        roleTitle: des.title, avenue: des.avenue,
        categoryId: null, zoneId: null, districtIds: null, zoneIds: riZoneIds,
        homeDistrictId: null, dgYear: null, supportingText: null,
      });
      await load();
      setRiZoneIds([]); setRiMember(null);
      setSuccessMessage("RI Director added. Click Build to assign its co-ordinators and assistants.");
      openBuild(created.id);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to add RI Director.");
    } finally { setCreating(false); }
  };

  const addZc = async () => {
    const des = designations.find((d) => d.avenue === pcAvenue && d.roleType === ZC);
    if (!des || !canAddZc || !pcZcMember) { setErrorMessage("Pick a zone, category and member."); return; }
    setCreating(true);
    try {
      await createGoalRoleAssignment({
        memberId: pcZcMember.id, memberNameText: null,
        roleType: ZC as GoalRoleType,
        assignmentName: `${des.title} — ${zoneNameOf(Number(pcZone))} · ${pcAvenue}`,
        roleTitle: des.title, avenue: des.avenue,
        categoryId: des.defaultCategoryId ?? null, zoneId: Number(pcZone),
        districtIds: null, zoneIds: null,
        homeDistrictId: null, dgYear: null, supportingText: null,
      });
      await load();
      setPcZcMember(null);
      setSuccessMessage("Zone Co-ordinator added.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to add Zone Co-ordinator.");
    } finally { setCreating(false); }
  };

  const addDa = async () => {
    const des = designations.find((d) => d.avenue === pcAvenue && d.roleType === DA);
    if (!des || !canAddDa || !pcDaMember) { setErrorMessage("Pick a zone, category, districts and member."); return; }
    setCreating(true);
    try {
      await createGoalRoleAssignment({
        memberId: pcDaMember.id, memberNameText: null,
        roleType: DA as GoalRoleType,
        assignmentName: `${des.title} — ${zoneNameOf(Number(pcZone))} · ${pcAvenue}`,
        roleTitle: des.title, avenue: des.avenue,
        categoryId: des.defaultCategoryId ?? null, zoneId: Number(pcZone),
        districtIds: pcDaDistrictIds, zoneIds: null,
        homeDistrictId: null, dgYear: null, supportingText: null,
      });
      await load();
      setPcDaDistrictIds([]); setPcDaMember(null);
      setSuccessMessage("District Assistant added.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to add District Assistant.");
    } finally { setCreating(false); }
  };

  const openBuild = (directorId: number) => {
    const d = directors.find((x) => x.id === directorId);
    setPopupDirectorId(directorId);
    setPcAvenue(avenues[0] || "");
    setPcZone(d && d.zoneIds && d.zoneIds.length ? String(d.zoneIds[0]) : "");
    setPcZcMember(null); setPcDaDistrictIds([]); setPcDaMember(null);
  };
  const closeBuild = () => {
    setPopupDirectorId(null);
    setPcAvenue(""); setPcZone(""); setPcZcMember(null); setPcDaDistrictIds([]); setPcDaMember(null);
  };
  // Switching category or zone resets the in-progress member/district picks (they're context-scoped).
  const changeAvenue = (av: string) => { setPcAvenue(av); setPcZcMember(null); setPcDaDistrictIds([]); setPcDaMember(null); };
  const changeZone = (zid: string) => { setPcZone(zid); setPcZcMember(null); setPcDaDistrictIds([]); setPcDaMember(null); };

  // ── Several people on one seat (2026-09-16) ──────────────────────────────────────────────────
  // A "seat" is a role + scope: an RI Director's zone set, or a ZC/DA's zone + avenue (+ districts).
  // "+" adds a colleague to the SAME seat, so both hold it; "✕" removes just one of them.
  const seatKey = (a: GoalRoleAssignmentDto) =>
    a.roleType === RI
      ? `RI|${[...(a.zoneIds || [])].sort((x, y) => x - y).join(",")}`
      : `${a.roleType}|${a.categoryId ?? ""}|${a.zoneId ?? ""}|${[...(a.districtNumbers || [])].sort().join(",")}`;
  const seatMates = (a: GoalRoleAssignmentDto) => activeAssignments.filter((x) => seatKey(x) === seatKey(a));

  const openAddHolder = (a: GoalRoleAssignmentDto) => { setAddHolderTarget(a); setAddHolderMember(null); };

  const handleAddHolder = async () => {
    if (!addHolderTarget || !addHolderMember) return;
    setAddingHolder(true);
    try {
      await addGoalRoleHolder(addHolderTarget.id, { memberId: addHolderMember.id });
      setSuccessMessage(`${addHolderMember.name} added — both now hold this role. No email was sent.`);
      setAddHolderTarget(null); setAddHolderMember(null);
      await load();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to add the person.");
    } finally { setAddingHolder(false); }
  };

  // ── Removing somebody must NOT reload the page (2026-09-16) ────────────────────────────────
  // Revoking used to end with load(), which re-fetched six lists (assignments, zones, years,
  // designations and two district lists) and re-rendered the whole tree — the "page refresh" you
  // saw. It also silently reset the Foundation-import year. Now the revoked rows are simply marked
  // inactive in local state, so the zone filter, the scroll position and every open panel stay put.
  //
  // The API does not only revoke the row you clicked: RevokeRoleAssignmentAsync cascades DOWN the
  // hierarchy, but only for zones nobody else covers. The rule below mirrors that exactly, so what
  // is on screen matches the database without asking the server again.
  //   • RI Director  → its ZCs and DAs go, but only in zones no OTHER director still covers.
  //   • Zone Co-ordinator → its DAs go, but only if no OTHER co-ordinator holds that zone + category.
  //   • District Assistant → just itself.
  // `going` is the whole set being revoked at once, so a seat held by two people correctly orphans
  // its zone (checking one at a time would wrongly see the colleague as still covering it).
  const cascadeIdsFor = (going: GoalRoleAssignmentDto[]): number[] => {
    const goingIds = new Set(going.map((g) => g.id));
    const stays = (x: GoalRoleAssignmentDto) => !goingIds.has(x.id);
    const ids = new Set<number>(goingIds);
    for (const a of going) {
      if (a.roleType === RI) {
        const orphanZones = (a.zoneIds || []).filter((z) =>
          !activeAssignments.some((x) => stays(x) && x.roleType === RI && (x.zoneIds || []).includes(z)));
        if (orphanZones.length > 0) {
          for (const x of activeAssignments) {
            if (stays(x) && (x.roleType === ZC || x.roleType === DA) &&
                x.zoneId != null && orphanZones.includes(x.zoneId)) ids.add(x.id);
          }
        }
      } else if (a.roleType === ZC && a.zoneId != null && a.categoryId != null) {
        const covered = activeAssignments.some((x) =>
          stays(x) && x.roleType === ZC && x.zoneId === a.zoneId && x.categoryId === a.categoryId);
        if (!covered) {
          for (const x of activeAssignments) {
            if (stays(x) && x.roleType === DA && x.zoneId === a.zoneId && x.categoryId === a.categoryId) ids.add(x.id);
          }
        }
      }
    }
    return Array.from(ids);
  };

  // Mark the revoked rows inactive locally — the same shape as the server's soft revoke (IsActive = 0),
  // so nothing is hard-deleted here either. Every derived list filters on isActive, so they vanish.
  const dropLocally = (ids: number[]) => {
    const gone = new Set(ids);
    setAssignments((prev) => prev.map((x) => (gone.has(x.id) ? { ...x, isActive: false } : x)));
  };

  // ✕ — remove ONE holder while colleagues keep the seat. Nothing below is touched, because someone
  // else still covers the zone (the API only cascades when the last holder goes).
  const handleRemoveOne = async (a: GoalRoleAssignmentDto) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Remove ${a.memberName} from this role?\n\nThe other person(s) keep it, and nobody below is affected.`)) return;
    setRevokingId(a.id);
    try {
      const ids = cascadeIdsFor([a]);
      await revokeGoalRoleAssignment(a.id);
      dropLocally(ids);
      setSuccessMessage(`${a.memberName} removed.`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to remove the person.");
    } finally { setRevokingId(null); }
  };

  // Revoke — removes EVERY holder of the seat (your rule: "2 persons → both are removed").
  const handleRevokeSeat = async (mates: GoalRoleAssignmentDto[]) => {
    if (mates.length === 0) return;
    if (mates.length === 1) { await handleRevoke(mates[0].id); return; }
    const names = mates.map((m) => m.memberName).join(", ");
    if (typeof window !== "undefined" &&
        !window.confirm(`Revoke this role?\n\nThis removes ${mates.length} people: ${names}.`)) return;
    setRevokingId(mates[0].id);
    try {
      const ids = cascadeIdsFor(mates);   // computed BEFORE the calls, while every mate is still active
      for (const m of mates) await revokeGoalRoleAssignment(m.id);
      dropLocally(ids);
      setSuccessMessage(`Role revoked for ${mates.length} people.`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to revoke.");
    } finally { setRevokingId(null); }
  };

  // Clicking any member's name opens their card (photo, contacts, clubs + districts). Names that
  // come from free text rather than a linked profile have no id, so they stay plain text.
  const [cardMemberId, setCardMemberId] = useState<number | null>(null);
  const memberLink = (memberId: number | null | undefined, name: string, className = "font-medium") => {
    if (!memberId || memberId <= 0) return <span className={className}>{name}</span>;
    return (
      <button
        type="button"
        onClick={() => setCardMemberId(memberId)}
        className={`${className} underline underline-offset-2 hover:opacity-80`}
        title="View member details"
      >
        {name}
      </button>
    );
  };

  // Everyone holding ONE seat, rendered on a single line: "Name ✕ ✉ | Name ✕ ✉", with ONE + at the end.
  //   • sharing the seat → each name carries its own ✕ (remove just that person) and ✉
  //   • alone on the seat → NO ✕ (removing the last person is the same as revoking); Change + Revoke
  //     appear instead, and they act on the whole seat.
  // onDark styles the buttons for the blue RI-Director header, where ghost buttons would vanish.
  const holdersInline = (holders: GoalRoleAssignmentDto[], compact: boolean, onDark = false) => {
    if (holders.length === 0) return null;
    const alone = holders.length === 1;
    const ic = compact ? "h-3.5 w-3.5" : "h-4 w-4";
    const h = compact ? "h-7 px-1.5" : "h-8 px-1.5";
    const tone = onDark ? "text-white hover:bg-white/20" : "";
    const danger = onDark ? "text-rose-200 hover:bg-white/20" : "text-destructive";
    // "+" — on the ZC / DA lines it sits right after the LAST name, because ml-auto pushed it to the
    // far edge of a wide row, miles away from a lone member. The RI Director header keeps it on the
    // right, where you said it already looks correct.
    const plusBtn = (
      <Button variant="ghost" size="sm" className={`${h} ${tone}`} onClick={() => openAddHolder(holders[0])}
              title="Add another person to this same role (same zones / districts)">
        <Plus className={ic} />
      </Button>
    );
    return (
      <>
        <span className="flex flex-wrap items-center gap-x-1 gap-y-1 min-w-0">
          {holders.map((p, i) => (
            <span key={p.id} className="inline-flex items-center gap-0.5">
              {i > 0 && <span className={`px-1 ${onDark ? "text-blue-200" : "text-slate-300"}`}>|</span>}
              {memberLink(p.memberId, p.memberName)}
              {/* Already emailed → show it. Informational only: the ✉ stays enabled so the role mail
                  can be sent again, which just moves this date forward. Never emailed → no flag. */}
              {p.roleEmailSentDate && (
                <span
                  className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${
                    onDark ? "bg-white/20 text-emerald-100" : "bg-emerald-50 text-emerald-700"}`}
                  title={`Role email sent ${p.roleEmailSentDate}`}>
                  <CheckCircle2 className="h-3 w-3" />sent
                </span>
              )}
              {!alone && (
                <Button variant="ghost" size="sm" className={`${h} ${danger}`} disabled={revokingId === p.id}
                        onClick={() => handleRemoveOne(p)} title={`Remove ${p.memberName} only`}>
                  {revokingId === p.id ? <RotaryLoader size="sm" /> : <X className={ic} />}
                </Button>
              )}
              <Button variant="ghost" size="sm" className={`${h} ${tone}`} disabled={credId === p.id}
                      onClick={() => handleSendCredentials(p.id)}
                      title={p.roleEmailSentDate ? `Email again — last sent ${p.roleEmailSentDate}` : "Email the role mail (link, username, password)"}>
                {credId === p.id ? <RotaryLoader size="sm" /> : <Mail className={ic} />}
              </Button>
            </span>
          ))}
          {/* ZC / DA: the + belongs beside the member, right after the last name. */}
          {compact && plusBtn}
        </span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {alone && (
            <>
              <Button variant="ghost" size="sm" className={`${h} ${tone}`} onClick={() => openChange(holders[0])} title="Replace this person (handover)">
                <UserCog className={`${ic} mr-1`} />Change
              </Button>
              <Button variant="ghost" size="sm" className={`${h} ${danger}`} disabled={revokingId === holders[0].id}
                      onClick={() => handleRevokeSeat(holders)}>
                {revokingId === holders[0].id ? <RotaryLoader size="sm" /> : <><UserMinus className={`${ic} mr-1`} />Revoke</>}
              </Button>
            </>
          )}
          {/* RI Director header only — you said the right-hand + is correct there. */}
          {!compact && plusBtn}
        </span>
      </>
    );
  };

  const handleRevoke = async (id: number) => {
    // Warn about the cascade so a whole sub-tree isn't wiped by accident.
    const a = activeAssignments.find((x) => x.id === id);
    if (a) {
      const msg = a.roleType === RI
        ? `Revoke RI Director "${a.memberName}"?\n\nThis also removes ALL Zone Co-ordinators and District Assistants under this director's zones.`
        : a.roleType === ZC
          ? `Revoke this Zone Co-ordinator (${a.memberName})?\n\nThis also removes ALL District Assistants under this zone & category.`
          : `Revoke District Assistant ${a.memberName}?`;
      if (typeof window !== "undefined" && !window.confirm(msg)) return;
    }
    setRevokingId(id);
    try {
      const ids = a ? cascadeIdsFor([a]) : [id];
      await revokeGoalRoleAssignment(id);
      if (id === popupDirectorId) closeBuild();
      dropLocally(ids);
      setSuccessMessage("Assignment revoked.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to revoke assignment.");
    } finally { setRevokingId(null); }
  };

  // ── Change / Replace holder (no revoke) ──────────────────────────────────────────────────────
  const openChange = async (a: GoalRoleAssignmentDto) => {
    setChangeTarget(a);
    setChangeMember(null);
    setChangeZoneIds(a.zoneIds || []);
    setChangeDistrictIds(a.districtIds || []);
    setChangeTakenZones([]);
    if (a.roleType === RI) {
      try { setChangeTakenZones(await getAssignedDirectorZones(a.id)); } catch { setChangeTakenZones([]); }
    }
  };
  const closeChange = () => { setChangeTarget(null); setChangeMember(null); setChangeZoneIds([]); setChangeDistrictIds([]); setChangeTakenZones([]); };

  const handleSaveChange = async () => {
    if (!changeTarget) return;
    if (!changeMember) { setErrorMessage("Pick the new member."); return; }
    if (changeTarget.roleType === RI && changeZoneIds.length === 0) { setErrorMessage("An RI Director needs at least one zone."); return; }
    if (changeTarget.roleType === DA && changeDistrictIds.length === 0) { setErrorMessage("A District Assistant needs at least one district."); return; }
    // Warn if any zone is being removed from a director (that revokes the sub-tree under it).
    if (changeTarget.roleType === RI) {
      const removed = (changeTarget.zoneIds || []).filter((z) => !changeZoneIds.includes(z));
      if (removed.length > 0 && typeof window !== "undefined" &&
          !window.confirm(`You removed ${removed.length} zone(s). The Zone Co-ordinators & District Assistants under the removed zone(s) will be revoked. Continue?`)) return;
    }
    setSavingChange(true); setErrorMessage(null); setSuccessMessage(null);
    try {
      await changeGoalRoleAssignment(changeTarget.id, {
        memberId: changeMember.id,
        zoneIds: changeTarget.roleType === RI ? changeZoneIds : null,
        districtIds: changeTarget.roleType === DA ? changeDistrictIds : null,
      });
      closeChange();
      await load();
      setSuccessMessage("Member changed. No email was sent.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to change member.");
    } finally { setSavingChange(false); }
  };

  // Send the login/credentials email to ONE member (on-demand, from the row).
  const handleSendCredentials = async (id: number) => {
    setCredId(id); setErrorMessage(null); setSuccessMessage(null);
    try {
      const r = await sendGoalRoleCredentials(id);
      setSuccessMessage(r.message || "Credentials email sent.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to send credentials email.");
    } finally { setCredId(null); }
  };

  // Send the role-assigned email (with login) to EVERYONE currently in the listing, in one go.
  // Assignment no longer emails automatically — this is the deliberate "now notify them all" action.
  const handleSendAllEmails = async () => {
    // With a zone picked, this emails ONLY that zone's people — never the whole list (2026-09-16).
    const n = emailRecipientCount;
    const scope = filterZoneId != null ? `Zone ${zoneNameOf(filterZoneId)}` : "the whole list";
    if (n === 0) { setErrorMessage("No assigned roles to notify yet."); return; }
    if (typeof window !== "undefined" &&
        !window.confirm(`Send the role email (with login details) to ${n} member(s) in ${scope} now?`)) return;
    setSendingEmails(true);
    try {
      const res = await sendGoalRoleAssignmentEmails(filterZoneId);
      setSuccessMessage(res.message || "Emails sent.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to send role emails.");
    } finally { setSendingEmails(false); }
  };

  // Export the listing to Excel - every role holder with the zone, the districts the role covers,
  // the holder's own club and district, and their name / mobile / email. Obeys the SAME zone filter
  // as the email button: "All zones" exports everyone, a picked zone exports only that zone
  // (user 2026-10-05).
  const handleExportRoles = async () => {
    setExportingRoles(true);
    try {
      const blob = await downloadGoalRoleAssignments(filterZoneId);
      const scope = filterZoneId != null ? zoneNameOf(filterZoneId).replace(/[^\w]+/g, "_") : "all_zones";
      saveBlob(blob, `goal_role_assignments_${scope}_${fileTimestamp()}.xlsx`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not export the role assignments.");
    } finally { setExportingRoles(false); }
  };

  // ── Foundation import handlers ─────────────────────────────────────────────────────────────
  const [dlSample, setDlSample] = useState<"" | "district" | "club">("");
  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const ts = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const handleDownloadDistrictSample = async () => {
    setDlSample("district");
    try { saveBlob(await downloadGoalFoundationSample(), `foundation_district_sample_${ts()}.xlsx`); }
    catch { setErrorMessage("Could not download the district sample."); }
    finally { setDlSample(""); }
  };
  const handleDownloadClubSample = async () => {
    setDlSample("club");
    try { saveBlob(await downloadGoalFoundationClubSample(), `foundation_club_sample_${ts()}.xlsx`); }
    catch { setErrorMessage("Could not download the club sample."); }
    finally { setDlSample(""); }
  };

  // Months available to import for the selected year: a past year → all 12 (Jul→Jun); the current
  // year → only up to the current calendar month. Each option carries the CALENDAR month number.
  const importMonths = (() => {
    const y = years.find((yr) => String(yr.id) === impYearId);
    if (!y || !y.startDate) return [] as { value: number; label: string }[];
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const start = new Date(y.startDate);
    const todayFirst = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const out: { value: number; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      if (d > todayFirst) break; // current year → stop at the current month
      out.push({ value: d.getMonth() + 1, label: `${labels[d.getMonth()]} ${d.getFullYear()}` });
    }
    return out;
  })();

  const handleImport = async () => {
    if (!impYearId) { setErrorMessage("Select a year."); return; }
    if (!impMonth) { setErrorMessage("Select the month this Excel is for."); return; }
    if (!impFile) { setErrorMessage("Choose an Excel file to import."); return; }
    setImporting(true); setImportResult(null);
    try {
      const res = await importGoalFoundationMonthly(Number(impYearId), impFile, Number(impMonth));
      setImportResult(res); setSuccessMessage(res.message || "Import complete."); setImpFile(null);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Import failed.");
    } finally { setImporting(false); }
  };

  const handleConvertRotaryFile = async (file: File | undefined) => {
    if (!file) return;
    setCfConverting(true);
    try {
      const r = await convertGoalFoundationClubFile(file);
      saveBlob(r.blob, `foundation_club_import_${ts()}.xlsx`);
      setSuccessMessage(
        `Converted: ${r.filled} synced club(s) filled` +
        (r.missing > 0 ? `, ${r.missing} not in Rotary's file (left blank - their current values are kept; listed on the Notes sheet)` : "") +
        ". Check the file, then import it here with the month.");
    } catch (err: any) {
      let msg = "Could not convert the file.";
      const data = err?.response?.data;
      if (data instanceof Blob) { try { msg = JSON.parse(await data.text())?.message || msg; } catch { /* keep default */ } }
      setErrorMessage(msg);
    } finally {
      setCfConverting(false);
      if (convertInputRef.current) convertInputRef.current.value = "";
    }
  };

  const handleClubImport = async () => {
    if (!impYearId) { setErrorMessage("Select a year."); return; }
    if (!cfMonth) { setErrorMessage("Select the month this Excel is for."); return; }
    if (!cfFile) { setErrorMessage("Choose the MCR Excel file to import."); return; }
    setCfImporting(true); setCfResult(null);
    try {
      const res = await importGoalFoundationClub(Number(impYearId), cfFile, Number(cfMonth));
      setCfResult(res); setSuccessMessage(res.message || "Import complete."); setCfFile(null);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Import failed.");
    } finally { setCfImporting(false); }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center items-center py-20 min-h-[60vh]"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }
  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage Goal Setting oversight roles.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Goal Setting — Oversight Roles</h2>
            <p className="text-muted-foreground text-base">Add an RI Director, then click Build to assign its Zone Co-ordinators and District Assistants per category.</p>
          </div>
        </div>

        {/* Overview tab hidden on the user's instruction (2026-09-25). Only its trigger is gone —
            the tab's content below is left untouched, so putting the trigger back restores it. The
            page now opens on District Foundation Import, which was the first visible tab anyway. */}
        <Tabs defaultValue="import" className="space-y-6">
          <TabsList>
            <TabsTrigger value="import">District Foundation Import</TabsTrigger>
            <TabsTrigger value="clubimport">Club Foundation Import</TabsTrigger>
            <TabsTrigger value="roles">Role Assign</TabsTrigger>
          </TabsList>

          {/* ── IMPORT TAB (default — used monthly) ── */}
          <TabsContent value="import" className="space-y-6 mt-0">

        {/* Foundation monthly benchmark import */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Foundation Benchmark Import (Till-Date)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Upload the official ROW district Foundation Excel (fields as rows, districts as columns).
              Only the 10 Foundation metrics are read into each field&apos;s <span className="font-medium">Achieved</span> value
              per district; other rows are ignored and any non-numeric characters in a cell are stripped. Re-importing overwrites with the latest figures.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotary Year</label>
                <Select value={impYearId} onValueChange={(v) => { setImpYearId(v); setImpMonth(""); setImportResult(null); }}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Month (this Excel is for)</label>
                <Select value={impMonth} onValueChange={(v) => { setImpMonth(v); setImportResult(null); }} disabled={!impYearId}>
                  <SelectTrigger><SelectValue placeholder={impYearId ? "Select month" : "Pick a year first"} /></SelectTrigger>
                  <SelectContent>
                    {importMonths.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Master Excel</label>
                <Input type="file" accept=".xlsx" onChange={(e) => setImpFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleImport} disabled={importing || !impFile || !impYearId || !impMonth}>
                {importing ? <RotaryLoader size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Import</>}
              </Button>
              <Button variant="outline" onClick={handleDownloadDistrictSample} disabled={dlSample !== ""}
                title="Download the district sample in the exact upload format — all current districts as columns, 0 baseline">
                {dlSample === "district" ? <RotaryLoader size="sm" /> : <><Download className="h-4 w-4 mr-2" />Download Sample</>}
              </Button>
            </div>
            {importResult && (
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="text-sm font-medium">
                  Imported {importResult.importedDistricts} district(s) · {importResult.valuesWritten} value(s) written.
                </div>
                {importResult.skippedRows.length > 0 ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 mb-1">
                      <AlertTriangle className="h-4 w-4" />{importResult.skippedRows.length} row(s) skipped
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="w-16">Row</TableHead>
                            <TableHead>District Number</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importResult.skippedRows.map((s, i) => (
                            <TableRow key={i}>
                              <TableCell>{s.row}</TableCell>
                              <TableCell className="font-medium">{s.districtNumber || "—"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{s.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-emerald-700">All rows imported — no skipped rows.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

          </TabsContent>

          {/* ── CLUB FOUNDATION IMPORT TAB — Year → upload the MCR Excel (all districts) ── */}
          <TabsContent value="clubimport" className="space-y-6 mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  Club Foundation Import (Monthly Contribution Report)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Pick a year, then upload the Rotary <span className="font-medium">Monthly Contribution Report (MCR)</span> Excel.
                  The file lists <span className="font-medium">every district's clubs</span> — each club is matched by <span className="font-medium">Club No = Club Rotary ID</span> and has its Foundation goals filled: Goal Amount &amp; Goal % Achieved
                  (the club can edit these) and the AF Per Capita / Annual Fund / PolioPlus / Other / Endowment / Total figures (read-only).
                  Wrong-format files are rejected (the bad column is named); non-numeric characters are ignored; any Club No not found in the system is skipped and listed below.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotary Year</label>
                    <Select value={impYearId} onValueChange={(v) => { setImpYearId(v); setCfMonth(""); setCfResult(null); }}>
                      <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Month (this Excel is for)</label>
                    <Select value={cfMonth} onValueChange={(v) => { setCfMonth(v); setCfResult(null); }} disabled={!impYearId}>
                      <SelectTrigger><SelectValue placeholder={impYearId ? "Select month" : "Pick a year first"} /></SelectTrigger>
                      <SelectContent>
                        {importMonths.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">MCR Excel</label>
                    <Input type="file" accept=".xlsx" onChange={(e) => setCfFile(e.target.files?.[0] || null)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleClubImport} disabled={cfImporting || !cfFile || !impYearId || !cfMonth}>
                    {cfImporting ? <RotaryLoader size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Import</>}
                  </Button>
                  <Button variant="outline" onClick={handleDownloadClubSample} disabled={dlSample !== ""}
                    title="Download the club sample in the exact MCR format — one row per current synced club, 0 baseline">
                    {dlSample === "club" ? <RotaryLoader size="sm" /> : <><Download className="h-4 w-4 mr-2" />Download Sample</>}
                  </Button>
                  <input ref={convertInputRef} type="file" accept=".xlsx" className="hidden"
                    onChange={(e) => handleConvertRotaryFile(e.target.files?.[0])} />
                  <Button variant="outline" onClick={() => convertInputRef.current?.click()} disabled={cfConverting}
                    title="Pick the Rotary.org Monthly Contribution Report as downloaded. You get back our import file: synced clubs only, amounts rounded to 2 decimals. Nothing is imported until you upload it with Import.">
                    {cfConverting ? <RotaryLoader size="sm" /> : <><FileSpreadsheet className="h-4 w-4 mr-2" />Convert Rotary.org File</>}
                  </Button>
                </div>
                {cfResult && (
                  <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-2">
                    <div>
                      <span className="font-medium">{cfResult.message}</span>
                      {cfResult.valuesWritten > 0 && <span className="text-emerald-700"> · {cfResult.valuesWritten} value(s) written.</span>}
                    </div>
                    {cfResult.skippedRows.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50">
                        <div className="px-3 py-2 text-xs font-semibold text-amber-800 border-b border-amber-200">
                          {cfResult.skippedRows.length} club row(s) skipped — Club No not found in the system
                        </div>
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-amber-100/80 text-amber-900">
                              <tr>
                                <th className="text-left px-3 py-1.5 font-medium">Row</th>
                                <th className="text-left px-3 py-1.5 font-medium">Club No</th>
                                <th className="text-left px-3 py-1.5 font-medium">Name</th>
                                <th className="text-left px-3 py-1.5 font-medium">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cfResult.skippedRows.map((s, i) => (
                                <tr key={i} className="border-t border-amber-100">
                                  <td className="px-3 py-1 tabular-nums">{s.row}</td>
                                  <td className="px-3 py-1 tabular-nums">{s.clubNo || "—"}</td>
                                  <td className="px-3 py-1">{s.clubName || "—"}</td>
                                  <td className="px-3 py-1 text-amber-800">{s.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── ROLE ASSIGN TAB (rare — once every 1-3 years) ── */}
          <TabsContent value="roles" className="space-y-6 mt-0">

        {/* Add RI Director */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" />Add RI Director</CardTitle>
            <p className="text-sm text-muted-foreground">Pick the zone(s) this director covers and the member. An RI Director spans all avenues.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Zones <span className="font-normal text-muted-foreground">— tick one or more (only free zones show)</span></label>
              {freeDirectorZones.length === 0 ? (
                <p className="text-xs text-amber-600">No free zones — every zone already has a director. Revoke one below to free it.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {freeDirectorZones.map((z) => {
                    const checked = riZoneIds.includes(z.id);
                    return (
                      <label key={z.id} className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${checked ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={checked} onChange={(e) => setRiZoneIds((prev) => e.target.checked ? [...prev, z.id] : prev.filter((x) => x !== z.id))} className="rounded" />
                        {z.zoneName}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Member <span className="font-normal text-muted-foreground">— search ANY member (need not belong to the zone)</span></label>
              <MemberPicker selected={riMember} onSelect={setRiMember} onClear={() => setRiMember(null)} zoneIds={riZoneIds} global placeholder="Search any member by name / email / mobile…" />
            </div>
            <div className="flex justify-end border-t pt-3">
              <Button onClick={addDirector} disabled={creating || !canAddRi}>
                {creating ? <RotaryLoader size="sm" /> : <><UserPlus className="h-4 w-4 mr-2" />Add RI Director</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Zone filter — sits ABOVE the role listing. Picking a zone narrows the whole tree below to
            that zone: its RI Director, its Zone Co-ordinators and their District Assistants, by
            category. Nothing is saved — this only filters what is shown. */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <span className="text-sm font-medium">Filter by zone</span>
          <select
            value={filterZoneId ?? ""}
            onChange={(e) => setFilterZoneId(e.target.value === "" ? null : Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[200px]"
          >
            <option value="">All zones</option>
            {visibleZones.map((z) => (
              <option key={z.id} value={z.id}>{z.zoneName}</option>
            ))}
          </select>
          {filterZoneId != null && (
            <>
              <span className="text-xs text-muted-foreground">
                Showing {directors.length} RI Director{directors.length === 1 ? "" : "s"} for this zone
              </span>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setFilterZoneId(null)}>Clear</Button>
            </>
          )}
        </div>

        {/* RI Directors — hierarchical tree: director → category (highlighted) → ZC → DAs */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-blue-600" />RI Directors ({directors.length})</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
              {/* Export the listing exactly as filtered — all zones, or just the picked zone. */}
              <Button
                variant="outline" size="sm"
                onClick={handleExportRoles}
                disabled={exportingRoles || directors.length + filteredAssignments.length === 0}
                title={filterZoneId != null
                  ? `Export this zone's RI Director, Zone Co-ordinators and District Assistants with their club, mobile and email`
                  : "Export every role holder with their zone, district, club, mobile and email"}
              >
                {exportingRoles ? <RotaryLoader size="sm" /> : (
                  <><Download className="h-4 w-4 mr-2" />
                    {filterZoneId != null
                      ? `Export — ${zoneNameOf(filterZoneId)} (${filteredAssignments.length})`
                      : `Export all roles (${filteredAssignments.length})`}
                  </>
                )}
              </Button>
              {/* Assigning a role no longer emails automatically — click this once the list looks
                  correct to send every assigned member their role email + login, in one go. */}
              <Button
                variant="outline" size="sm"
                onClick={handleSendAllEmails}
                disabled={sendingEmails || emailRecipientCount === 0}
                title={filterZoneId != null
                  ? `Send the role email (with login) to this zone's RI Director, Zone Co-ordinators and District Assistants only`
                  : "Send the role email (with login) to everyone currently in the list"}
              >
                {sendingEmails ? <RotaryLoader size="sm" /> : (
                  <><Mail className="h-4 w-4 mr-2" />
                    {filterZoneId != null
                      ? `Send role emails — ${zoneNameOf(filterZoneId)} (${emailRecipientCount})`
                      : `Send role emails to all (${emailRecipientCount})`}
                  </>
                )}
              </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Assigning a role does <span className="font-medium">not</span> send any email. When the whole list looks correct, click
              <span className="font-medium"> "Send role emails to all"</span> to email every assigned member their role &amp; login together.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {directors.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No RI Directors yet. Add one above.</div>
            ) : (
              directorSeats.map((seat) => {
                const d = seat[0];   // all holders of a seat share the same zones
                // With a zone picked, a director covering several zones shows ONLY that zone's
                // Co-ordinator + District Assistants (the tree is grouped by zone below).
                const dZoneIds = (d.zoneIds || []).filter((z) => filterZoneId == null || z === filterZoneId);
                return (
                  <div key={seat.map((x) => x.id).join("-")} className="rounded-xl border overflow-hidden">
                    {/* Director header — ALL holders of these zones on one line */}
                    <div className="flex items-center gap-3 bg-blue-600 text-white px-4 py-2.5">
                      <Target className="h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1 font-semibold leading-tight">
                          <span>RI Director —</span>
                          {holdersInline(seat, false, true)}
                        </div>
                        <div className="text-[11px] text-blue-100">Zones: {(d.zoneNames || []).join(", ") || "—"}</div>
                      </div>
                      <div className="ml-auto flex gap-2 shrink-0">
                        <Button size="sm" variant="secondary" onClick={() => openBuild(d.id)}><Settings2 className="h-4 w-4 mr-1" />Build</Button>
                      </div>
                    </div>

                    {/* Category sections (Membership → Foundation → Public Image) */}
                    <div className="divide-y">
                      {avenues.map((av) => {
                        const catId = avenueCategoryId(av);
                        // Group by ZONE so each Zone Co-ordinator (e.g. RMC) is shown with HIS District
                        // Assistants (e.g. ARC) nested directly under him, then the next zone's ZC + its DAs.
                        // zcs is a LIST now — several co-ordinators may share one zone + avenue (2026-09-16).
                        const perZone = dZoneIds.map((zid) => {
                          const zcs = activeAssignments.filter((a) => a.roleType === ZC && a.zoneId === zid && a.categoryId === catId);
                          const das = activeAssignments.filter((a) => a.roleType === DA && a.zoneId === zid && a.categoryId === catId);
                          const zoneName = zcs[0]?.zoneName ?? das[0]?.zoneName ?? String(zid);
                          return { zid, zcs, das, zoneName };
                        }).filter((z) => z.zcs.length > 0 || z.das.length > 0);
                        if (perZone.length === 0) return null;
                        return (
                          <div key={av}>
                            {/* highlighted category name */}
                            <div className="bg-amber-100 text-amber-900 font-semibold text-sm px-4 py-1.5 border-l-4 border-amber-500">{av}</div>
                            <div className="px-4 py-2 space-y-3">
                              {perZone.map((z) => (
                                <div key={z.zid} className="space-y-1.5">
                                  {/* Zone Co-ordinator (RMC/RPIC/RRFC…) for this zone */}
                                  {/* All co-ordinators of this zone + avenue are ONE seat → one line. */}
                                  {z.zcs.length > 0 ? (
                                    <div className="flex items-center gap-2 text-sm">
                                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-[11px]">{z.zcs[0].roleTitle || "Zone Co-ordinator"}</Badge>
                                      <Badge variant="outline" className="text-[11px]">Zone {z.zoneName}</Badge>
                                      {holdersInline(z.zcs, true)}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">Zone {z.zoneName} — no Zone Co-ordinator yet</div>
                                  )}
                                  {/* His District Assistants (ARC/ARPIC/ARRFC…) nested under him */}
                                  {/* District Assistants grouped by their DISTRICT SET — each set is one
                                      seat, so everyone holding it shows inline on a single line. */}
                                  {(() => {
                                    const bySet = new Map<string, GoalRoleAssignmentDto[]>();
                                    for (const a of z.das) {
                                      const k = [...(a.districtNumbers || [])].sort().join(",");
                                      const arr = bySet.get(k);
                                      if (arr) arr.push(a); else bySet.set(k, [a]);
                                    }
                                    return Array.from(bySet.values()).map((grp) => (
                                      <div key={grp.map((x) => x.id).join("-")} className="flex items-center gap-2 text-sm pl-3 ml-2 border-l-2 border-emerald-200">
                                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[11px]">{grp[0].roleTitle || "District Assistant"}</Badge>
                                        <Badge variant="outline" className="text-[11px]">D {(grp[0].districtNumbers || []).join(", ")}</Badge>
                                        {holdersInline(grp, true)}
                                      </div>
                                    ));
                                  })()}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {avenues.every((av) => {
                        const catId = avenueCategoryId(av);
                        return !activeAssignments.some((a) => (a.roleType === ZC || a.roleType === DA) && a.zoneId != null && dZoneIds.includes(a.zoneId) && a.categoryId === catId);
                      }) && (
                        <div className="px-4 py-3 text-xs text-muted-foreground">No co-ordinators yet — click <span className="font-medium">Build</span> to add them.</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── Change / Replace member dialog (no revoke; keeps the hierarchy below) ── */}
        <Dialog open={changeTarget != null} onOpenChange={(o) => { if (!o) closeChange(); }}>
          <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><UserCog className="h-4 w-4 text-blue-600" />Change member</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {changeTarget?.roleType === RI ? "RI Director" : changeTarget?.roleType === ZC ? (changeTarget?.roleTitle || "Zone Co-ordinator") : (changeTarget?.roleTitle || "District Assistant")}
                {" · currently "}{memberLink(changeTarget?.memberId, changeTarget?.memberName ?? "")}. No email is sent — replacing keeps everyone below.
              </p>
            </DialogHeader>
            {changeTarget && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1.5 block">New member <span className="font-normal text-muted-foreground">— search ANY member</span></label>
                  <MemberPicker selected={changeMember} onSelect={setChangeMember} onClear={() => setChangeMember(null)} zoneIds={[]} global placeholder="Search any member by name / email / mobile…" />
                </div>
                {changeTarget.roleType === RI && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Zones <span className="font-normal text-muted-foreground">— tick one or more (zones held by another director are hidden)</span></label>
                    <div className="flex flex-wrap gap-2">
                      {visibleZones.filter((z) => !changeTakenZones.includes(z.id)).map((z) => {
                        const checked = changeZoneIds.includes(z.id);
                        return (
                          <label key={z.id} className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${checked ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                            <input type="checkbox" checked={checked} onChange={(e) => setChangeZoneIds((prev) => e.target.checked ? [...prev, z.id] : prev.filter((x) => x !== z.id))} className="rounded" />
                            {z.zoneName}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-amber-600 mt-1.5">Removing a zone revokes the Zone Co-ordinators &amp; District Assistants under it.</p>
                  </div>
                )}
                {changeTarget.roleType === DA && changeTarget.zoneId != null && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Districts <span className="font-normal text-muted-foreground">— in {zoneNameOf(changeTarget.zoneId)}</span></label>
                    <div className="flex flex-wrap gap-2">
                      {districtsOfZone(changeTarget.zoneId).map((d) => {
                        const checked = changeDistrictIds.includes(d.id);
                        return (
                          <label key={d.id} className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${checked ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                            <input type="checkbox" checked={checked} onChange={(e) => setChangeDistrictIds((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))} className="rounded" />
                            {d.districtNumber}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2 border-t pt-3">
                  <Button variant="outline" onClick={closeChange} disabled={savingChange}>Cancel</Button>
                  <Button onClick={handleSaveChange} disabled={savingChange || !changeMember}>
                    {savingChange ? <RotaryLoader size="sm" /> : <><CheckCircle2 className="h-4 w-4 mr-2" />Save change</>}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ── "+" Add another holder ──────────────────────────────────────────────────────────
            Adds a SECOND (third, …) person to the SAME seat. Nothing to pick but the member — the
            new holder inherits the same zones / avenue / districts. Silent: no email is sent. */}
        <Dialog open={addHolderTarget != null} onOpenChange={(o) => { if (!o) { setAddHolderTarget(null); setAddHolderMember(null); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-blue-600" />
                Add another {addHolderTarget?.roleType === RI ? "RI Director"
                  : addHolderTarget?.roleType === ZC ? (addHolderTarget?.roleTitle || "Zone Co-ordinator")
                  : (addHolderTarget?.roleTitle || "District Assistant")}
              </DialogTitle>
            </DialogHeader>
            {addHolderTarget && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  <div className="text-muted-foreground text-xs mb-1">The new person gets exactly the same access as</div>
                  <div>{memberLink(addHolderTarget.memberId, addHolderTarget.memberName)}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {addHolderTarget.roleType === RI
                      ? `Zones: ${(addHolderTarget.zoneNames || []).join(", ") || "—"}`
                      : addHolderTarget.roleType === ZC
                        ? `Zone ${addHolderTarget.zoneName ?? "—"} · ${addHolderTarget.categoryName ?? addHolderTarget.avenue ?? ""}`
                        : `Zone ${addHolderTarget.zoneName ?? "—"} · D ${(addHolderTarget.districtNumbers || []).join(", ") || "—"}`}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Member</label>
                  <MemberPicker
                    selected={addHolderMember}
                    onSelect={setAddHolderMember}
                    onClear={() => setAddHolderMember(null)}
                    zoneIds={[]}
                    global
                    placeholder="Search any member by name / email / mobile…"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Both people will hold this role. No email is sent now — use the ✉ icon or the
                    &quot;Send role emails&quot; button when you are ready.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setAddHolderTarget(null); setAddHolderMember(null); }}>Cancel</Button>
                  <Button onClick={handleAddHolder} disabled={addingHolder || !addHolderMember}>
                    {addingHolder ? <RotaryLoader size="sm" /> : <><Plus className="h-4 w-4 mr-1" />Add</>}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Build popup ── */}
        <Dialog open={popupDirectorId != null} onOpenChange={(o) => { if (!o) closeBuild(); }}>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-blue-600" />
                Build under {memberLink(popupDirector?.memberId, popupDirector?.memberName ?? "", "font-semibold")}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">Zones: {(popupDirector?.zoneNames || []).join(", ")}</p>
            </DialogHeader>

            {popupDirector && (
              <div className="space-y-4">
                {/* Category tabs */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Category</label>
                  <div className="flex flex-wrap gap-1 border-b">
                    {avenues.map((av) => (
                      <button key={av} type="button" onClick={() => changeAvenue(av)}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 -mb-px transition ${pcAvenue === av ? "bg-white text-slate-900 border-slate-200" : "border-transparent text-muted-foreground hover:text-slate-700"}`}>
                        {av}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Zone buttons */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Zone</label>
                  <div className="flex flex-wrap gap-2">
                    {popupDirectorZones.map((z) => (
                      <button key={z.id} type="button" onClick={() => changeZone(String(z.id))}
                        className={`text-sm px-3 py-1.5 rounded-lg border transition ${String(z.id) === pcZone ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        {z.zoneName}
                      </button>
                    ))}
                  </div>
                </div>

                {pcZone && pcAvenue && (
                  <>
                    {/* Zone Co-ordinator */}
                    <div className="rounded-lg border p-3 bg-muted/20">
                      <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Zone Co-ordinator — {pcAvenue} · {zoneNameOf(Number(pcZone))}</div>
                      {existingZc ? (
                        <div className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          {memberLink(existingZc.memberId, existingZc.memberName)}
                          <Button variant="ghost" size="sm" className="ml-auto text-destructive" disabled={revokingId === existingZc.id} onClick={() => handleRevoke(existingZc.id)}>
                            {revokingId === existingZc.id ? <RotaryLoader size="sm" /> : <><UserMinus className="h-4 w-4 mr-1" />Revoke</>}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {/* global: a Zone Co-ordinator need NOT belong to the zone — a Zone 5 member can
                              hold Zone 4 (2026-09-16 request), so search every member, not just this zone's. */}
                          <MemberPicker selected={pcZcMember} onSelect={setPcZcMember} onClear={() => setPcZcMember(null)} zoneIds={pcZone ? [Number(pcZone)] : []} global placeholder="Search any member by name / email / mobile…" />
                          <div className="flex justify-end">
                            <Button size="sm" onClick={addZc} disabled={creating || !canAddZc}>
                              {creating ? <RotaryLoader size="sm" /> : <><UserPlus className="h-4 w-4 mr-1" />Add Zone Co-ordinator</>}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* District Assistant — needs a ZC first */}
                    <div className="rounded-lg border p-3 bg-muted/20">
                      <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">District Assistants — {pcAvenue} · {zoneNameOf(Number(pcZone))}</div>
                      {!existingZc ? (
                        <p className="text-xs text-amber-600">Add the Zone Co-ordinator above first — a District Assistant sits under a co-ordinator.</p>
                      ) : (
                        <div className="space-y-2">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Districts <span className="text-[11px]">(only free districts show)</span></div>
                            <div className="flex flex-wrap gap-2 border rounded-lg p-2 max-h-32 overflow-y-auto bg-white">
                              {daFreeDistricts.length === 0 && <span className="text-xs text-muted-foreground">No free districts — the rest already have a District Assistant for this category.</span>}
                              {daFreeDistricts.map((d) => {
                                const checked = pcDaDistrictIds.includes(d.id);
                                return (
                                  <label key={d.id} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border cursor-pointer ${checked ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                                    <input type="checkbox" checked={checked} onChange={(e) => setPcDaDistrictIds((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))} className="rounded" />
                                    District {d.districtNumber}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          {/* global: same rule for a District Assistant — any member, any zone. */}
                          <MemberPicker selected={pcDaMember} onSelect={setPcDaMember} onClear={() => setPcDaMember(null)} zoneIds={pcZone ? [Number(pcZone)] : []} global placeholder="Search any member by name / email / mobile…" />
                          <div className="flex justify-end">
                            <Button size="sm" onClick={addDa} disabled={creating || !canAddDa}>
                              {creating ? <RotaryLoader size="sm" /> : <><UserPlus className="h-4 w-4 mr-1" />Add District Assistant</>}
                            </Button>
                          </div>
                        </div>
                      )}

                      {existingDas.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {existingDas.map((a) => (
                            <div key={a.id} className="flex items-center gap-2 text-sm bg-white rounded-lg border px-2.5 py-1.5">
                              <Badge variant="outline" className="text-[11px]">D {(a.districtNumbers || []).join(", ")}</Badge>
                              {memberLink(a.memberId, a.memberName)}
                              <Button variant="ghost" size="sm" className="ml-auto text-destructive" disabled={revokingId === a.id} onClick={() => handleRevoke(a.id)}>
                                {revokingId === a.id ? <RotaryLoader size="sm" /> : <><UserMinus className="h-4 w-4 mr-1" />Revoke</>}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className="flex justify-end border-t pt-3">
                  <Button variant="outline" onClick={closeBuild}>Done</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

          </TabsContent>

          {/* ── OVERVIEW TAB — read-only zone × category × year district matrix ── */}
          <TabsContent value="overview" className="space-y-6 mt-0">
            <GoalReadonlyViewer
              zones={visibleZones.map((z) => ({ id: z.id, zoneName: z.zoneName }))}
              years={years}
            />
          </TabsContent>
        </Tabs>

        <MemberContactCardDialog
          memberId={cardMemberId}
          open={cardMemberId != null}
          onClose={() => setCardMemberId(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
