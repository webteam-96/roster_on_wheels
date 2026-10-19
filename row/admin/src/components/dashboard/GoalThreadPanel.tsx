"use client";

// Pairwise oversight messaging for one (category, district, year).
//
// - District Assistant / Zone Co-ordinator: sees ONE private thread with the RI Director over their
//   zone. Their messages go only to that RI Director (never to each other or a ZC below/above).
// - RI Director (or SuperAdmin): sees a LIST of the DA/ZC threads under this district+category and
//   can open any one to read + reply, or start a new message to that person.
// Everything is server-enforced; this just renders what the thread API returns.

import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Loader2, ChevronLeft, User } from "@/components/icons";
import { getGoalThreadList, getGoalThreadMessages, postGoalThreadMessage } from "@/services/api";
import type { GoalCommentDto, GoalThreadListDto, GoalMessageThreadDto } from "@/types/goalSetting";

export default function GoalThreadPanel({
  categoryId, districtId, yearId,
}: {
  categoryId: number | null;
  districtId: number | null;
  yearId: number | null;
}) {
  const [list, setList] = useState<GoalThreadListDto | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [activeOwner, setActiveOwner] = useState<GoalMessageThreadDto | null>(null);
  const [messages, setMessages] = useState<GoalCommentDto[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load the thread list whenever the (category, district, year) context changes.
  useEffect(() => {
    if (categoryId == null || districtId == null || yearId == null) { setList(null); setActiveOwner(null); return; }
    let cancelled = false;
    setLoadingList(true); setError(null); setActiveOwner(null); setMessages(null);
    getGoalThreadList(categoryId, districtId, yearId)
      .then((data) => {
        if (cancelled) return;
        setList(data);
        // A DA/ZC has exactly one (their own) thread — open it straight away.
        if ((data.viewerRole === "DistrictAssistant" || data.viewerRole === "ZoneCoordinator") && data.threads.length === 1) {
          setActiveOwner(data.threads[0]);
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [categoryId, districtId, yearId]);

  const loadMessages = useCallback((ownerId: number) => {
    if (categoryId == null || districtId == null || yearId == null) return;
    setLoadingMsgs(true); setError(null);
    getGoalThreadMessages(categoryId, districtId, yearId, ownerId)
      .then(setMessages)
      .catch((e) => setError(e?.response?.data?.message || "Failed to load this conversation."))
      .finally(() => setLoadingMsgs(false));
  }, [categoryId, districtId, yearId]);

  useEffect(() => { if (activeOwner) loadMessages(activeOwner.ownerMemberId); else setMessages(null); }, [activeOwner, loadMessages]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  async function handlePost() {
    if (!text.trim() || !activeOwner || categoryId == null || districtId == null || yearId == null) return;
    setPosting(true); setError(null);
    try {
      const c = await postGoalThreadMessage(categoryId, districtId, yearId, activeOwner.ownerMemberId, text.trim());
      setMessages((prev) => [...(prev ?? []), c]);
      setText("");
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ block: "nearest" }); });
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to send message.");
    } finally { setPosting(false); }
  }

  if (categoryId == null || districtId == null || yearId == null) return null;
  if (loadingList) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 size={13} className="animate-spin" /> Loading messages…
      </div>
    );
  }
  // No messaging role here (e.g. a district outside this person's scope, or admins) → render nothing.
  if (!list || list.viewerRole === "None" || list.threads.length === 0) {
    if (list && list.viewerRole !== "None" && list.threads.length === 0) {
      return (
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 text-xs text-slate-400">
          <MessagesSquare size={15} className="inline mr-1.5 text-blue-600" />
          No District Assistants or Zone Co-ordinators are assigned here yet. No message threads.
        </div>
      );
    }
    return null;
  }

  const isRiView = list.viewerRole === "RIDirector" || list.viewerRole === "SuperAdmin";

  // RI Director / SuperAdmin, no thread selected → show the list of DA/ZC threads to pick from.
  if (isRiView && !activeOwner) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-blue-50">
          <MessagesSquare size={16} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Messages</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            {list.threads.length} conversation{list.threads.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {list.threads.map((t) => (
            <button
              key={t.ownerMemberId}
              onClick={() => setActiveOwner(t)}
              className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50/70"
            >
              <span className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <User size={15} className="text-slate-500" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{t.ownerName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                    {t.ownerRoleLabel}
                  </span>
                </span>
                <span className="block text-xs text-slate-400 truncate">
                  {t.lastMessagePreview ? t.lastMessagePreview : "No messages yet: start the conversation"}
                </span>
              </span>
              {t.messageCount > 0 && (
                <span className="text-[10px] text-slate-400 shrink-0">{t.lastMessageDate}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Chat view (DA/ZC own thread, or the RI Director's selected DA/ZC thread).
  const header = isRiView
    ? `${activeOwner?.ownerName} · ${activeOwner?.ownerRoleLabel}`
    : `Messages with ${activeOwner?.counterpartyName || "RI Director"}`;
  const canPost = activeOwner?.canPost ?? false;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-blue-50">
        {isRiView && (
          <button onClick={() => setActiveOwner(null)} className="text-slate-500 hover:text-slate-700" title="Back to conversations">
            <ChevronLeft size={16} />
          </button>
        )}
        <MessagesSquare size={16} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800">{header}</h3>
      </div>

      <div ref={scrollRef} className="p-4 space-y-3 flex-1 min-h-[8rem] overflow-y-auto bg-slate-50/40">
        {loadingMsgs && (
          <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        )}
        {!loadingMsgs && messages && messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-6">No messages yet. Start the conversation below.</p>
        )}
        {!loadingMsgs && messages && messages.map((c) => {
          const mine = !!c.isMine;
          return (
            <div key={c.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div className={`flex items-center gap-1.5 mb-0.5 px-1 ${mine ? "flex-row-reverse" : ""}`}>
                <span className="text-xs font-semibold text-slate-700">{mine ? "You" : c.postedByName}</span>
                {c.postedByRoleLabel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                    {c.postedByRoleLabel}
                  </span>
                )}
              </div>
              <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                mine ? "bg-blue-600 text-white rounded-br-sm" : "bg-white text-slate-700 border border-slate-200 rounded-bl-sm"
              }`}>
                {c.commentText}
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 px-1">{c.createdDate}</span>
            </div>
          );
        })}
      </div>

      {activeOwner?.notice && (
        <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">{activeOwner.notice}</p>
      )}

      {canPost && (
        <div className="p-3 border-t border-slate-100 flex gap-2 shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handlePost(); }}
            placeholder="Type a message…"
            disabled={posting}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
          />
          <button
            onClick={handlePost}
            disabled={posting || !text.trim()}
            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
          </button>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
