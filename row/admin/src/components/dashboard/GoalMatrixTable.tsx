"use client";

// Presentational Target/Achieved matrix — fields as rows, districts as columns, each cell showing
// Target + Achieved. Same layout as the SuperAdmin Overview tab; used on the oversight dashboards.

import { Card } from "@/components/ui/card";
import { MatrixTable } from "@/components/ui/data-table";
import type { GoalOverviewMatrixDto } from "@/types/goalSetting";

export default function GoalMatrixTable({ matrix }: { matrix: GoalOverviewMatrixDto }) {
  if (matrix.districts.length === 0) {
    return <p className="text-sm text-amber-600">No districts in <span className="font-medium">{matrix.zoneName}</span> for this category.</p>;
  }
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-sm font-semibold text-slate-800">{matrix.zoneName} · {matrix.categoryName} · {matrix.yearLabel}</p>
        <p className="text-xs text-slate-400">{matrix.districts.length} district(s) · {matrix.rows.length} metric(s)</p>
      </div>
      <MatrixTable
        caption={`${matrix.categoryName} by district`}
        corner="Particulars"
        columns={matrix.districts.map((d) => ({ key: String(d.districtId), header: `District ${d.districtNumber}`, className: "min-w-[140px] text-center" }))}
        rows={matrix.rows.map((row) => ({
          key: `${row.groupName}::${row.metricKey}`,
          label: (
            <>
              <div>{row.label}</div>
              {row.groupName && row.groupName !== row.label && (
                <div className="text-[11px] font-normal text-slate-400">{row.groupName}</div>
              )}
            </>
          ),
          cells: row.cells.map((cell) => (
            <div key={cell.districtId} className="flex flex-col gap-0.5 items-center">
              {row.hasTarget && (
                <span className="text-xs"><span className="text-slate-400">Target: </span><span className="font-semibold text-slate-800">{cell.target ?? "–"}</span></span>
              )}
              {row.hasAchieved && (
                <span className="text-xs"><span className="text-slate-400">Achieved: </span><span className="font-semibold text-emerald-700">{cell.achieved ?? "–"}</span></span>
              )}
              {!row.hasTarget && !row.hasAchieved && <span className="text-slate-400">–</span>}
            </div>
          )),
        }))}
      />
    </Card>
  );
}
