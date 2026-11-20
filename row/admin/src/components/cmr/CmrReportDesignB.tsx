"use client";

// NEW CMR preview - DESIGN B ("thoda hatke", user 2026-11-10, for the boss to compare with Design A).
// SAME content and SAME figures as Design A (foundationTable / membershipTable / grouped meetings) - only the
// look differs: a printed-report style page with a big month masthead, a status stamp, key figures as large
// numerals, numbered sections, meeting-type cards and a member-flow strip (no progress bars or goal %). View only.
// Fixed A4 width (794 px): the PDF is a picture of THIS element (cmrPdfFromPage), so page and PDF are the same.

import { forwardRef } from "react";
import { usd, CmrFoundationTable } from "@/components/cmr/CmrGoalPanels";
import type { CmrReportProps } from "@/components/cmr/CmrReportDesignA";
import { CMR_PROJECT_LABELS, CMR_DISTRICT_NOTE, groupCmrMeetings } from "@/components/cmr/cmrLabels";
import { appLocale } from "@/lib/appFormat";

const day = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short" });
};
const n = (s: string | undefined) => {
  const v = Number(String(s ?? "").replace(/[,+\s]/g, ""));
  return Number.isFinite(v) && String(s ?? "").trim() !== "" && s !== "–" ? v : null;
};
// No progress bars / goal % (user 2026-11-13): the report shows the same figures as the CMR screen.

