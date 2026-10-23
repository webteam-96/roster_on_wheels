"use client";

/** Club Admin Dashboard › Foundation designations: members of the club with designation X (build spec 3.12). */

import { useSelectedClub } from "@/contexts/AuthContext";
import FoundationDesignationsReport from "@/components/membership/FoundationDesignationsReport";

export default function ClubFoundationDesignationsPage() {
  const club = useSelectedClub();
  if (!club) return <p className="text-sm text-slate-500">No club selected.</p>;
  return <FoundationDesignationsReport scope="clubs" scopeId={club.id} />;
}
