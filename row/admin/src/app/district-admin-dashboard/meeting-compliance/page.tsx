"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * District Admin Dashboard: meeting compliance (N8 Meetings, build spec B.1 #31).
 * Meetings held by each club against the meetings-per-month rule. The district sets the rule; a club can have its
 * own number. A meeting counts when its record is dated in the month and has attendance marked. The club list
 * shows the same status in its "Meetings" column. Off until Settings > Features turns on "meetings".
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { getDistrictMeetingCompliance, setMeetingRule, type MeetingCompliance } from "@/services/api";
import { MEETING_STATUS, lastCompleteMonth, monthLabel, parseMeetingCount } from "@/lib/meetingCompliance";

export default function MeetingCompliancePage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const on = useFeatureLoadedOn("meetings");
  const [month, setMonth] = useState(lastCompleteMonth);
  const [data, setData] = useState<MeetingCompliance | null>(null);
  const [defaultInput, setDefaultInput] = useState("");
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!districtId || !on || !month) return;
    try {
      const d = await getDistrictMeetingCompliance(districtId, month);
      setData(d);
      setDefaultInput(String(d.districtDefault));
      setOverrides(Object.fromEntries(d.clubs.map((c) => [c.clubId, c.isOverride ? String(c.required) : ""])));
    } catch {
      setError("Meeting compliance could not be loaded.");
    }
  }, [districtId, on, month]);

  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  // clubId undefined: the district rule. A club's empty box clears its own number.
  const save = async (count: number | null | undefined, clubId?: number) => {
    if (count === undefined || (clubId === undefined && count === null)) {
      setError("Enter a whole number from 0 to 31.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setMeetingRule(districtId, count, clubId);
      setNotice(clubId === undefined ? "District rule saved." : "Club rule saved.");
      await load();
    } catch {
      setError("The rule could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <PageHeader title="Meeting compliance" description="Meetings held by each club against the number required per month. A meeting counts once its attendance is marked." />
        <Card className="p-5">
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="mc-month" className="mb-1 block text-sm font-medium text-slate-700">Month</label>
              <Input
                id="mc-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-auto"
              />
            </div>
            <div>
              <label htmlFor="mc-default" className="mb-1 block text-sm font-medium text-slate-700">
                District rule: meetings per month
              </label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="mc-default"
                  type="number"
                  min={0}
                  max={31}
                  value={defaultInput}
                  onChange={(e) => setDefaultInput(e.target.value)}
                  className="w-20"
                />
                <Button
                  type="button"
                  onClick={() => save(parseMeetingCount(defaultInput))}
                  disabled={busy || !data}
                  size="sm"
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
          {data && !data.districtDefaultIsSet && (
            <p className="mt-2 text-xs text-slate-500">The district has not set a rule yet, so 2 a month applies.</p>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
        </Card>

        {!data ? (
          <TableSkeleton rows={8} />
        ) : data.clubs.length === 0 ? (
          <Card className="p-5 text-center text-sm text-slate-500">
            No active clubs in this district.
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <Table className="w-full text-sm">
              <TableHeader className="border-b border-slate-200 text-left">
                <TableRow>
                  <TableHead className="px-4">Club</TableHead>
                  <TableHead className="px-4">Held in {monthLabel(data.month)}</TableHead>
                  <TableHead className="px-4">Required</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4">
                    Club rule <span className="font-normal normal-case">(empty: district rule)</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {data.clubs.map((c) => (
                  <TableRow key={c.clubId}>
                    <TableCell className="px-4 py-2.5 font-medium text-slate-800">{c.clubName}</TableCell>
                    <TableCell className="px-4 py-2.5 tabular-nums text-slate-700">{c.held}</TableCell>
                    <TableCell className="px-4 py-2.5 tabular-nums text-slate-700">
                      {c.required}
                      {c.isOverride && <span className="ml-1 text-xs text-slate-500">(club rule)</span>}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${MEETING_STATUS[c.status].cls}`}>
                        {MEETING_STATUS[c.status].label}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={31}
                          aria-label={`Meetings per month for ${c.clubName}`}
                          placeholder={String(data.districtDefault)}
                          value={overrides[c.clubId] ?? ""}
                          onChange={(e) => setOverrides((o) => ({ ...o, [c.clubId]: e.target.value }))}
                          className="row-field-sm w-16"
                        />
                        <Button
                          type="button"
                          onClick={() => save(parseMeetingCount(overrides[c.clubId] ?? ""), c.clubId)}
                          disabled={busy}
                          variant="outline" size="sm"
                        >
                          Save
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  );
}
