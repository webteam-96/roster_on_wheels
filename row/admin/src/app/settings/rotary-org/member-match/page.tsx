"use client";

/**
 * SuperAdmin → Rotary.org → "Check Member Matched or not".
 *
 * Pick a district → list its SYNC clubs → compare the ROW member count (left,
 * club_members isdeleted=0 — same set the sweep reconciles) against the LIVE
 * Rotary.org count (right = /Active + /Honorary, NOT the /clubs number). Clubs
 * whose counts differ are highlighted and sorted to the top; each mismatch gets a
 * one-click "Sync" that runs the exact same logic as
 * `RotaryOrgSyncWorker.exe --member-sweep --club-id <id>`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, CheckCircle2, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import {
  getDistricts, getDistrictSyncClubsForMatch, getClubOrgMemberCount,
  sweepMembersForClub, sweepMembersForDistrict,
  getClubMemberDiff, softDeleteClubMemberLinks,
} from "@/services/api";

interface DistrictOption { id: number; districtNumber: string }
interface OrgCount { orgActive: number; orgHonorary: number; orgTotal: number; error?: string }
interface ClubRow {
  clubId: number;
  clubRotaryId: string;
  clubName: string;
  clubType: string;
  localCount: number;
  org: OrgCount | null;   // null until loaded
  orgLoading: boolean;
}

// Run async workers over items with limited concurrency (avoid hammering Rotary.org).
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = 4) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx]); } catch { /* per-item error handled in worker */ }
    }
  });
  await Promise.all(runners);
}

