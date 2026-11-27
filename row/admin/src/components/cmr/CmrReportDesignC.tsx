"use client";

// NEW CMR report - DESIGN C "Timeline" (user 2026-11-10: two more designs to compare). Same content and
// figures as A / B. Split header (navy month block + gold-tint key figures), then the sections run down a
// vertical timeline with round markers. Fixed A4 width (794 px); the PDF is a picture of this element.

import { forwardRef } from "react";
import { Calendar, DollarSign, Users, FolderOpen, Award } from "@/components/icons";
import { usd } from "@/components/cmr/CmrGoalPanels";
import { CMR_PROJECT_LABELS, CMR_DISTRICT_NOTE } from "@/components/cmr/cmrLabels";
import type { CmrReportProps } from "@/components/cmr/CmrReportDesignA";
import { reportFigures, reportDay } from "@/components/cmr/cmrReportShared";

function Step({ icon: Icon, title, note, last, children }: { icon: React.ElementType; title: string; note?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative pl-14">
      {!last && <span className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-slate-200" />}
      <span className="absolute left-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#0B2A5E] text-white ring-4 ring-[#F7A81B]/30"><Icon size={18} /></span>
      <div data-pdf-block className="flex items-baseline justify-between gap-3 pt-1.5">
        <h3 className="text-[18px] font-extrabold text-[#0B2A5E]">{title}</h3>
        {note && <span className="text-[11px] font-medium text-slate-500">{note}</span>}
      </div>
      <div className="pb-8 pt-3">{children}</div>
    </div>
  );
}

const Mini = ({ head, rows, right = [], strong = [], foot }: { head: string[]; rows: React.ReactNode[][]; right?: number[]; strong?: number[]; foot?: React.ReactNode[] }) => {
  const al = (i: number) => (right.includes(i) ? "text-right tabular-nums" : "text-left");
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="border-b-2 border-[#0B2A5E]">{head.map((h, i) => <th key={h} className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0B2A5E] ${al(i)}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, ri) => (
        <tr key={ri} className={`border-b border-slate-100 ${strong.includes(ri) ? "bg-[#F7A81B]/10 font-bold" : ""}`}>
          {r.map((c, i) => <td key={i} className={`px-2 py-1.5 text-slate-800 ${al(i)}`}>{c}</td>)}
        </tr>
      ))}</tbody>
      {foot && <tfoot><tr className="border-t-2 border-[#0B2A5E]">{foot.map((c, i) => <td key={i} className={`px-2 py-1.5 font-bold text-[#0B2A5E] ${al(i)}`}>{c}</td>)}</tr></tfoot>}
    </table>
  );
};

