"use client";

import { ClubCitationV2View } from "./view";

// Route entrypoint — thin wrapper (see ./view for the actual UI). ClubCitationV2View
// is also imported by the Club Admin E-Governance page to render this inline.
export default function ClubCitationV2Page() {
  return <ClubCitationV2View />;
}
