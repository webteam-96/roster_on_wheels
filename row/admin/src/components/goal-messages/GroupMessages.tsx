"use client";

// Group messages (user 2026-10-19) - the NEW messages screen; UnifiedMessages.tsx stays as it was.
// Same chat look. Left: the groups I belong to (District group per district + category, Team group
// per designation, my "All my districts" box), then my existing one-to-one chats under "Personal
// chats" (unchanged data + API). Right: the open group or chat with the message box at the bottom.
//   DG / District Admin : their district's group per category (shown as the DG to others).
//   RRFC / E/MGA / EPNC / RMC / RPIC : All my districts · each district group · my team (with assistants).
//   ARRFC / AE/MGA / AEPNC / ARMC / ARPIC : My districts · each of their district groups · my team.
//   RI Director / SuperAdmin : every group of the zone.

import { useEffect, useRef, useState } from "react";
import { Loader2, Megaphone, MessagesSquare, Send, Users } from "@/components/icons";
import {
  getGoalCategories, getGoalDirectContacts, getGoalDirectConversation, postGoalDirectMessage,
  getGoalGroups, getGoalGroupConversation, postGoalGroupMessage, type GoalDirectScope,
} from "@/services/api";
import type {
  GoalCommentDto, GoalDirectContactDto, GoalGroupDto, GoalGroupMemberDto, GoalMessageDistrictDto,
} from "@/types/goalSetting";
import GoalMessageList from "./GoalMessageList";
import { byRecent, CHAT_BG, ChatListHeader, ChatPaneHeader, ChatRow, ChatShell, EmptyPane, listTime, shortRole } from "./ChatUi";

type Active = { type: "group"; key: string } | { type: "person"; id: number };

const personSub = (c: GoalDirectContactDto) => {
  if (c.roleKind === "District") return `${c.roleLabel === "No DG" ? "No DG" : "DG"} · District ${c.districts ?? ""}`;
  const role = shortRole(c.roleLabel);
  return c.districts ? `${role} · D ${c.districts}` : role;
};

const memberLine = (m: GoalGroupMemberDto) => `${m.name} (${m.role === "District Governor" ? "DG" : shortRole(m.role)})`;

