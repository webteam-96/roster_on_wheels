"use client";

// The placeholder shown wherever Club Goal Setting used to appear (user 2026-10-01).
// One component so every surface reads identically — see lib/clubGoalSetting.ts for the switch.

import { Clock } from "lucide-react";
import { CLUB_GOAL_COMING_SOON_TEXT, CLUB_GOAL_COMING_SOON_TITLE } from "@/lib/clubGoalSetting";

export default function ClubGoalComingSoon({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
        <Clock size={12} /> {CLUB_GOAL_COMING_SOON_TITLE}
      </span>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="h-12 w-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-3">
        <Clock size={22} className="text-amber-600" />
      </div>
      <p className="text-base font-semibold text-slate-800">{CLUB_GOAL_COMING_SOON_TITLE}</p>
      <p className="text-sm text-slate-500 mt-1 max-w-md">{CLUB_GOAL_COMING_SOON_TEXT}</p>
    </div>
  );
}
