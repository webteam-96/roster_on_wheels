"use client";

import { OcvCategoryV2View } from "./view";

// Route entrypoint — a thin wrapper so the page's default export stays
// PageProps-compatible. The real UI lives in ./view (OcvCategoryV2View), which
// the Club Admin E-Governance page also imports to embed a single category
// (e.g. "dues") inline as its own tab.
export default function OcvCategoryV2Page() {
  return <OcvCategoryV2View />;
}