function GroupRow({ g, active, onClick }: { g: GoalGroupDto; active: boolean; onClick: () => void }) {
  const Icon = g.kind === "Broadcast" ? Megaphone : Users;
  const tone = g.kind === "Broadcast" ? "bg-amber-500" : g.kind === "Team" ? "bg-violet-600" : "bg-teal-700";
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-slate-100 ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}>
      <span className={`h-11 w-11 rounded-full flex items-center justify-center text-white shrink-0 ${tone}`}><Icon size={20} /></span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={`flex-1 truncate text-[15px] text-slate-900 ${g.unreadCount > 0 ? "font-semibold" : ""}`}>{g.name}</span>
          <span className={`text-[11px] shrink-0 ${g.unreadCount > 0 ? "text-emerald-600 font-semibold" : "text-slate-500"}`}>{listTime(g.lastMessageDate)}</span>
        </span>
        {g.sub && <span className="block text-[11px] text-slate-500 truncate mt-0.5" title={g.sub}>{g.sub}</span>}
        <span className="flex items-center gap-2 mt-0.5">
          <span className={`flex-1 truncate text-[13px] ${g.unreadCount > 0 ? "text-slate-800 font-medium" : "text-slate-500"}`}>
            {g.lastMessagePreview || (g.kind === "Broadcast" ? "One message to every district" : "No messages yet")}
          </span>
          {g.unreadCount > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">{g.unreadCount}</span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function GroupMessages({
  mode, zoneId = 0, districtId: contextDistrictId = 0, yearId, initialCategoryId,
}: {
  mode: "ri" | "own" | "district";
  zoneId?: number;
  districtId?: number;
  yearId: number;
  categoryId?: number;
  filterDistrictId?: number;
  categories?: { categoryId: number; name: string }[];
  actingAs?: string | null;
  initialCategoryId?: number | null;
}) {
  const scope: GoalDirectScope = mode === "district" ? { districtId: contextDistrictId } : { zoneId };
  const scopeKey = `${mode}-${zoneId}-${contextDistrictId}`;
  const [groups, setGroups] = useState<GoalGroupDto[] | null>(null);
  const [people, setPeople] = useState<GoalDirectContactDto[]>([]);
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [catFilter, setCatFilter] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [messages, setMessages] = useState<GoalCommentDto[] | null>(null);
  const [members, setMembers] = useState<GoalGroupMemberDto[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [tagDistricts, setTagDistricts] = useState<GoalMessageDistrictDto[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState("");
  const [postCat, setPostCat] = useState<number>(initialCategoryId ?? 0);
  const [postDistrict, setPostDistrict] = useState(0);
  const [posting, setPosting] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);
  useEffect(() => {
    getGoalCategories().then((c) => {
      const list = c.map((x) => ({ id: x.id, name: x.name === "TRF" ? "Foundation" : x.name }));
      setCats(list);
      setPostCat((cur) => cur || initialCategoryId || list[0]?.id || 0);
    }).catch(() => setCats([]));
  }, [initialCategoryId]);

  useEffect(() => {
    let cancelled = false;
    setGroups(null); setPeople([]); setError(null); setActive(null); setMessages(null); setUnreadOnly(false);
    if (!yearId || (mode === "district" ? !contextDistrictId : !zoneId)) { setGroups([]); return; }
    Promise.all([getGoalGroups(yearId, scope), getGoalDirectContacts(yearId, scope).catch(() => [] as GoalDirectContactDto[])])
      .then(([g, p]) => { if (!cancelled) { setGroups(g); setPeople(p); } })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load messages."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, yearId]);

  const activeGroup = active?.type === "group" ? groups?.find((g) => g.key === active.key) ?? null : null;
  const activePerson = active?.type === "person" ? people.find((p) => p.memberId === active.id) ?? null : null;

  function reset() { setMessages(null); setMembers([]); setLoadingMsgs(true); setText(""); setPostDistrict(0); setCanPost(false); setTagDistricts([]); setError(null); }

  function openGroup(g: GoalGroupDto) {
    setGroups((prev) => prev && prev.map((x) => x.key === g.key ? { ...x, unreadCount: 0 } : x));
    setActive({ type: "group", key: g.key }); reset();
    getGoalGroupConversation(g.key, yearId, scope)
      .then((r) => { setCanPost(r.group.canPost); setMembers(r.members); setMessages(r.messages); })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }

  function openPerson(c: GoalDirectContactDto) {
    setPeople((prev) => prev.map((x) => x.memberId === c.memberId ? { ...x, unreadCount: 0 } : x));
    setActive({ type: "person", id: c.memberId }); reset();
    getGoalDirectConversation(c.memberId, yearId, scope)
      .then((r) => { setCanPost(r.canPost); setTagDistricts(r.districts ?? []); setMessages(r.messages); })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }

  async function send() {
    if (!active || !text.trim()) return;
    setPosting(true); setError(null);
    try {
      if (active.type === "group") {
        const m = await postGoalGroupMessage(active.key, yearId, scope, text.trim());
        setMessages((prev) => [...(prev ?? []), m]);
        setGroups((prev) => prev && prev.map((x) => x.key === active.key
          ? { ...x, lastMessagePreview: `You: ${m.commentText}`, lastMessageDate: m.createdDate, messageCount: x.messageCount + 1 } : x));
        // A broadcast lands in every district group - refresh their previews.
        if (activeGroup?.kind === "Broadcast") getGoalGroups(yearId, scope).then(setGroups).catch(() => {});
      } else {
        if (!postCat) { setError("Pick the category this message is about."); return; }
        const m = await postGoalDirectMessage(active.id, yearId, scope, { commentText: text.trim(), categoryId: postCat, districtId: postDistrict });
        setMessages((prev) => [...(prev ?? []), m]);
        setPeople((prev) => prev.map((x) => x.memberId === active.id
          ? { ...x, lastMessagePreview: m.commentText, lastMessageDate: m.createdDate, messageCount: x.messageCount + 1 } : x));
      }
      setText("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to send message.");
    } finally { setPosting(false); }
  }

  if (error && !groups) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!groups) return <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-10"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  if (groups.length === 0 && people.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400">
        <MessagesSquare size={26} className="mb-2 text-slate-300" />
        <p className="text-sm">No groups or chats here yet.</p>
      </div>
    );
  }

  const term = q.trim().toLowerCase();
  // Broadcast boxes stay on top; the rest newest first (groups keep their category order until used).
  const shownGroups = [
    ...groups.filter((g) => g.kind === "Broadcast"),
    ...byRecent(groups.filter((g) => g.kind !== "Broadcast"), (g) => g.lastMessageDate),
  ]
    .filter((g) => !catFilter || g.categoryId === catFilter)
    .filter((g) => !unreadOnly || g.unreadCount > 0)
    .filter((g) => !term || `${g.name} ${g.sub ?? ""} ${g.lastMessagePreview ?? ""}`.toLowerCase().includes(term));
  // A district screen lists only people of THAT district (user 2026-10-19): RI Director, zone
  // co-ordinators (they cover every district), assistants whose districts include it, and this
  // district's own chat. Others stay only when there is already a conversation with them.
  const ctxNum = mode === "district" ? groups.find((g) => g.districtId === contextDistrictId)?.districtNumber ?? null : null;
  const ofThisDistrict = (c: GoalDirectContactDto) => {
    if (mode !== "district") return true;
    if (c.roleKind === "RIDirector" || c.roleKind === "ZoneCoordinator") return true;
    if (c.roleKind === "SuperAdmin") return c.messageCount > 0;
    const ds = (c.districts ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (ctxNum && ds.includes(ctxNum)) return true;
    return c.messageCount > 0 && (!ctxNum || ds.length === 0);
  };
  // On a district screen an assistant with several districts reads "ARPIC · D 3292" - just this one.
  const subOf = (c: GoalDirectContactDto) => {
    const ds = (c.districts ?? "").split(",").map((x) => x.trim());
    return ctxNum && c.roleKind === "DistrictAssistant" && ds.includes(ctxNum) ? `${shortRole(c.roleLabel)} · D ${ctxNum}` : personSub(c);
  };
  const shownPeople = byRecent(people, (c) => c.lastMessageDate)
    .filter(ofThisDistrict)
    .filter((c) => !catFilter)
    .filter((c) => !unreadOnly || c.unreadCount > 0)
    .filter((c) => !term || `${c.name} ${subOf(c)} ${c.lastMessagePreview ?? ""}`.toLowerCase().includes(term));
  const unreadTotal = groups.filter((g) => g.unreadCount > 0).length + people.filter((c) => c.unreadCount > 0).length;
  const catsInUse = cats.filter((c) => groups.some((g) => g.categoryId === c.id));
  const pill = (on: boolean) =>
    `text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${on ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;
  const section = (label: string) => (
    <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 bg-white sticky top-0">{label}</div>
  );

  const list = (
    <>
      <ChatListHeader q={q} onQ={setQ} unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} unreadTotal={unreadTotal}
        placeholder="Search group, name, district…" />
      {catsInUse.length > 1 && (
        <div className="flex gap-1.5 px-3 py-2 border-b border-slate-100 overflow-x-auto">
          <button type="button" className={pill(catFilter === 0)} onClick={() => setCatFilter(0)}>All</button>
          {catsInUse.map((c) => (
            <button key={c.id} type="button" className={pill(catFilter === c.id)} onClick={() => setCatFilter(c.id)}>{c.name}</button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {shownGroups.length > 0 && section("Groups")}
        {shownGroups.map((g) => (
          <GroupRow key={g.key} g={g} active={active?.type === "group" && active.key === g.key} onClick={() => openGroup(g)} />
        ))}
        {shownPeople.length > 0 && section("Personal chats")}
        {shownPeople.map((c) => (
          <ChatRow key={c.memberId} name={c.name} sub={subOf(c)}
            preview={c.lastMessagePreview ?? (c.canMessage ? "Start a chat" : null)}
            date={c.lastMessageDate} unread={c.unreadCount} active={active?.type === "person" && active.id === c.memberId} onClick={() => openPerson(c)} />
        ))}
        {shownGroups.length === 0 && shownPeople.length === 0 && <p className="px-4 py-6 text-xs text-slate-400 text-center">Nothing matches.</p>}
      </div>
    </>
  );

  const title = activeGroup?.name ?? activePerson?.name ?? "";
  const headerSub = activeGroup
    ? (activeGroup.kind === "Broadcast"
        ? `Goes to each district group: ${members.map((m) => m.name.replace("District ", "")).join(", ")}`
        : members.map(memberLine).join(", "))
    : activePerson ? subOf(activePerson) : "";

  const pane = active && (activeGroup || activePerson) ? (
    <>
      <ChatPaneHeader name={title} sub={<span className="block whitespace-normal break-words leading-snug max-h-24 overflow-y-auto">{headerSub}</span>} onBack={() => { setActive(null); setMessages(null); }}
        right={!canPost && !loadingMsgs ? <span className="text-[11px] text-slate-400 shrink-0">Read only</span> : undefined} />
      <div ref={scrollRef} className={`flex-1 min-h-0 overflow-y-auto px-4 py-3 ${CHAT_BG}`}>
        {loadingMsgs ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-8"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <GoalMessageList messages={messages ?? []} showCategory={!activeGroup}
            emptyText={activeGroup?.kind === "Broadcast" ? "Write once - it goes to every district group listed above."
              : activeGroup ? "No messages yet. Everyone in this group will see what you write." : `No messages yet. Say hello to ${title}.`} />
        )}
      </div>
      {canPost && (
        <div className="px-3 py-2.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-end gap-2 shrink-0">
          {activePerson && (
            <select value={postCat} onChange={(e) => setPostCat(Number(e.target.value))} disabled={posting}
              title="Which category is this message about?"
              className="h-10 px-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {activePerson && tagDistricts.length > 0 && (
            <select value={postDistrict} onChange={(e) => setPostDistrict(Number(e.target.value))} disabled={posting}
              title="Which district is this message about?"
              className="h-10 px-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value={0}>All districts</option>
              {tagDistricts.map((d) => <option key={d.id} value={d.id}>District {d.number}</option>)}
            </select>
          )}
          <textarea ref={inputRef} rows={1} value={text} disabled={posting} maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={activeGroup?.kind === "Broadcast" ? "Message to all these districts" : "Type a message"}
            className="flex-1 min-w-[160px] min-h-[40px] max-h-32 resize-none px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button type="button" onClick={send} disabled={posting || !text.trim()} title="Send"
            className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 disabled:opacity-40 shrink-0">
            {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      )}
      {!canPost && !loadingMsgs && (
        <p className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 shrink-0">
          {activeGroup ? "You can read this group but not write in it." : `${title} no longer holds a role you can message - this conversation is read only.`}
        </p>
      )}
      {error && <p className="px-4 py-1.5 text-xs text-rose-700 bg-rose-50">{error}</p>}
    </>
  ) : <EmptyPane text="Select a group or a person on the left." />;

  return <ChatShell list={list} pane={pane} hasActive={!!active} className="h-full min-h-[380px]" />;
}
