// Data-access layer for the /projects guided-drill browse feature.
//
// ⚠️ DUMMY DATA FOR NOW. These functions have the SAME shapes the real public
// endpoints will have (see PROJECTS_API_SPEC.txt at the repo root). Today they
// compute in-memory from SAMPLE_PROJECTS; when the backend ships
//   GET /api/public/projects/stats | /years | /options | (list)
// swap each body for a fetch() through the /site-data/rotary/* proxy and NOTHING in
// the components changes. They're already async for exactly that reason.
//
// Mock-vs-real id note: the real API keys clubs by clubId (int) and areas by
// area_of_focus_id (int); the mock keys them by name (the sample has no stable
// ids). Components treat every choice `id` as opaque — pass it straight back as
// the next filter — so both worlds work unchanged.

import {
  SAMPLE_PROJECTS,
  type BundledProject,
} from "@/components/pages/projects/sampleProjects";
import { getProject, type ProjectDetail } from "@/lib/projectsApi";
import {
  AREA_TABS,
  normArea,
  parseTime,
  rotaryYearOf,
  isClubService,
} from "@/components/pages/projects/shared";

const USD_RATE = 83; // placeholder — backend will own the real/config rate

export type DrillFilters = {
  state?: string;
  district?: string;
  club?: string;
  areaFocus?: string;
  year?: number; // 0 / undefined = all years
};

export type OptionLevel = "states" | "districts" | "clubs" | "areas";
export type Choice = { id: string; label: string; count: number };
export type YearOption = { yearId: number; label: string };
export type ProjectStats = {
  totalProjects: number;
  clubsInvolved: number;
  valueInr: number;
  valueUsd: number;
  beneficiaries: number;
  manHours: number;
};
export type ProjectListItem = Pick<
  BundledProject,
  | "id"
  | "title"
  | "areaOfFocus"
  | "clubName"
  | "clubCity"
  | "clubState"
  | "districtNumber"
  | "zoneName"
  | "projectCost"
  | "directBeneficiaries"
  | "projectDate"
  | "primaryPhoto"
