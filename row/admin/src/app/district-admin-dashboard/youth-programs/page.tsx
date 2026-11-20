"use client";

/** District Admin Dashboard › Youth Programs (flagged module "youth_programs"): components/youth/YouthPrograms.tsx. */

import { useAuth } from "@/contexts/AuthContext";
import YouthPrograms from "@/components/youth/YouthPrograms";

export default function DistrictYouthProgramsPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return <YouthPrograms key={districtId} scope={{ kind: "districts", id: districtId }} />;
}
