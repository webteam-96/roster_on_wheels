"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, AlertTriangle, Plus, Trash2, Eye, ArrowRightCircle, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import {
  getDistricts, compareClubs, addClubFromOrg, updateClubManual,
  deleteClubManualSync, getClubOrgDetail, refreshClubsCache, markClubSynced,
  getClubOrgMemberCount, getClubMemberDiff, reconcileDistrictMembers, softDeleteClubMemberLinks,
} from "@/services/api";

interface DistrictOption { id: number; districtNumber: string }

// Run async workers over items with limited concurrency (don't hammer Rotary.org).
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = 4) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { await worker(items[idx]); } catch { /* per-item handled */ } }
  });
  await Promise.all(runners);
}

export default function RotaryOrgClubsPage() {
  const { isSuperAdmin } = useAuth();
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [data, setData] = useState<any>(null);
  // Live Rotary.org member counts (Active + Honorary) per SYNC club — loaded progressively, same
  // source as the member-match page (NOT the /clubs cache number).
  const [liveOrg, setLiveOrg] = useState<Record<number, { total: number | null; loading: boolean; error?: string }>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // Edit dialog
  const [editTarget, setEditTarget] = useState<any>(null);   // { india, org }
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Bulk district reconcile in progress (top button). Disabled + "Reconciling…" while the background
  // worker runs; per-club member-sync buttons were removed in favour of this single top action.
  const [reconciling, setReconciling] = useState(false);
  const [diffFor, setDiffFor] = useState<any>(null);                     // club for the per-member diff popup
  const [showOrgOnly, setShowOrgOnly] = useState(false);                 // popup: synced on Rotary.org but not in Rizones

  useEffect(() => {
    (async () => {
      try {
        // hasSyncClubs=true → only districts that have ≥1 sync club (hide non-sync-only districts like Taiwan)
        const list = await getDistricts(1, 1000, undefined, undefined, undefined, undefined, undefined, true);
        const items = (list?.items || [])
          .map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }))
          // numeric-aware sort: DistrictNumber is a VARCHAR, so "999" must come before "3142"
          .sort((a: any, b: any) =>
            String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true }));
        setDistricts(items);
      } catch { setError("Failed to load districts."); }
    })();
  }, []);

  // silent=true → re-fetch WITHOUT blanking the table (used after a Sync so the page doesn't jump to top).
  const reload = async (silent = false) => {
    if (!districtId) return;
    if (!silent) { setLoading(true); setData(null); }
    setLiveOrg({});
    try {
      const d = await compareClubs(Number(districtId));
      setData(d);
      // Fetch the LIVE Rotary.org member count (Active + Honorary) for each SYNC club, progressively,
      // exactly like the member-match page. Non-sync clubs have no members so we skip them.
      const syncClubs = (d?.indiaClubs || []).filter((c: any) => Number(c.isSynced) === 1 && c.clubRotaryId);
      if (syncClubs.length > 0) {
        setLiveOrg(Object.fromEntries(syncClubs.map((c: any) => [c.clubId, { total: null, loading: true }])));
        setCountsLoading(true);
        runPool(syncClubs, async (c: any) => {
          try {
            const oc = await getClubOrgMemberCount(c.clubId);
            setLiveOrg((p) => ({ ...p, [c.clubId]: { total: oc.orgTotal ?? 0, loading: false, error: oc.error } }));
          } catch (e: any) {
            setLiveOrg((p) => ({ ...p, [c.clubId]: { total: null, loading: false, error: e?.message || "load failed" } }));
          }
        }, 4).finally(() => setCountsLoading(false));
      }
    }
    catch (e: any) { setError(e?.response?.data?.message || "Failed to compare clubs"); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { if (districtId) reload(); /* eslint-disable-next-line */ }, [districtId]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshClubsCache();
      setSuccess(r.message || "Cache refreshed");
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Refresh failed"); }
    finally { setRefreshing(false); }
  };

  const onAdd = async (rotaryClubId: number) => {
    if (!districtId) return;
    setBusyKey(`add-${rotaryClubId}`);
    try {
      const r = await addClubFromOrg(rotaryClubId, Number(districtId));
      setSuccess(`Club added. ${r?.membersAdded ?? 0} members synced (${r?.memberErrors ?? 0} errors).`);
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to add club"); }
    finally { setBusyKey(null); }
  };

  // Club is sync on Rotary.org but not marked synced in rizones → flip flag + full member sweep.
  const onMarkSynced = async (india: any) => {
    if (!india?.clubId) return;
    setBusyKey(`sync-${india.clubId}`);
    try {
      const r = await markClubSynced(india.clubId);
      setSuccess(r?.message || "Club marked synced; member sync started in the background.");
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to sync club."); }
    finally { setBusyKey(null); }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClubManualSync(deleteTarget.clubId);
      setSuccess("Club deleted (soft).");
      setDeleteTarget(null);
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to delete"); setDeleteTarget(null); }
    finally { setDeleting(false); }
  };

  const openEdit = async (india: any) => {
    setViewingId(india.clubId);
    if (!india.clubRotaryId) {
      setEditTarget({ india, org: null });
      setEditForm({ ...india });
      setViewingId(null);
      return;
    }
    try {
      const org = await getClubOrgDetail(Number(india.clubRotaryId));
      setEditTarget({ india, org });
      setEditForm({ ...india });
    } catch (e: any) {
      setEditTarget({ india, org: null });
      setEditForm({ ...india });
    } finally {
      setViewingId(null);
    }
  };

  const copyFromOrg = (key: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [key]: value }));
  };

  const saveEdit = async () => {
    if (!editTarget?.india) return;
    setSavingEdit(true);
    try {
      await updateClubManual(editTarget.india.clubId, {
        clubName: editForm.clubName,
        meetingAddress: editForm.meetingAddress,
        meetingDay: editForm.meetingDay,
        meetingTime: editForm.meetingTime,
        city: editForm.city,
        state: editForm.state,
        charterDate: editForm.charterDate,
      });
      setSuccess("Club updated.");
      setEditTarget(null);
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to save"); }
    finally { setSavingEdit(false); }
  };

  // Bulk reconcile: one click reconciles ONLY the mismatched sync clubs in the selected district
  // (--member-count-reconcile --districts <num>). The worker adds missing members + removes departed
  // ones (profiles kept) for every mismatched club. Disabled while running; we silently refresh the
  // counts a few times so the mismatches clear on screen as the worker finishes.
  const onReconcileDistrict = async () => {
    if (!districtId || reconciling) return;
    // Snapshot ONLY the currently-mismatched sync clubs — we refresh just these, never the whole
    // district (no full compareClubs refetch, matched clubs don't flicker).
    const targets: number[] = (data?.indiaClubs || [])
      .filter((c: any) => Number(c.isSynced) === 1 && c.clubRotaryId)
      .filter((c: any) => {
        const l = liveOrg[c.clubId];
        return l && !l.loading && l.total != null && c.memberCount != null && c.memberCount !== l.total;
      })
      .map((c: any) => c.clubId as number);
    if (targets.length === 0) return;
    setReconciling(true);
    try {
      const r = await reconcileDistrictMembers(Number(districtId));
      setSuccess(r?.message || "Member reconcile started for this district's mismatched clubs. Only those clubs refresh as it runs — no need to click again.");
      // Poll ONLY the mismatched clubs. Each club's diff gives BOTH fresh counts (rizones + live
      // Rotary.org) in one call; we patch just that club and drop it once it reconciles. All other
      // clubs are left completely untouched.
      const pending = new Set<number>(targets);
      let attempts = 0;
      const MAX = 9;   // 9 × 20s = 3 min
      const tick = async () => {
        attempts++;
        await Promise.all(Array.from(pending).map(async (cid) => {
          try {
            const d = await getClubMemberDiff(cid);
            if (d && !d.error) {
              setData((prev: any) => prev
                ? { ...prev, indiaClubs: (prev.indiaClubs || []).map((c: any) => c.clubId === cid ? { ...c, memberCount: d.rizonesCount } : c) }
                : prev);
              setLiveOrg((p) => ({ ...p, [cid]: { total: d.orgCount, loading: false } }));
              if ((d.toAdd?.length ?? 0) === 0 && (d.toRemove?.length ?? 0) === 0) pending.delete(cid);
            }
          } catch { /* transient — retry next tick */ }
        }));
        if (pending.size > 0 && attempts < MAX) window.setTimeout(tick, 20000);
        else setReconciling(false);
      };
      window.setTimeout(tick, 20000);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to start district reconcile.");
      setReconciling(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
        </div>
      </ProtectedRoute>
    );
  }

  // Two sections:
  //   1. Sync clubs      — IsSyncedFromRotaryOrg = 1 (full data: members/BOD)
  //   2. Non-sync clubs  — everything not fully synced, SYNCABLE ones on top:
  //        - SYNCABLE (ClubRotaryId present in /clubs): a Sync button pulls the club + members into
  //          Rizones. Includes /clubs clubs not yet in Rizones at all (india = null → Sync = add+sync).
  //        - search-only (present only on /Clubs/search, NOT in /clubs): display-only, no button.
  type Row = { key: string; india: any | null; org: any | null; status: "matched" | "onlyIndia" | "onlyOrg"; syncable?: boolean };

  // The Rotary.org member count to display/compare: for SYNC clubs use the LIVE Active+Honorary count
  // (same as member-match); for others fall back to whatever count the cache/synth carries.
  const orgCountOf = (row: Row): { count: number | null; loading: boolean; error?: string } => {
    if (row.india && Number(row.india.isSynced) === 1) {
      const l = liveOrg[row.india.clubId];
      return { count: l?.total ?? null, loading: !!l?.loading, error: l?.error };
    }
    return { count: row.org?.memberCount ?? null, loading: false };
  };
  const groups = (() => {
    const syncRows: Row[] = [];
    const nonSyncRows: Row[] = [];
    if (!data) return { syncRows, nonSyncRows };
    const orgById = new Map<string, any>((data.orgClubs || []).map((c: any) => [String(c.rotaryClubId), c]));
    const usedOrg = new Set<string>();
    for (const i of (data.indiaClubs || [])) {
      const rid = String(i.clubRotaryId || "");
      const inClubs = !!rid && orgById.has(rid);   // present in /clubs (sync API) → syncable
      let org = inClubs ? orgById.get(rid) : null;
      if (org) usedOrg.add(rid);
      if (Number(i.isSynced) === 1) {
        syncRows.push({ key: `i-${i.clubId}`, india: i, org, status: org ? "matched" : "onlyIndia" });
      } else {
        // Non-sync club that IS already in Rizones → display-only, NEVER a Sync button (your rule:
        // the Sync button is only for clubs in /clubs that are NOT yet in Rizones). Search-only clubs
        // aren't in /clubs, so synthesize their org side for display.
        if (!org && rid) org = { rotaryClubId: i.clubRotaryId, clubName: i.clubName, memberCount: null, _searchOnly: true };
        nonSyncRows.push({ key: `i-${i.clubId}`, india: i, org, status: "matched" });
      }
    }
    // Clubs in /clubs (synced on Rotary.org) but NOT in Rizones → these get the Sync button and sit on
    // TOP of the Non-sync list. Sync = add the club + all its members into Rizones.
    for (const o of (data.orgClubs || [])) {
      const rid = String(o.rotaryClubId);
      if (!usedOrg.has(rid)) nonSyncRows.push({ key: `o-${rid}`, india: null, org: o, status: "onlyOrg", syncable: true });
    }
    const byName = (a: Row, b: Row) =>
      (a.india?.clubName || a.org?.clubName || "").toLowerCase()
        .localeCompare((b.india?.clubName || b.org?.clubName || "").toLowerCase());
    // Absolute member-count gap between Rizones and the LIVE Rotary.org count (0 when matched or not
    // yet loaded). While a club's live count is still loading it counts as 0 (stays put until loaded).
    const memberGap = (r: Row) => {
      const oc = orgCountOf(r);
      return (r.india && r.india.memberCount != null && oc.count != null)
        ? Math.abs(r.india.memberCount - oc.count) : 0;
    };
    // Sync clubs: member-count MISMATCH on top (largest gap first), then matched clubs by club name.
    syncRows.sort((a, b) => {
      const ga = memberGap(a), gb = memberGap(b);
      if ((ga > 0) !== (gb > 0)) return ga > 0 ? -1 : 1;   // mismatched clubs first
      if (ga > 0 && gb > 0 && ga !== gb) return gb - ga;    // bigger gap first (desc)
      return byName(a, b);                                 // matched → alphabetical
    });
    // Non-sync: syncable (Sync button) on TOP, then search-only; alphabetical within each.
    nonSyncRows.sort((a, b) => (Number(!!b.syncable) - Number(!!a.syncable)) || byName(a, b));
    return { syncRows, nonSyncRows };
  })();

  // How many SYNC clubs currently show a member-count mismatch (live count loaded and different).
  // Drives the top "Sync mismatched clubs" button — only shown when there's something to fix.
  const mismatchCount = groups.syncRows.filter((r) => {
    const oc = orgCountOf(r);
    return !oc.loading && r.india?.memberCount != null && oc.count != null && r.india.memberCount !== oc.count;
  }).length;

  // Sync a club fully into Rizones: rizones non-sync club → flip + member sweep; /clubs club not in
  // Rizones → add it + sync. Only ever called for syncable rows (ClubRotaryId is in /clubs).
  const onSyncClub = async (row: Row) => {
    const key = row.india ? `sync-${row.india.clubId}` : `add-${row.org.rotaryClubId}`;
    setBusyKey(key);
    try {
      if (row.india) {
        const r = await markClubSynced(row.india.clubId);
        setSuccess(r?.message || "Club synced; members syncing in the background.");
      } else {
        const r = await addClubFromOrg(row.org.rotaryClubId, Number(districtId));
        setSuccess(`Club added & synced. ${r?.membersAdded ?? 0} members (${r?.memberErrors ?? 0} errors).`);
      }
      await reload(true);   // silent → don't blank the table / jump to top
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to sync club"); }
    finally { setBusyKey(null); }
  };

  const renderRow = (row: Row, index: number) => {
    const rowBg = row.status === "matched" ? "bg-green-50" : row.status === "onlyIndia" ? "bg-yellow-50" : "bg-blue-50";
    return (
      <TableRow key={row.key} className={rowBg}>
        <TableCell className="border-r align-top">
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-7 flex-shrink-0 pt-0.5 text-right tabular-nums">{index + 1}.</span>
            <div className="flex-1 min-w-0">
              {row.india ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.india.clubName}</p>
                    <p className="text-xs text-muted-foreground">ID: {row.india.clubRotaryId || "—"} · Members: {row.india.memberCount ?? 0}</p>
                  </div>
                  {/* Actions only for SYNC clubs. Non-sync clubs are display-only (no view/edit/delete). */}
                  {Number(row.india.isSynced) === 1 && (
                    <div className="flex-shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row.india)} title="View / Edit" disabled={viewingId === row.india.clubId}>
                        {viewingId === row.india.clubId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(row.india)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              ) : row.org ? (
                // Club not yet in Rizones (syncable /clubs club) — still show its name + Rotary ID on the
                // left so the row reads cleanly (it's the same club; Sync will add it to Rizones).
                <div className="min-w-0">
                  <p className="font-medium truncate">{row.org.clubName}</p>
                  <p className="text-xs text-muted-foreground">ID: {row.org.rotaryClubId}</p>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground italic">— not in Rizones —</span>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="align-top">
          {row.org ? (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{row.org.clubName}</p>
                <p className="text-xs text-muted-foreground">
                  ID: {row.org.rotaryClubId}
                  {(() => {
                    const oc = orgCountOf(row);
                    if (oc.loading) return <Loader2 className="inline h-3 w-3 animate-spin ml-1 align-middle" />;
                    if (oc.error) return <span className="text-red-600 ml-1" title={oc.error}> · Members: err</span>;
                    const diff = (row.india && row.india.memberCount != null && oc.count != null) ? row.india.memberCount - oc.count : null;
                    return (
                      <>
                        {oc.count != null ? ` · Members: ${oc.count}` : ""}
                        {/* Member-count mismatch → signed diff in red, CLICK to see the per-member diff popup. */}
                        {diff != null && diff !== 0 && (
                          <span
                            className="text-red-600 font-semibold ml-1 cursor-pointer underline decoration-dotted"
                            onClick={() => row.india && setDiffFor({ clubId: row.india.clubId, clubName: row.india.clubName, clubRotaryId: String(row.india.clubRotaryId ?? ""), rizonesCount: row.india.memberCount ?? 0, orgCount: oc.count })}
                            title="Click to see which members differ and what Sync will do"
                          >
                            ({diff > 0 ? "+" : ""}{diff})
                          </span>
                        )}
                      </>
                    );
                  })()}
                </p>
              </div>
              {/* Sync clubs: mismatch → red "Mismatch" indicator (fixed by the top "Sync mismatched"
                  button, not per-club); matched → "Matched". Syncable non-sync clubs (in /clubs) →
                  club Sync button. Search-only non-sync clubs → nothing. */}
              {Number(row.india?.isSynced) === 1 ? (() => {
                const oc = orgCountOf(row);
                if (oc.loading) return null;   // still checking the live count
                const mismatch = row.india.memberCount != null && oc.count != null && row.india.memberCount !== oc.count;
                if (!mismatch) return <span className="inline-flex items-center gap-1 text-emerald-600 text-sm"><CheckCircle2 className="h-4 w-4" />Matched</span>;
                return <span className="inline-flex items-center gap-1 text-red-600 text-sm" title="Member count differs — use the “Sync mismatched clubs” button at the top to reconcile all of them."><AlertTriangle className="h-4 w-4" />Mismatch</span>;
              })() : row.syncable ? (
                <Button size="sm" variant="outline" onClick={() => onSyncClub(row)}
                  disabled={busyKey === (row.india ? `sync-${row.india.clubId}` : `add-${row.org.rotaryClubId}`)}
                  title="Present in Rotary.org /clubs — sync this club and all its members into Rizones">
                  {busyKey === (row.india ? `sync-${row.india.clubId}` : `add-${row.org.rotaryClubId}`)
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}Sync
                </Button>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">— not on Rotary.org —</span>
          )}
        </TableCell>
      </TableRow>
    );
  };

  const Section = ({ title, subtitle, color, rows, empty }: { title: string; subtitle: string; color: string; rows: Row[]; empty: string }) => (
    <Card>
      <CardContent className="p-0">
        <div className={`px-4 py-2 border-b flex items-center gap-2 ${color}`}>
          <span className="font-semibold">{title}</span>
          <Badge variant="secondary">{rows.length}</Badge>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/2 border-r bg-muted/40">Rotary Zones 4, 5, 6, 7 &amp; 8</TableHead>
              <TableHead className="w-1/2">Rotary.org</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => renderRow(r, i))}
            {rows.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">{empty}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings/rotary-org"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Club Sync</h2>
              <p className="text-muted-foreground text-base">Compare clubs in a district side-by-side and sync manually</p>
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">District</Label>
              <Select value={districtId} onValueChange={setDistrictId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Select district" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh from Rotary.org"}
            </Button>
          </div>
        </div>

        {loading && <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && data && (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              {/* Plain spans (not Badge) so there's no hover-darken that makes the text unreadable. */}
              <span className="inline-flex items-center rounded-md border border-green-300 bg-green-100 text-green-800 text-sm px-3 py-1">Synced Clubs:<b className="ml-1">{groups.syncRows.length}</b></span>
              <span
                className={`inline-flex items-center rounded-md border border-blue-300 bg-blue-100 text-blue-800 text-sm px-3 py-1 ${groups.nonSyncRows.filter((r) => !r.india).length > 0 ? "cursor-pointer underline decoration-dotted hover:bg-blue-200" : ""}`}
                onClick={() => groups.nonSyncRows.filter((r) => !r.india).length > 0 && setShowOrgOnly(true)}
                title="Click to see the clubs synced on Rotary.org but not yet in Rizones"
              >
                In Rotary.org, not in Rizones:<b className="ml-1">{groups.nonSyncRows.filter((r) => !r.india).length}</b>
              </span>
              <span className="inline-flex items-center rounded-md border border-yellow-300 bg-yellow-100 text-yellow-800 text-sm px-3 py-1">Not sync clubs:<b className="ml-1">{groups.nonSyncRows.filter((r) => r.india && !r.syncable).length}</b></span>
              <span className="inline-flex items-center rounded-md border border-red-300 bg-red-100 text-red-800 text-sm px-3 py-1">Member mismatch:<b className="ml-1">{mismatchCount}</b></span>
              {/* One bulk action: reconcile ONLY the mismatched sync clubs in THIS district. Freezes while running. */}
              {mismatchCount > 0 && (
                <Button size="sm" onClick={onReconcileDistrict} disabled={reconciling}
                  title="Reconcile members for every mismatched club in this district — adds missing, removes departed (member profiles are kept).">
                  {reconciling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  {reconciling ? "Reconciling…" : `Sync ${mismatchCount} mismatched club${mismatchCount === 1 ? "" : "s"}`}
                </Button>
              )}
              {countsLoading && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking member count {Object.values(liveOrg).filter((v) => !v.loading).length}/{Object.keys(liveOrg).length} clubs…
                </span>
              )}
              {data.lastFetchedUtc && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Cache last refreshed: {new Date(data.lastFetchedUtc).toLocaleString()}
                  {data.nextRefreshUtc && <> · Next auto-refresh: {new Date(data.nextRefreshUtc).toLocaleString()}</>}
                </span>
              )}
              {!data.lastFetchedUtc && data.counts.rotaryOrg === 0 && (
                <span className="text-xs text-amber-600 ml-auto">
                  Cache empty — click "Refresh from Rotary.org" to populate.
                </span>
              )}
            </div>

            <div className="space-y-4">
              <Section
                title="Sync clubs"
                subtitle="full data — members & BOD synced from Rotary.org"
                color="bg-green-50"
                rows={groups.syncRows}
                empty="No sync clubs in this district"
              />
              <Section
                title="Non-sync clubs"
                subtitle="syncable clubs (in Rotary.org /clubs) on top with a Sync button; search-only clubs below"
                color="bg-yellow-50"
                rows={groups.nonSyncRows}
                empty="No non-sync clubs in this district"
              />
            </div>
          </>
        )}

        {/* Edit / View dialog */}
        <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Club Comparison & Edit</DialogTitle>
              <DialogDescription>Click the ⬅ icon to copy a value from Rotary.org into the editable Rotary Zones 4, 5, 6, 7 & 8 field.</DialogDescription>
            </DialogHeader>
            {editTarget && (
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground">
                  <div className="col-span-3">Field</div>
                  <div className="col-span-4">Rotary.org (read-only)</div>
                  <div className="col-span-1 text-center">Copy</div>
                  <div className="col-span-4">Rotary Zones 4, 5, 6, 7 & 8 (edit)</div>
                </div>
                {[
                  { key: "clubName", label: "Club Name", orgValue: editTarget.org?.clubName },
                  { key: "meetingAddress", label: "Meeting Address", orgValue: (editTarget.org?.addresses?.[0]?.addressLine1 || "") },
                  { key: "meetingDay", label: "Meeting Day", orgValue: editTarget.org?.addresses?.[0]?.meetingDay },
                  { key: "meetingTime", label: "Meeting Time", orgValue: editTarget.org?.addresses?.[0]?.meetingTime },
                  { key: "city", label: "City", orgValue: editTarget.org?.addresses?.[0]?.city },
                  { key: "state", label: "State", orgValue: editTarget.org?.addresses?.[0]?.state },
                  { key: "charterDate", label: "Charter Date", orgValue: editTarget.org?.charterDate?.substring?.(0, 10) },
                ].map((row) => (
                  <div key={row.key} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 text-sm">{row.label}</div>
                    <div className="col-span-4 text-sm bg-muted p-2 rounded text-muted-foreground truncate" title={row.orgValue || ""}>{row.orgValue || "—"}</div>
                    <div className="col-span-1 flex justify-center">
                      <Button variant="ghost" size="icon" disabled={!row.orgValue} onClick={() => copyFromOrg(row.key, row.orgValue)} title="Copy from Rotary.org">
                        <ArrowRightCircle className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="col-span-4">
                      <Input
                        value={editForm[row.key] || ""}
                        onChange={(e) => setEditForm((prev: any) => ({ ...prev, [row.key]: e.target.value }))}
                      />
                    </div>
                  </div>
                ))}
                {!editTarget.org && (
                  <p className="text-sm text-amber-600">Rotary.org details could not be loaded (no Club Rotary ID, or member-only access).</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>Close</Button>
              <Button onClick={saveEdit} disabled={savingEdit}>
                {savingEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {savingEdit ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Club"
          description={`Soft-delete "${deleteTarget?.clubName}"? This cascades: members, BOD, modules.`}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={onDelete}
          cancelLabel="Cancel"
          onCancel={() => !deleting && setDeleteTarget(null)}
        />
        {showOrgOnly && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowOrgOnly(false)}>
            <div className="bg-background rounded-lg shadow-lg w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold">Synced on Rotary.org, not yet in Rizones</h3>
              <p className="text-sm text-muted-foreground">In Rotary.org <code>/clubs</code> but missing from Rizones. Click Sync to add + sync each.</p>
              {(() => {
                const list = groups.nonSyncRows.filter((r) => !r.india);
                if (list.length === 0) return <p className="text-sm text-muted-foreground">None — Rizones matches Rotary.org.</p>;
                return (
                  <ul className="divide-y rounded-md border">
                    {list.map((r, i) => (
                      <li key={r.key} className="flex items-center justify-between px-3 py-2 gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{i + 1}. {r.org.clubName}</p>
                          <p className="text-xs text-muted-foreground">ID: {r.org.rotaryClubId}{r.org.memberCount != null ? ` · Members: ${r.org.memberCount}` : ""}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => onSyncClub(r)} disabled={busyKey === `add-${r.org.rotaryClubId}`}>
                          {busyKey === `add-${r.org.rotaryClubId}` ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}Sync
                        </Button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
              <div className="flex justify-end border-t pt-3">
                <Button variant="outline" onClick={() => setShowOrgOnly(false)}>Close</Button>
              </div>
            </div>
          </div>
        )}
        {diffFor && (
          <MemberDiffDialog
            club={diffFor}
            onClose={() => setDiffFor(null)}
            onSoftDeleted={(n: number) => { setSuccess(`${n} no-Rotary-ID member(s) soft-deleted.`); setDiffFor(null); reload(); }}
            onError={setError}
          />
        )}
        <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}

// ── Per-member diff popup (same as the member-match page): what Sync will ADD (on Rotary.org, missing
// here), REMOVE (has a Rotary ID but gone from Rotary.org), and no-Rotary-ID members (soft-deleted
// unless honorary / in the COG club). Soft-delete is applied on demand; everything else via Sync.
interface DiffMemberAdd { rotaryId: string; name: string; isHonorary: boolean }
interface DiffMemberRemove { memberId: number; rotaryId: string; name: string }
interface DiffMemberNoRid { memberId: number; name: string; honorary: boolean; inCog: boolean; willSoftDelete: boolean; keepReason: string | null }
interface DiffData {
  clubName: string; rizonesCount: number; orgCount: number;
  toAdd: DiffMemberAdd[]; toRemove: DiffMemberRemove[]; noRotaryId: DiffMemberNoRid[]; error?: string;
}

function MemberDiffDialog({ club, onClose, onSoftDeleted, onError }: {
  club: { clubId: number; clubName: string; clubRotaryId: string; rizonesCount: number };
  onClose: () => void; onSoftDeleted: (n: number) => void; onError: (m: string) => void;
}) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const d = await getClubMemberDiff(club.clubId); if (alive) setData(d); }
      catch (e: any) { if (alive) { onError(e?.response?.data?.message || "Failed to load member diff."); onClose(); } }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.clubId]);

  const softDeletable = (data?.noRotaryId || []).filter((m) => m.willSoftDelete);
  const applySoftDelete = async () => {
    if (softDeletable.length === 0) return;
    setBusy(true);
    try {
      const res = await softDeleteClubMemberLinks(club.clubId, softDeletable.map((m) => m.memberId));
      onSoftDeleted(res?.softDeleted ?? softDeletable.length);
    } catch (e: any) { onError(e?.response?.data?.message || "Failed to soft-delete members."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-lg font-semibold">{club.clubName}</h3>
          {data && !data.error && (
            <p className="text-sm text-muted-foreground">rizones <b>{data.rizonesCount}</b> vs Rotary.org <b>{data.orgCount}</b> — here&apos;s exactly who differs.</p>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><RotaryLoader /></div>
        ) : !data || data.error ? (
          <p className="text-sm text-red-600">{data?.error || "Could not load the diff."}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <section>
              <p className="font-medium text-emerald-700">On Rotary.org, missing here — added when you Sync ({data.toAdd.length})</p>
              {data.toAdd.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                <ul className="mt-1 divide-y rounded-md border">
                  {data.toAdd.map((m) => (
                    <li key={m.rotaryId} className="flex items-center justify-between px-3 py-1.5">
                      <span>{m.name || "(no name)"} {m.isHonorary && <Badge variant="secondary" className="ml-1 text-[10px]">Honorary</Badge>}</span>
                      <span className="text-xs text-muted-foreground">RID {m.rotaryId}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <p className="font-medium text-amber-700">Left Rotary.org — removed when you Sync ({data.toRemove.length})</p>
              {data.toRemove.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                <ul className="mt-1 divide-y rounded-md border">
                  {data.toRemove.map((m) => (
                    <li key={m.memberId} className="flex items-center justify-between px-3 py-1.5">
                      <span>{m.name || "(no name)"}</span>
                      <span className="text-xs text-muted-foreground">RID {m.rotaryId}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <p className="font-medium text-red-700">No Rotary ID ({data.noRotaryId.length})</p>
              {data.noRotaryId.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                <ul className="mt-1 divide-y rounded-md border">
                  {data.noRotaryId.map((m) => (
                    <li key={m.memberId} className="flex items-center justify-between px-3 py-1.5">
                      <span>{m.name || "(no name)"}</span>
                      {m.willSoftDelete
                        ? <Badge variant="destructive" className="text-[10px]">will soft-delete</Badge>
                        : <Badge variant="secondary" className="text-[10px]">kept — {m.keepReason}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <div className="flex gap-2 justify-end border-t pt-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {softDeletable.length > 0 && (
            <Button variant="destructive" onClick={applySoftDelete} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Soft-delete {softDeletable.length} no-Rotary-ID member{softDeletable.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
