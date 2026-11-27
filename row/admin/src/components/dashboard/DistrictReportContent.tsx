"use client";

/**
 * Embeddable district-report body. Reuses the V1 page's section list and
 * exportSection() flow verbatim — same per-section Excel downloads, same
 * Photos hyperlink column on the six service-module project tables.
 *
 * Mounted by:
 *   - app/districts/[id]/district-report/page.tsx (V1 standalone wrapper)
 *   - app/district-admin-dashboard/egovernance/page.tsx (egovernance Reports
 *     sub-tab) — so admins don't have to leave the new dashboard.
 *
 * Year picker lives INSIDE this component, so each host page only passes
 * districtId (+ optional initial yearId from a URL param). Auth wrapper
 * stays on the page side; this component assumes it's already inside an
 * authenticated route.
 */

import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { Mail } from "@/components/icons";
import Link from "next/link";
import RotaryLoader from "@/components/RotaryLoader";
import { useDistrictReport, DistrictReportProps } from "./useDistrictReport";
import DistrictReportMembers from "./DistrictReportMembers";
import DistrictReportClubs from "./DistrictReportClubs";
import DistrictReportDistrict from "./DistrictReportDistrict";


/**
 * agMemberId — AG Reports only. When set, every request carries it and the backend
 * scopes the whole report (and the club dropdown) to that AG's clubs for the year.
 * Left undefined by the District Admin and Club Admin pages, so their behaviour is
 * byte-for-byte unchanged.
 */
export default function DistrictReportContent(props: DistrictReportProps) {
  const r = useDistrictReport(props);
  const { servicesOnly, hideMembers, showCommunicationLogs, report, yearsLoading, reportLoading, errorMessage, setErrorMessage, successMessage, setSuccessMessage } = r;
  if (yearsLoading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  return (
    <div className="space-y-6">
      {!servicesOnly && <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />}
      {!servicesOnly && <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />}

      {reportLoading ? (
        <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
      ) : !report ? (
        <div className="text-center py-20 text-muted-foreground">No report data available.</div>
      ) : (
        <>
          {showCommunicationLogs && (
            <Card className="mb-4">
              <CardContent className="p-0">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="row-h3">Communication Logs</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Delivery status of email sent to your district&apos;s members</p>
                </div>
                <div className="p-4 flex flex-wrap gap-3">
                  <Link href="/district-admin-dashboard/email-log" className="row-btn row-btn-secondary row-btn-sm">
                    <Mail size={14} /> Email Log
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary stat-card grid removed — too slow to compute server-side
              and not needed for the report-export workflow. Backend still
              returns report.summary but the UI no longer renders the cards. */}

          {/* Per-avenue project rows (Community / Club / New Generation /
              Vocational / International / Public Image) intentionally
              removed — those reports already live under the Avenue of Service
              dropdown rows in the CLUBS subsection (All Clubs, Club-Wise
              Count, AG-Wise variants). */}

          {!servicesOnly && <>
            {/* ── MEMBERS subsection ── hidden when hideMembers ── */}
            {!hideMembers && (<>
            <DistrictReportMembers r={r} />


            </>)}

            <DistrictReportClubs r={r} />

            <DistrictReportDistrict r={r} />

          </>}
        </>
      )}
    </div>
  );
}
