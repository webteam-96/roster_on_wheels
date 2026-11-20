"use client";

// Shared read view for Goal Setting messages. Chat style (user 2026-10-15): a date pill between
// days, the writer's name in colour on top of each bubble, then their designation (ARC / RRFC / RPIC …),
// the district and the CATEGORY the message is about, and the time in the bubble's corner. Your own
// messages sit on the right in green.

import type { GoalCommentDto } from "@/types/goalSetting";
import { ddmmyyyy, hhmm, nameColour, shortRole } from "./ChatUi";

// Colour by what the role IS - designations are long titles ("Assistant Rotary Co-Ordinator (ARC)").
function roleStyle(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("governor")) return "bg-amber-50 text-amber-800 border-amber-200";
  if (r.includes("district admin")) return "bg-orange-50 text-orange-800 border-orange-200";
  if (r.includes("director")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (r.startsWith("former")) return "bg-slate-100 text-slate-500 border-slate-200";
  if (r.includes("assistant")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (r.includes("co-ordinator") || r.includes("coordinator")) return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

// Shows the short form (ARC / ARRFC / RMC …); the full title is the tooltip.
export function RoleChip({ role }: { role?: string | null }) {
  if (!role) return null;
  return (
    <span title={role} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap ${roleStyle(role)}`}>
      {shortRole(role)}
    </span>
  );
}

export function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" }) {
  const cls = tone === "blue" ? "bg-blue-50 text-blue-700 border-blue-200"
    : tone === "green" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{children}</span>;
}

function parse(d: string | null): Date | null {
  if (!d) return null;
  // The API prints "yyyy-MM-dd HH:mm" in the viewer's zone, with " UTC" added when that zone is UTC (ZoneTime.Print).
  const dt = new Date(d.replace(/ UTC$/, "Z").replace(" ", "T"));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export default function GoalMessageList({
  messages, showCategory = true, emptyText = "No messages yet.", plainMine = false,
}: {
  messages: GoalCommentDto[];
  showCategory?: boolean;     // every message names its category (user 2026-10-15)
  emptyText?: string;
  // The writer's own box (District Admin / DG, user 2026-10-09): their messages show just "You" -
  // no role or district chip. Readers (RI / ZC / DA) keep the full labels.
  plainMine?: boolean;
}) {
  if (messages.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <span className="text-xs text-slate-600 bg-white/80 rounded-lg px-3 py-1.5 shadow-sm">{emptyText}</span>
      </div>
    );
  }
  let lastDay = "";
  let lastEarlier: boolean | null = null;
  return (
    <div className="space-y-1.5">
      {messages.map((m) => {
        const dt = parse(m.createdDate);
        const day = dt ? ddmmyyyy(dt) : (m.createdDate ?? "");
        // "Earlier messages" before the merged older ones, "Chat" where the one-to-one chat starts.
        const earlier = !!m.isEarlier;
        const runLabel = earlier !== lastEarlier && (earlier || lastEarlier === true)
          ? (earlier ? "Earlier messages · read only" : "Chat") : null;
        lastEarlier = earlier;
        const header = day !== lastDay || runLabel ? day : null;
        lastDay = day;
        const mine = !!m.isMine;
        const showLabels = !(plainMine && mine);
        return (
          <div key={m.id}>
            {runLabel && (
              <div className="flex items-center gap-2 my-3">
                <span className="h-px flex-1 bg-slate-300" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{runLabel}</span>
                <span className="h-px flex-1 bg-slate-300" />
              </div>
            )}
            {header && (
              <div className="flex justify-center my-3">
                <span className="text-[11px] font-medium text-slate-600 bg-white rounded-lg px-3 py-1 shadow-sm">{header}</span>
              </div>
            )}
            <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`min-w-[140px] max-w-[80%] rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm ${mine ? "bg-navy-100 rounded-tr-none" : "bg-cream rounded-tl-none"}`}>
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="text-[13px] font-semibold" style={{ color: mine ? "var(--go-navy-900)" : nameColour(m.postedByName) }}>
                    {mine ? "You" : m.postedByName}
                  </span>
                  {showLabels && (
                    <>
                      <RoleChip role={m.postedByRoleLabel} />
                      {m.districtId ? <Chip tone="green">District {m.districtNumber}</Chip>
                        : m.postedByTier === 2 ? <Chip>All districts</Chip> : null}
                    </>
                  )}
                  {showCategory && m.categoryName && <Chip tone="blue">{m.categoryName}</Chip>}
                </div>
                {m.enteredByName && (
                  <div className="text-[11px] text-slate-500 italic -mt-0.5 mb-0.5">entered by {m.enteredByName}</div>
                )}
                <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
                  {m.commentText}
                  <span className="float-right ml-3 mt-1.5 text-[10px] text-slate-500">{dt ? hhmm(dt) : ""}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
