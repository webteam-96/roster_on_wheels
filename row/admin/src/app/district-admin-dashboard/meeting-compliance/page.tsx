"use client";

/**
 * District Admin Dashboard: meeting compliance (N8 Meetings, build spec B.1 #31).
 * Meetings held by each club against the meetings-per-month rule. The district sets the rule; a club can have its
 * own number. A meeting counts when its record is dated in the month and has attendance marked. The club list
 * shows the same status in its "Meetings" column. Off until Settings > Features turns on "meetings".
 */

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
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h1 className="text-lg font-semibold text-slate-800">Meeting compliance</h1>
          <p className="mt-1 text-sm text-slate-500">
            Meetings held by each club against the number required per month. A meeting counts once its attendance is
            marked.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="mc-month" className="mb-1 block text-sm font-medium text-slate-700">Month</label>
              <input
                id="mc-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-[12px] border border-slate-200 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <div>
              <label htmlFor="mc-default" className="mb-1 block text-sm font-medium text-slate-700">
                District rule: meetings per month
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="mc-default"
                  type="number"
                  min={0}
                  max={31}
                  value={defaultInput}
                  onChange={(e) => setDefaultInput(e.target.value)}
                  className="w-20 rounded-[12px] border border-slate-200 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
                <button
                  type="button"
                  onClick={() => save(parseMeetingCount(defaultInput))}
                  disabled={busy || !data}
                  className="rounded-full bg-azure px-3 py-1.5 text-sm font-semibold text-cream hover:bg-mint-ink disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
          {data && !data.districtDefaultIsSet && (
            <p className="mt-2 text-xs text-slate-500">The district has not set a rule yet, so 2 a month applies.</p>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
        </div>

        {!data ? (
          <TableSkeleton rows={8} />
        ) : data.clubs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No active clubs in this district.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-[#EDF4FB] text-left text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Club</th>
                  <th className="px-4 py-2.5">Held in {monthLabel(data.month)}</th>
                  <th className="px-4 py-2.5">Required</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">
                    Club rule <span className="font-normal normal-case">(empty: district rule)</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.clubs.map((c) => (
                  <tr key={c.clubId}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{c.clubName}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{c.held}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">
                      {c.required}
                      {c.isOverride && <span className="ml-1 text-xs text-slate-500">(club rule)</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${MEETING_STATUS[c.status].cls}`}>
                        {MEETING_STATUS[c.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={31}
                          aria-label={`Meetings per month for ${c.clubName}`}
                          placeholder={String(data.districtDefault)}
                          value={overrides[c.clubId] ?? ""}
                          onChange={(e) => setOverrides((o) => ({ ...o, [c.clubId]: e.target.value }))}
                          className="w-16 rounded-[12px] border border-slate-200 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                        />
                        <button
                          type="button"
                          onClick={() => save(parseMeetingCount(overrides[c.clubId] ?? ""), c.clubId)}
                          disabled={busy}
                          className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
