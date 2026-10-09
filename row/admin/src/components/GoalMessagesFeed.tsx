"use client";

// RI Director / SuperAdmin read-only messages for the Goal Overview "Messages" popup.
// Shows a clickable ROSTER of every Zone Co-ordinator + District Assistant in the zone (filtered by
// category + district). Each row shows their message count or "No message yet". Clicking a person opens
// their message thread (each message with district + date & time). Read-only. Filters + Download live in
// the parent popup.

import { useEffect, useState } from "react";
import { Loader2, MessagesSquare, User, ChevronLeft } from "lucide-react";
import { getGoalMessageRoster, getGoalOwnerThreadMessages } from "@/services/api";
import type { GoalMessageOwnerDto, GoalCommentDto } from "@/types/goalSetting";

export default function GoalMessagesFeed({
  zoneId, yearId, categoryId, districtId,
}: {
  zoneId: number;
  yearId: number;
  categoryId: number; // 0 = all
  districtId: number; // 0 = all
}) {
  const [roster, setRoster] = useState<GoalMessageOwnerDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<GoalMessageOwnerDto | null>(null);
  const [messages, setMessages] = useState<GoalCommentDto[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  // "Unread only" (user 2026-09-29): a zone can hold a long list, and the reader usually wants just
  // the people who have written something new. A pure view filter - it never marks anything read.
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Load the roster whenever the zone/filters change. Reset any open thread.
  useEffect(() => {
    setActive(null); setMessages(null); setUnreadOnly(false);
    if (!zoneId || !yearId) { setRoster([]); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    getGoalMessageRoster(zoneId, yearId, categoryId, districtId)
      .then((r) => { if (!cancelled) setRoster(r); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [zoneId, yearId, categoryId, districtId]);

  // Open one owner's thread.
  function openOwner(o: GoalMessageOwnerDto) {
    // Opening the thread is what stamps it read on the server, so clear its badge here as well -
    // otherwise the count would still be sitting there when the reader comes back to the list.
    setRoster((prev) => prev && prev.map((x) =>
      x.memberId === o.memberId && x.categoryId === o.categoryId ? { ...x, unreadCount: 0 } : x));
    setActive(o); setMessages(null); setLoadingMsgs(true);
    getGoalOwnerThreadMessages(o.categoryId, yearId, o.memberId)
      .then((m) => setMessages(districtId ? m.filter((x) => (x.districtId ?? 0) === districtId) : m))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-slate-400 py-6 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  // ── One owner's message thread ──
  if (active) {
    return (
      <div className="space-y-3">
        <button onClick={() => { setActive(null); setMessages(null); }} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
          <ChevronLeft size={14} /> Back to list
        </button>
        <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-blue-50 to-white px-4 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800">{active.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{active.roleLabel}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">{active.categoryName}</span>
            {active.districts && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{active.districts}</span>}
          </div>
        </div>
        {loadingMsgs ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-6 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : !messages || messages.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No message yet.</p>
        ) : (
          <div className="space-y-2.5">
            {messages.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-slate-800">{c.postedByName}</span>
                  {c.postedByRoleLabel && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">{c.postedByRoleLabel}</span>}
                  {c.districtId ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{c.districtNumber}</span>
                    : c.postedByTier === 2 ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">All districts</span> : null}
                  <span className="ml-auto text-[10px] text-slate-400">{c.createdDate}</span>
                </div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{c.commentText}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Roster (clickable) ──
  // One row per person, even when the DB holds more than one active seat for them. The API groups
  // them now; this is the second guard, because duplicate rows here share a React key and React then
  // leaves the old rows behind in the page every time the thread opens and closes (user 2026-09-29).
  const people = (roster ?? []).filter(
    (o, i, all) => all.findIndex((x) => x.memberId === o.memberId && x.categoryId === o.categoryId) === i);
  const unreadTotal = people.filter((o) => (o.unreadCount ?? 0) > 0).length;
  const shown = unreadOnly ? people.filter((o) => (o.unreadCount ?? 0) > 0) : people;

  if (people.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
        <MessagesSquare size={26} className="mb-2 text-slate-300" />
        <p className="text-sm">No messages yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-white">
        <span className="text-xs font-semibold text-slate-700">{people.length} conversation{people.length === 1 ? "" : "s"}</span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-red-500 cursor-pointer"
          />
          Unread only{unreadTotal > 0 && <span className="text-red-600 font-semibold">({unreadTotal})</span>}
        </label>
      </div>
      <div className="divide-y divide-slate-100">
      {unreadOnly && shown.length === 0 && (
        <div className="px-4 py-4 text-xs text-slate-400">No unread messages.</div>
      )}
      {shown.map((o, i) => (
        <button key={`${o.memberId}-${o.categoryId}-${i}`} onClick={() => openOwner(o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/70">
          <span className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><User size={16} className="text-slate-500" /></span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm truncate ${(o.unreadCount ?? 0) > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{o.name}</span>
              {(o.unreadCount ?? 0) > 0 && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white shrink-0"
                  title={`${o.unreadCount} new message${o.unreadCount === 1 ? "" : "s"}`}
                >
                  {o.unreadCount} new
                </span>
              )}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{o.roleLabel}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">{o.categoryName}</span>
              {o.districts && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{o.districts}</span>}
            </span>
            <span className={`block text-xs mt-0.5 ${(o.unreadCount ?? 0) > 0 ? "text-slate-700 font-medium" : "text-slate-400"}`}>{o.messageCount > 0 ? `${o.messageCount} message${o.messageCount === 1 ? "" : "s"} — click to read` : "No message yet"}</span>
          </span>
        </button>
      ))}
      </div>
    </div>
  );
}