const CmrReportDesignC = forwardRef<HTMLDivElement, CmrReportProps>(function CmrReportDesignC(props, ref) {
  const { report, monthName, calendarYear, foundation, membership, counts, remarks, uploadedLabel } = props;
  const f = reportFigures(props);

  return (
    <div ref={ref} className="w-[794px] bg-white pb-6 text-slate-900">
      {/* Split header */}
      <div data-pdf-block className="grid grid-cols-[1.1fr_1fr]">
        <div className="bg-[#0B2A5E] px-9 py-8 text-white">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#F7A81B]">Club Monthly Report</p>
          <p className="mt-2 text-[44px] font-black leading-none">{monthName}</p>
          <p className="text-[22px] font-light text-[#C9D6EE]">{calendarYear ?? ""} · RY {report.yearLabel}</p>
          <p className="mt-5 text-[15px] font-semibold">{report.clubName}</p>
          <p className="text-[12px] text-[#C9D6EE]">Assistant Governor: {report.assistantGovernor || "N/A"}</p>
          <p className={`mt-4 inline-block rounded px-3 py-1 text-[11px] font-bold ${uploadedLabel ? "bg-emerald-400/20 text-emerald-100" : "bg-white/10 text-[#C9D6EE]"}`}>
            {uploadedLabel ? `Uploaded to District · ${uploadedLabel}` : "Preview · not uploaded to District"}
          </p>
        </div>
        <div className="grid grid-cols-2 bg-[#FFF6E5]">
          {[
            { v: String(report.meetings.length), l: "Meetings", s: f.avgAttendance != null ? `${f.avgAttendance}% avg attendance` : "none held" },
            { v: usd(foundation.total.month), l: "Foundation", s: foundation.synced ? "from Rotary.org" : "CMR entries" },
            { v: String(f.projectCount), l: "Projects", s: `${f.projectTypes.length} service type(s)` },
            { v: String(f.membersNow), l: "Members", s: `+${counts.added} / −${counts.terminated} this month` },
          ].map((k, i) => (
            <div key={k.l} className={`flex flex-col justify-center px-6 py-5 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""} border-[#F7A81B]/30`}>
              <span className="text-[26px] font-black tabular-nums text-[#0B2A5E]">{k.v}</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8a5a00]">{k.l}</span>
              <span className="text-[10px] text-slate-600">{k.s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-9 pt-9">
        <Step icon={Calendar} title="Meetings" note={`${report.meetings.length} this month`}>
          {f.groups.length === 0 ? <p data-pdf-block className="text-[12px] italic text-slate-500">No meetings this month.</p> : f.groups.map((g) => (
            <div key={g.type} className="mb-4">
              <p data-pdf-block className="mb-1 flex items-center gap-2 text-[13px] font-bold text-slate-800">
                <span className="h-2 w-2 rounded-full bg-[#F7A81B]" />{g.label} <span className="font-normal text-slate-500">· {g.items.length}{g.avgAttendance != null ? ` · avg ${g.avgAttendance}%` : ""}</span>
              </p>
              <Mini head={["Date", "Title", "Attendance", "%"]} right={[2, 3]}
                rows={g.items.map((m) => [reportDay(m.projectDate), m.title, m.attendance ?? "-", m.attendancePercentage != null ? `${m.attendancePercentage}%` : "-"])} />
            </div>
          ))}
        </Step>

        <Step icon={DollarSign} title="Foundation" note={foundation.synced ? `From Club Goals (Rotary.org)${f.foundationPct != null ? ` · ${f.foundationPct.toFixed(2)}% of year target` : ""}` : "Not synced - CMR entries"}>
          {foundation.rows.length === 0 ? <p data-pdf-block className="text-[12px] italic text-slate-500">No Foundation figures for this month.</p> : foundation.synced ? (
            <Mini head={["Fund", "This month", "Month target", "Year till date", "Year target"]} right={[1, 2, 3, 4]}
              rows={foundation.rows.map((r) => [r.name, usd(r.month), usd(r.monthTarget), usd(r.ytd), usd(r.yearTarget)])}
              foot={["Total", usd(foundation.total.month), usd(foundation.total.monthTarget), usd(foundation.total.ytd), usd(foundation.total.yearTarget)]} />
          ) : (
            <Mini head={["Fund type", "This month (USD)"]} right={[1]} rows={foundation.rows.map((r) => [r.name, usd(r.month)])} foot={["Total", usd(foundation.total.month)]} />
          )}
        </Step>

        <Step icon={Users} title="Membership" note={`${f.membersNow} members${f.memberPct != null ? ` · ${f.memberPct}% of year target` : ""}`}>
          <Mini head={["", "This month", "Month target", "Year till date", "Year target"]} right={[1, 2, 3, 4]}
            strong={membership.map((r, i) => (r.strong ? i : -1)).filter((i) => i >= 0)}
            rows={membership.map((r) => [r.label, r.month, r.monthTarget, r.ytd, r.yearTarget])} />
        </Step>

        <Step icon={FolderOpen} title="Projects" note={`${f.projectCount} this month`}>
          {f.projectTypes.length === 0 ? <p data-pdf-block className="text-[12px] italic text-slate-500">No projects this month.</p> : f.projectTypes.map((k) => (
            <div key={k} className="mb-4">
              <p data-pdf-block className="mb-1 flex items-center gap-2 text-[13px] font-bold text-slate-800"><span className="h-2 w-2 rounded-full bg-[#F7A81B]" />{CMR_PROJECT_LABELS[k]} <span className="font-normal text-slate-500">· {report.projects[k].length}</span></p>
              <Mini head={["Date", "Title", "Area of focus"]}
                rows={report.projects[k].map((p) => [reportDay(p.projectDate), p.title, p.areaOfFocusName || "-"])} />
            </div>
          ))}
        </Step>

        <Step icon={Award} title="Above club level" last>
          <p data-pdf-block className="whitespace-pre-wrap rounded-xl bg-[#FFF6E5] px-4 py-3 text-[12px] leading-relaxed text-slate-800">{remarks?.trim() || "None."}</p>
          {report.preparedBy && <p data-pdf-block className="mt-3 text-[11px] text-slate-500">Prepared by {report.preparedBy}{report.designation ? `, ${report.designation}` : ""}</p>}
        </Step>
        <p data-pdf-block className="rounded-xl bg-[#0B2A5E] px-5 py-3 text-[11px] leading-relaxed text-[#C9D6EE]">
          <b className="text-[#F7A81B]">Note:</b> {CMR_DISTRICT_NOTE}
        </p>
      </div>
    </div>
  );
});

export default CmrReportDesignC;
