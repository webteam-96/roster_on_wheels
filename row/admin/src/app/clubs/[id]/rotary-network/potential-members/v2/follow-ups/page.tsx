"use client";

// The club's prospect follow-up tasks and its new-prospect notification settings (feature contacts_growth).
// Tasks are added on each prospect's edit page.

import { PageHeader } from "@/components/row/AppKit";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useFeatureOn } from "@/components/FeatureGate";
import { CONTACTS_FEATURE } from "@/lib/contacts";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import ProspectTasksPanel from "@/components/contacts/ProspectTasksPanel";
import ProspectNotifySettingsCard from "@/components/contacts/ProspectNotifySettingsCard";

export default function ProspectFollowUpsPage() {
  useSyncClubIdFromUrl();
  const clubId = Number(useParams().id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  const on = useFeatureOn(CONTACTS_FEATURE);

  return (
    <ProtectedRoute>
      <ClubAdminShell pageTitle="Prospect follow-ups" pageSubtitle="Tasks and notifications" activeNavHref="/club-admin-dashboard/dashboard">
        <div className="space-y-5">
          <PageHeader title="Prospect follow-ups" description="Members see their tasks in the app, get a reminder before the due date and mark them done there." back={`/clubs/${clubId}/rotary-network/potential-members/v2`} />
          {on ? (
            <>
              <ProspectTasksPanel clubId={clubId} canManage={canManage} />
              <ProspectNotifySettingsCard clubId={clubId} canManage={canManage} />
            </>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
              Follow-ups are part of the prospect pipeline, which is switched off.
            </p>
          )}
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
