"use client";

// NEW CMR report - DESIGN A (user 2026-11-10: "the PDF looks very good - that design should be on the page").
// The A4 report look of the first PDF (navy header band, summary boxes, gold-bar headings, navy-header grid
// tables) as a page. The PDF is a picture of THIS element (cmrPdfFromPage), so page and PDF are the same.
// Fixed A4 width (794 px); same figures as Design B (foundationTable / membershipTable / grouped meetings).

import { forwardRef } from "react";
import type { MonthlyReportPreview } from "@/types/clubMonthlyReport";
import type { FoundationTable, MembershipRow, CmrMemberCounts, FoundationSourceDates } from "@/components/cmr/CmrGoalPanels";
import { usd } from "@/components/cmr/CmrGoalPanels";
import { CMR_PROJECT_LABELS, CMR_DISTRICT_NOTE, groupCmrMeetings } from "@/components/cmr/cmrLabels";
import { appLocale } from "@/lib/appFormat";

export interface CmrReportProps {
  report: MonthlyReportPreview; monthName: string; calendarYear: number | null;
  foundation: FoundationTable; membership: MembershipRow[]; counts: CmrMemberCounts;
  remarks: string | null; uploadedLabel: string | null;
  // "Updated from Rotary.org / RISAO on …" for the Foundation table (Design B, user 2026-11-13).
  foundationDates?: FoundationSourceDates;
}

const day = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
};

const TH = "border border-[#0B2A5E] bg-[#0B2A5E] px-2 py-1.5 text-[11px] font-bold text-white";
const TD = "border border-slate-200 px-2 py-1.5 text-[12px] text-slate-800";

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <div data-pdf-block className="mb-2 mt-6 flex items-end justify-between">
      <div className="flex items-center gap-2">
        <span className="inline-block h-5 w-[5px] bg-[#F7A81B]" />
        <h3 className="text-[17px] font-bold text-[#0B2A5E]">{title}</h3>
      </div>
      {note && <span className="text-[11px] text-slate-500">{note}</span>}
    </div>
  );
}

