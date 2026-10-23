"use client";

/**
 * "Members with designation X" for a club or a district (build spec 3.12): each member's highest level of the
 * chosen designation and the date it was reached. Choosing a level lists members at that level or higher.
 */

import { useEffect, useState } from "react";
import { Award } from "@/components/icons";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DESIGNATION_OPTIONS } from "@/lib/foundationDesignations";
import { getDesignationReport, type DesignationReportRow } from "@/services/api";
import { apiMessage, selectCls } from "./FoundationDesignationsCard";

export default function FoundationDesignationsReport({ scope, scopeId }: { scope: "clubs" | "districts"; scopeId: number }) {
  const [choice, setChoice] = useState(DESIGNATION_OPTIONS[0].value);
  const [rows, setRows] = useState<DesignationReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!(scopeId > 0)) return;
    const opt = DESIGNATION_OPTIONS.find((o) => o.value === choice) ?? DESIGNATION_OPTIONS[0];
    let live = true;
    setRows(null);
    setError(null);
    getDesignationReport(scope, scopeId, opt.type, opt.level ?? 0)
      .then((r) => live && setRows(r))
      .catch((err) => live && setError(apiMessage(err, "Could not load the report.")));
    return () => {
      live = false;
    };
  }, [scope, scopeId, choice]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Foundation designations"
        subtitle={scope === "clubs" ? "Members of this club with a Rotary Foundation designation" : "Members of this district with a Rotary Foundation designation"}
        icon={Award}
      />

      <label className="block max-w-sm space-y-1 text-xs font-semibold text-slate-700">
        <span>Members with at least</span>
        <select className={selectCls} value={choice} onChange={(e) => setChoice(e.target.value)}>
          {DESIGNATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>
      ) : rows === null ? (
        <TableSkeleton rows={5} />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <p className="px-4 py-3 text-xs text-slate-500 border-b border-slate-100">
            {rows.length} {rows.length === 1 ? "member" : "members"}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                {scope === "districts" && <TableHead>Club</TableHead>}
                <TableHead>Highest designation</TableHead>
                <TableHead>Reached</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.memberId}>
                  <TableCell className="font-medium text-slate-800">{r.memberName}</TableCell>
                  {scope === "districts" && <TableCell className="text-slate-600">{r.clubName}</TableCell>}
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-slate-600">{fmtDate(r.awardedDate)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={scope === "districts" ? 4 : 3} className="py-8 text-center text-slate-500">
                    No members with this designation yet. Add designations on a member&apos;s profile.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
