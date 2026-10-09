"use client";

import { ClubReportV2PageImpl } from "./view";

// Route entrypoint — thin wrapper (see ./view for the actual UI). ClubReportV2PageImpl
// is also imported by the Club Admin E-Governance page to render this inline.
export default function ClubReportV2Page() {
  return <ClubReportV2PageImpl />;
}
