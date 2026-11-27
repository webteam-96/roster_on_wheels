"use client";

/**
 * DistrictAwardsModule — reusable full District Awards admin module.
 *
 * Renders the 5-tab management UI (Categories, Description, Auto Questions,
 * Manual Questions, Club Points) that used to live in the V2 standalone page.
 * Now consumed by both:
 *   - /districts/[id]/citation/v2  (standalone admin page with SectionHeader)
 *   - /district-admin-dashboard/egovernance  (District Awards sub-tab)
 *
 * Does NOT render an outer page header or back navigation — the host page
 * owns those. It DOES own the year picker, the 4-KPI strip, the tab bar,
 * all tab bodies, and all dialogs.
 *
 * Integer-only inputs (step="1" + intOnly strip) and integer-only displays
 * (fmtInt / Math.round) — no decimals anywhere.
 */

import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { FolderOpen, Trophy, Sparkles, ClipboardList } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import { useDistrictAwards, DistrictAwardsModuleProps } from "./useDistrictAwards";
import DistrictAwardsTabs from "./DistrictAwardsTabs";
import DistrictAwardsDialogs from "./DistrictAwardsDialogs";


// fetchEntryLabels: "Auto Fetch" / "Manual Entry" names - District Set Goals only (user 2026-11-18); District Awards unchanged.
// rccPointsTab: District Set Goals only (user 2026-11-23) - "RCC Set Points" tab before Auto Fetch Question; District Awards unchanged.
export default function DistrictAwardsModule(props: DistrictAwardsModuleProps) {
  const r = useDistrictAwards(props);
  const { fe, canManage, editableYears, loading, successMessage, setSuccessMessage, errorMessage, setErrorMessage, isPastYear, holdsSelectedYear, categories, autoQuestions, manualCriteria, clubPoints } = r;

  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  // Configuration (categories / questions / criteria) is ALWAYS editable — the activation flag
  // only gates CLUB point entry. So there's no "Coming soon" block here; instead a disabled
  // notice (below) explains the state while the admin keeps building the awards.
  const kpiCategories = categories.length;
  const kpiAuto = autoQuestions.length;
  const kpiManual = manualCriteria.length;
  const kpiClubs = clubPoints.length;

  return (
    <div className="space-y-6">
      {/* Only when the YEAR RIGHTS are the reason. A past year is already
          read-only for every admin, and blaming that on their years would
          send them looking for a permission problem that isn't there. */}
      {canManage && !isPastYear && !holdsSelectedYear && (
        <ViewOnlyBadge editableYears={editableYears} />
      )}

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      {/* Year picker removed — District Awards always uses the global (current)
          rotary year. add/edit/delete stay gated to the current year. */}

      {/* ── Top KPI tiles ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Categories" value={fmtInt(kpiCategories)} subtitle="Main award groups" icon={FolderOpen} color="blue" />
        <KpiCard title={fe ? "Auto Fetch" : "Auto Questions"} value={fmtInt(kpiAuto)} subtitle="System-scored" icon={Sparkles} color="purple" />
        <KpiCard title={fe ? "Manual Entry" : "Manual Criteria"} value={fmtInt(kpiManual)} subtitle="Admin-entered" icon={ClipboardList} color="gold" />
        <KpiCard title="Clubs Reported" value={fmtInt(kpiClubs)} subtitle="With points this RY" icon={Trophy} color="green" />
      </div>

      <DistrictAwardsTabs r={r} />

      <DistrictAwardsDialogs r={r} />
    </div>
  );
}

