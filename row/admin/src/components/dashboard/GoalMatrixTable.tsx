"use client";

// Presentational Target/Achieved matrix — fields as rows, districts as columns, each cell showing
// Target + Achieved. Same layout as the SuperAdmin Overview tab; used on the oversight dashboards.

import type { GoalOverviewMatrixDto } from "@/types/goalSetting";

export default function GoalMatrixTable({ matrix }: { matrix: GoalOverviewMatrixDto }) {
  if (matrix.districts.length === 0) {
    return <p className="text-sm text-amber-600">No districts in <span className="font-medium">{matrix.zoneName}</span> for this category.</p>;
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-sm font-semibold text-slate-800">{matrix.zoneName} · {matrix.categoryName} · {matrix.yearLabel}</p>
        <p className="text-xs text-slate-400">{matrix.districts.length} district(s) · {matrix.rows.length} metric(s)</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 text-left px-3 py-2 font-semibold min-w-[220px] border-b border-r">Particulars</th>
              {matrix.districts.map((d) => (
                <th key={d.districtId} className="text-center px-3 py-2 font-semibold whitespace-nowrap border-b border-r min-w-[140px]">
                  District {d.districtNumber}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={`${row.groupName}::${row.metricKey}`} className="odd:bg-white even:bg-slate-50/50">
                <th className="sticky left-0 z-10 bg-inherit text-left px-3 py-2 font-medium align-top border-b border-r">
                  <div>{row.label}</div>
                  {row.groupName && row.groupName !== row.label && (
                    <div className="text-[11px] font-normal text-slate-400">{row.groupName}</div>
                  )}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.districtId} className="px-3 py-2 align-top border-b border-r text-center">
                    <div className="flex flex-col gap-0.5 items-center">
                      {row.hasTarget && (
                        <span className="text-xs"><span className="text-slate-400">Target: </span><span className="font-semibold text-slate-800">{cell.target ?? "–"}</span></span>
                      )}
                      {row.hasAchieved && (
                        <span className="text-xs"><span className="text-slate-400">Achieved: </span><span className="font-semibold text-emerald-700">{cell.achieved ?? "–"}</span></span>
                      )}
                      {!row.hasTarget && !row.hasAchieved && <span className="text-slate-400">, </span>}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
