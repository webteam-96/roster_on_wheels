"use client";

// RCC goals of ONE club / district as a table (user 2026-11-20): Category | Question | Goal | Achieved | %.
// Same look as the RCC Goals overview table (GoalOversightMatrixRotary), for the club goals page.

import { Table } from "@/components/ui/table";
import { Fragment } from "react";
import {
  sectionHeading, categoryShortName, overviewLabel, cardSourceNote, isRotaryOnlyCard, dayLabel, asOnWording, RAG_BANDS,
  type SectionView, type SectionCard,
} from "@/lib/goalRotaryLayout";
import { RCC_ROTARY_TARGET_KEYS } from "@/lib/rccGoals";
import type { GoalFieldWithValueDto } from "@/types/goalSetting";

const ragFill = (p: number) => `var(--go-rag-${p <= 10 ? "red" : p <= 25 ? "yellow" : p <= 50 ? "orange" : p <= 100 ? "blue" : "purple"})`;
const fmt = (f: GoalFieldWithValueDto | undefined) => {
  if (!f) return "—";
  if (f.dataType === "Boolean") return f.boolValue == null ? "—" : f.boolValue ? "YES" : "NO";
  if (f.numericValue == null) return "—";
  const s = Number(f.numericValue).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return f.dataType === "Currency" ? `$${s}` : s;
};
const noteOf = (g: SectionCard) => {
  const n = cardSourceNote(g, null);
  if (n || !isRotaryOnlyCard(g)) return asOnWording(n);
  const d = dayLabel(g.form.rotaryOrgUpdatedAt);
  return d ? `Updated from Rotary.org as on ${d}` : "Updated from Rotary.org";
};

export default function RccGoalsTable({ sections, headingExtras }: {
  sections: SectionView[];
  /** Shown on the right of a section's heading bar (e.g. Membership's Quarterly / Month-wise, user 2026-11-20). */
  headingExtras?: (s: SectionView) => React.ReactNode;
}) {
  const th = "border-b border-r border-go-border-strong last:border-r-0 bg-go-sunken px-3 py-3 text-go-label font-bold uppercase tracking-wide text-go-text-secondary";
  const td = "border-b border-r border-go-border last:border-r-0 px-3 py-2.5 align-top";
  const numTd = `${td} text-right tabular-nums whitespace-nowrap font-semibold text-go-navy-900`;
  const row = (key: string, category: string, title: string, note: string | null, extra: React.ReactNode, goal: string, achieved: string, pct: number | null) => (
    <tr key={key}>
      <td className={`${td} font-semibold text-go-navy-700`}>{category}</td>
      <td className={`${td} text-go-text-primary`}>
        <div className="font-semibold leading-snug">{title}</div>
        {note && <div className="text-go-meta text-go-text-secondary">{note}</div>}
        {extra}
      </td>
      <td className={`${numTd} bg-go-navy-50`}>{goal}</td>
      <td className={`${numTd} bg-go-sunken`}>{achieved}</td>
      <td className={`${numTd} bg-go-navy-50`}>
        {pct == null ? "—" : (
          <span className="inline-flex items-center gap-1.5 font-bold">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ragFill(pct) }} />
            {pct.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%
          </span>
        )}
      </td>
    </tr>
  );

  if (sections.length === 0) return <p className="p-6 text-go-body text-go-text-muted">No RCC goals for this club.</p>;
  return (
    <section className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-x-auto">
      <Table bare className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-go-body">
        <colgroup><col className="w-[17%]" /><col /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[9%]" /></colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={`${th} text-left`}>Category</th>
            <th className={`${th} text-left`}>Question</th>
            <th className={`${th} text-right`}>Goal</th>
            <th className={`${th} text-right`}>Achieved</th>
            <th className={`${th} text-right`}>%</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <Fragment key={s.key}>
              <tr><td colSpan={5} className="border-b border-go-border-strong bg-go-navy-900 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-go-title font-bold text-white">{sectionHeading(s)}</span>
                  {headingExtras?.(s)}
                </div>
              </td></tr>
              {s.cards.map((g) => {
                const category = categoryShortName(g.form.categoryId, g.form.categoryName);
                const note = noteOf(g);
                if (g.fields.some((f) => f.fieldKey.startsWith("rag5_"))) {
                  const vals = RAG_BANDS.map((b) => Number(g.fields.find((f) => f.fieldKey === b.key)?.numericValue ?? 0));
                  return row(g.name, category, g.name, note, (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-go-meta text-go-text-primary">
                      {RAG_BANDS.map((b, i) => <span key={b.key} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-go-sm" style={{ background: b.color }} />{b.label}: <b>{vals[i]}</b></span>)}
                    </div>
                  ), "—", `${vals.reduce((a, b) => a + b, 0).toLocaleString("en-IN")} clubs`, null);
                }
                const pf = g.fields.find((f) => f.dataType === "Percentage");
                const gf = g.fields.find((f) => f.fieldRole === "Target" || RCC_ROTARY_TARGET_KEYS.has(f.fieldKey) || /_target$/.test(f.fieldKey));
                const af = g.fields.find((f) => f !== gf && f !== pf && (/achiev/i.test(f.fieldKey) || /achiev/i.test(f.fieldLabel)));
                // No goal / achieved pair (e.g. Summary): each figure on its own row, under Achieved.
                if (!gf && !af) return (
                  <Fragment key={g.name}>
                    {g.fields.filter((f) => f !== pf).map((f) => row(`${g.name}-${f.fieldId}`, category, `${g.name}: ${overviewLabel(f.fieldLabel)}`, note, null, "—", fmt(f), null))}
                  </Fragment>
                );
                const goal = gf?.numericValue != null ? Number(gf.numericValue) : null;
                const ach = af?.numericValue != null ? Number(af.numericValue) : null;
                const p = pf?.numericValue != null ? Number(pf.numericValue) : goal && goal > 0 && ach != null ? (ach / goal) * 100 : null;
                return row(g.name, category, g.name, note, null, fmt(gf), fmt(af), p);
              })}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
