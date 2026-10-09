"use client";

// Two-way MESSAGE thread for one (district, category, year) — and, when clubId>0, a
// Club↔District thread. Access + membership are enforced server-side; everyone in a
// thread sees the whole conversation, so this just renders what the API returns.
// Rendered as a chat: my own messages align right (blue), everyone else left (grey),
// each bubble carrying the sender's name + leadership role label + timestamp.

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Loader2 } from "lucide-react";
import { getGoalComments, postGoalComment } from "@/services/api";
import type { GoalCommentDto } from "@/types/goalSetting";

const TIER_LABELS: Record<number, string> = {
  1: "District Admin",
  2: "Assistant Co-ordinator",
  3: "Regional Co-ordinator",
  4: "Zonal Action Plan",
  5: "Super Admin",
};

export default function GoalCommentPanel({
  categoryId, districtId, yearId, clubId = 0, title = "Messages",
}: {
  categoryId: number | null;
  districtId: number | null;
  yearId: number | null;
  clubId?: number;
  title?: string;
}) {
  const [messages, setMessages] = useState<GoalCommentDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (categoryId == null || districtId == null || yearId == null) { setMessages(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    getGoalComments(categoryId, districtId, yearId, clubId)
      .then((rows) => { if (!cancelled) setMessages(rows); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryId, districtId, yearId, clubId]);

  // Keep the newest message in view whenever the thread grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function handlePost() {
    if (!text.trim() || categoryId == null || districtId == null || yearId == null) return;
    setPosting(true); setError(null);
    try {
      const c = await postGoalComment(categoryId, districtId, yearId, text.trim(), clubId);
      setMessages((prev) => [...(prev ?? []), c]);
      setText("");
      // Keep the composer in view + focused so the Send button never scrolls off-screen as the
      // thread grows — the input scrolls back into view instead of being pushed below the fold.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ block: "nearest" });
      });
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to send message.");
    } finally {
      setPosting(false);
    }
  }

  if (categoryId == null || districtId == null || yearId == null) return null;

  const roleLabelOf = (c: GoalCommentDto) =>
    c.postedByRoleLabel || TIER_LABELS[c.postedByTier] || `Tier ${c.postedByTier}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-white">
        <MessagesSquare size={16} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {clubId > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Club ↔ District
          </span>
        )}
      </div>

      <div ref={scrollRef} className="p-4 space-y-3 flex-1 min-h-[8rem] overflow-y-auto bg-slate-50/40">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 size={13} className="animate-spin" /> Loading messages…
          </div>
        )}
        {!loading && messages && messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-6">No messages yet. Start the conversation below.</p>
        )}
        {!loading && messages && messages.map((c) => {
          const mine = !!c.isMine;
          return (
            <div key={c.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div className={`flex items-center gap-1.5 mb-0.5 px-1 ${mine ? "flex-row-reverse" : ""}`}>
                <span className="text-xs font-semibold text-slate-700">{mine ? "You" : c.postedByName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  {roleLabelOf(c)}
                </span>
              </div>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                  mine
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-white text-slate-700 border border-slate-200 rounded-bl-sm"
                }`}
              >
                {c.commentText}
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 px-1">{c.createdDate}</span>
            </div>
          );
        })}
      </div>

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
      {error && <p className="px-4 pb-3 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
