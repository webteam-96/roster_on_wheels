"use client";

// Zone-based messaging for the goal oversight roles, scoped to one (category, zone, year).
// - RI Director / SuperAdmin: sees a message BOX per Zone Co-ordinator and per District Assistant of
//   the zone (name + designation + coverage). Click one to open its private chat and reply/start.
// - A Zone Co-ordinator / District Assistant: sees their single box (chat with their RI Director).
// Every (zone × category) conversation is separate. Chat UI matches the old admin message box.

import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Loader2, ChevronLeft, User } from "@/components/icons";
import { getGoalZoneThreadList, getGoalOwnerThreadMessages, postGoalOwnerThreadMessage, setGoalViewAs } from "@/services/api";
import type { GoalCommentDto, GoalThreadListDto, GoalMessageThreadDto } from "@/types/goalSetting";
import GoalMessageList from "@/components/goal-messages/GoalMessageList";

export default function GoalZoneMessages({
  categoryId, zoneId, yearId, actingAs, districtId = null, allowObserverPost = true, allOwners = false,
}: {
  categoryId: number | null;
  zoneId: number | null;
  yearId: number | null;
  actingAs?: string | null;
  // null → no district picked (show the Zone Co-ordinator only); a district id → that district's DA(s).
  districtId?: number | null;
  // The gated observer may POST as a ZC/DA only where this is true (settings roles page). On the
  // goal-oversight dashboard it's false → the observer view is strictly read-only (check messages only).
  allowObserverPost?: boolean;
  // true → list EVERY owner of the zone (ZC + all DAs) regardless of district — used by the RI messages popup.
  allOwners?: boolean;
}) {
  const [list, setList] = useState<GoalThreadListDto | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [active, setActive] = useState<GoalMessageThreadDto | null>(null);
  const [messages, setMessages] = useState<GoalCommentDto[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState("");
  const [postDistrict, setPostDistrict] = useState(0); // District Assistant: which district this message is about (0 = All)
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Observer-only: when the gated SuperAdmin clicks a ZC/DA box, we act AS that owner (post-as).
  // This ref remembers we set the global "view as" so we clear ONLY our own override (never one set
  // by another page, e.g. goal-oversight's dropdown).
  const postingAsRef = useRef(false);
  const clearPostAs = useCallback(() => { if (postingAsRef.current) { setGoalViewAs(null); postingAsRef.current = false; } }, []);

  // Clear our post-as override whenever we leave the component.
  useEffect(() => () => clearPostAs(), [clearPostAs]);

  useEffect(() => {
    if (categoryId == null || zoneId == null || yearId == null) { setList(null); setActive(null); return; }
    let cancelled = false;
    clearPostAs(); // always fetch the list as myself (SuperAdmin), not as a previously-opened owner
    setLoadingList(true); setError(null); setActive(null); setMessages(null);
    // allOwners → send nothing (every ZC + DA); else 0 = zone level (ZC only), a district id = that district's DA(s).
    getGoalZoneThreadList(categoryId, zoneId, yearId, actingAs, allOwners ? undefined : (districtId ?? 0))
      .then((data) => {
        if (cancelled) return;
        setList(data);
        // A DA/ZC has exactly one (own) box — open it straight away.
        if ((data.viewerRole === "DistrictAssistant" || data.viewerRole === "ZoneCoordinator") && data.threads.length === 1) {
          setActive(data.threads[0]);
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [categoryId, zoneId, yearId, actingAs, districtId, allOwners, clearPostAs]);

  const loadMessages = useCallback((ownerId: number) => {
    if (categoryId == null || yearId == null) return;
    setLoadingMsgs(true); setError(null);
    getGoalOwnerThreadMessages(categoryId, yearId, ownerId, zoneId)
      .then(setMessages)
      .catch((e) => setError(e?.response?.data?.message || "Failed to load this conversation."))
      .finally(() => setLoadingMsgs(false));
  }, [categoryId, yearId, zoneId]);

  useEffect(() => { if (active) loadMessages(active.ownerMemberId); else setMessages(null); }, [active, loadMessages]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  async function handlePost() {
    if (!text.trim() || !active || categoryId == null || yearId == null) return;
    setPosting(true); setError(null);
    try {
      // District Assistant tags the message to a district (0 = All). Others post zone-wide (0).
      const dId = list?.viewerRole === "DistrictAssistant" ? postDistrict : 0;
      const c = await postGoalOwnerThreadMessage(categoryId, yearId, active.ownerMemberId, text.trim(), dId);
      setMessages((prev) => [...(prev ?? []), c]);
      setText("");
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ block: "nearest" }); });
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to send message.");
    } finally { setPosting(false); }
  }

  const canObservePost = !!list?.canObservePost && allowObserverPost;

  // Observer clicks a ZC/DA box → act AS that owner so the composer works and the post is saved as them.
  function openOwner(t: GoalMessageThreadDto) {
    if (canObservePost) { setGoalViewAs(t.ownerMemberId); postingAsRef.current = true; }
    // Opening the box is what marks it read on the server, so drop its badge here too — otherwise
    // the count would still be sitting there when the reader comes back to the list.
    setList((prev) => prev && ({
      ...prev,
      threads: prev.threads.map((x) =>
        x.ownerMemberId === t.ownerMemberId && x.ownerRoleLabel === t.ownerRoleLabel
          ? { ...x, unreadCount: 0 } : x),
    }));
    setActive(t);
  }
  // "Unread only" filter (user 2026-09-29): a zone can hold a long list of conversations, and
  // after a busy week the reader only wants the ones with something new. Purely a view filter -
  // it hides rows, it never marks anything read.
  const [unreadOnly, setUnreadOnly] = useState(false);
  function backToList() { clearPostAs(); setActive(null); setMessages(null); }

  if (categoryId == null || zoneId == null || yearId == null) return null;
  if (loadingList) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> Loading messages…</div>;
  }
  const isRiView = list?.viewerRole === "RIDirector" || list?.viewerRole === "SuperAdmin";
  // RI Director / SuperAdmin listing: only people who have messaged. The observer who may post keeps
  // every box (the API already returns them) so they can start a conversation.
  const allThreads = (list?.threads ?? []).filter((t) => !isRiView || canObservePost || t.messageCount > 0);
  const unreadTotal = allThreads.filter((t) => t.unreadCount > 0).length;
  const visibleThreads = unreadOnly ? allThreads.filter((t) => t.unreadCount > 0) : allThreads;

  if (!list || list.viewerRole === "None" || allThreads.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 text-xs text-slate-400">
        <MessagesSquare size={15} className="inline mr-1.5 text-blue-600" />
        {list && isRiView ? "No messages yet." : "No Zone Co-ordinator or District Assistant assigned for this zone & category yet."}
      </div>
    );
  }

  // Box list (RI Director / SuperAdmin) — one per ZC / DA of the zone.
  if (isRiView && !active) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-blue-50">
          <MessagesSquare size={16} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Messages</h3>
          {canObservePost && <span className="ml-auto text-[11px] text-amber-700">Click a person to send a message as them</span>}
          <label className={`${canObservePost ? "" : "ml-auto"} inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none`}>
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
          {unreadOnly && visibleThreads.length === 0 && (
            <div className="px-5 py-4 text-xs text-slate-400">No unread messages.</div>
          )}
          {visibleThreads.map((t, i) => (
            <button key={`${t.ownerMemberId}-${t.ownerRoleLabel}-${i}`} onClick={() => openOwner(t)} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50/70">
              <span className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><User size={16} className="text-slate-500" /></span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  {/* Unread is per conversation, so the name itself carries the signal — the reader
                      can see WHO wrote without opening every box (user 2026-09-25). */}
                  <span className={`text-sm truncate ${t.unreadCount > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{t.ownerName}</span>
                  {t.unreadCount > 0 && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white shrink-0"
                      title={`${t.unreadCount} new message${t.unreadCount === 1 ? "" : "s"}`}
                    >
                      {t.unreadCount} new
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border ${t.isFormer ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>{t.ownerRoleLabel}</span>
                  {t.scope && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 shrink-0">{t.scope}</span>}
                </span>
                <span className={`block text-xs truncate ${t.unreadCount > 0 ? "text-slate-700 font-medium" : "text-slate-400"}`}>{t.lastMessagePreview ? t.lastMessagePreview : "No messages yet: start the conversation"}</span>
              </span>
              {t.messageCount > 0 && <span className={`text-[10px] shrink-0 ${t.unreadCount > 0 ? "text-slate-600 font-medium" : "text-slate-400"}`}>{t.lastMessageDate}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const header = isRiView
    ? `${active?.ownerName} · ${active?.ownerRoleLabel}${active?.scope ? " · " + active.scope : ""}`
    : `Messages with ${active?.counterpartyName || "RI Director"}`;
  // Normally the owner posts; the gated observer may also post AS the owner box they opened.
  const canPost = (active?.canPost ?? false) || (canObservePost && !!active);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-blue-50">
        {isRiView && (
          <button
            onClick={backToList}
            title="Back to conversations"
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 text-white px-2.5 py-1.5 text-xs font-semibold hover:bg-blue-700 shrink-0"
          >
            <ChevronLeft size={14} /> Back
          </button>
        )}
        <MessagesSquare size={16} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800 truncate">{header}</h3>
      </div>

      <div ref={scrollRef} className="p-4 space-y-3 flex-1 min-h-[8rem] overflow-y-auto bg-slate-50/40">
        {loadingMsgs && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> Loading…</div>}
        {!loadingMsgs && messages && (
          <GoalMessageList messages={messages} emptyText="No messages yet. Start the conversation below." />
        )}
      </div>

      {active?.notice && <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">{active.notice}</p>}

      {canPost && (
        <div className="p-3 border-t border-slate-100 flex gap-2 shrink-0 flex-wrap">
          {list?.viewerRole === "DistrictAssistant" && (list?.ownerDistricts?.length ?? 0) > 0 && (
            <select
              value={postDistrict}
              onChange={(e) => setPostDistrict(Number(e.target.value))}
              disabled={posting}
              title="Which district is this message about?"
              className="px-2.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
            >
              <option value={0}>All districts</option>
              {list!.ownerDistricts!.map((d) => <option key={d.id} value={d.id}>{d.number}</option>)}
            </select>
          )}
          <input ref={inputRef} type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handlePost(); }} placeholder={canObservePost && active ? `Type a message as ${active.ownerName}…` : "Type a message…"} disabled={posting}
            className="flex-1 min-w-[140px] px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
          <button onClick={handlePost} disabled={posting || !text.trim()} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
          </button>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
