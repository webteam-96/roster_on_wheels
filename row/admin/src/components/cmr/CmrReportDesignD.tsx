"use client";

// NEW CMR report - DESIGN D "Infographic" (user 2026-11-10: two more designs to compare). Same content and
// figures as A / B / C. Ring charts for attendance, Foundation, members and women against their targets,
// then one coloured band per section (Meetings blue, Foundation gold, Membership green, Projects purple).
// Fixed A4 width (794 px); the PDF is a picture of this element.

import { forwardRef } from "react";
import { usd } from "@/components/cmr/CmrGoalPanels";
import { CMR_PROJECT_LABELS, CMR_DISTRICT_NOTE } from "@/components/cmr/cmrLabels";
import type { CmrReportProps } from "@/components/cmr/CmrReportDesignA";
import { reportFigures, reportDay } from "@/components/cmr/cmrReportShared";

type Tone = { band: string; text: string; tint: string; line: string };
const TONES: Record<"blue" | "gold" | "green" | "purple" | "slate", Tone> = {
  blue:   { band: "#2563EB", text: "#ffffff", tint: "#EFF6FF", line: "#BFDBFE" },
  gold:   { band: "#F7A81B", text: "#0B2A5E", tint: "#FFF7E6", line: "#FDE2A7" },
  green:  { band: "#059669", text: "#ffffff", tint: "#ECFDF5", line: "#A7F3D0" },
  purple: { band: "#7C3AED", text: "#ffffff", tint: "#F5F3FF", line: "#DDD6FE" },
  slate:  { band: "#334155", text: "#ffffff", tint: "#F8FAFC", line: "#E2E8F0" },
};

