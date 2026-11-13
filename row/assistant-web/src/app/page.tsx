"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CenteredCard from "@/components/CenteredCard";
import Composer, { MAX_MESSAGE_LENGTH } from "@/components/Composer";
import MessageView, { type UiMessage } from "@/components/Message";
import Sidebar from "@/components/Sidebar";
import { LogoutIcon, MenuIcon } from "@/components/icons";
import {
  ApiError,
  LOGIN_PATH,
  deleteConversation,
  getConversation,
  getMe,
  listConversations,
  type ConversationSummary,
  type Me,
} from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { streamChat } from "@/lib/sse";

const STARTERS = [
  "How many members joined my district this year?",
  "Which clubs haven't submitted this month's report?",
  "Show community service projects about water",
];

const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : fallback;

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [bootError, setBootError] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const loadSeq = useRef(0); // guards against out-of-order conversation loads
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshConversations = useCallback(() => {
    listConversations()
      .then(setConversations)
      .catch(() => {});
  }, []);

  // ── Boot: token → /me → conversation list ──
  useEffect(() => {
    if (!getToken()) {
      router.replace(LOGIN_PATH);
      return;
    }
    let cancelled = false;
    getMe()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        if (m.allowed) refreshConversations();
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof ApiError && e.status === 401))
          setBootError(errorText(e, "Couldn't reach the assistant service. Please try again."));
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [router, refreshConversations]);

  // Keep the thread pinned to the bottom while streaming, unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Escape closes the mobile sidebar.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSidebarOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const patch = useCallback((key: string, fn: (m: UiMessage) => UiMessage) => {
    setMessages((list) => list.map((m) => (m.key === key ? fn(m) : m)));
  }, []);

  function logout() {
    abortRef.current?.abort();
    clearToken();
    router.replace(LOGIN_PATH);
  }

  function newChat() {
    abortRef.current?.abort();
    loadSeq.current++;
    setActiveId(null);
    setMessages([]);
    setThreadError("");
    setThreadLoading(false);
    setSidebarOpen(false);
    inputRef.current?.focus();
  }

  async function openConversation(id: number) {
    setSidebarOpen(false);
    if (id === activeId && !threadError) return;
    abortRef.current?.abort();
    const seq = ++loadSeq.current;
    setActiveId(id);
    setMessages([]);
    setThreadError("");
    setThreadLoading(true);
    try {
      const detail = await getConversation(id);
      if (seq !== loadSeq.current) return;
      stickToBottom.current = true;
      setMessages(
        detail.messages.map((m) => ({ key: `s-${m.id}`, role: m.role, content: m.content })),
      );
    } catch (e) {
      if (seq === loadSeq.current) setThreadError(errorText(e, "Couldn't load this conversation."));
    } finally {
      if (seq === loadSeq.current) setThreadLoading(false);
    }
  }

  async function removeConversation(c: ConversationSummary) {
    if (!window.confirm(`Delete "${c.title || "Untitled conversation"}"? This can't be undone.`)) return;
    try {
      await deleteConversation(c.id);
      setConversations((list) => list.filter((x) => x.id !== c.id));
      if (c.id === activeId) newChat();
    } catch (e) {
      window.alert(errorText(e, "Couldn't delete the conversation. Please try again."));
    }
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || streaming || text.length > MAX_MESSAGE_LENGTH) return;

    const stamp = Date.now();
    const botKey = `a-${stamp}`;
    setMessages((list) => [
      ...list,
      { key: `u-${stamp}`, role: "user", content: text },
      { key: botKey, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setStreaming(true);
    setAnnouncement("The assistant is answering…");
    stickToBottom.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let settled = false;
    const end = (fields: Partial<UiMessage>) =>
      patch(botKey, (m) => ({ ...m, streaming: false, status: undefined, ...fields }));

    try {
      await streamChat(
        { conversationId: activeId ?? undefined, message: text },
        (e) => {
          switch (e.type) {
            case "meta":
              setActiveId(e.conversationId);
              setConversations((list) =>
                list.some((c) => c.id === e.conversationId)
                  ? list
                  : [{ id: e.conversationId, title: text.slice(0, 80), updatedDate: new Date().toISOString() }, ...list],
              );
              break;
            case "status":
              patch(botKey, (m) => ({ ...m, status: e.text }));
              break;
            case "delta":
              patch(botKey, (m) => ({ ...m, content: m.content + e.text }));
              break;
            case "answer_reset":
              patch(botKey, (m) => ({ ...m, content: "" }));
              break;
            case "done":
              settled = true;
              patch(botKey, (m) => ({
                ...m,
                content: e.answer || m.content,
                streaming: false,
                status: undefined,
                cached: e.cached,
                asOf: e.asOf,
              }));
              setMe((cur) =>
                cur && {
                  ...cur,
                  questionsToday: e.questionsToday ?? cur.questionsToday,
                  dailyLimit: e.dailyLimit ?? cur.dailyLimit,
                },
              );
              setAnnouncement("Answer ready.");
              break;
            case "error":
              settled = true;
              end({ error: { message: e.message, code: e.code } });
              if (e.code === "daily_limit")
                setMe((cur) => cur && { ...cur, questionsToday: Math.max(cur.questionsToday, cur.dailyLimit) });
              setAnnouncement(e.message);
              break;
          }
        },
        controller.signal,
      );
      if (!settled) end({ error: { message: "The answer was interrupted. Please try again." } });
    } catch {
      if (controller.signal.aborted) end({ stopped: true });
      else end({ error: { message: "Couldn't reach the assistant. Check your connection and try again." } });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      refreshConversations(); // pick up the server-side title / ordering
    }
  }

  // ── Render states ──
  if (bootError) {
    return (
      <CenteredCard title="ROW Assistant">
        <p role="alert" className="text-sm text-slate-700">
          {bootError}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-ink hover:bg-gold-600"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </CenteredCard>
    );
  }

  if (!me) {
    return (
      <main className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  if (!me.allowed) {
    return (
      <CenteredCard title="ROW Assistant">
        <h2 className="text-base font-semibold text-slate-800">You don&apos;t have access to the assistant</h2>
        <p className="mt-2 text-sm text-slate-600">
          {me.reason || "The assistant isn't enabled for your role yet. Please contact your district administrator."}
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </CenteredCard>
    );
  }

  const empty = activeId === null && messages.length === 0;
  const limitReached = me.dailyLimit > 0 && me.questionsToday >= me.dailyLimit;
  const firstName = me.name.split(" ")[0];

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-gold-500 bg-navy-900 px-3 text-white sm:px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open conversation list"
          aria-controls="conversation-sidebar"
          aria-expanded={sidebarOpen}
          className="rounded-lg p-2 hover:bg-white/10 md:hidden"
        >
          <MenuIcon />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/row-logo-inverse.png" alt="Roster on Wheels" className="hidden h-8 w-auto sm:block" />
        <h1 className="text-sm font-semibold sm:border-l sm:border-white/20 sm:pl-3 sm:text-base">AI Assistant</h1>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <div className="min-w-0 text-right leading-tight">
            <p className="truncate text-sm font-medium">{me.name}</p>
            {me.scope && <p className="truncate text-xs text-white/60">{me.scope}</p>}
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            <LogoutIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNew={newChat}
          onSelect={openConversation}
          onDelete={removeConversation}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="flex-1 overflow-y-auto"
          >
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
              {empty ? (
                <section className="pt-8 text-center sm:pt-16" aria-labelledby="welcome-heading">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/rotary-logo.png" alt="" className="mx-auto h-14 w-14" />
                  <h2 id="welcome-heading" className="mt-4 text-xl font-semibold text-navy-900">
                    Hi {firstName}, what would you like to know?
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Answers come from Rotary portal data you have access to{me.scope ? ` (${me.scope})` : ""}.
                  </p>
                  <ul className="mx-auto mt-8 grid max-w-xl gap-2 text-left sm:grid-cols-1">
                    {STARTERS.map((q) => (
                      <li key={q}>
                        <button
                          type="button"
                          onClick={() => send(q)}
                          disabled={streaming}
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-card hover:border-gold-500 hover:bg-gold-50 disabled:opacity-60"
                        >
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                messages.map((m) => <MessageView key={m.key} m={m} />)
              )}
              {threadLoading && <p className="text-center text-sm text-slate-500">Loading conversation…</p>}
              {threadError && (
                <p role="alert" className="text-center text-sm text-red-600">
                  {threadError}
                </p>
              )}
            </div>
          </div>

          <Composer
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onStop={() => abortRef.current?.abort()}
            streaming={streaming}
            disabled={threadLoading}
            quota={
              <span className={limitReached ? "font-medium text-amber-700" : undefined}>
                {me.questionsToday} of {me.dailyLimit} questions today
              </span>
            }
          />
        </main>
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
