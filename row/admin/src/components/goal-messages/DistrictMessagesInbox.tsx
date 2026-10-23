"use client";

// Read-only inbox of District Admin / District Governor messages (user 2026-10-09) for the
// SuperAdmin. The API returns only what the viewer may read. Two panes: conversations (district + category) on the left, the messages on the
// right. Opening a conversation marks it read.

import { useEffect, useState } from "react";
import { Loader2, Inbox, Search, ChevronLeft } from "@/components/icons";
import { getDistrictGoalMessageInbox, getDistrictGoalMessages } from "@/services/api";
import type { GoalDistrictConversationDto, GoalDistrictMessagesDto } from "@/types/goalSetting";
import GoalMessageList, { Chip, RoleChip } from "./GoalMessageList";

export default function DistrictMessagesInbox({
  zoneId, yearId, categoryId = 0, districtId = 0,
}: {
  zoneId: number;
  yearId: number;
  categoryId?: number;   // 0 = all
  districtId?: number;   // 0 = all
}) {
  const [rows, setRows] = useState<GoalDistrictConversationDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<GoalDistrictConversationDto | null>(null);
  const [thread, setThread] = useState<GoalDistrictMessagesDto | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    setActive(null); setThread(null);
    if (!zoneId || !yearId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    getDistrictGoalMessageInbox(zoneId, yearId, categoryId, districtId)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [zoneId, yearId, categoryId, districtId]);

  function open(c: GoalDistrictConversationDto) {
    setActive(c); setThread(null); setLoadingThread(true);
    setRows((prev) => prev && prev.map((x) => x.districtId === c.districtId && x.categoryId === c.categoryId ? { ...x, unreadCount: 0 } : x));
    getDistrictGoalMessages(c.categoryId, c.districtId, yearId)
      .then(setThread)
      .catch(() => setThread(null))
      .finally(() => setLoadingThread(false));
  }

  if (loading) return <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-10"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  const all = rows ?? [];
  const term = q.trim().toLowerCase();
  const shown = all
    .filter((r) => !unreadOnly || r.unreadCount > 0)
    .filter((r) => !term || `${r.districtNumber} ${r.categoryName} ${r.lastFrom} ${r.lastPreview}`.toLowerCase().includes(term));
  const unreadTotal = all.filter((r) => r.unreadCount > 0).length;

  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400">
        <Inbox size={28} className="mb-2 text-slate-300" />
        <p className="text-sm">No messages from District Admins or District Governors yet.</p>
      </div>
    );
  }

  const list = (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-2.5 border-b border-slate-100 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search district, name, text…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-3.5 w-3.5 accent-red-500" />
          Unread only{unreadTotal > 0 && <span className="text-red-600 font-semibold">({unreadTotal})</span>}
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
        {shown.length === 0 && <p className="px-3 py-4 text-xs text-slate-400">Nothing matches.</p>}
        {shown.map((c) => {
          const isActive = active?.districtId === c.districtId && active?.categoryId === c.categoryId;
          return (
            <button key={`${c.districtId}-${c.categoryId}`} onClick={() => open(c)}
              className={`w-full text-left px-3 py-2.5 ${isActive ? "bg-blue-50" : "hover:bg-slate-50"}`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm ${c.unreadCount > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>District {c.districtNumber}</span>
                <Chip tone="blue">{c.categoryName}</Chip>
                {c.unreadCount > 0 && <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">{c.unreadCount} new</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <span className="text-[11px] text-slate-600 truncate">{c.lastFrom}</span>
                <RoleChip role={c.lastFromRole} />
              </div>
              <p className={`text-xs truncate mt-0.5 ${c.unreadCount > 0 ? "text-slate-700" : "text-slate-400"}`}>{c.lastPreview}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{c.lastDate} · {c.messageCount} message{c.messageCount === 1 ? "" : "s"}</p>
            </button>
          );
        })}
      </div>
    </div>
  );

  const pane = active ? (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-blue-50 flex items-center gap-2 flex-wrap">
        <button onClick={() => { setActive(null); setThread(null); }} className="md:hidden inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><ChevronLeft size={14} /> Back</button>
        <span className="text-sm font-semibold text-slate-800">District {active.districtNumber}</span>
        <Chip tone="blue">{active.categoryName}</Chip>
        <span className="ml-auto text-[10px] text-slate-400">Read only</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-slate-50/40">
        {loadingThread ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-8"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : <GoalMessageList messages={thread?.messages ?? []} />}
      </div>
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm p-6 text-center">
      <Inbox size={26} className="mb-2 text-slate-300" />
      Select a conversation on the left to read it.
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden h-[60vh] min-h-[360px] grid md:grid-cols-[300px_1fr]">
      <div className={`${active ? "hidden md:flex" : "flex"} flex-col min-h-0 border-r border-slate-100`}>{list}</div>
      <div className={`${active ? "flex" : "hidden md:flex"} flex-col min-h-0`}>{pane}</div>
    </div>
  );
}
