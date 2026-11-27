"use client";

// Messages on Disha Goals (user 2026-11-18, option A): the Goal Setting chat EXACTLY as on goal-overviews-rotary -
// the code below is copied unchanged from GoalOversightMatrixRotary (button, red dot, mark seen, dialog, filters,
// report) and the role level is worked out the same way as goal-overviews-rotary/page.tsx. Nothing else is different.

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { Download, MessagesSquare } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { fileTimestamp } from "@/lib/dateUtils";
import { getDistrictSummaryMatrix, getGoalMessagesHasUnread, downloadGoalMessagesReport } from "@/services/api";
import { CATEGORY_TAGS } from "@/lib/goalRotaryLayout";
import GroupMessages from "@/components/goal-messages/GroupMessages";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GoalDistrictSummaryMatrixDto } from "@/types/goalSetting";
import { getMyGoalAssignments, markGoalMessagesSeen, type GoalMyAssignmentDto } from "@/services/goalFlowApi";

type OversightLevel = "ri" | "zone" | "district";
// Every tag of one level, for the RI Director's Messages tooltip (tags, never role names - user 2026-10-29).
const allTags = (level: "zone" | "district") => Object.values(CATEGORY_TAGS).map((t) => t[level]).join(", ");

/** The level goal-overviews-rotary passes to GoalOversightMatrixRotary (same rules). */
function useOversightLevel(actingAs: string | null): OversightLevel {
  const { isSuperAdmin } = useAuth();
  const [assignments, setAssignments] = useState<GoalMyAssignmentDto[]>([]);
  useEffect(() => { getMyGoalAssignments().then(setAssignments).catch(() => {}); }, []);
  const actingRoleType =
    actingAs === "ri-director" ? "AllCategoryAllDistrictsFewZones"
    : actingAs === "zone-coordinator" ? "AllDistrictsOneCategoryOneZone"
    : actingAs === "district-assistant" ? "FewDistrictsOneCategoryOneZone"
    : null;
  const scopedAssignments = useMemo(
    () => (actingRoleType ? assignments.filter((a) => a.roleType === actingRoleType)
      : isSuperAdmin ? [] : assignments),
    [assignments, actingRoleType, isSuperAdmin],
  );
  const roleLabel = useMemo(() => {
    const types = new Set(scopedAssignments.map((a) => a.roleType));
    if (types.has("AllCategoryAllDistrictsFewZones")) return "RI Director";
    if (types.has("AllDistrictsOneCategoryOneZone")) return "Zone Co-ordinator";
    if (types.has("FewDistrictsOneCategoryOneZone")) return "District Assistant";
    return isSuperAdmin ? "Super Admin" : "Goal Setting";
  }, [scopedAssignments, isSuperAdmin]);
  return actingAs === "zone-coordinator" || roleLabel === "Zone Co-ordinator" ? "zone"
    : actingAs === "district-assistant" || roleLabel === "District Assistant" ? "district" : "ri";
}

export default function DishaMessages({ zoneId, zoneName, yearId, actingAs = null, onError }: {
  zoneId: number | null; zoneName: string; yearId: number | null; actingAs?: string | null; onError: (m: string) => void;
}) {
  const level = useOversightLevel(actingAs);
  const dl = useDownloadProgress();
  const [matrix, setMatrix] = useState<GoalDistrictSummaryMatrixDto | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [rptCat, setRptCat] = useState(0);
  const [rptDistrict, setRptDistrict] = useState(0);

  // The zone's categories and districts - the same call Goal Overview makes.
  useEffect(() => {
    if (!zoneId || !yearId) { setMatrix(null); return; }
    getDistrictSummaryMatrix(zoneId, yearId).then(setMatrix).catch(() => setMatrix(null));
  }, [zoneId, yearId]);
  const cats = useMemo(() => matrix?.categories ?? [], [matrix]);

  // Red dot on Messages (as today).
  useEffect(() => {
    if (!zoneId || !yearId) { setHasUnread(false); return; }
    let cancelled = false;
    const check = () => getGoalMessagesHasUnread(zoneId, yearId).then((u) => { if (!cancelled) setHasUnread(u); }).catch(() => {});
    check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [zoneId, yearId, msgOpen]);

  function openMessages() {
    setMsgOpen(true);
    if (level === "ri" && zoneId && yearId) markGoalMessagesSeen(zoneId, yearId).then(() => setHasUnread(false)).catch(() => {});
  }
  async function downloadMessagesReport() {
    if (!zoneId || !yearId) return;
    try {
      const blob = await downloadGoalMessagesReport(zoneId, yearId, rptCat, rptDistrict);
      saveAs(blob, `Goal_Messages_${zoneName || "zone"}_${fileTimestamp()}.xlsx`);
    } catch (e) {
      onError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || "Could not download the messages report.");
    }
  }
  const msgTitle = level === "ri" ? `Read messages from your ${allTags("zone")} & ${allTags("district")}` : "Message your RI Director";

  return (
    <>
      {/* After a zone is selected - exactly as Goal Overview (user 2026-11-18). */}
      {zoneId && (
        <Button variant="outline" type="button" onClick={openMessages} title={msgTitle}
          className="relative w-full sm:w-auto">
          <MessagesSquare size={16} /> Messages
          {hasUnread && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-go-danger-600 ring-2 ring-white" title="New message" />}
        </Button>
      )}

      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="max-w-6xl w-[96vw] h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2"><MessagesSquare size={18} className="text-go-navy-700" /> Messages{zoneName ? ` — ${zoneName}` : ""}</DialogTitle>
          </DialogHeader>
          {level === "ri" && (
            <div className="shrink-0 flex flex-wrap items-end gap-2 border-b border-go-border pb-3 pr-8">
              <label className="flex flex-col gap-1 text-go-meta text-go-text-secondary">
                Category
                <NativeSelect value={rptCat} onChange={(e) => setRptCat(Number(e.target.value))} className="row-field-sm w-auto">
                  <option value={0}>All categories</option>
                  {cats.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-go-meta text-go-text-secondary">
                District
                <NativeSelect value={rptDistrict} onChange={(e) => setRptDistrict(Number(e.target.value))} className="row-field-sm w-auto">
                  <option value={0}>All districts</option>
                  {(matrix?.districts || []).map((d) => <option key={d.districtId} value={d.districtId}>{d.districtNumber}</option>)}
                </NativeSelect>
              </label>
              <Button variant="outline" size="sm" type="button" onClick={() => dl.run("messages", downloadMessagesReport)} disabled={dl.busy} title="Download the goal messages report for the selected filters">
                {dl.is("messages") ? dl.bar("messages") : <><Download size={13} /> Download report</>}
              </Button>
            </div>
          )}
          <div className="mt-3 flex-1 min-h-0 flex flex-col">
            {zoneId && yearId ? (
              level === "ri"
                ? <GroupMessages mode="ri" zoneId={zoneId} yearId={yearId} categoryId={rptCat} filterDistrictId={rptDistrict} />
                : <GroupMessages mode="own" zoneId={zoneId} yearId={yearId} actingAs={actingAs} categories={cats.map((c) => ({ categoryId: c.categoryId, name: c.name }))} />
            ) : (
              <p className="text-go-body text-go-text-muted py-6 text-center">Select a zone to see its messages.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
