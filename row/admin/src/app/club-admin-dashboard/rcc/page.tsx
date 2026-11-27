"use client";

// RCC Goals - Club Admin (user 2026-11-18): the SAME screen as Club Goals (goal-setting-rotary - 4 Rotary.org tabs,
// Sync from Rotary.org, Report) showing ONLY the 26 Rotary.org goals, read only for everyone (they come from
// Rotary.org). Super Admin only until tested (menu item superAdminOnly).

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "@/components/icons";
import { saveAs } from "file-saver";
import { useAuth } from "@/contexts/AuthContext";
import { fileTimestamp } from "@/lib/dateUtils";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import RotaryOrgSync from "@/components/goal-rotary/RotaryOrgSync";
import RccGoalsTable from "@/components/RccGoalsTable";
import GoalTargetSplitPanelRotary from "@/components/dashboard/GoalTargetSplitPanelRotary";
import type { GoalMonthlyForm } from "@/services/api";
import { rccCardTitle, rccOnlyTransform, rccOnlyMonthly, isRccRotaryCard } from "@/lib/rccGoals";
import { dayLabel, withRag, withRotaryFields, buildSections, type SectionView, SECTION_CATEGORY_ID } from "@/lib/goalRotaryLayout";
import { getGoalCategories, getClubGoalForm, getClubMonthlyGoals } from "@/services/api";
import { downloadRotaryClubReport } from "@/services/goalFlowApi";
import type { GoalCategoryFormDto } from "@/types/goalSetting";

export default function ClubRccGoalsPage() {
  return <ClubRcc />;
}

function ClubRcc() {
  const { selectedClubId } = useAuth();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const { currentYearId } = useRotaryYears();
  const viewingYearId = yearId ?? currentYearId;
  const [forms, setForms] = useState<GoalCategoryFormDto[]>([]);   // loaded below, for the subtitle / report
  const [syncTick, setSyncTick] = useState(0);
  // Latest "Updated from Rotary.org" date over the 4 tabs.
  const updatedOn = dayLabel(forms.map((f) => f.rotaryOrgUpdatedAt).filter((d): d is string => !!d).sort().pop() ?? null);
  const onSynced = useCallback(() => setSyncTick((t) => t + 1), []);

  const fetchForm = useCallback((categoryId: number): Promise<GoalCategoryFormDto> =>
    getClubGoalForm(categoryId, yearId, selectedClubId), [selectedClubId, yearId]);

  // Quarterly / Month-wise - same box as District / Club Goals, only the Rotary.org-goal rows, read only.
  const [monthly, setMonthly] = useState<Record<number, GoalMonthlyForm>>({});
  useEffect(() => {
    if (!selectedClubId) { setMonthly({}); return; }
    let cancelled = false;
    Promise.allSettled([1, 210].map((c) => getClubMonthlyGoals(c, yearId, selectedClubId)))
      .then((res) => {
        if (cancelled) return;
        const next: Record<number, GoalMonthlyForm> = {};
        res.forEach((r, i) => { if (r.status === "fulfilled") next[[1, 210][i]] = rccOnlyMonthly(r.value); });
        setMonthly(next);
      });
    return () => { cancelled = true; };
  }, [selectedClubId, yearId, syncTick]);

  const dl = useDownloadProgress();
  const downloadReport = () => dl.run("report", async () => {
    const clubId = forms[0]?.clubId ?? selectedClubId;
    if (!clubId) return;
    try { saveAs(await downloadRotaryClubReport(clubId, forms[0]?.yearId ?? yearId, true), `RCC_Club_Goals_${fileTimestamp()}.xlsx`); } catch { /* try again */ }
  });

  // Table design (user 2026-11-20), same as the RCC Goals oversight pages: Category | Question | Goal | Achieved | %.
  const [sections, setSections] = useState<SectionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedClubId) { setSections(null); return; }
    let cancelled = false;
    setSections(null); setError(null);
    (async () => {
      try {
        const cats = await getGoalCategories();
        // Same forms as before: Goal Setting boxes + RAG bands, then the RCC transform (Rotary.org goals, RCC cards only).
        const res = await Promise.allSettled(cats.map(async (c) => rccOnlyTransform(await withRag(withRotaryFields(await fetchForm(c.id))))));
        const loaded = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (loaded.length === 0) throw new Error();
        if (cancelled) return;
        setForms(loaded);
        setSections(buildSections(loaded, (_f, x) => x.dataType === "Text")
          .map((s) => ({ ...s, cards: s.cards.filter(isRccRotaryCard).map((c) => ({ ...c, name: rccCardTitle(c.name) })) }))
          .filter((s) => s.cards.length > 0));
      } catch { if (!cancelled) setError("Failed to load the RCC goals."); }
    })();
    return () => { cancelled = true; };
  }, [fetchForm, selectedClubId, syncTick]);
  // Same height and corners as the Sync button next to it.
  const reportBtn = (
    <Button type="button" onClick={downloadReport} disabled={dl.busy || forms.length === 0}>
      {dl.is("report") ? dl.bar("report") : <><Download size={15} /> Report</>}
    </Button>
  );
  const title = (
    <div className="min-w-0">
      <h2 className="text-go-kpi font-bold text-go-navy-900">RCC Goals</h2>
      <div className="text-go-body text-go-text-secondary">{forms[0] ? `${forms[0].entityName} · RY ${forms[0].yearLabel}` : "Synced from Rotary.org, read only."}</div>
    </div>
  );
  // Membership / Foundation Quarterly + Month-wise on their section's heading bar (user 2026-11-20).
  const splitOf = (s: SectionView) => {
    const m = monthly[SECTION_CATEGORY_ID[s.key]];
    return m && m.fields.length > 0
      ? <GoalTargetSplitPanelRotary form={m} readOnly noLabel onDownload={downloadReport} reloadKey={`${m.categoryId}-${yearId ?? "cur"}`} />
      : null;
  };

  return (
    <div className="space-y-4">
      {/* Header (user 2026-11-20): title + club / year left, Sync from Rotary.org + Report right, one line;
          the info text under them in one yellow alert. */}
      {selectedClubId ? (   // every year: the server decides who may sync that year (user 2026-11-23)
        <RotaryOrgSync yearId={yearId} clubId={selectedClubId} tone="light" onSynced={onSynced} alert lead={title} actions={reportBtn} />
      ) : (
        <div className="flex flex-col items-stretch gap-2">
          <div className="flex flex-wrap items-center gap-2.5">{title}<span className="flex-1" />{reportBtn}</div>
          {updatedOn && <p className="rounded-go-md border border-amber-300 bg-amber-50 px-4 py-3 text-go-body font-semibold text-amber-900">Updated from Rotary.org as on {updatedOn}</p>}
        </div>
      )}
      {!selectedClubId && <p className="p-6 text-go-body text-go-text-muted">Select a club.</p>}
      {error && <div className="rounded-go-md border border-go-danger-600 bg-go-danger-50 p-4 text-go-body text-go-danger-600">{error}</div>}
      {selectedClubId && !sections && !error && <div className="p-6 flex items-center gap-2 text-go-body text-go-text-muted"><Loader2 size={14} className="animate-spin" /> Loading goals…</div>}
      {sections && <RccGoalsTable sections={sections} headingExtras={splitOf} />}
    </div>
  );
}
