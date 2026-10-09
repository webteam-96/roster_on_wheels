// Typed client for the public project-stats endpoints, called through the
// same-origin proxy at /site-data/rotary/* (see src/app/(site)/site-data/rotary/[...path]/route.ts).
// Not /api/* — IIS routes that to the .NET backend in production; see the route file.
// Designed for CLIENT components — the URLs are relative.
//
// Every function resolves to null (or an empty list) on any failure — it
// NEVER throws — so the UI can fall back to bundled data when the stats
// controller isn't deployed to the live API yet.

export type YearRef = { yearId: number; yearLabel: string };

export type OverviewCurrentYear = YearRef & {
  totalProjects: number;
  totalCost: number;
  totalBeneficiaries: number;
};

export type Overview = {
  totalProjects: number;
  totalCost: number;
  totalBeneficiaries: number;
  totalManHours: number;
  totalRotarians: number;
  years: YearRef[];
  currentYear: OverviewCurrentYear | null;
};

export type StateStat = { state: string; projects: number; clubs: number };

export type DistrictStat = {
  districtId: number;
  districtNumber: string;
  projects: number;
  clubs: number;
};

export type ClubStat = {
  clubId: number;
  clubName: string;
  city: string | null;
  projects: number;
};

// areaOfFocusId 0 = "Uncategorised" (projects with no area of focus set).
export type AreaStat = { areaOfFocusId: number; name: string; projects: number };

export type ProjectCard = {
  id: number;
  yearId: number; // needed for the detail link: /projects/{id}?yearId=
  title: string;
  projectDate: string | null;
  projectCost: number | null;
  currency: string | null;
  directBeneficiaries: number | null;
  areaOfFocus: string | null;
  clubId: number;
  clubName: string | null;
  city: string | null;
  state: string | null;
  districtNumber: string | null;
  primaryPhoto: string | null;
};

