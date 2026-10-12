"use client";

// Standalone route — /district-admin-dashboard/district-committee/groups.
// The reusable listing lives in ./view (GroupCommitteeView) so the District
// Committee landing can embed it directly below the master committee listing.
import { GroupCommitteeView } from "./view";

export default function DistrictAdminDashboardGroupCommitteePage() {
  return <GroupCommitteeView />;
}
