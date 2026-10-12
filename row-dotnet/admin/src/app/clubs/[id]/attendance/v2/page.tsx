"use client";

import { AttendanceV2View } from "./view";

// Route entrypoint — thin wrapper (see ./view for the actual UI). AttendanceV2View
// is also imported by the Club Admin E-Governance page to render this inline.
export default function AttendanceV2Page() {
  return <AttendanceV2View />;
}
