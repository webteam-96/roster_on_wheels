"use client";

import { useFeatureOn } from "@/components/FeatureGate";
import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ClipboardList } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import SectionHeader from "@/components/dashboard/SectionHeader";
// Live module views rendered inline (embedded) so each tab opens its module's
// data in-place instead of navigating away — same UX as the Communication tab.
// These are named exports from sibling `view.tsx` files (the route `page.tsx`
// default exports stay prop-less so Next's PageProps check passes).
import { ClubMonthlyReportV2View } from "@/app/clubs/[id]/club-monthly-report/v2/view";
import { OcvGovV2View } from "@/app/clubs/[id]/ocv-gov/v2/view";
import { OcvCategoryV2View } from "@/app/clubs/[id]/ocv-gov/v2/[categoryCode]/view";
import { AttendanceV2View } from "@/app/clubs/[id]/attendance/v2/view";
import { ClubCitationV2View } from "@/app/clubs/[id]/citation/v2/view";
import { ClubReportV2PageImpl } from "@/app/clubs/[id]/club-report/v2/view";
import { DashboardRotaryNetworkView } from "@/app/club-admin-dashboard/dashboard/rotary-network/view";

// Tabs render their module inline (embedded) rather than navigating away.
// Default tab = Club Monthly Report.
// "dues" surfaces the SAME OCV/GOV "Dues" category (document/receipt uploads)
// as its own top-level tab for quicker access — it still also lives inside the
// OCV / GOV tab's category grid; both point at the identical OcvCategoryV2View.
type EGovTab = "cmr" | "ocv" | "dues" | "attendance" | "awards" | "network" | "reports";

const EGOV_TABS: { key: EGovTab; label: string }[] = [
  { key: "cmr",        label: "Club Monthly Report" },
  { key: "ocv",        label: "OCV / GOV" },
  { key: "dues",       label: "Dues" },
  { key: "attendance", label: "Attendance" },
  { key: "awards",     label: "District Awards" },
  { key: "network",    label: "Rotary Network" },
  { key: "reports",    label: "Reports" },
];

function isEGovTab(v: string | null): v is EGovTab {
  return v === "cmr" || v === "ocv" || v === "dues" || v === "attendance" || v === "awards" || v === "network" || v === "reports";
}

export default function ClubAdminEGovernancePage() {
  const { eGovernance, overview, status, refresh, yearId } = useClubAdminCache();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ROW module switches (components/FeatureGate): skipped or switched-off modules lose their tab
  const tabOn = useEGovTabsOn();
  // Active tab from URL ?tab= — default "cmr" (Club Monthly Report).
  const initialTab: EGovTab = (() => {
    const t = searchParams?.get("tab");
    return isEGovTab(t) && tabOn[t] ? t : tabOn.cmr ? "cmr" : "attendance";
  })();
  const [activeTab, setActiveTab] = useState<EGovTab>(initialTab);

  const handleTabChange = (next: EGovTab) => {
    setActiveTab(next);
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    if (next === "cmr") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const clubId = eGovernance?.club.clubId ?? overview?.club.clubId ?? null;

  // ── Loading / error guards ─────────────────────────────────────────────
  if (status === "loading" && !eGovernance && !overview) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading e-governance…" />
      </div>
    );
  }
  if (!eGovernance && !overview) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
        <span>Failed to load e-governance data.</span>
        <button
          onClick={() => refresh()}
          className="text-xs font-semibold text-red-700 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="E-Governance & Reporting"
        subtitle="Attendance, reports, citations, TRF and district submissions"
        icon={ClipboardList}
      />

      {/* ── Tab strip — buttons swap the section inline (no navigation), same
             navy/gold visual as the Communication tab bar. ── */}
      <EGovTabBar active={activeTab} onChange={handleTabChange} />

      {/* ══ Each tab renders its live v2 module inline (embedded) ══ */}
      {clubId != null && (
        <>
          {/* CMR, OCV and Reports follow the GLOBAL dashboard year (no own year dropdown).
              Attendance and Awards keep their own module-wise year filter. */}
          {activeTab === "cmr"        && <ClubMonthlyReportV2View clubId={clubId} embedded yearId={yearId} />}
          {activeTab === "ocv"        && <OcvGovV2View            clubId={clubId} embedded yearId={yearId} />}
          {activeTab === "dues"       && <OcvCategoryV2View       clubId={clubId} embedded yearId={yearId} categoryCode="dues" />}
          {activeTab === "attendance" && <AttendanceV2View        clubId={clubId} embedded />}
          {activeTab === "awards"     && <ClubCitationV2View      clubId={clubId} embedded />}
          {activeTab === "network"    && <DashboardRotaryNetworkView embedded />}
          {activeTab === "reports"    && <ClubReportV2PageImpl clubId={clubId} embedded yearId={yearId} />}
        </>
      )}
    </div>
  );
}

// ── Tab strip — navy/gold pills, active state (mirrors Communication) ────────
function useEGovTabsOn(): Record<EGovTab, boolean> {
  const cmr = useFeatureOn("club_monthly_report");
  const ocv = useFeatureOn("ocv");
  return { cmr, ocv, dues: true, attendance: true, awards: true, network: true, reports: true };
}

function EGovTabBar({ active, onChange }: { active: EGovTab; onChange: (k: EGovTab) => void }) {
  const tabOn = useEGovTabsOn();
  return (
    <div className="overflow-x-auto">
      <div
        className="inline-flex items-center gap-1 rounded-xl p-1.5"
        style={{ backgroundColor: "#17458f" }}
      >
        {EGOV_TABS.filter((t) => tabOn[t.key]).map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition ${
                isActive ? "shadow-sm" : "text-white hover:bg-white/10"
              }`}
              style={isActive ? { backgroundColor: "#F7A81B", color: "#17458f" } : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
