"use client";

// Stage, owner and notes of a prospect (feature contacts_growth), shared by the add and edit pages. Renders nothing
// while the feature is off, so those pages look as before.

import { useEffect, useState } from "react";
import { getClubMembers } from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { CONTACTS_FEATURE, PROSPECT_STAGES, label } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { ListChecks } from "@/components/icons";

export interface PipelineValue { stage: string; ownerMemberId: number | null; notes: string }

const FIELD = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function ProspectPipelineFields({ clubId, number, value, onChange }: {
  clubId: number; number: number; value: PipelineValue; onChange: (v: PipelineValue) => void;
}) {
  const on = useFeatureOn(CONTACTS_FEATURE);
  const [members, setMembers] = useState<{ id: number; memberName: string }[] | null>(null);

  useEffect(() => {
    if (!on || !clubId) return;
    getClubMembers(clubId, 1, 500).then((r) => setMembers(r.items)).catch(() => setMembers([]));
  }, [on, clubId]);

  if (!on) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-azure text-xs font-bold text-white">{number}</div>
        <ListChecks className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Pipeline</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-slate-700">
          <span className="block">Stage</span>
          <select value={value.stage} onChange={(e) => onChange({ ...value, stage: e.target.value })} className={`${FIELD} font-normal`}>
            {PROSPECT_STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-700">
          <span className="block">Owner <span className="font-normal text-slate-400">(the member who follows up)</span></span>
          {members === null ? <Skeleton className="h-9 w-full" /> : (
            <select value={value.ownerMemberId ?? 0} onChange={(e) => onChange({ ...value, ownerMemberId: Number(e.target.value) || null })}
              className={`${FIELD} font-normal`}>
              <option value={0}>No owner</option>
              {value.ownerMemberId && !members.some((m) => m.id === value.ownerMemberId) && (
                <option value={value.ownerMemberId}>Current owner (no longer in the club)</option>
              )}
              {members.map((m) => <option key={m.id} value={m.id}>{m.memberName}</option>)}
            </select>
          )}
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
          <span className="block">Notes</span>
          <textarea rows={4} maxLength={2000} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })}
            placeholder="Conversations, meetings attended, next step" className={`${FIELD} font-normal`} />
        </label>
      </div>
    </div>
  );
}