function Ring({ value, label, sub, color, dp = 0 }: { value: number | null; label: string; sub: string; color: string; dp?: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const fill = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative h-[92px] w-[92px]">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle cx="46" cy="46" r={r} fill="none" stroke="#E2E8F0" strokeWidth="9" />
          <circle cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${(fill / 100) * c} ${c}`} transform="rotate(-90 46 46)" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[17px] font-black tabular-nums text-slate-900">
          {value == null ? "–" : `${value.toFixed(dp)}%`}
        </span>
      </div>
      <span className="mt-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">{label}</span>
      <span className="text-[10px] text-slate-500">{sub}</span>
    </div>
  );
}

function Band({ tone, title, note, children }: { tone: Tone; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div data-pdf-block className="flex items-center justify-between rounded-t-xl px-5 py-2.5" style={{ background: tone.band, color: tone.text }}>
        <h3 className="text-[15px] font-black uppercase tracking-[0.14em]">{title}</h3>
        {note && <span className="text-[11px] font-semibold opacity-90">{note}</span>}
      </div>
      <div className="rounded-b-xl border border-t-0 px-5 py-4" style={{ borderColor: tone.line }}>{children}</div>
    </section>
  );
}

function Table({ tone, head, rows, right = [], strong = [], foot }: { tone: Tone; head: string[]; rows: React.ReactNode[][]; right?: number[]; strong?: number[]; foot?: React.ReactNode[] }) {
  const al = (i: number) => (right.includes(i) ? "text-right tabular-nums" : "text-left");
  return (
    <table className="w-full text-[12px]">
      <thead><tr>{head.map((h, i) => <th key={h} className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 ${al(i)}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, ri) => (
        <tr key={ri} style={{ background: ri % 2 === 0 ? tone.tint : "#ffffff" }} className={strong.includes(ri) ? "font-bold" : ""}>
          {r.map((c, i) => <td key={i} className={`px-2 py-1.5 text-slate-800 ${al(i)}`}>{c}</td>)}
        </tr>
      ))}</tbody>
      {foot && <tfoot><tr style={{ borderTop: `2px solid ${tone.band}` }}>{foot.map((c, i) => <td key={i} className={`px-2 py-1.5 font-bold text-slate-900 ${al(i)}`}>{c}</td>)}</tr></tfoot>}
    </table>
  );
}

const CmrReportDesignD = forwardRef<HTMLDivElement, CmrReportProps>(function CmrReportDesignD(props, ref) {
  const { report, monthName, calendarYear, foundation, membership, counts, remarks, uploadedLabel } = props;
  const f = reportFigures(props);
  const T = TONES;

  return (
    <div ref={ref} className="w-[794px] bg-white px-8 pb-8 pt-7 text-slate-900">
      {/* Header */}
      <div data-pdf-block className="flex items-end justify-between gap-4 rounded-2xl bg-[#0B2A5E] px-7 py-6 text-white">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#F7A81B]">Club Monthly Report</p>
          <h1 className="mt-1 text-[34px] font-black leading-tight">{monthName} {calendarYear ?? ""}</h1>
          <p className="text-[13px] text-[#C9D6EE]">{report.clubName} · RY {report.yearLabel} · AG {report.assistantGovernor || "N/A"}</p>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-lg px-3 py-1.5 text-[11px] font-bold ${uploadedLabel ? "bg-emerald-400 text-emerald-950" : "bg-[#F7A81B] text-[#0B2A5E]"}`}>
            {uploadedLabel ? "UPLOADED TO DISTRICT" : "PREVIEW"}
          </span>
          {uploadedLabel && <p className="mt-1 text-[10px] text-[#C9D6EE]">{uploadedLabel}</p>}
        </div>
      </div>

      {/* Rings + key numbers */}
      <div data-pdf-block className="mt-6 grid grid-cols-4 gap-2 rounded-2xl border border-slate-200 px-4 py-5">
        <Ring value={f.avgAttendance} label="Attendance" sub={`${report.meetings.length} meeting(s)`} color={T.blue.band} />
        <Ring value={f.foundationPct} dp={2} label="Foundation" sub={foundation.synced ? `${usd(foundation.total.ytd)} of ${usd(foundation.total.yearTarget)}` : "not synced yet"} color={T.gold.band} />
        <Ring value={f.memberPct} label="Members" sub={`${f.membersNow} of ${f.memberTarget ?? "–"} target`} color={T.green.band} />
        <Ring value={f.womenPct} label="Women" sub={`${f.womenNow ?? "–"} of ${f.womenTarget ?? "–"} target`} color={T.purple.band} />
      </div>
      <div data-pdf-block className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          [String(report.meetings.length), "meetings"],
          [usd(foundation.total.month), "Foundation this month"],
          [String(f.projectCount), "projects"],
          [`+${counts.added} / −${counts.terminated}`, "members this month"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-xl bg-slate-50 py-2.5">
            <div className="text-[18px] font-black tabular-nums text-[#0B2A5E]">{v}</div>
            <div className="text-[10px] text-slate-500">{l}</div>
          </div>
        ))}
      </div>

      <Band tone={T.blue} title="Meetings" note={`${report.meetings.length} this month`}>
        {f.groups.length === 0 ? <p data-pdf-block className="text-[12px] italic text-slate-500">No meetings this month.</p> : f.groups.map((g) => (
          <div key={g.type} className="mb-3">
            <p data-pdf-block className="mb-1 text-[12px]">
              <span className="rounded px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ background: T.blue.band }}>{g.label}</span>
              <span className="ml-2 text-slate-600">{g.items.length} meeting(s){g.avgAttendance != null ? ` · avg attendance ${g.avgAttendance}%` : ""}</span>
            </p>
            <Table tone={T.blue} head={["Date", "Title", "Attendance", "%"]} right={[2, 3]}
              rows={g.items.map((m) => [reportDay(m.projectDate), m.title, m.attendance ?? "-", m.attendancePercentage != null ? `${m.attendancePercentage}%` : "-"])} />
          </div>
        ))}
      </Band>

      <Band tone={T.gold} title="Foundation" note={foundation.synced ? "From Club Goals (Rotary.org)" : "Not synced - CMR entries"}>
        {foundation.rows.length === 0 ? <p data-pdf-block className="text-[12px] italic text-slate-500">No Foundation figures for this month.</p> : foundation.synced ? (
          <Table tone={T.gold} head={["Fund", "This month", "Month target", "Year till date", "Year target"]} right={[1, 2, 3, 4]}
            rows={foundation.rows.map((r) => [r.name, usd(r.month), usd(r.monthTarget), usd(r.ytd), usd(r.yearTarget)])}
            foot={["Total", usd(foundation.total.month), usd(foundation.total.monthTarget), usd(foundation.total.ytd), usd(foundation.total.yearTarget)]} />
        ) : (
          <Table tone={T.gold} head={["Fund type", "This month (USD)"]} right={[1]} rows={foundation.rows.map((r) => [r.name, usd(r.month)])} foot={["Total", usd(foundation.total.month)]} />
        )}
      </Band>

      <Band tone={T.green} title="Membership" note={f.july1 != null ? `${f.july1} on 1 July · net ${f.netGrowth != null && f.netGrowth > 0 ? "+" : ""}${f.netGrowth ?? "–"}` : undefined}>
        <div data-pdf-block className="mb-3 grid grid-cols-4 gap-2 text-center">
          {[
            [String(counts.start), "start of month", "#334155"],
            [`+${counts.added}`, "added", T.green.band],
            [`−${counts.terminated}`, "terminated", "#E11D48"],
            [String(f.membersNow), "members now", "#0B2A5E"],
          ].map(([v, l, c]) => (
            <div key={l} className="rounded-xl py-2" style={{ background: T.green.tint }}>
              <div className="text-[20px] font-black tabular-nums" style={{ color: c }}>{v}</div>
              <div className="text-[10px] text-slate-600">{l}</div>
            </div>
          ))}
        </div>
        <Table tone={T.green} head={["", "This month", "Month target", "Year till date", "Year target"]} right={[1, 2, 3, 4]}
          strong={membership.map((r, i) => (r.strong ? i : -1)).filter((i) => i >= 0)}
          rows={membership.map((r) => [r.label, r.month, r.monthTarget, r.ytd, r.yearTarget])} />
      </Band>

      <Band tone={T.purple} title="Projects" note={`${f.projectCount} this month`}>
        {f.projectTypes.length === 0 ? <p data-pdf-block className="text-[12px] italic text-slate-500">No projects this month.</p> : f.projectTypes.map((k) => (
          <div key={k} className="mb-3">
            <p data-pdf-block className="mb-1 text-[12px]">
              <span className="rounded px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ background: T.purple.band }}>{CMR_PROJECT_LABELS[k]}</span>
              <span className="ml-2 text-slate-600">{report.projects[k].length} project(s)</span>
            </p>
            <Table tone={T.purple} head={["Date", "Title", "Area of focus"]}
              rows={report.projects[k].map((p) => [reportDay(p.projectDate), p.title, p.areaOfFocusName || "-"])} />
          </div>
        ))}
      </Band>

      <Band tone={T.slate} title="Above club level">
        <p data-pdf-block className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-800">{remarks?.trim() || "None."}</p>
        {report.preparedBy && <p data-pdf-block className="mt-3 text-[11px] text-slate-500">Prepared by {report.preparedBy}{report.designation ? `, ${report.designation}` : ""}</p>}
      </Band>
      <div data-pdf-block className="mt-5 flex items-start gap-3 rounded-xl border-2 border-dashed border-[#F7A81B] bg-[#FFF7E6] px-4 py-3 text-[11px] leading-relaxed text-slate-800">
        <span className="rounded-md bg-[#F7A81B] px-2 py-0.5 text-[10px] font-black text-[#0B2A5E]">NOTE</span>
        <span>{CMR_DISTRICT_NOTE}</span>
      </div>
    </div>
  );
});

export default CmrReportDesignD;
