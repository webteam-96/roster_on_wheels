"use client";

// The club's prospect follow-up tasks and its new-prospect notification settings (feature contacts_growth).
// Tasks are added on each prospect's edit page.

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
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
          <div className="flex items-start gap-2">
            <Link href={`/clubs/${clubId}/rotary-network/potential-members/v2`} aria-label="Back"
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Prospect follow-ups</h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Members see their tasks in the app, get a reminder before the due date and mark them done there.
              </p>
            </div>
          </div>
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
