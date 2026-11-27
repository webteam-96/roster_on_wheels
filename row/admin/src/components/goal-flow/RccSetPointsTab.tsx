"use client";

// District Set Goals → Questions → "RCC Set Points" (user 2026-11-23): the 26 RCC questions by category, and the
// DG sets the points of each one - the same fields as an Auto Fetch question (Points, For every, Bonus, Min / Max).
// The club earns them from its Rotary.org Achieved, worked out live by the API after every sync. SEPARATE from District
// Awards: these points count in District Set Goals only (never in District Awards' Club Points).

import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "@/components/icons";
import { apiClient as api } from "@/services/goalFlowApi";

interface RccPointItem {
  itemNo: number; category: string; title: string; points: number; perUnit: number;
  isBonus: boolean; bonusPoints: number; minBonus: number; maxBonus: number;
}

export default function RccSetPointsTab({ districtId, yearId }: { districtId: number; yearId: number | null }) {
  const [items, setItems] = useState<RccPointItem[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!districtId || !yearId) return;
    setItems(null); setDirty(false); setMsg(null);
    api.get(`/api/goal-flow/district-set-goals/district/${districtId}/rcc-points`, { params: { yearId } })
      .then((r) => { setItems(r.data.items); setCanEdit(!!r.data.canEdit); })
      .catch(() => setMsg({ ok: false, text: "Failed to load the RCC points." }));
  }, [districtId, yearId]);

  const groups = useMemo(() => {
    const out: { category: string; rows: RccPointItem[] }[] = [];
    (items ?? []).forEach((it) => {
      const g = out.find((x) => x.category === it.category);
      if (g) g.rows.push(it); else out.push({ category: it.category, rows: [it] });
    });
    return out;
  }, [items]);

  const set = (no: number, patch: Partial<RccPointItem>) => {
    setItems((xs) => (xs ?? []).map((x) => (x.itemNo === no ? { ...x, ...patch } : x)));
    setDirty(true); setMsg(null);
  };
  const n = (v: string) => (v === "" ? 0 : Math.max(0, Number(v) || 0));

  const save = async () => {
    if (!items || !yearId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.put(`/api/goal-flow/district-set-goals/district/${districtId}/rcc-points`, { yearId, items });
      setMsg({ ok: true, text: r.data?.message || "RCC points saved." }); setDirty(false);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.message || "Failed to save the RCC points." });
    } finally { setBusy(false); }
  };

  if (!items) return msg ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{msg.text}</p>
    : <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading RCC questions…</div>;

  const inp = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums disabled:bg-slate-50 disabled:text-slate-500";
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <Table bare className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
              <th className="px-4 py-2 text-left">Question</th>
              <th className="px-2 py-2 text-right w-24">Points</th>
              <th className="px-2 py-2 text-right w-24">For every</th>
              <th className="px-2 py-2 text-center w-20">Bonus</th>
              <th className="px-2 py-2 text-right w-24">Bonus points</th>
              <th className="px-2 py-2 text-right w-20">Min</th>
              <th className="px-2 py-2 text-right w-20">Max</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.category}>
                <tr><td colSpan={7} className="bg-[#0B2A5E] px-4 py-2 text-sm font-bold text-white">{g.category}</td></tr>
                {g.rows.map((it) => (
                  <tr key={it.itemNo} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-800">{it.title}</div>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Auto Fetch · Rotary.org</span>
                    </td>
                    <td className="px-2 py-2"><input className={inp} type="number" min={0} step="any" disabled={!canEdit} value={it.points}
                      onChange={(e) => set(it.itemNo, { points: n(e.target.value) })} aria-label={`Points for ${it.title}`} /></td>
                    <td className="px-2 py-2"><input className={inp} type="number" min={1} step={1} disabled={!canEdit} value={it.perUnit}
                      onChange={(e) => set(it.itemNo, { perUnit: Math.max(1, Math.trunc(n(e.target.value)) || 1) })} aria-label={`For every for ${it.title}`} /></td>
                    <td className="px-2 py-2 text-center"><input type="checkbox" disabled={!canEdit} checked={it.isBonus}
                      onChange={(e) => set(it.itemNo, { isBonus: e.target.checked })} aria-label={`Bonus for ${it.title}`} /></td>
                    <td className="px-2 py-2"><input className={inp} type="number" min={0} step="any" disabled={!canEdit || !it.isBonus} value={it.bonusPoints}
                      onChange={(e) => set(it.itemNo, { bonusPoints: n(e.target.value) })} aria-label={`Bonus points for ${it.title}`} /></td>
                    <td className="px-2 py-2"><input className={inp} type="number" min={0} step={1} disabled={!canEdit || !it.isBonus} value={it.minBonus}
                      onChange={(e) => set(it.itemNo, { minBonus: Math.trunc(n(e.target.value)) })} aria-label={`Min for ${it.title}`} /></td>
                    <td className="px-2 py-2"><input className={inp} type="number" min={0} step={1} disabled={!canEdit || !it.isBonus} value={it.maxBonus}
                      onChange={(e) => set(it.itemNo, { maxBonus: Math.trunc(n(e.target.value)) })} aria-label={`Max for ${it.title}`} /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      </div>
      <p className="text-xs text-slate-500">Points = (Achieved ÷ For every, whole number) × Points. Bonus: added when Achieved reaches Min; Max caps the Achieved counted (blank / 0 = no limit).</p>
      {msg && <p className={`rounded-lg px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {canEdit && (
        <div className="sticky bottom-3 flex items-center justify-end gap-3">
          {dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 shadow">Unsaved changes</span>}
          <Button type="button" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save RCC points
          </Button>
        </div>
      )}
    </div>
  );
}