>;
export type PagedProjects = {
  items: ProjectListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

/* ── internal helpers (mock only) ─────────────────────────────────── */

/** Rotary-year id (start year) + label for a project, e.g. 2025 / "2025-2026". */
function ryOf(p: BundledProject): { id: number; label: string } {
  const t = parseTime(p.projectDate);
  if (t === null) return { id: 0, label: "–" };
  const label = rotaryYearOf(t);
  return { id: Number(label.slice(0, 4)), label };
}

/** Canonical area-of-focus label for a project (maps free text → the 7 causes). */
function areaKeyOf(p: BundledProject): string {
  const raw = p.areaOfFocus ?? "Others";
  const tab = AREA_TABS.find((t) => normArea(t.key) === normArea(raw));
  return tab ? tab.key : raw;
}

function matches(p: BundledProject, f: DrillFilters): boolean {
  if (isClubService(p)) return false;
  if (f.year && ryOf(p).id !== f.year) return false;
  if (f.state && p.clubState !== f.state) return false;
  if (f.district && p.districtNumber !== f.district) return false;
  if (f.club && p.clubName !== f.club) return false;
  if (f.areaFocus && normArea(areaKeyOf(p)) !== normArea(f.areaFocus)) return false;
  return true;
}

/** Group matching projects by a key, return sorted {id,label,count} choices. */
function tally(
  base: BundledProject[],
  keyOf: (p: BundledProject) => { id: string; label: string },
  sort: (a: Choice, b: Choice) => number
): Choice[] {
  const map = new Map<string, Choice>();
  for (const p of base) {
    const { id, label } = keyOf(p);
    const hit = map.get(id);
    if (hit) hit.count += 1;
    else map.set(id, { id, label, count: 1 });
  }
  return [...map.values()].sort(sort);
}

const byLabel = (a: Choice, b: Choice) => a.label.localeCompare(b.label);
const byCountDesc = (a: Choice, b: Choice) => b.count - a.count || byLabel(a, b);

/* ── the "API" (dummy today, fetch tomorrow) ──────────────────────── */

/** [GET /projects/stats?year=]  Aggregate totals for the stats strip. */
export async function getProjectStats(year = 0): Promise<ProjectStats> {
  const rows = SAMPLE_PROJECTS.filter((p) => matches(p, { year }));
  const valueInr = rows.reduce((s, p) => s + (p.projectCost ?? 0), 0);
  return {
    totalProjects: rows.length,
    clubsInvolved: new Set(rows.map((p) => p.clubName)).size,
    valueInr,
    valueUsd: Math.round(valueInr / USD_RATE),
    beneficiaries: rows.reduce((s, p) => s + (p.directBeneficiaries ?? 0), 0),
    manHours: rows.reduce((s, p) => s + (p.manHours ?? 0), 0),
  };
}

/** [GET /projects/years]  Rotary years that have projects, newest first. */
export async function getProjectYears(): Promise<YearOption[]> {
  const seen = new Map<number, string>();
  for (const p of SAMPLE_PROJECTS) {
    if (isClubService(p)) continue;
    const y = ryOf(p);
    if (y.id) seen.set(y.id, y.label);
  }
  return [...seen.entries()]
    .map(([yearId, label]) => ({ yearId, label }))
    .sort((a, b) => b.yearId - a.yearId);
}

/** [GET /projects/options?level=&…]  Next drill choices + counts. */
export async function getProjectOptions(
  level: OptionLevel,
  filters: DrillFilters = {}
): Promise<Choice[]> {
  const base = SAMPLE_PROJECTS.filter((p) => matches(p, filters));
  switch (level) {
    case "states":
      return tally(base, (p) => ({ id: p.clubState ?? "–", label: p.clubState ?? "–" }), byLabel);
    case "districts":
      return tally(
        base,
        (p) => ({ id: p.districtNumber ?? "–", label: `RID ${p.districtNumber ?? "–"}` }),
        (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })
      );
    case "clubs":
      return tally(
        base,
        (p) => ({ id: p.clubName ?? "–", label: p.clubName ?? "–" }),
        byLabel
      );
    case "areas":
      return tally(base, (p) => ({ id: areaKeyOf(p), label: areaKeyOf(p) }), byCountDesc);
  }
}

/**
 * [GET /projects/{id}]  Full project detail. A bundled sample id wins over the
 * live endpoint, because the sample's 70801-70856 range is ALREADY occupied by
 * real projects upstream (70801 is "BOARD MEETING") — live-first would send
 * every card on /projects to an unrelated project that looks authentic. Every
 * other id goes straight to the live endpoint. Drop the sample branch entirely
 * once the list endpoints serve real ids; the ids stop colliding then.
 */
export async function getProjectDetail(
  id: number,
  yearId?: number
): Promise<ProjectDetail | null> {
  // A yearId only ever comes from a LIVE card's link (/projects/{id}?yearId=), so its
  // presence settles the collision the other way: this is a real project, and the
  // bundled sample must not shadow it. Without this the 37 sample ids (70801-70856)
  // hijacked real projects that share those ids — id 70823 is a genuine project in
  // each of the 2022-23, 2023-24, 2024-25 and 2025-26 tables — and served invented
  // title, cost and beneficiary figures under a real club's name.
  const p = yearId === undefined ? SAMPLE_PROJECTS.find((x) => x.id === id) : undefined;
  if (p) {
    const { primaryPhoto: _primaryPhoto, ...project } = p;
    return { project, photos: [], officers: [] };
  }
  return getProject(id, yearId);
}

/** [GET /projects?…&page=]  Paginated leaf list, newest first, 10/page. */
export async function getProjectsList(
  filters: DrillFilters = {},
  page = 1,
  pageSize = 10
): Promise<PagedProjects> {
  const all = SAMPLE_PROJECTS.filter((p) => matches(p, filters)).sort(
    (a, b) => (parseTime(b.projectDate) ?? 0) - (parseTime(a.projectDate) ?? 0)
  );
  const start = (page - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    totalCount: all.length,
    page,
    pageSize,
  };
}
