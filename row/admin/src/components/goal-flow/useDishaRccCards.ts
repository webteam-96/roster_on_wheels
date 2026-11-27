"use client";

// Disha (user 2026-11-18): each district's Goal Setting / RCC cards (the same forms goal-overviews-rotary loads),
// a few districts at a time. Used by the Overview and the Set Goals tab.

import { useEffect, useState } from "react";
import { getGoalCategories, getDistrictGoalForm, getGoalSourceDates, type GoalSourceDates } from "@/services/api";
import { withRag, withRotaryFields, isFutureYearLabel, type SectionKey, type SectionCard } from "@/lib/goalRotaryLayout";
import { dishaCards } from "@/lib/dishaRccGoals";
import type { GoalCategoryDto } from "@/types/goalSetting";

export type DistrictCards = { cards: Record<SectionKey, SectionCard[]>; dates: GoalSourceDates | null };

let catsOnce: Promise<GoalCategoryDto[]> | null = null;

export function useDishaRccCards(districtIds: number[] | null, yearId: number | null, yearLabel?: string | null) {
  const [byDistrict, setByDistrict] = useState<Record<number, DistrictCards>>({});
  const key = districtIds ? districtIds.join(",") : "";
  const future = isFutureYearLabel(yearLabel ?? null);

  useEffect(() => {
    if (!districtIds || !yearId) return;
    let cancelled = false;
    setByDistrict({});
    (async () => {
      catsOnce ??= getGoalCategories().catch((e) => { catsOnce = null; throw e; });
      let cats: GoalCategoryDto[] = [];
      try { cats = await catsOnce; } catch { return; }
      const queue = [...districtIds];
      const worker = async () => {
        for (let id = queue.shift(); id != null && !cancelled; id = queue.shift()) {
          const [res, dates] = await Promise.all([
            Promise.allSettled(cats.map(async (c) => withRag(withRotaryFields(await getDistrictGoalForm(c.id, yearId, id))))),
            getGoalSourceDates(yearId, id, null).catch(() => null),
          ]);
          const forms = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
          if (!cancelled) setByDistrict((s) => ({ ...s, [id]: { cards: dishaCards(forms, future), dates } }));
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, yearId, future]);

  const ready = !!districtIds && districtIds.length > 0 && districtIds.every((id) => byDistrict[id]);
  return { byDistrict, ready };
}
