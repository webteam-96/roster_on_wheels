"use client";

// Shared read view for Goal Setting messages (user 2026-10-09: "message read screen not proper").
// Every message reads the same everywhere - who wrote it (name + role), which district and category it
// is about, and when - grouped under a date heading, newest at the bottom like a conversation.

import type { GoalCommentDto } from "@/types/goalSetting";

const ROLE_STYLE: Record<string, string> = {
  "District Governor": "bg-amber-50 text-amber-800 border-amber-200",
  "District Admin": "bg-orange-50 text-orange-800 border-orange-200",
};

export function RoleChip({ role }: { role?: string | null }) {
  if (!role) return null;
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap ${ROLE_STYLE[role] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {role}
    </span>
  );
}

export function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" }) {
  const cls = tone === "blue" ? "bg-blue-50 text-blue-700 border-blue-200"
    : tone === "green" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{children}</span>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

// "2026-10-09 14:05" -> date heading + time.
function splitDate(d: string | null) {
  if (!d) return { day: "", time: "" };
  const dt = new Date(d.replace(" ", "T"));
  if (Number.isNaN(dt.getTime())) return { day: d, time: "" };
  return {
    day: dt.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }),
    time: dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function GoalMessageList({
  messages, showCategory = false, emptyText = "No messages yet.", plainMine = false,
}: {
  messages: GoalCommentDto[];
  showCategory?: boolean;     // inbox views that mix categories show the category chip on each message
  emptyText?: string;
  // The writer's own box (District Admin / DG, user 2026-10-09): their messages show just "You" -
  // no role or district chip. Readers (SuperAdmin) keep the full labels.
  plainMine?: boolean;
}) {
  if (messages.length === 0) return <p className="text-sm text-slate-400 text-center py-10">{emptyText}</p>;
  let lastDay = "";
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const { day, time } = splitDate(m.createdDate);
        const header = day !== lastDay ? day : null;
        lastDay = day;
        return (
          <div key={m.id}>
            {header && (
              <div className="flex items-center gap-2 my-2">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{header}</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            <div className={`flex gap-3 ${m.isMine ? "flex-row-reverse" : ""}`}>
              <span className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${m.isMine ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                {initials(m.postedByName)}
              </span>
              <div className={`min-w-0 max-w-[85%] rounded-2xl border px-3.5 py-2.5 ${m.isMine ? "bg-blue-50 border-blue-200 rounded-tr-sm" : "bg-white border-slate-200 rounded-tl-sm"}`}>
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-slate-800">{m.isMine ? "You" : m.postedByName}</span>
                  {!(plainMine && m.isMine) && (
                    <>
                      <RoleChip role={m.postedByRoleLabel} />
                      {m.districtId ? <Chip tone="green">District {m.districtNumber}</Chip>
                        : m.postedByTier === 2 ? <Chip>All districts</Chip> : null}
                    </>
                  )}
                  {showCategory && m.categoryName && <Chip tone="blue">{m.categoryName}</Chip>}
                  <span className="ml-auto text-[10px] text-slate-400 pl-2">{time}</span>
                </div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{m.commentText}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
