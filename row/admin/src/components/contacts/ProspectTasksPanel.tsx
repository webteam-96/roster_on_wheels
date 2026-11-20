"use client";

// Follow-up tasks on prospects (feature contacts_growth). With a prospectId: that prospect's tasks plus a form to add
// one (the prospect edit page). Without: every task of the club (the follow-ups page). Renders nothing while the
// feature is off. The assigned member sees and completes the task in the app and gets a reminder before it is due.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getClubMembers, getProspectTasks, createProspectTask, updateProspectTask, deleteProspectTask,
  type ProspectTask, type SaveProspectTask,
} from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { CONTACTS_FEATURE, errorText } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { ClipboardList, Plus, Trash2, RotateCcw, CheckCircle2 } from "@/components/icons";

const FIELD = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const REMIND = [
  { value: "", label: "No reminder" },
  { value: "0", label: "On the due date" },
  { value: "1", label: "1 day before" },
  { value: "2", label: "2 days before" },
  { value: "3", label: "3 days before" },
  { value: "7", label: "1 week before" },
];

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function toSave(t: ProspectTask, status: "open" | "done"): SaveProspectTask {
  return {
    prospectId: t.prospectId, title: t.title, notes: t.notes ?? undefined, assigneeMemberId: t.assigneeMemberId,
    dueDate: t.dueDate, remindDaysBefore: t.remindDaysBefore, status,
  };
}

export default function ProspectTasksPanel({ clubId, prospectId, canManage }: {
  clubId: number; prospectId?: number; canManage: boolean;
}) {
  const on = useFeatureOn(CONTACTS_FEATURE);
  const [tasks, setTasks] = useState<ProspectTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "open" | "done">(prospectId ? "" : "open");
  const [members, setMembers] = useState<{ id: number; memberName: string }[] | null>(null);
  const [form, setForm] = useState({ title: "", assignee: 0, due: "", remind: "1", notes: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setTasks(await getProspectTasks(clubId, { status: status || undefined, prospectId }));
    } catch (e) {
      setTasks(null);
      setLoadError(errorText(e, "Could not load the follow-up tasks."));
    }
  }, [clubId, prospectId, status]);

  useEffect(() => { if (on) load(); }, [on, load]);
  useEffect(() => {
    if (!on || !prospectId || !canManage) return;
    getClubMembers(clubId, 1, 500).then((r) => setMembers(r.items)).catch(() => setMembers([]));
  }, [on, clubId, prospectId, canManage]);

  if (!on) return null;

  const add = async () => {
    if (!prospectId) return;
    setBusy(true);
    setMessage(null);
    try {
      await createProspectTask(clubId, {
        prospectId, title: form.title, notes: form.notes || undefined, assigneeMemberId: form.assignee,
        dueDate: form.due, remindDaysBefore: form.remind === "" ? null : Number(form.remind),
      });
      setForm({ title: "", assignee: 0, due: "", remind: "1", notes: "" });
      setMessage({ ok: true, text: "Task added. The member sees it in the app." });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e, "Could not add the task.") });
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e, fallback) });
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toLocaleDateString("en-CA"); // local yyyy-MM-dd
  const canAdd = form.title.trim() !== "" && form.assignee > 0 && form.due !== "";

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <ClipboardList className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Follow-up tasks</h3>
        <select aria-label="Task status" value={status} onChange={(e) => setStatus(e.target.value as "" | "open" | "done")}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
          <option value="">All tasks</option>
          <option value="open">Open</option>
          <option value="done">Done</option>
        </select>
      </div>

      {message && (
        <p role="status" className={`px-4 pt-3 text-xs ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>{message.text}</p>
      )}

      {loadError ? (
        <div className="px-4 py-6 text-sm text-rose-700">
          {loadError}{" "}
          <button type="button" onClick={load} className="font-medium underline">Try again</button>
        </div>
      ) : tasks === null ? (
        <div className="space-y-3 p-4" aria-label="Loading tasks">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      ) : tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          {status === "open" ? "No open follow-up tasks." : status === "done" ? "No finished tasks yet." : "No follow-up tasks yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
              <tr>
                <th className="px-3 py-2 text-left">Task</th>
                {!prospectId && <th className="px-3 py-2 text-left">Prospect</th>}
                <th className="px-3 py-2 text-left">Assigned to</th>
                <th className="px-3 py-2 text-left">Due</th>
                <th className="px-3 py-2 text-left">Status</th>
                {canManage && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => {
                const overdue = t.status === "open" && t.dueDate < today;
                return (
                  <tr key={t.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{t.title}</div>
                      {t.notes && <div className="text-xs text-slate-500">{t.notes}</div>}
                      {t.completionNote && <div className="text-xs text-emerald-700">Outcome: {t.completionNote}</div>}
                    </td>
                    {!prospectId && (
                      <td className="px-3 py-2">
                        <Link href={`/clubs/${clubId}/rotary-network/potential-members/v2/${t.prospectId}/edit`}
                          className="text-[#17458F] underline-offset-2 hover:underline">{t.prospectName}</Link>
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-600">{t.assigneeName || "-"}</td>
                    <td className={`whitespace-nowrap px-3 py-2 ${overdue ? "font-medium text-rose-700" : "text-slate-600"}`}>
                      {fmtDay(t.dueDate)}{overdue ? " (overdue)" : ""}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{t.status === "done" ? "Done" : "Open"}</td>
                    {canManage && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button type="button" disabled={busy}
                          onClick={() => act(() => updateProspectTask(clubId, t.id, toSave(t, t.status === "done" ? "open" : "done")), "Could not save the task.")}
                          className="mr-1 inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          {t.status === "done" ? <><RotateCcw size={13} /> Reopen</> : <><CheckCircle2 size={13} /> Mark done</>}
                        </button>
                        <button type="button" disabled={busy} aria-label={`Delete task ${t.title}`}
                          onClick={() => act(() => deleteProspectTask(clubId, t.id), "Could not delete the task.")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {prospectId && canManage && (
        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
            <span className="block">New task</span>
            <input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="For example: invite to the next meeting" className={`${FIELD} font-normal`} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">
            <span className="block">Assign to</span>
            {members === null ? <Skeleton className="h-9 w-full" /> : (
              <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: Number(e.target.value) })} className={`${FIELD} font-normal`}>
                <option value={0}>Choose a member</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.memberName}</option>)}
              </select>
            )}
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">
            <span className="block">Due date</span>
            <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className={`${FIELD} font-normal`} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">
            <span className="block">Reminder</span>
            <select value={form.remind} onChange={(e) => setForm({ ...form, remind: e.target.value })} className={`${FIELD} font-normal`}>
              {REMIND.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700">
            <span className="block">Notes <span className="font-normal text-slate-400">(optional)</span></span>
            <input value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${FIELD} font-normal`} />
          </label>
          <div className="sm:col-span-2">
            <button type="button" disabled={!canAdd || busy} onClick={add}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#17458F] px-4 text-xs font-semibold text-white disabled:opacity-50">
              <Plus size={13} /> Add task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