function Grid({ head, rows, right = [], bold = [], foot }: {
  head: string[]; rows: React.ReactNode[][]; right?: number[]; bold?: number[]; foot?: React.ReactNode[];
}) {
  const al = (i: number) => (right.includes(i) ? "text-right tabular-nums" : "text-left");
  return (
    <table className="w-full border-collapse">
      <thead><tr>{head.map((h, i) => <th key={h} className={`${TH} ${al(i)}`}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className={ri % 2 === 1 ? "bg-slate-50" : "bg-white"}>
            {r.map((c, i) => <td key={i} className={`${TD} ${al(i)} ${bold.includes(ri) ? "font-bold" : ""}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
      {foot && <tfoot><tr className="bg-slate-100">{foot.map((c, i) => <td key={i} className={`${TD} ${al(i)} font-bold text-slate-900`}>{c}</td>)}</tr></tfoot>}
    </table>
  );
}

const None = ({ text }: { text: string }) => <p data-pdf-block className="py-1 text-[12px] text-slate-500">{text}</p>;

const CmrReportDesignA = forwardRef<HTMLDivElement, CmrReportProps>(function CmrReportDesignA(
  { report, monthName, calendarYear, foundation, membership, counts, remarks, uploadedLabel }, ref,
) {
  const groups = groupCmrMeetings(report.meetings);
  const pcts = report.meetings.map((m) => m.attendancePercentage).filter((p): p is number => p != null);
  const avg = pcts.length ? Math.round(pcts.reduce((s, p) => s + Number(p), 0) / pcts.length) : null;
  const types = Object.keys(CMR_PROJECT_LABELS).filter((k) => (report.projects[k]?.length ?? 0) > 0);
  const projectCount = types.reduce((s, k) => s + report.projects[k].length, 0);
  const now = counts.start + counts.added - counts.terminated;
  const title = `${monthName}${calendarYear ? ` ${calendarYear}` : ""}`;

  return (
    <div ref={ref} className="w-[794px] bg-white pb-8 text-slate-900">
      {/* Header band */}
      <div data-pdf-block className="relative bg-[#0B2A5E] px-[45px] pb-5 pt-6 text-white">
        <h1 className="text-[24px] font-bold leading-tight">Club Monthly Report - {title}</h1>
        <p className="mt-1.5 text-[14px]">{report.clubName}   |   Rotary Year {report.yearLabel}</p>
        <p className="mt-1 text-[14px]">Assistant Governor: {report.assistantGovernor || "N/A"}</p>
        <span className="absolute right-[45px] top-6 rounded-md bg-[#F7A81B] px-4 py-1 text-[11px] font-bold text-[#0B2A5E]">PREVIEW</span>
        <span className="absolute bottom-5 right-[45px] text-[13px]">{uploadedLabel ? `Uploaded to District: ${uploadedLabel}` : "Not uploaded to District yet"}</span>
      </div>

      <div className="px-[45px]">
        {/* Summary boxes */}
        <div data-pdf-block className="mt-6 grid grid-cols-4 gap-3">
          {[
            ["MEETINGS", String(report.meetings.length), avg != null ? `Avg attendance ${avg}%` : "No meetings"],
            ["FOUNDATION", usd(foundation.total.month), foundation.synced ? "From Rotary.org" : "CMR entries (not synced)"],
            ["PROJECTS", String(projectCount), `${types.length} service type(s)`],
            ["MEMBERS NOW", String(now), "From member records"],
          ].map(([l, v, h]) => (
            <div key={l} className="rounded-lg border border-slate-200 px-3 py-2.5">
              <div className="text-[10px] font-bold text-slate-500">{l}</div>
              <div className="mt-1 text-[20px] font-bold tabular-nums">{v}</div>
              <div className="text-[10px] text-slate-500">{h}</div>
            </div>
          ))}
        </div>

        {/* Meetings - one table per type */}
        <Heading title="Meetings" note={`${report.meetings.length} this month`} />
        {groups.length === 0 ? <None text="No meetings this month." /> : groups.map((g) => (
          <div key={g.type} className="mb-3">
            <p data-pdf-block className="mb-1 text-[13px] font-bold">{g.label} ({g.items.length}){g.avgAttendance != null ? `  -  avg attendance ${g.avgAttendance}%` : ""}</p>
            <Grid head={["#", "Date", "Title", "Attendance", "Attendance %"]} right={[3, 4]}
              rows={g.items.map((m, i) => [i + 1, day(m.projectDate), m.title, m.attendance ?? "-", m.attendancePercentage != null ? `${m.attendancePercentage}%` : "-"])} />
          </div>
        ))}

        {/* Foundation */}
        <Heading title="Foundation" note={foundation.synced ? "From Club Goals (Rotary.org)" : "Not synced - CMR entries by fund type"} />
        {foundation.rows.length === 0 ? <None text="No Foundation figures for this month." /> : foundation.synced ? (
          <Grid head={["Fund", "This month", "Month target", "Year till date", "Year target"]} right={[1, 2, 3, 4]}
            rows={foundation.rows.map((r) => [r.name, usd(r.month), usd(r.monthTarget), usd(r.ytd), usd(r.yearTarget)])}
            foot={["Total", usd(foundation.total.month), usd(foundation.total.monthTarget), usd(foundation.total.ytd), usd(foundation.total.yearTarget)]} />
        ) : (
          <Grid head={["Fund type", "This month (USD)"]} right={[1]}
            rows={foundation.rows.map((r) => [r.name, usd(r.month)])} foot={["Total", usd(foundation.total.month)]} />
        )}

        {/* Membership */}
        <Heading title="Membership" note="From member records and Club Goals" />
        <Grid head={["Membership", "This month", "Month target", "Year till date", "Year target"]} right={[1, 2, 3, 4]}
          bold={membership.map((r, i) => (r.strong ? i : -1)).filter((i) => i >= 0)}
          rows={membership.map((r) => [r.label, r.month, r.monthTarget, r.ytd, r.yearTarget])} />

        {/* Projects */}
        <Heading title="Projects" note={`${projectCount} this month`} />
        {types.length === 0 ? <None text="No projects this month." /> : types.map((k) => (
          <div key={k} className="mb-3">
            <p data-pdf-block className="mb-1 text-[13px] font-bold">{CMR_PROJECT_LABELS[k]} ({report.projects[k].length})</p>
            <Grid head={["#", "Date", "Title", "Area of focus"]}
              rows={report.projects[k].map((p, i) => [i + 1, day(p.projectDate), p.title, p.areaOfFocusName || "-"])} />
          </div>
        ))}

        {/* Remarks */}
        <Heading title="Additional achievement / participation above club level" />
        <p data-pdf-block className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-800">{remarks?.trim() || "None."}</p>
        {report.preparedBy && (
          <p data-pdf-block className="mt-4 text-[11px] text-slate-500">Prepared by: {report.preparedBy}{report.designation ? ` (${report.designation})` : ""}</p>
        )}
        <p data-pdf-block className="mt-5 border-l-[5px] border-[#F7A81B] bg-[#FFF7E6] px-3 py-2 text-[11px] leading-relaxed text-slate-800">
          <b>Note:</b> {CMR_DISTRICT_NOTE}
        </p>
      </div>
    </div>
  );
});

export default CmrReportDesignA;
