"use client";

/** Club Admin Dashboard › Youth Programs (flagged module "youth_programs"): components/youth/YouthPrograms.tsx. */

import { useAuth } from "@/contexts/AuthContext";
import YouthPrograms from "@/components/youth/YouthPrograms";

export default function ClubYouthProgramsPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return <YouthPrograms key={clubId} scope={{ kind: "clubs", id: clubId }} />;
}
