"use client";

// RCC Goals - View all clubs (District Admin). Redesign 2026-11-20: same table as the oversight clubs page
// (RccClubsList) - heading + search, Club name | View goals, plus Download all clubs (clubs down, 26 goals across).
// View goals opens ./goals (the club's RCC goals as a table).

import { Button } from "@/components/ui/button";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { saveAs } from "file-saver";
import { ArrowLeft, Download } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { fileTimestamp } from "@/lib/dateUtils";
import RccClubsList from "@/components/RccClubsList";
import { RotaryOrgAsOn } from "@/components/goal-rotary/RotaryOrgSync";
import { getDistrictClubsGoalList, downloadRotaryAllClubsReport } from "@/services/goalFlowApi";

export default function DistrictRccClubsPage() {
  const { selectedDistrictId } = useAuth();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const yq = yearId ? `yearId=${yearId}` : "";
  const dl = useDownloadProgress();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Link href={`/district-admin-dashboard/rcc${yq ? `?${yq}` : ""}`} className="inline-flex items-center gap-1.5 text-go-body font-semibold text-go-navy-700 hover:underline">
        <ArrowLeft size={15} /> Back to District RCC Goals
      </Link>
      {selectedDistrictId ? (
        <>
          <RccClubsList title="RCC Goals · All Clubs" reloadKey={`${selectedDistrictId}-${yearId ?? "cur"}`}
            listFor={(cat) => getDistrictClubsGoalList(cat, yearId, selectedDistrictId)}
            goalsHref={(c) => `/district-admin-dashboard/rcc/clubs/goals?clubId=${c.id}&club=${encodeURIComponent(c.name)}${yq ? `&${yq}` : ""}`}
            actions={(clubs) => (
              <Button type="button" disabled={dl.busy || clubs.length === 0}
                onClick={() => dl.run("all", async () => {
                  setErr(null);
                  try { saveAs(await downloadRotaryAllClubsReport(selectedDistrictId, yearId, false, true), `RCC_Goals_All_Clubs_${fileTimestamp()}.xlsx`); }
                  catch { setErr("Could not download the report."); }
                })}>
                {dl.is("all") ? dl.bar("all") : <><Download size={15} /> Download all clubs</>}
              </Button>
            )} />
          <RotaryOrgAsOn districtId={selectedDistrictId} className="block text-go-meta text-go-text-secondary" />
          {err && <div className="rounded-go-md border border-go-danger-600 bg-go-danger-50 p-4 text-go-body text-go-danger-600">{err}</div>}
        </>
      ) : <p className="p-6 text-go-body text-go-text-muted">Select a district first.</p>}
    </div>
  );
}
