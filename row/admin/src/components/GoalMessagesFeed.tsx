"use client";

// RI Director / SuperAdmin read-only messages for the Goal Overview "Messages" popup.
// A ROSTER of every Zone Co-ordinator + District Assistant in the zone (filtered by category +
// district) on the left - each with their message count, unread badge or "No message yet" - and the
// selected person's messages on the right (user 2026-10-09: two-pane read screen, the same message
// look as the District Admin inbox). Read-only. Filters + Download live in the parent popup.

import { useEffect, useState } from "react";
import { Loader2, MessagesSquare, Search, ChevronLeft } from "lucide-react";
import { getGoalMessageRoster, getGoalOwnerThreadMessages } from "@/services/api";
import type { GoalMessageOwnerDto, GoalCommentDto } from "@/types/goalSetting";
import GoalMessageList, { Chip, RoleChip } from "@/components/goal-messages/GoalMessageList";

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
  // "Unread only" (user 2026-09-29): a pure view filter - it never marks anything read.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");

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

  function openOwner(o: GoalMessageOwnerDto) {
    // Opening the thread stamps it read on the server - clear its badge here too.
    setRoster((prev) => prev && prev.map((x) =>
      x.memberId === o.memberId && x.categoryId === o.categoryId ? { ...x, unreadCount: 0 } : x));
    setActive(o); setMessages(null); setLoadingMsgs(true);
    // zoneId: so a former seat-holder's conversation opens (and is marked read) for this zone.
    getGoalOwnerThreadMessages(o.categoryId, yearId, o.memberId, zoneId)
      .then((m) => setMessages(districtId ? m.filter((x) => (x.districtId ?? 0) === districtId) : m))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-slate-400 py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  // One row per person even when the DB holds more than one active seat for them (duplicate keys
  // would leave stale rows behind - user 2026-09-29).
  const people = (roster ?? []).filter(
    (o, i, all) => all.findIndex((x) => x.memberId === o.memberId && x.categoryId === o.categoryId) === i);
  const unreadTotal = people.filter((o) => (o.unreadCount ?? 0) > 0).length;
  const term = q.trim().toLowerCase();
  const shown = people
    .filter((o) => !unreadOnly || (o.unreadCount ?? 0) > 0)
    .filter((o) => !term || `${o.name} ${o.roleLabel} ${o.categoryName} ${o.districts ?? ""}`.toLowerCase().includes(term));

  if (people.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400">
        <MessagesSquare size={26} className="mb-2 text-slate-300" />
        <p className="text-sm">No messages yet.</p>
      </div>
    );
  }

  const list = (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-2.5 border-b border-slate-100 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, district…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">{people.length} conversation{people.length === 1 ? "" : "s"}</span>
          <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-3.5 w-3.5 accent-red-500" />
            Unread only{unreadTotal > 0 && <span className="text-red-600 font-semibold">({unreadTotal})</span>}
          </label>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
        {shown.length === 0 && <p className="px-3 py-4 text-xs text-slate-400">Nothing matches.</p>}
        {shown.map((o, i) => {
          const isActive = active?.memberId === o.memberId && active?.categoryId === o.categoryId;
          const unread = o.unreadCount ?? 0;
          return (
            <button key={`${o.memberId}-${o.categoryId}-${i}`} onClick={() => openOwner(o)}
              className={`w-full text-left px-3 py-2.5 ${isActive ? "bg-blue-50" : "hover:bg-slate-50"}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`text-sm truncate ${unread > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{o.name}</span>
                {unread > 0 && <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">{unread} new</span>}
              </div>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <RoleChip role={o.isFormer ? o.roleLabel : o.roleLabel} />
                <Chip tone="blue">{o.categoryName}</Chip>
                {o.districts && <Chip tone="green">{o.districts}</Chip>}
              </div>
              <p className={`text-[11px] mt-1 ${unread > 0 ? "text-slate-700 font-medium" : "text-slate-400"}`}>
                {o.messageCount > 0 ? `${o.messageCount} message${o.messageCount === 1 ? "" : "s"}` : "No message yet"}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );

  const pane = active ? (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white flex items-center gap-2 flex-wrap">
        <button onClick={() => { setActive(null); setMessages(null); }} className="md:hidden inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><ChevronLeft size={14} /> Back</button>
        <span className="text-sm font-semibold text-slate-800">{active.name}</span>
        <RoleChip role={active.roleLabel} />
        <Chip tone="blue">{active.categoryName}</Chip>
        {active.districts && <Chip tone="green">{active.districts}</Chip>}
        <span className="ml-auto text-[10px] text-slate-400">Read only</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-slate-50/40">
        {loadingMsgs ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-8"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : <GoalMessageList messages={messages ?? []} emptyText="No message yet." />}
      </div>
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm p-6 text-center">
      <MessagesSquare size={26} className="mb-2 text-slate-300" />
      Select a person on the left to read their messages.
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden h-[60vh] min-h-[360px] grid md:grid-cols-[300px_1fr]">
      <div className={`${active ? "hidden md:flex" : "flex"} flex-col min-h-0 border-r border-slate-100`}>{list}</div>
      <div className={`${active ? "flex" : "hidden md:flex"} flex-col min-h-0`}>{pane}</div>
    </div>
  );
}
