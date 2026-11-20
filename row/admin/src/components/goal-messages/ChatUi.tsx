"use client";

// Chat-style building blocks for every Goal Setting messages screen (user 2026-10-15): a
// conversation list on the left (name, role · districts, last message, time, green unread count,
// newest on top) and the open conversation on the right. Used by the RI Director / SuperAdmin,
// Zone Co-ordinator, District Assistant and "From Districts" inboxes so they all look the same.

import { ChevronLeft, MessagesSquare, Search } from "@/components/icons";

// Stable colour per name, for the avatar and the sender name in a bubble.
const PALETTE = ["#0f766e", "#7c3aed", "#b45309", "#be123c", "#1d4ed8", "#4d7c0f", "#a21caf", "#c2410c"];
export function nameColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// "Assistant Rotary Co-Ordinator (ARC)" → "ARC" (user 2026-10-15); a title with no bracket stays as is.
export function shortRole(role?: string | null): string {
  if (!role) return "";
  const m = role.match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : role;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

function parse(d?: string | null): Date | null {
  if (!d) return null;
  // The API prints "yyyy-MM-dd HH:mm" in the viewer's zone, with " UTC" added when that zone is UTC (ZoneTime.Print).
  const dt = new Date(d.replace(/ UTC$/, "Z").replace(" ", "T"));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ddmmyyyy = (dt: Date) => `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
export const hhmm = (dt: Date) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

// List time: today → "14:05", yesterday → "Yesterday", else "08/10/2026".
export function listTime(d?: string | null): string {
  const dt = parse(d);
  if (!dt) return "";
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return hhmm(dt);
  if (dt.toDateString() === y.toDateString()) return "Yesterday";
  return ddmmyyyy(dt);
}

// Newest first; conversations without a message go last.
export function byRecent<T>(rows: T[], dateOf: (r: T) => string | null | undefined): T[] {
  return [...rows].sort((a, b) => (parse(dateOf(b))?.getTime() ?? 0) - (parse(dateOf(a))?.getTime() ?? 0));
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <span className="rounded-full flex items-center justify-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, backgroundColor: nameColour(name), fontSize: size * 0.34 }}>
      {initials(name)}
    </span>
  );
}

export function ChatListHeader({
  q, onQ, unreadOnly, onUnreadOnly, unreadTotal, placeholder = "Search name, role, district…",
}: {
  q: string; onQ: (v: string) => void;
  unreadOnly: boolean; onUnreadOnly: (v: boolean) => void;
  unreadTotal: number; placeholder?: string;
}) {
  const pill = (on: boolean) =>
    `text-xs font-medium px-3 py-1 rounded-full transition-colors ${on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;
  return (
    <div className="p-3 space-y-2.5 border-b border-slate-100">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 text-sm bg-slate-100 rounded-lg border border-transparent focus:outline-none focus:bg-white focus:border-emerald-400" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onUnreadOnly(false)} className={pill(!unreadOnly)}>All</button>
        <button type="button" onClick={() => onUnreadOnly(true)} className={pill(unreadOnly)}>
          Unread{unreadTotal > 0 ? ` (${unreadTotal})` : ""}
        </button>
      </div>
    </div>
  );
}

export function ChatRow({
  name, sub, preview, date, unread, active, onClick, avatarName,
}: {
  name: string;
  sub?: React.ReactNode;        // role · districts · category
  preview?: string | null;
  date?: string | null;
  unread: number;
  active: boolean;
  onClick: () => void;
  avatarName?: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-slate-100 ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}>
      <Avatar name={avatarName ?? name} />
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={`flex-1 truncate text-[15px] ${unread > 0 ? "font-semibold text-slate-900" : "text-slate-900"}`}>{name}</span>
          <span className={`text-[11px] shrink-0 ${unread > 0 ? "text-emerald-600 font-semibold" : "text-slate-500"}`}>{listTime(date)}</span>
        </span>
        {sub && <span className="block text-[11px] text-slate-500 truncate mt-0.5">{sub}</span>}
        <span className="flex items-center gap-2 mt-0.5">
          <span className={`flex-1 truncate text-[13px] ${unread > 0 ? "text-slate-800 font-medium" : "text-slate-500"}`}>
            {preview || "No messages yet"}
          </span>
          {unread > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
              {unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function ChatPaneHeader({
  name, sub, onBack, right,
}: { name: string; sub?: React.ReactNode; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-3 shrink-0">
      {onBack && (
        <button type="button" onClick={onBack} className="md:hidden -ml-1 p-1 text-slate-600" title="Back"><ChevronLeft size={20} /></button>
      )}
      <Avatar name={name} size={38} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-slate-900 truncate">{name}</p>
        {sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function EmptyPane({ text }: { text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm p-6 text-center bg-cream-2">
      <MessagesSquare size={40} className="mb-3 text-slate-300" />
      {text}
    </div>
  );
}

// The chat background (chat beige) that holds the bubbles.
export const CHAT_BG = "bg-cream";

// Two panes; on phones only one shows at a time.
export function ChatShell({ list, pane, hasActive, className = "h-[66vh] min-h-[380px]" }: {
  list: React.ReactNode; pane: React.ReactNode; hasActive: boolean; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden grid md:grid-cols-[340px_1fr] ${className}`}>
      <div className={`${hasActive ? "hidden md:flex" : "flex"} flex-col min-h-0 border-r border-slate-200`}>{list}</div>
      <div className={`${hasActive ? "flex" : "hidden md:flex"} flex-col min-h-0`}>{pane}</div>
    </div>
  );
}
