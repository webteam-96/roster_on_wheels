"use client";

// District Admin / District Governor -> Super Admin (user 2026-10-09). Category-wise: the message
// goes to the Super Admin for the selected category. They read it; there are no replies here.

import { useEffect, useRef, useState } from "react";
import { Loader2, MessagesSquare, Send } from "@/components/icons";
import { getGoalCategories, getDistrictGoalMessages, postDistrictGoalMessage } from "@/services/api";
import type { GoalDistrictMessagesDto } from "@/types/goalSetting";
import GoalMessageList from "./GoalMessageList";

export default function DistrictGoalMessages({
  districtId, yearId, initialCategoryId, lockCategory = false,
}: {
  districtId: number | null;
  yearId: number | null;
  initialCategoryId?: number | null;
  // true -> opened from a category's "Messages" button: that category only, no category buttons.
  lockCategory?: boolean;
}) {
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [catId, setCatId] = useState<number | null>(initialCategoryId ?? null);
  const [data, setData] = useState<GoalDistrictMessagesDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getGoalCategories().then((c) => {
      const list = c.map((x) => ({ id: x.id, name: x.name }));
      setCats(list);
      setCatId((cur) => cur ?? list[0]?.id ?? null);
    }).catch(() => setCats([]));
  }, []);

  useEffect(() => {
    if (!districtId || !yearId || catId == null) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    getDistrictGoalMessages(catId, districtId, yearId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [districtId, yearId, catId]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [data]);
  // Follow the category the parent opened us for.
  useEffect(() => { if (initialCategoryId != null) setCatId(initialCategoryId); }, [initialCategoryId]);

  async function send() {
    if (!text.trim() || !districtId || !yearId || catId == null) return;
    setSending(true); setError(null);
    try {
      const m = await postDistrictGoalMessage(catId, districtId, yearId, text.trim());
      setData((d) => d ? { ...d, messages: [...d.messages, m] } : d);
      setText("");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to send the message.");
    } finally { setSending(false); }
  }

  if (!districtId || !yearId) return null;
  const catName = cats.find((c) => c.id === catId)?.name ?? "";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-blue-50">
        <div className="flex flex-wrap items-center gap-2">
          <MessagesSquare size={16} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">{lockCategory && catName ? `${catName} Messages` : "Messages"}</h3>
          {data?.districtNumber && <span className="text-xs text-slate-500">District {data.districtNumber}</span>}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Goes to the Super Admin for the selected category. They read it; there are no replies here.
        </p>
      </div>

      <div className={`px-5 pt-3 flex flex-wrap gap-2 ${lockCategory ? "hidden" : ""}`}>
        {cats.map((c) => (
          <button key={c.id} onClick={() => setCatId(c.id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${c.id === catId ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {c.name}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="mx-5 my-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 max-h-[420px] min-h-[140px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-8"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <GoalMessageList messages={data?.messages ?? []} emptyText={`No ${catName} messages sent yet.`} plainMine />
        )}
      </div>


      {data?.canPost ? (
        <div className="px-5 pb-4 flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={4000}
            disabled={sending}
            placeholder={`Write your ${catName} message…`}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42] disabled:bg-slate-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400">{text.length}/4000</span>
            <button onClick={send} disabled={sending || !text.trim()}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-[#17458F] text-white hover:bg-[#17458F] disabled:opacity-50">
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
            </button>
          </div>
        </div>
      ) : data && (
        <p className="px-5 pb-4 text-xs text-slate-400">Only this district&apos;s District Admin or District Governor can send messages here.</p>
      )}
      {error && <p className="px-5 pb-4 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