export default function MemberMatchPage() {
  const { isSuperAdmin } = useAuth();
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [countsLoading, setCountsLoading] = useState(false);
  const [sweepingKey, setSweepingKey] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<ClubRow | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic token — a later district selection invalidates any in-flight earlier load,
  // so a slow response for district A can't overwrite the table after B was picked.
  const reqRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        // hasSyncClubs=true → only districts that have ≥1 sync club (hide non-sync-only districts like Taiwan)
        const list = await getDistricts(1, 1000, undefined, undefined, undefined, undefined, undefined, true);
        setDistricts((list?.items || [])
          .map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }))
          // numeric-aware sort: DistrictNumber is a VARCHAR, so "999" must come before "3142"
          .sort((a: any, b: any) =>
            String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch { setError("Failed to load districts."); }
    })();
  }, []);

  const loadDistrict = async (idStr: string) => {
    if (!idStr) return;
    const token = ++reqRef.current;
    const stale = () => token !== reqRef.current;
    setLoading(true);
    setClubs([]);
    try {
      const res = await getDistrictSyncClubsForMatch(Number(idStr));
      if (stale()) return; // a newer district was picked while this was in flight
      const rows: ClubRow[] = (res?.items || []).map((c: any) => ({
        clubId: c.clubId,
        clubRotaryId: String(c.clubRotaryId ?? ""),
        clubName: c.clubName || "",
        clubType: c.clubType || "Rotary Club",
        localCount: Number(c.localCount ?? 0),
        org: null,
        orgLoading: true,
      }));
      setClubs(rows);
      setLoading(false);
      // Progressively fetch the live Rotary.org count for each club.
      setCountsLoading(true);
      await runPool(rows, async (row) => {
        if (stale()) return;
        try {
          const oc = await getClubOrgMemberCount(row.clubId);
          if (stale()) return;
          setClubs((prev) => prev.map((c) => c.clubId === row.clubId
            ? { ...c, org: { orgActive: oc.orgActive ?? 0, orgHonorary: oc.orgHonorary ?? 0, orgTotal: oc.orgTotal ?? 0, error: oc.error }, orgLoading: false }
            : c));
        } catch (e: any) {
          if (stale()) return;
          setClubs((prev) => prev.map((c) => c.clubId === row.clubId
            ? { ...c, org: { orgActive: 0, orgHonorary: 0, orgTotal: 0, error: e?.message || "load failed" }, orgLoading: false }
            : c));
        }
      }, 4);
      if (stale()) return;
      setCountsLoading(false);
    } catch (e: any) {
      if (stale()) return;
      setError(e?.response?.data?.message || "Failed to load clubs.");
      setLoading(false);
    }
  };

  const onDistrictChange = (v: string) => { setDistrictId(v); loadDistrict(v); };

  const reloadOne = async (clubId: number) => {
    setClubs((prev) => prev.map((c) => c.clubId === clubId ? { ...c, orgLoading: true } : c));
    try {
      const oc = await getClubOrgMemberCount(clubId);
      setClubs((prev) => prev.map((c) => c.clubId === clubId
        ? { ...c, org: { orgActive: oc.orgActive ?? 0, orgHonorary: oc.orgHonorary ?? 0, orgTotal: oc.orgTotal ?? 0, error: oc.error }, orgLoading: false }
        : c));
    } catch {
      setClubs((prev) => prev.map((c) => c.clubId === clubId ? { ...c, orgLoading: false } : c));
    }
  };

  const onSweepClub = async (row: ClubRow) => {
    setSweepingKey(`club-${row.clubId}`);
    try {
      const r = await sweepMembersForClub(row.clubId);
      setSuccess(r?.message || "Member sync started.");
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to start sync.");
    } finally { setSweepingKey(null); }
  };

  const onSweepDistrict = async () => {
    if (!districtId) return;
    setSweepingKey("district");
    try {
      const r = await sweepMembersForDistrict(Number(districtId));
      setSuccess(r?.message || "District member sync started.");
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to start district sync.");
    } finally { setSweepingKey(null); }
  };

  // Sort: loaded mismatches first (biggest gap on top), then matched, then still-loading.
  const sortedClubs = useMemo(() => {
    const diffOf = (c: ClubRow) => c.org ? Math.abs(c.localCount - c.org.orgTotal) : -1;
    const rank = (c: ClubRow) => {
      if (!c.org) return 2;                                  // still loading → bottom
      return c.localCount !== c.org.orgTotal ? 0 : 1;      // mismatch → top, matched → middle
    };
    return [...clubs].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return diffOf(b) - diffOf(a);            // both mismatched → biggest gap first
      return a.clubName.localeCompare(b.clubName);
    });
  }, [clubs]);

  const loadedCount = clubs.filter((c) => c.org).length;
  const mismatchCount = clubs.filter((c) => c.org && c.localCount !== c.org.orgTotal).length;

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/rotary-org"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Check Member Matched or not</h2>
            <p className="text-muted-foreground text-base">
              ROW vs Rotary.org member count per sync club. Rotary.org count is live (Active + Honorary).
            </p>
          </div>
        </div>

        {/* District picker + district sync */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>District</Label>
              <Select value={districtId} onValueChange={onDistrictChange}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Select a district" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>District {d.districtNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {districtId && clubs.length > 0 && (
              <Button variant="outline" onClick={onSweepDistrict} disabled={sweepingKey !== null}>
                {sweepingKey === "district" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync whole district
              </Button>
            )}
            {clubs.length > 0 && (
              <div className="ml-auto text-sm text-muted-foreground">
                {countsLoading
                  ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading counts {loadedCount}/{clubs.length}…</span>
                  : <span><b className={mismatchCount ? "text-red-600" : "text-emerald-600"}>{mismatchCount}</b> mismatch{mismatchCount === 1 ? "" : "es"} of {clubs.length} sync clubs</span>}
              </div>
            )}
          </CardContent>
        </Card>

        {loading && <RotaryLoader />}

        {!loading && districtId && clubs.length === 0 && (
          <p className="text-muted-foreground text-sm">No sync clubs found for this district.</p>
        )}

        {clubs.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Club</TableHead>
                    <TableHead className="text-center">ROW</TableHead>
                    <TableHead className="text-center">Rotary.org (A+H)</TableHead>
                    <TableHead className="text-center">Diff</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedClubs.map((c, idx) => {
                    const loaded = !!c.org;
                    const mismatch = loaded && c.localCount !== c.org!.orgTotal;
                    const diff = loaded ? c.localCount - c.org!.orgTotal : 0;
                    return (
                      <TableRow key={c.clubId} className={mismatch ? "bg-red-50 hover:bg-red-100/70" : ""}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">{c.clubName}</div>
                          <div className="text-xs text-muted-foreground">RID {c.clubRotaryId}</div>
                        </TableCell>
                        <TableCell className="text-center font-semibold">{c.localCount}</TableCell>
                        <TableCell className="text-center">
                          {c.orgLoading ? (
                            <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                          ) : c.org?.error ? (
                            <span className="text-xs text-red-600" title={c.org.error}>error</span>
                          ) : (
                            <span className="font-semibold" title={`Active ${c.org?.orgActive ?? 0} + Honorary ${c.org?.orgHonorary ?? 0}`}>
                              {c.org?.orgTotal ?? 0}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {!loaded ? <span className="text-muted-foreground">—</span>
                            : mismatch
                              ? <Badge variant="destructive" className="cursor-pointer hover:opacity-80" title="Click to see which members differ and what will happen to them" onClick={() => setDiffFor(c)}>{diff > 0 ? `+${diff}` : diff}</Badge>
                              : <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />}
                        </TableCell>
                        <TableCell className="text-right">
                          {mismatch ? (
                            <Button size="sm" onClick={() => onSweepClub(c)} disabled={sweepingKey !== null}>
                              {sweepingKey === `club-${c.clubId}`
                                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                              Sync
                            </Button>
                          ) : loaded ? (
                            <Button size="sm" variant="ghost" onClick={() => reloadOne(c.clubId)} title="Re-check count">
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {clubs.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1 text-amber-500" />
            &quot;Sync&quot; runs the same reconcile as <code>--member-sweep --club-id</code> (adds new Rotary IDs,
            updates existing, terminates missing). It runs in the background and emails a report; re-check the count after a minute.
          </p>
        )}

        {diffFor && (
          <DiffDialog
            club={diffFor}
            onClose={() => setDiffFor(null)}
            onSoftDeleted={(clubId, n) => {
              setClubs((prev) => prev.map((c) => c.clubId === clubId ? { ...c, localCount: Math.max(0, c.localCount - n) } : c));
              setSuccess(`${n} no-Rotary-ID member(s) soft-deleted.`);
            }}
            onError={setError}
          />
        )}

        <SuccessAlert open={!!success} title="Started" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}

// Per-member diff for one club: what will be ADDED (from Rotary.org), REMOVED (left Rotary.org),
// and the no-Rotary-ID members (soft-deleted unless honorary / in COG). The soft-delete is applied
// here on demand — everything else happens via the row's "Sync".
interface DiffMemberAdd { rotaryId: string; name: string; isHonorary: boolean }
interface DiffMemberRemove { memberId: number; rotaryId: string; name: string }
interface DiffMemberNoRid { memberId: number; name: string; honorary: boolean; inCog: boolean; willSoftDelete: boolean; keepReason: string | null }
interface DiffData {
  clubName: string; localCount: number; orgCount: number;
  toAdd: DiffMemberAdd[]; toRemove: DiffMemberRemove[]; noRotaryId: DiffMemberNoRid[]; error?: string;
}

function DiffDialog({ club, onClose, onSoftDeleted, onError }: {
  club: ClubRow; onClose: () => void; onSoftDeleted: (clubId: number, n: number) => void; onError: (m: string) => void;
}) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const d = await getClubMemberDiff(club.clubId); if (alive) setData(d); }
      catch (e: any) { if (alive) onError(e?.response?.data?.message || "Failed to load member diff."); if (alive) onClose(); }
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
      onSoftDeleted(club.clubId, res?.softDeleted ?? softDeletable.length);
      onClose();
    } catch (e: any) { onError(e?.response?.data?.message || "Failed to soft-delete members."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-lg font-semibold">{club.clubName}</h3>
          {data && !data.error && (
            <p className="text-sm text-muted-foreground">ROW <b>{data.localCount}</b> vs Rotary.org <b>{data.orgCount}</b> — here&apos;s exactly who differs.</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><RotaryLoader /></div>
        ) : !data || data.error ? (
          <p className="text-sm text-red-600">{data?.error || "Could not load the diff."}</p>
        ) : (
          <div className="space-y-4 text-sm">
            {/* To add */}
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

            {/* Left Rotary.org */}
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

            {/* No Rotary ID */}
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
