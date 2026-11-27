"use client";

// RCC Goals - one club's goals for the District Admin (ported from RIZones rcc/clubs/goals 2026-11-27): the table
// design (RccGoalsTable), read only. District Admin club form + the RCC transform, Quarterly / Month-wise of
// Membership / Foundation on their section's heading bar. ?clubId=&club=<name>[&yearId=]

import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { saveAs } from "file-saver";
import { ArrowLeft, Download } from "@/components/icons";
import { SkeletonRows } from "@/components/row/AppKit";
import RccGoalsTable from "@/components/RccGoalsTable";
import GoalTargetSplitPanelRotary from "@/components/dashboard/GoalTargetSplitPanelRotary";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { fileTimestamp } from "@/lib/dateUtils";
import { getGoalCategories, getClubGoalForm, getClubMonthlyGoals, type GoalMonthlyForm } from "@/services/api";
import { downloadRotaryClubReport } from "@/services/goalFlowApi";
import { withRotaryFields, withRag, buildSections, SECTION_CATEGORY_ID, type SectionView } from "@/lib/goalRotaryLayout";
import { isRccRotaryCard, rccOnlyTransform, rccOnlyMonthly, rccCardTitle } from "@/lib/rccGoals";

const SPLIT_CATEGORIES = [1, 210];

export default function DistrictRccClubGoalsPage() {
  const sp = useSearchParams();
  const clubId = Number(sp.get("clubId")) || 0;
  const club = sp.get("club") ?? "Club";
  const yearId = sp.get("yearId") ? Number(sp.get("yearId")) : null;
  const yq = yearId ? `yearId=${yearId}` : "";

  const [sections, setSections] = useState<SectionView[] | null>(null);
  const [yearLabel, setYearLabel] = useState<string | null>(null);
  const [monthly, setMonthly] = useState<Record<number, GoalMonthlyForm>>({});
  const [error, setError] = useState<string | null>(null);
  const dl = useDownloadProgress();

  useEffect(() => {
    if (!clubId) { setError("No club picked."); return; }
    let cancelled = false;
    setSections(null); setError(null);
    (async () => {
      try {
        const cats = await getGoalCategories();
        const res = await Promise.allSettled(cats.map(async (c) => rccOnlyTransform(await withRag(withRotaryFields(await getClubGoalForm(c.id, yearId, clubId))))));
        const forms = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (forms.length === 0) throw new Error();
        if (cancelled) return;
        setYearLabel(forms[0].yearLabel);
        setSections(buildSections(forms, (_f, x) => x.dataType === "Text")
          .map((s) => ({ ...s, cards: s.cards.filter(isRccRotaryCard).map((c) => ({ ...c, name: rccCardTitle(c.name) })) }))
          .filter((s) => s.cards.length > 0));
      } catch { if (!cancelled) setError("Failed to load the club's goals."); }
    })();
    Promise.allSettled(SPLIT_CATEGORIES.map((c) => getClubMonthlyGoals(c, yearId, clubId))).then((res) => {
      if (cancelled) return;
      const next: Record<number, GoalMonthlyForm> = {};
      res.forEach((r, i) => { if (r.status === "fulfilled") next[SPLIT_CATEGORIES[i]] = rccOnlyMonthly(r.value); });
      setMonthly(next);
    });
    return () => { cancelled = true; };
  }, [clubId, yearId]);

  const report = () => dl.run("r", async () => {
    try { saveAs(await downloadRotaryClubReport(clubId, yearId, true), `RCC_Club_Goals_${club.replace(/\s+/g, "_")}_${fileTimestamp()}.xlsx`); }
    catch { setError("Could not download the report."); }
  });
  const splitOf = (s: SectionView) => {
    const m = monthly[SECTION_CATEGORY_ID[s.key]];
    return m && m.fields.length > 0 ? <GoalTargetSplitPanelRotary form={m} readOnly noLabel onDownload={report} reloadKey={`${clubId}-${m.categoryId}`} /> : null;
  };

  return (
    <div className="space-y-4">
      <Link href={`/district-admin-dashboard/rcc/clubs${yq ? `?${yq}` : ""}`} className="inline-flex items-center gap-1.5 text-go-body font-semibold text-go-navy-700 hover:underline">
        <ArrowLeft size={15} /> Back to all clubs
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-go-kpi font-bold text-go-navy-900">{club}</h2>
          <div className="text-go-body text-go-text-secondary">RCC goals{yearLabel ? ` · RY ${yearLabel}` : ""}</div>
        </div>
        <Button type="button" onClick={report} disabled={dl.busy || !sections}>
          {dl.is("r") ? dl.bar("r") : <><Download size={15} /> Report</>}
        </Button>
      </div>
      {error && <div className="rounded-go-md border border-go-danger-600 bg-go-danger-50 p-4 text-go-body text-go-danger-600">{error}</div>}
      {!sections && !error && <SkeletonRows rows={6} />}
      {sections && <RccGoalsTable sections={sections} headingExtras={splitOf} />}
    </div>
  );
}
