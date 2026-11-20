"use client";

/**
 * Year-end rollover for a club or a district (API: YearRolloverController). Shows every change before it is made,
 * applies only what is ticked, and lists earlier runs with an Undo for each. Running it twice adds nothing: rows
 * already in the new year show as "Already there" and are never sent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Undo2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { asUtc } from "@/lib/planning";
import { buildApplyBody, countChanges, defaultSelection, summaryText, type RolloverSelection } from "@/lib/rollover";
import {
  applyRollover, getRolloverPreview, getRotaryYears, undoRollover,
  type RolloverAction, type RolloverPreview, type RolloverScope,
} from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;
const ACTION_LABEL: Record<RolloverAction, string> = { add: "Will be added", exists: "Already there", left: "No longer in the club" };

function ActionTag({ action }: { action: RolloverAction }) {
  return (
    <span className={`text-xs ${action === "add" ? "font-semibold text-primary" : "text-muted-foreground"}`}>{ACTION_LABEL[action]}</span>
  );
}

export default function RolloverPanel({ scope, scopeId }: { scope: RolloverScope; scopeId: number }) {
  const fmt = useFormat();
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [fromYearId, setFromYearId] = useState<number | undefined>(undefined);
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<RolloverSelection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { getRotaryYears().then(setYears).catch(() => setYears([])); }, []);

  const load = useCallback(() => {
    setPreview(null);
    setLoadError(null);
    setConfirming(false);
    getRolloverPreview(scope, scopeId, fromYearId)
      .then((p) => { setPreview(p); setSel(defaultSelection(p)); })
      .catch((err) => setLoadError(message(err, "Could not load the rollover preview.")));
  }, [scope, scopeId, fromYearId]);

  useEffect(() => { load(); }, [load]);

  const body = useMemo(() => (preview && sel ? buildApplyBody(preview, sel) : null), [preview, sel]);
  const changes = preview && body ? countChanges(preview, body) : 0;

  const apply = async () => {
    if (!body) return;
    setBusy(true);
    try {
      const r = await applyRollover(scope, scopeId, body);
      setDone(r.changed === 0 ? "Nothing new to carry over: everything ticked is already in the new year." : `${r.changed} changes made.`);
      load();
    } catch (err) {
      setError(message(err, "The rollover could not be applied."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const undo = async (runId: number) => {
    setBusy(true);
    try {
      const r = await undoRollover(runId);
      setDone(`Rollover undone: ${r.removed} rows removed from the new year.`);
      load();
    } catch (err: any) {
      const blockers: string[] = err?.response?.data?.blockers ?? [];
      setError(message(err, "The rollover could not be undone.") + (blockers.length ? ` ${blockers.join(". ")}.` : ""));
    } finally {
      setBusy(false);
    }
  };

  const tick = (patch: Partial<RolloverSelection>) => setSel((s) => (s ? { ...s, ...patch } : s));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Roll over from</span>
          <select className={SELECT} value={fromYearId ?? ""} onChange={(e) => setFromYearId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Current Rotary year</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
          </select>
        </label>
        {preview && <p className="pb-2 text-sm text-muted-foreground">Into {preview.toYear.label}. Nothing changes until you apply.</p>}
      </div>

      {loadError ? (
        <Card><CardContent className="space-y-3 p-6">
          <p className="text-sm">{loadError}</p>
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </CardContent></Card>
      ) : !preview || !sel ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <TableSkeleton rows={5} />
        </div>
      ) : (
        <>
          <Card><CardContent className="space-y-4 p-6">
            <h3 className="text-lg font-semibold">Committees</h3>
            {preview.committees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No committees in {preview.fromYear.label} to carry over.</p>
            ) : preview.committees.map((c) => (
              <div key={c.sourceId} className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
                <label className="flex items-center gap-3">
                  <Checkbox checked={!!sel.committees[c.sourceId]} onCheckedChange={(v) => tick({ committees: { ...sel.committees, [c.sourceId]: v === true } })} />
                  <span className="font-medium" data-no-translate={c.sourceId === 0 ? undefined : true}>{c.name}</span>
                  <ActionTag action={c.action} />
                </label>
                {c.subGroups.length > 0 && <p className="pl-8 text-xs text-muted-foreground">Sub-groups: <span data-no-translate>{c.subGroups.join(", ")}</span></p>}
                {sel.committees[c.sourceId] && (
                  <ul className="grid gap-1 pl-8 sm:grid-cols-2">
                    {c.members.length === 0 && <li className="text-sm text-muted-foreground">No members.</li>}
                    {c.members.map((m) => (
                      <li key={m.key}>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox disabled={m.action !== "add"} checked={m.action === "add" && !!sel.members[m.key]}
                            onCheckedChange={(v) => tick({ members: { ...sel.members, [m.key]: v === true } })} />
                          <span data-no-translate>{m.name}</span>
                          {m.action !== "add" && <ActionTag action={m.action} />}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent></Card>

          {scope === "club" && (
            <Card><CardContent className="space-y-4 p-6">
              <h3 className="text-lg font-semibold">Officers</h3>
              {preview.ipp ? (
                <label className="flex items-center gap-3">
                  <Checkbox disabled={preview.ipp.action !== "add"} checked={preview.ipp.action === "add" && sel.includeIpp}
                    onCheckedChange={(v) => tick({ includeIpp: v === true })} />
                  <span>Make <span data-no-translate>{preview.ipp.name}</span> Immediate Past President for {preview.toYear.label}</span>
                  <ActionTag action={preview.ipp.action} />
                </label>
              ) : (
                <p className="text-sm text-muted-foreground">No club president is recorded for {preview.fromYear.label}.</p>
              )}
              {preview.officers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Keep these officers in the same office for {preview.toYear.label}:</p>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {preview.officers.map((o) => (
                      <li key={o.sourceId}>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox disabled={o.action !== "add"} checked={o.action === "add" && !!sel.officers[o.sourceId]}
                            onCheckedChange={(v) => tick({ officers: { ...sel.officers, [o.sourceId]: v === true } })} />
                          <span><span data-no-translate>{o.name}</span>, {o.designation}</span>
                          {o.action !== "add" && <ActionTag action={o.action} />}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent></Card>
          )}

          <Card><CardContent className="space-y-3 p-6">
            <h3 className="text-lg font-semibold">Already in place for {preview.toYear.label}</h3>
            {preview.incoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No officers entered for {preview.toYear.label} yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {preview.incoming.map((o, i) => <li key={i}><span data-no-translate>{o.name}</span>, {o.designation}</li>)}
              </ul>
            )}
            {/* Officer progression (PN to PE to P to IPP) lists its pending steps here once that module is connected. */}
            {preview.pendingProgression.connected && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-sm font-medium">Officer progression steps waiting for confirmation</p>
                {preview.pendingProgression.steps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="text-sm">
                    {preview.pendingProgression.steps.map((s, i) => <li key={i}>{s.role}: <span data-no-translate>{s.memberName}</span> ({s.status})</li>)}
                  </ul>
                )}
              </div>
            )}
          </CardContent></Card>

          <div className="flex flex-wrap items-center gap-3">
            {!confirming ? (
              <Button disabled={busy || changes === 0} onClick={() => setConfirming(true)}>
                {changes === 0 ? "Nothing to apply" : `Apply ${changes} changes`}
              </Button>
            ) : (
              <>
                <p className="text-sm">Add {changes} rows to {preview.toYear.label}? You can undo this run later.</p>
                <Button disabled={busy} onClick={apply}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm</Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            )}
          </div>

          <Card><CardContent className="space-y-3 p-6">
            <h3 className="text-lg font-semibold">Earlier rollovers</h3>
            <p className="text-sm text-muted-foreground">
              Undo removes only what that run added. It is refused while anything added or edited since then hangs off
              it (for example a member added to a committee the run created); remove those first.
            </p>
            {preview.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rollover has been run yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {preview.runs.map((r) => (
                  <li key={r.runId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {fmt.date(asUtc(r.createdUtc), "long")}
                      {r.createdByName && <>, <span data-no-translate>{r.createdByName}</span></>}. {summaryText(r.summary)}
                      {r.status === "undone" && <span className="text-muted-foreground"> Undone {r.undoneUtc ? fmt.date(asUtc(r.undoneUtc), "long") : ""}.</span>}
                    </span>
                    {r.status === "applied" && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => undo(r.runId)}>
                        <Undo2 className="mr-2 h-4 w-4" />Undo
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        </>
      )}

      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      <SuccessAlert open={!!done} title="Rollover" description={done || ""} onOk={() => setDone(null)} />
    </div>
  );
}
