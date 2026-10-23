"use client";

/** Club Admin Dashboard › Engagement: spotlight cards for the club's milestones and new Paul Harris Fellows (build list #26-#28). */

import { useSelectedClub } from "@/contexts/AuthContext";
import EngagementPanel from "@/components/engagement/EngagementPanel";

export default function ClubEngagementPage() {
  const club = useSelectedClub();
  if (!club) return <p className="text-sm text-slate-500">No club selected.</p>;
  return <EngagementPanel scope="clubs" scopeId={club.id} />;
}
