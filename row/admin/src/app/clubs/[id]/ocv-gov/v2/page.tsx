"use client";

import { OcvGovV2View } from "./view";

// Route entrypoint — a thin wrapper so the page's default export stays
// PageProps-compatible. The real UI lives in ./view (OcvGovV2View), which the
// Club Admin E-Governance page also imports to render this module inline.
export default function OcvGovV2Page() {
  return <OcvGovV2View />;
}
