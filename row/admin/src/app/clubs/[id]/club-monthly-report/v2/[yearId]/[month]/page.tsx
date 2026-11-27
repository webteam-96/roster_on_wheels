"use client";

/**
 * Club Monthly Report v2 — 4-step wizard (Meetings → TRF → Projects → Members).
 *
 * Visual chrome rebuilt on the v2 design language (dot-accented section cards,
 * slate-toned chips, sticky bottom action bar). Underlying data flow is
 * identical to v1: every API call, every validation, every deep-link target.
 *
 * Deep-links to module add/edit pages prefer v2 paths where they exist (TRF,
 * club-service, community-service, vocational-service, international-service,
 * new-generation-service, public-image-initiative). frozenMonth / frozenYearId
 * are propagated so the launched form locks its date input to the wizard
 * month. The TRF v2 listing uses ?from=cmr&yearId=&month= instead — also v2.
 *
 * v2 reads ONLY `?returnTo=` — the value propagates back to the e-Gov tab on
 * success / cancel via V2FormShell's useV2ReturnTo() helper. Step index is
 * still read from `?step=meetings|trf|projects|members` so sub-pages can
 * return the user to the tab they came from.
 */
import { PageHeader } from "@/components/row/AppKit";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useMonthlyReportWizard } from "./useMonthlyReportWizard";
import WizardStepper from "./WizardStepper";
import StepMeetings from "./StepMeetings";
import StepTrf from "./StepTrf";
import StepProjects from "./StepProjects";
import StepMembers from "./StepMembers";
import WizardFooter from "./WizardFooter";
import { MONTH_NAMES } from "./monthlyReportWizardShared";

// ── Main component ─────────────────────────────────────────────────────────

function ClubMonthlyReportV2WizardInner() {
  const h = useMonthlyReportWizard();
  const { loading, clubName, month, cmrLandingHref, error, setError } = h;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RotaryLoader />
      </div>
    );
  }
  const v = h;

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader title="Monthly Report" description={<>{clubName || "–"} · {MONTH_NAMES[month] || `Month ${month}`}</>} back={cmrLandingHref} />

      {/* Step indicator */}
      <WizardStepper v={v} />

      <ErrorAlert
        open={!!error}
        title="Error"
        description={error || ""}
        onOk={() => setError(null)}
      />

      {/* Step content */}
      <StepMeetings v={v} />

      <StepTrf v={v} />

      <StepProjects v={v} />

      <StepMembers v={v} />

      {/* Sticky bottom action bar */}
      <WizardFooter v={v} />
    </div>
  );
}

export default function ClubMonthlyReportV2WizardPage() {
  useSyncClubIdFromUrl();
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Monthly Report Wizard"
        pageSubtitle="Meetings, TRF, projects and members"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        <ClubMonthlyReportV2WizardInner />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