// Section numbers (01, 02 …) removed from the headings (user 2026-11-13); `no` is kept optional, not shown.
// `asTyped` = the heading keeps its own capitals (long headings) instead of the upper-case style.
function Section({ title, note, asTyped, children }: { no?: string; title: string; note?: string; asTyped?: boolean; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-7">
      <div data-pdf-block className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-3">
          <span className={asTyped ? "text-lg font-extrabold text-[#0B2A5E]" : "text-xl font-extrabold uppercase tracking-[0.12em] text-[#0B2A5E]"}>{title}</span>
        </h2>
        {note && <span className="text-xs italic text-slate-500">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const CmrReportDesignB = forwardRef<HTMLDivElement, CmrReportProps>(function CmrReportDesignB({
  report, monthName, calendarYear, foundation, membership, counts, remarks, uploadedLabel, foundationDates,
}, ref) {
  const groups = groupCmrMeetings(report.meetings);
  const pcts = report.meetings.map((m) => m.attendancePercentage).filter((p): p is number => p != null);
  const avg = pcts.length ? Math.round(pcts.reduce((s, p) => s + Number(p), 0) / pcts.length) : null;
  const projectTypes = Object.keys(CMR_PROJECT_LABELS).filter((k) => (report.projects[k]?.length ?? 0) > 0);
  const projectCount = projectTypes.reduce((s, k) => s + report.projects[k].length, 0);

  const row = (label: string) => membership.find((r) => r.label === label);
  const now = counts.start + counts.added - counts.terminated;
  const target = n(row("Members now")?.yearTarget);
  const july1 = n(row("Members at start")?.ytd);
  const net = n(row("Members now")?.ytd);
  const womenNowRow = row("Women members now"), womenAddRow = row("Women members added");
  const womenNow = n(womenNowRow?.ytd), womenTarget = n(womenNowRow?.yearTarget);

  return (
    <article ref={ref} className="w-[794px] bg-white">
      <div className="h-2 bg-[#0B2A5E]" />
      <div className="px-10 py-8">
        {/* Masthead */}
        <header data-pdf-block className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-500">Club Monthly Report</p>
            <h1 className="mt-2 font-serif text-6xl font-bold leading-none text-[#0B2A5E]">
              {monthName}<span className="ml-3 text-[#F7A81B]">{calendarYear ?? ""}</span>
            </h1>
            <p className="mt-3 text-lg font-semibold text-slate-800">{report.clubName}</p>
            <p className="text-sm text-slate-500">Rotary Year {report.yearLabel} · Assistant Governor {report.assistantGovernor || "N/A"}</p>
          </div>
          <div className={`flex h-28 w-28 shrink-0 rotate-[-8deg] flex-col items-center justify-center rounded-full border-[3px] text-center ${uploadedLabel ? "border-emerald-600 text-emerald-700" : "border-slate-400 text-slate-500"}`}>
            <span className="text-[10px] font-bold uppercase tracking-widest">{uploadedLabel ? "Uploaded" : "Draft"}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{uploadedLabel ? "to District" : "Preview"}</span>
            {uploadedLabel && <span className="mt-1 px-2 text-[9px] leading-tight">{uploadedLabel}</span>}
          </div>
        </header>

        {/* Key figures */}
        <div data-pdf-block className="mt-8 grid grid-cols-4 border-y-2 border-[#0B2A5E]">
          {[
            { v: String(report.meetings.length), l: "Meetings", s: avg != null ? `${avg}% avg attendance` : "none held" },
            { v: usd(foundation.total.month), l: "Foundation", s: foundation.synced ? "from Rotary.org" : "CMR entries" },
            { v: String(projectCount), l: "Projects", s: `${projectTypes.length} service type${projectTypes.length === 1 ? "" : "s"}` },
            { v: String(now), l: "Members", s: `+${counts.added} / −${counts.terminated} this month` },
          ].map((k, i) => (
            <div key={k.l} className={`px-4 py-5 ${i > 0 ? "border-l border-slate-200" : ""}`}>
              <div className="font-serif text-3xl font-bold tabular-nums text-[#0B2A5E]">{k.v}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-700">{k.l}</div>
              <div className="text-xs text-slate-500">{k.s}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-10">
          {/* 01 Meetings */}
          <Section no="01" title="Meetings" note={`${report.meetings.length} this month`}>
            {groups.length === 0 ? <p className="text-sm italic text-slate-500">No meetings this month.</p> : (
              <div className="grid grid-cols-2 gap-4">
                {groups.map((g) => (
                  <div key={g.type} data-pdf-block className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-bold uppercase tracking-wider text-[#0B2A5E]">{g.label}</span>
                      <span className="font-serif text-2xl font-bold text-slate-900">{g.items.length}</span>
                    </div>
                    {g.avgAttendance != null && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[11px] text-slate-500"><span>Avg attendance</span><span className="font-semibold text-slate-800">{g.avgAttendance}%</span></div>
                      </div>
                    )}
                    <ul className="mt-3 divide-y divide-dashed divide-slate-200 text-sm">
                      {g.items.map((m) => (
                        <li key={m.projectId} className="flex items-baseline gap-3 py-1.5">
                          <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">{day(m.projectDate)}</span>
                          <span className="flex-1 text-slate-800">{m.title}</span>
                          <span className="shrink-0 text-xs tabular-nums text-slate-600">
                            {m.attendance ?? "-"}{m.attendancePercentage != null ? ` · ${m.attendancePercentage}%` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 02 Foundation */}
          {/* Foundation = the very same table as the CMR screen (user 2026-11-13). */}
          <Section no="02" title="Foundation" note={foundation.synced ? undefined : "Not synced yet - CMR entries by fund type"}>
            <div data-pdf-block>
              <CmrFoundationTable t={foundation} dates={foundationDates ?? { sync: null, imp: null }} />
            </div>
          </Section>

          {/* 03 Membership */}
          {/* Same "From Rotary.org · Updated from Rotary.org on …" line as the CMR screen (user 2026-11-13). */}
          <Section no="03" title="Membership">
            <div data-pdf-block className="mb-4 rounded-lg bg-slate-50 px-4 py-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#1e3a5f]">From Rotary.org</span>
              <span className="ml-3 text-xs font-semibold text-emerald-700">
                {foundationDates?.member ? `Updated from Rotary.org on ${foundationDates.member}` : "Updated from Rotary.org"}
              </span>
            </div>
            <div data-pdf-block className="flex flex-wrap items-stretch gap-2">
              {[
                { l: `Start · 1 ${monthName.slice(0, 3)}`, v: String(counts.start), c: "bg-slate-50 text-slate-900" },
                { l: "Added", v: `+${counts.added}`, c: "bg-emerald-50 text-emerald-700" },
                { l: "Terminated", v: `−${counts.terminated}`, c: "bg-rose-50 text-rose-700" },
                { l: "Members now", v: String(now), c: "bg-[#0B2A5E] text-white" },
              ].map((x, i, a) => (
                <div key={x.l} className="flex items-center gap-2">
                  <div className={`min-w-[110px] rounded-lg px-4 py-3 ${x.c}`}>
                    <div className="font-serif text-3xl font-bold tabular-nums">{x.v}</div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{x.l}</div>
                  </div>
                  {i < a.length - 1 && <span className="text-xl text-slate-300">→</span>}
                </div>
              ))}
            </div>

            <div data-pdf-block className="mt-6 grid grid-cols-2 gap-6">
              <div>
                <div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-slate-800">Members vs year target</span><span className="text-slate-600">{now} of {target ?? "–"}</span></div>
                <p className="mt-2 text-xs text-slate-500">
                  {july1 != null ? `${july1} on 1 July · ` : ""}net growth {net != null ? `${net > 0 ? "+" : ""}${net}` : "–"} · added this year {row("Members added")?.ytd ?? "–"} · left this year {row("Members terminated")?.ytd ?? "–"}
                  {row("Members added")?.monthTarget ? ` · this month's target +${row("Members added")?.monthTarget}` : ""}
                </p>
              </div>
              {womenNowRow && (
                <div>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-slate-800">Women members vs year target</span><span className="text-slate-600">{womenNow ?? "–"} of {womenTarget ?? "–"}</span></div>
                  <p className="mt-2 text-xs text-slate-500">
                    {womenNowRow.sub} · added this month {womenAddRow?.month ?? "–"} · added this year {womenAddRow?.ytd ?? "–"}
                    {womenAddRow?.monthTarget ? ` · this month's target +${womenAddRow.monthTarget}` : ""}
                  </p>
                </div>
              )}
            </div>
          </Section>

          {/* 04 Projects */}
          <Section no="04" title="Projects" note={`${projectCount} this month`}>
            {projectTypes.length === 0 ? <p className="text-sm italic text-slate-500">No projects this month.</p> : (
              <div className="space-y-5">
                {projectTypes.map((k) => (
                  <div key={k}>
                    <p data-pdf-block className="mb-2 text-sm font-bold uppercase tracking-wider text-[#0B2A5E]">{CMR_PROJECT_LABELS[k]} <span className="text-[#F7A81B]">· {report.projects[k].length}</span></p>
                    <div className="grid grid-cols-2 gap-3">
                      {report.projects[k].map((p) => (
                        <div key={p.projectId} data-pdf-block className="rounded-lg border-l-4 border-[#F7A81B] bg-slate-50 px-4 py-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-semibold text-slate-900">{p.title}</span>
                            <span className="shrink-0 text-xs font-semibold text-slate-500">{day(p.projectDate)}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {[p.areaOfFocusName].filter(Boolean).map((c) => (
                              <span key={c} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{c}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Above club level - heading = the CMR's own field name (user 2026-11-13) */}
          <Section no="05" asTyped title="Additional achievement / participation / hosting of events / projects above club level">
            <blockquote data-pdf-block className="border-l-4 border-[#0B2A5E] bg-slate-50 px-5 py-4 font-serif text-base italic leading-relaxed text-slate-700 whitespace-pre-wrap">
              {remarks?.trim() || "No additional achievement, participation or hosting above club level this month."}
            </blockquote>
          </Section>
        </div>

        <p data-pdf-block className="mt-10 border-y border-[#0B2A5E] py-3 text-center font-serif text-[13px] italic text-slate-700">
          <span className="not-italic font-bold uppercase tracking-widest text-[#0B2A5E]">Note · </span>{CMR_DISTRICT_NOTE}
        </p>

        <footer data-pdf-block className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500">
          <span>{report.preparedBy ? `Prepared by ${report.preparedBy}${report.designation ? `, ${report.designation}` : ""}` : ""}</span>
          <span>{uploadedLabel ? `Uploaded to District: ${uploadedLabel}` : "Preview - not submitted to the district"}</span>
        </footer>
      </div>
    </article>
  );
});

export default CmrReportDesignB;
