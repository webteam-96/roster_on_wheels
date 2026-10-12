"use client";

/**
 * District Committee — single-page landing (no 2-box chooser, no page header).
 *
 * Flow (per user):
 *   1. Master District Committee listing on top (its own Add + Search).
 *   2. Group Committee listing directly below (its own Add + Search).
 *   3. Clicking a group navigates into its sub-groups page (groups/[groupId]).
 *
 * Both listings are the reusable *View components (embedded) from the committee/
 * and groups/ routes — same behaviour, just stacked here.
 */

import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";
import { CommitteeMembersView } from "./committee/view";
import { GroupCommitteeView } from "./groups/view";

export default function DistrictAdminDashboardCommitteeLandingPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null; // wait for auth

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <DistrictMembershipTabBar />

        {/* 1. Master District Committee listing (its own Add + Search). */}
        <CommitteeMembersView embedded />

        <div className="border-t border-slate-200" />

        {/* 2. Group District Committee listing (its own Add + Search). Groups drill into sub-groups. */}
        <h2 className="text-lg font-bold tracking-tight text-[#1e3a5f]">Group District Committee</h2>
        <GroupCommitteeView embedded />
      </div>
    </ProtectedRoute>
  );
}