export type ProjectPage = {
  items: ProjectCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ProjectFilters = {
  yearId?: number;
  state?: string;
  districtId?: number;
  clubId?: number;
  areaOfFocusId?: number; // 0 = uncategorised bucket
  /** Free text matched against the project's title and area of focus, word by word,
   *  server-side. The ONLY way to narrow the listing by subject: it holds 6+ lakh
   *  projects and serves 48 a page, so the browser never has enough rows to filter. */
  q?: string;
  page?: number;
  pageSize?: number; // API clamps to 1..48
};

const BASE = "/site-data/rotary/project-stats";

/** Build a query string, skipping undefined values (0 is kept — it's meaningful for areaOfFocusId). */
function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Fetch + parse JSON; null on any HTTP or network failure. Never throws. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Zone-wide totals, year list, and current-year snapshot. */
export async function getOverview(): Promise<Overview | null> {
  return getJson<Overview>(`${BASE}/overview`);
}

/** Project/club counts per state. Omitted yearId = current rotary year. */
export async function getStates(yearId?: number): Promise<StateStat[]> {
  return (await getJson<StateStat[]>(`${BASE}/states${qs({ yearId })}`)) ?? [];
}

/* Administrative, non-geographic districts the public site never shows: they are
   manually managed and do not belong in a "browse by district" filter. Excluded
   at the source so the Districts tab, its count, the universal search and the
   club fan-out all agree. */
const HIDDEN_DISTRICT_NUMBERS = new Set(["5656", "ifrm india"]);

const visibleDistricts = (list: DistrictStat[]) =>
  list.filter((d) => !HIDDEN_DISTRICT_NUMBERS.has(String(d.districtNumber ?? "").trim().toLowerCase()));

/** Districts within a state. */
export async function getDistricts(
  state: string,
  yearId?: number
): Promise<DistrictStat[]> {
  const url = `${BASE}/states/${encodeURIComponent(state)}/districts${qs({ yearId })}`;
  return visibleDistricts((await getJson<DistrictStat[]>(url)) ?? []);
}

/**
 * Districts across every zone, or within one state when `state` is given. Powers the
 * "Districts" browse tab before a state has been chosen (getDistricts needs a state).
 */
export async function getAllDistricts(
  state?: string,
  yearId?: number
): Promise<DistrictStat[]> {
  const url = `${BASE}/districts${qs({ state, yearId })}`;
  return visibleDistricts((await getJson<DistrictStat[]>(url)) ?? []);
}

/** Clubs within a district that have at least one project in the year. */
export async function getClubs(
  districtId: number,
  yearId?: number
): Promise<ClubStat[]> {
  const url = `${BASE}/districts/${districtId}/clubs${qs({ yearId })}`;
  return (await getJson<ClubStat[]>(url)) ?? [];
}

/** A club annotated with the district it was fetched under — the shape the
 *  universal search needs to label and apply a club picked from anywhere. */
export type GlobalClub = ClubStat & { districtId: number; districtNumber: string };

// The API only serves clubs per district, so a zone-wide club search fans out
// one getClubs call per district, a few at a time so a two-character query
// never bursts dozens of simultaneous requests at the backend. Fetched lazily
// (first time someone actually types a club query) and memoized per year, so a
// session pays for it at most once per year filter — including on failure:
// per-district errors resolve [] silently (house style), so those districts'
// clubs are simply missing from search until a reload. Accepted tradeoff.
const allClubsCache = new Map<string, Promise<GlobalClub[]>>();
const CLUB_FANOUT_CONCURRENCY = 8;

export function getAllClubs(yearId?: number): Promise<GlobalClub[]> {
  const key = String(yearId ?? "all");
  let promise = allClubsCache.get(key);
  if (!promise) {
    promise = (async () => {
      const districts = await getAllDistricts(undefined, yearId);
      const all: GlobalClub[] = [];
      for (let i = 0; i < districts.length; i += CLUB_FANOUT_CONCURRENCY) {
        const chunk = districts.slice(i, i + CLUB_FANOUT_CONCURRENCY);
        const lists = await Promise.all(
          chunk.map(async (d) =>
            (await getClubs(d.districtId, yearId)).map((c) => ({
              ...c,
              districtId: d.districtId,
              districtNumber: d.districtNumber,
            }))
          )
        );
        all.push(...lists.flat());
      }
      return all;
    })();
    allClubsCache.set(key, promise);
  }
  return promise;
}

/** Area-of-focus breakdown for one club. */
export async function getAreas(
  clubId: number,
  yearId?: number
): Promise<AreaStat[]> {
  const url = `${BASE}/clubs/${clubId}/areas${qs({ yearId })}`;
  return (await getJson<AreaStat[]>(url)) ?? [];
}

/**
 * Area-of-focus breakdown scoped to the CURRENT drill-down (state / district),
 * or zone-wide when neither is set — so Area of Focus can be a top-level filter
 * (like rotaryindia.org), not just per-club. Falls back to [] until the
 * `project-stats/areas` endpoint is deployed; the UI then uses per-club areas.
 */
export async function getScopeAreas(
  filters: { state?: string; districtId?: number; yearId?: number } = {}
): Promise<AreaStat[]> {
  const url = `${BASE}/areas${qs({
    state: filters.state,
    districtId: filters.districtId,
    yearId: filters.yearId,
  })}`;
  return (await getJson<AreaStat[]>(url)) ?? [];
}

/**
 * Totals for the CURRENT selection (same filter set as getProjects). Lets the stat strip
 * report the chosen slice instead of the zone-wide figure the moment a filter is on.
 */
export type SummaryStat = {
  totalProjects: number;
  clubsInvolved: number;
  valueInr: number;
  beneficiaries: number;
  manHours: number;
};

export async function getSummary(
  filters: Omit<ProjectFilters, "page" | "pageSize"> = {}
): Promise<SummaryStat | null> {
  const url = `${BASE}/summary${qs({
    yearId: filters.yearId,
    state: filters.state,
    districtId: filters.districtId,
    clubId: filters.clubId,
    areaOfFocusId: filters.areaOfFocusId,
    q: filters.q,
  })}`;
  return getJson<SummaryStat>(url);
}

/** Paged project cards; all filters optional and combinable. */
export async function getProjects(
  filters: ProjectFilters = {}
): Promise<ProjectPage | null> {
  const url = `${BASE}/projects${qs({
    yearId: filters.yearId,
    state: filters.state,
    districtId: filters.districtId,
    clubId: filters.clubId,
    areaOfFocusId: filters.areaOfFocusId,
    q: filters.q,
    page: filters.page,
    pageSize: filters.pageSize,
  })}`;
  return getJson<ProjectPage>(url);
}

// ── Availability probe ─────────────────────────────────────────────
// The stats controller may not be deployed to the live API yet. Pages call
// statsAvailable() once and fall back to bundled data when it resolves false.
// Memoized in module scope so a page pays for at most one overview fetch.
let availabilityProbe: Promise<boolean> | null = null;

export function statsAvailable(): Promise<boolean> {
  if (!availabilityProbe) {
    availabilityProbe = getOverview().then((overview) => {
      // A failed probe (API restarting, transient network) must not condemn
      // the whole session to the bundled fallback — forget it so the next
      // mount retries.
      if (overview === null) availabilityProbe = null;
      return overview !== null;
    });
  }
  return availabilityProbe;
}
