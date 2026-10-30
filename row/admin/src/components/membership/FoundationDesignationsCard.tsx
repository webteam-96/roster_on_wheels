"use client";

/**
 * Foundation designations on the admin member profile (build spec 3.12): the member's history of Paul Harris
 * Fellow, Major Donor and Bequest Society designations with dates, and add / remove for club and district admins.
 * Hidden when the membership_fields module is off or the viewer may not see this member's designations.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Award, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AlertModal from "@/components/AlertModal";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { useFeatureOn } from "@/components/FeatureGate";
import { useAuth } from "@/contexts/AuthContext";
import { DESIGNATION_OPTIONS } from "@/lib/foundationDesignations";
import {
  addMemberDesignation, getMemberDesignations, removeMemberDesignation, type MemberDesignation,
} from "@/services/api";

export const selectCls =
  "flex h-11 w-full rounded-xl border border-input bg-white px-3.5 py-2 text-base md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25";

export function apiMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

export default function FoundationDesignationsCard({ memberId }: { memberId: number }) {
  const on = useFeatureOn("membership_fields");
  const { isSuperAdmin, isAdmin, isAG } = useAuth();
  const canEdit = isSuperAdmin || isAdmin || isAG; // a member sees their own list read-only; the API decides either way
  const [rows, setRows] = useState<MemberDesignation[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [choice, setChoice] = useState(DESIGNATION_OPTIONS[0].value);
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MemberDesignation | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getMemberDesignations(memberId));
    } catch {
      setHidden(true); // module off (404) or no access (403): nothing to show
    }
  }, [memberId]);

  useEffect(() => {
    if (on && memberId > 0) load();
  }, [on, memberId, load]);

  if (!on || hidden || !(memberId > 0)) return null;

  const add = async () => {
    const opt = DESIGNATION_OPTIONS.find((o) => o.value === choice) ?? DESIGNATION_OPTIONS[0];
    setBusy(true);
    setError(null);
    try {
      await addMemberDesignation(memberId, { type: opt.type, level: opt.level, awardedDate: date, notes: notes.trim() || null });
      setDate("");
      setNotes("");
      await load();
    } catch (err) {
      setError(apiMessage(err, "Could not add the designation."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    setBusy(true);
    setError(null);
    try {
      await removeMemberDesignation(memberId, target.id);
      await load();
    } catch (err) {
      setError(apiMessage(err, "Could not remove the designation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[20px] border border-slate-200 overflow-hidden mb-4 bg-white">
      <header className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <Award className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Foundation designations</h3>
      </header>
      <div className="p-4 space-y-4">
        {rows === null ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No designations recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-800">{r.label}</span>
                  <span className="text-slate-500"> · {fmtDate(r.awardedDate)}</span>
                  {r.notes && <span className="block text-xs text-slate-500">{r.notes}</span>}
                </span>
                {canEdit && (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(r)} aria-label={`Remove ${r.label}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              <span>Designation</span>
              <select className={selectCls} value={choice} onChange={(e) => setChoice(e.target.value)}>
                {DESIGNATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              <span>Date reached</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              <span>Notes (optional)</span>
              <Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <Button type="button" onClick={add} disabled={busy || !date}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>

      <AlertModal
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Remove designation"
        description={removing ? `Remove ${removing.label} from this member's history?` : ""}
        confirmLabel="Remove"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={remove}
        cancelLabel="Cancel"
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
