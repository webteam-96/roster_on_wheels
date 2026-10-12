"use client";

// Standalone route — /district-admin-dashboard/district-committee/committee.
// The reusable listing lives in ./view (CommitteeMembersView) so the District
// Committee landing can embed it directly above the Group Committee listing.
import { CommitteeMembersView } from "./view";

export default function DistrictAdminDashboardCommitteeMembersPage() {
  return <CommitteeMembersView />;
}
