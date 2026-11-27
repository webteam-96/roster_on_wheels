
// Multi-district ("All Districts") mode. Fetches one report per district in the zone
// and concatenates every section array into a single payload so the existing
// per-section Download buttons emit ONE combined file (all districts, all clubs).
// Each row is stamped with its source districtNumber so the origin isn't lost.
// Only used when the caller passes districtIds; single-district reports never hit this.
export const MERGE_ARRAY_KEYS = [
  "bod", "members", "appUsers", "attendance", "clubMonthlyProjectDetails",
  "monthlyReportSubmissions", "trf",
  "nonRiSyncedClubs", "riSyncedClubs", "events", "newsletters", "announcements",
  "documents", "districtProjects", "agAllocation", "committeeMain",
  "committeeGroup", "committeeSubGroup", "clubList",
];

// Stamp a row with the zone + district it came from (never overwriting a value the
// row already carries, e.g. the Sync/Non-sync club rows that ship their own districtNumber).
export function stampGeo(row: any, dn: string, zn: string): any {
  if (!row || typeof row !== "object") return row;
  return { ...row, districtNumber: row.districtNumber ?? dn, zoneName: row.zoneName ?? zn };
}

export function mergeDistrictReports(reports: any[]): any | null {
  const list = (reports || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const merged: any = { district: { districtNumber: "All Districts", zoneName: "" }, projectsByModule: {} };
  for (const k of MERGE_ARRAY_KEYS) merged[k] = [];
  for (const r of list) {
    const dn = r?.district?.districtNumber ?? "";
    const zn = r?.district?.zoneName ?? "";
    if (!merged.district.zoneName && zn) merged.district.zoneName = zn;
    for (const k of MERGE_ARRAY_KEYS) {
      const rows = Array.isArray(r?.[k]) ? r[k] : [];
      for (const row of rows) merged[k].push(stampGeo(row, dn, zn));
    }
    const pbm = r?.projectsByModule || {};
    for (const mk of Object.keys(pbm)) {
      if (!merged.projectsByModule[mk]) merged.projectsByModule[mk] = [];
      const rows = Array.isArray(pbm[mk]) ? pbm[mk] : [];
      for (const row of rows) merged.projectsByModule[mk].push(stampGeo(row, dn, zn));
    }
  }
  return merged;
}

// Geo-columns view: stamp every section row with the one district's
// zone + district so the injected Zone / District columns are populated.
export function stampGeoSingle(report: any): any {
  if (!report) return report;
  const dn = report?.district?.districtNumber ?? "";
  const zn = report?.district?.zoneName ?? "";
  for (const k of MERGE_ARRAY_KEYS) {
    if (Array.isArray(report[k])) report[k] = report[k].map((row: any) => stampGeo(row, dn, zn));
  }
  const pbm = report?.projectsByModule || {};
  for (const mk of Object.keys(pbm)) {
    if (Array.isArray(pbm[mk])) pbm[mk] = pbm[mk].map((row: any) => stampGeo(row, dn, zn));
  }
  return report;
}
