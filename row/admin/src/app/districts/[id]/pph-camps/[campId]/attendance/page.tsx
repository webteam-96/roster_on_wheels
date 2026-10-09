"use client";

import { useParams } from "next/navigation";
import PphAttendeesManager from "@/components/pph/PphAttendeesManager";

export default function DistrictPphAttendancePage() {
  const params = useParams();
  const districtId = Number(params.id);
  const campId = Number(params.campId);
  return <PphAttendeesManager scope="district" scopeId={districtId} campId={campId} />;
}
