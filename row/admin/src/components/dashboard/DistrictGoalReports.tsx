"use client";

// District E-Governance ▸ Reports — download-only goal reports (no on-screen detail), styled to match
// the other report rows (Card + outline Download button). mode "district" → the district's report;
// mode "club" → a club picker (list + "All") + download. Each Excel = all four categories, 2 sheets.

import { useEffect, useState } from "react";
import ClubGoalComingSoon from "@/components/ClubGoalComingSoon";
import { CLUB_GOAL_SETTING_COMING_SOON } from "@/lib/clubGoalSetting";
import { Download, BarChart3 } from "@/components/icons";
import { saveAs } from "file-saver";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import RotaryLoader from "@/components/RotaryLoader";
import { downloadDistrictGoalExcel, downloadClubGoalExcel, downloadAllClubsGoalExcel, getDistrictClubs } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";

export default function DistrictGoalReports({ districtId, yearId, mode = "both" }: { districtId?: number | null; yearId?: number | null; mode?: "both" | "district" | "club" }) {
  const [clubs, setClubs] = useState<Array<{ clubId: number; clubName: string }>>([]);
  const [clubId, setClubId] = useState<number | null>(null); // null = All
  const [busy, setBusy] = useState<"" | "district" | "club">("");

  useEffect(() => {
    if (mode === "district" || !districtId) { setClubs([]); return; }
    let cancelled = false;
    // The district's club list every district manager and AG may read; the download checks each club again.
    getDistrictClubs(districtId)
      .then((cs) => { if (!cancelled) setClubs(cs.map((c) => ({ clubId: c.id, clubName: c.clubName }))); })
      .catch(() => { if (!cancelled) setClubs([]); });
    return () => { cancelled = true; };
  }, [districtId, mode]);

  async function dlDistrict() {
    if (busy) return; setBusy("district");
    try {
      const blob = await downloadDistrictGoalExcel(yearId, districtId);
      saveAs(blob, `District_Goal_Setting_${fileTimestamp()}.xlsx`);
    } finally { setBusy(""); }
  }
  async function dlClub() {
    if (busy) return; setBusy("club");
    try {
      // A specific club → that club's report. "All" → EVERY club in the district (not the
      // district's own goals — that's the District Goal Setting card).
      const blob = clubId ? await downloadClubGoalExcel(yearId, clubId) : await downloadAllClubsGoalExcel(yearId, districtId);
      const name = clubId ? (clubs.find((c) => c.clubId === clubId)?.clubName ?? "club") : "All-Clubs";
      saveAs(blob, `Club_Goal_Setting_${name.replace(/\s+/g, "-")}_${fileTimestamp()}.xlsx`);
    } finally { setBusy(""); }
  }

  const dlBtn = (label: string, on: () => void, isBusy: boolean, disabled = false) => (
    <Button variant="outline" size="sm" onClick={on} disabled={isBusy || disabled}>
      {isBusy ? <span className="inline-flex items-center gap-2"><RotaryLoader size="sm" />Loading…</span>
              : <><Download className="mr-2 h-3 w-3" />Download</>}
    </Button>
  );

  const iconBox = (
    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
      <BarChart3 className="h-5 w-5 text-primary" />
    </div>
  );

  return (
    <>
      {mode !== "club" && (
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {iconBox}
              <div className="min-w-0">
                <p className="font-medium truncate">District Goal Setting</p>
                <p className="text-xs text-muted-foreground">Month wise &amp; Till date · all categories</p>
              </div>
            </div>
            {dlBtn("Download", dlDistrict, busy === "district")}
          </CardContent>
        </Card>
      )}

      {/* Club Goal Setting is parked (user 2026-10-01): the tile stays visible so nobody wonders where
          the report went, but the club picker and the download are replaced by the placeholder. */}
      {mode !== "district" && CLUB_GOAL_SETTING_COMING_SOON && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {iconBox}
              <div className="min-w-0">
                <p className="font-medium truncate">Club Goal Setting</p>
                <p className="text-xs text-muted-foreground">Month wise &amp; Till date · all categories</p>
              </div>
            </div>
            <ClubGoalComingSoon compact />
          </CardContent>
        </Card>
      )}

      {mode !== "district" && !CLUB_GOAL_SETTING_COMING_SOON && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {iconBox}
              <div className="min-w-0">
                <p className="font-medium truncate">Club Goal Setting</p>
                <p className="text-xs text-muted-foreground">Month wise &amp; Till date · all categories</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={clubId ?? ""} onChange={(e) => setClubId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All</option>
                {clubs.map((c) => <option key={c.clubId} value={c.clubId}>{c.clubName}</option>)}
              </select>
              {dlBtn("Download", dlClub, busy === "club")}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
