"use client";

// Route entry for /districts/[id]/zonal-awards. The full module lives in ./view as a named,
// embeddable export (DistrictZonalAwardsView) so the District Admin E-Governance dashboard can
// render it inline in a tab. This default export stays prop-less so Next's PageProps check passes.
import { DistrictZonalAwardsView } from "./view";

export default function DistrictZonalAwardsPage() {
  return <DistrictZonalAwardsView />;
}
