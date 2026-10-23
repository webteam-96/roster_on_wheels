// Year-partitioned snapshot of the public project-stats API. SERVER ONLY.
//
// The shape of this cache follows the shape of the data's volatility:
//
//   frozen slices  — one summary per PAST rotary year. Those tables don't change
//                    once the year closes, so a slice is fetched once and kept.
//                    Filled lazily, the first time someone selects that year.
//   live slice     — the CURRENT year's summary. The only thing that moves, so the
//                    only thing the freshness probe re-reads (~0.3s).
//   all years      — NOT re-queried. Computed as the zone-wide figure captured at
//                    build time, plus the current year's drift since then.
//
// That last line is the point of the whole design. A zone-wide query unions every
// rotary_projects_YYYY_YY table and measures 8-10 SECONDS cold, while the same query
// scoped to one year measures 0.1-1.0s. Deriving the all-years total by arithmetic
// keeps the 8-second query off the visitor's path entirely.
//
// Caveat, deliberate: clubsInvolved is a COUNT(DISTINCT club), so it CANNOT be summed
// or drifted — a club active in two years would be counted twice. It is carried from
// the last full build and corrected on the next one. It moves by a handful of clubs a
// year against a base of ~2,275, so the drift is invisible; correctness of the additive
// metrics is what matters minute to minute.

import { readSnapshot, writeSnapshot, discardSnapshot } from "@/lib/statsCache";
// shared.tsx carries no "use client" precisely so server code can import from it.
// Imported rather than re-listed: if a cause is ever added to AREA_TABS, a duplicated
// copy here would silently drop it from the cache instead of failing loudly.
import { AREA_TABS, normArea } from "@/components/pages/projects/shared";
import type {
  AreaStat,
  DistrictStat,
  Overview,
  ProjectPage,
  StateStat,
  SummaryStat,
  YearRef,
} from "@/lib/projectStats";

const API_BASE = process.env.PROJECTS_API_BASE ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "";
const STATS = `${API_BASE}/api/public/project-stats`;

/** Swallows a rejection from a fire-and-forget call. Nothing awaits these, and an
 *  unhandled rejection terminates the Node process — a cache fault must never do that. */
const noop = () => {};

/** Zone-wide queries genuinely take 8-10s; anything past this is a fault, not slowness. */
const UPSTREAM_TIMEOUT_MS = 45_000;

/**
 * Bumped whenever the API changes what counts as a project (see ProjectCountRules.cs).
 *
 * The snapshot lives on disk, outside the build output, and is trusted for 12 hours — so
 * without this a deploy that changes the counting rules would keep serving the OLD totals
 * for half a day, against a database that had already moved. A snapshot stamped with a
 * different version is treated as missing and rebuilt on the spot.
 *
 * 2 = the 2026-09-28 rules: an ongoing project counts once (parent, or its first entry of
 * this year when the parent is from an earlier year), no Zone 0 / exempt districts.
 */
const RULES_VERSION = 2;

export type Snapshot = {
  builtAt: string;
  /** See RULES_VERSION. Absent on a snapshot written before this existed. */
  rulesVersion?: number;
  currentYearId: number;
  years: YearRef[];
  /** Zone-wide overview as captured at build time. */
  overview: Overview;
  /** Zone-wide summary as captured at build time — the baseline for drift. */
  allAtBuild: SummaryStat;
  /** Current-year summary as captured at build time — the other half of the drift. */
  currentAtBuild: SummaryStat;
  /** Latest known current-year summary. The freshness probe replaces this alone. */
  current: SummaryStat;
  /** Frozen past-year summaries, keyed by yearId. Filled on demand. */
  frozenYears: Record<string, SummaryStat>;
  states: StateStat[];
  districts: DistrictStat[];
  areas: AreaStat[];
  /** Page 1 of the unfiltered listing. OPTIONAL because it is deliberately not part of
   *  the cold build — see build() below. Absent means "not fetched yet", and the proxy
   *  forwards that one request upstream until it lands. */
  projectsPage1?: ProjectPage;
};

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${STATS}${path}`, {
      cache: "no-store", // we own the caching; Next must not add a second layer
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchYearSummary = (yearId: number) =>
  get<SummaryStat>(`/summary?yearId=${yearId}`);

/**
 * Keep only the area rows the UI can actually use.
 *
 * The zone-wide /areas endpoint answers with ~3,028 rows (3,024 distinct names across
 * just 66 areaOfFocusIds) — free-text cause spellings, most with a handful of projects
 * each. 204 KB of the snapshot's 232 KB was this one list.
 *
 * The only consumer is ProjectsHub's `areaByKey` memo, which walks the seven canonical
 * AREA_TABS and takes the FIRST row whose normArea(name) matches. Keeping exactly those
 * rows, in their original order, leaves that lookup returning the identical row — same
 * areaOfFocusId, same project count — so the cause tabs, their counts and the filtering
 * they drive are untouched.
 *
 * Fails open: if the match ever comes back empty against a non-empty payload (the API
 * renames its causes), the full list is kept rather than shipping a cache that would
 * quietly break every cause tab.
 */
function trimAreas(areas: AreaStat[]): AreaStat[] {
  const canonical = new Set(AREA_TABS.map((t) => normArea(t.key)));
  const kept = areas.filter((a) => canonical.has(normArea(a.name)));
  return kept.length === 0 && areas.length > 0 ? areas : kept;
}

/**
 * Build every slice a cold cache needs, in ONE parallel fan-out — including the 21-second
 * card listing.
 *
 * Measured, because the intuition is wrong: pulling that slowest query out of the fan-out
 * and running it afterwards looks like it should get the numbers up sooner, and it does
 * (18s instead of 23s) — but the cards then land at 44s instead of 23s, because these
 * queries contend on the same database rather than running independently. Issuing all six
 * together costs ~2s over the slowest one alone. Keep them together.
 */
async function build(): Promise<Snapshot | null> {
  const [overview, allAtBuild, states, districts, areas, projectsPage1] = await Promise.all([
    get<Overview>("/overview"),
    get<SummaryStat>("/summary"),
    get<StateStat[]>("/states"),
    get<DistrictStat[]>("/districts"),
    get<AreaStat[]>("/areas"),
    get<ProjectPage>("/projects?page=1&pageSize=50"),
  ]);

  // Without these there is no snapshot worth keeping — leave the cache empty so the
  // page falls back to fetching live, and try again on the next request.
  //
  // states/districts/areas are in this guard, not defaulted to [], because the proxy
  // serves them as a cache HIT: one failed sub-query here (these are 8-10s zone-wide
  // queries, so a blip is not rare) would pin "States 0 · Districts 0" on the browse
  // pills for the snapshot's full 12-hour life, with no upstream request left to
  // correct it. projectsPage1 stays optional — the proxy forwards that one upstream
  // while it is absent, so its failure costs latency, not correctness.
  if (!overview || !allAtBuild || !states || !districts || !areas) return null;

  // The API's own notion of "current year" — never inferred from today's date, which
  // would disagree with the backend across the July rotary-year boundary.
  const currentYearId = overview.currentYear?.yearId ?? overview.years[0]?.yearId;
  if (currentYearId === undefined) return null;

  const currentAtBuild = (await fetchYearSummary(currentYearId)) ?? {
    totalProjects: 0,
    clubsInvolved: 0,
    valueInr: 0,
    beneficiaries: 0,
    manHours: 0,
  };

  return {
    builtAt: new Date().toISOString(),
    rulesVersion: RULES_VERSION,
    currentYearId,
    years: overview.years,
    overview,
    allAtBuild,
    currentAtBuild,
    current: currentAtBuild,
    frozenYears: {},
    states,
    districts,
    areas: trimAreas(areas),
    // May be null if that one query failed — the type allows its absence, and the proxy
    // forwards the listing upstream until a later refresh fills it in.
    projectsPage1: projectsPage1 ?? undefined,
  };
}

/** One build at a time per worker; concurrent callers share the in-flight promise
 *  instead of each firing their own 10-second fan-out. */
let building: Promise<Snapshot | null> | null = null;

function buildAndStore(): Promise<Snapshot | null> {
  if (!building) {
    building = build()
      .then(async (snap) => {
        // Either a fresh snapshot is somehow over the ceiling, or the cache directory
        // is unwritable. Both mean "no cache": the page falls back to fetching live,
        // which is slow but correct. Rebuilding again would just repeat the failure.
        if (snap && (await writeSnapshot(snap)) !== "ok") return null;
        // Only if the listing query was the one thing that failed — everything else is
        // already live, so fill the gap without waiting for the next change.
        if (snap && !snap.projectsPage1) void refreshCards(true).catch(noop);
        return snap;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

/**
 * Persist a snapshot that has GROWN — a frozen year appended, fresh cards, new current
 * year figures.
 *
 * If the write is refused the snapshot has crossed the 1 MB ceiling, and the response is
 * to rebuild the whole thing from scratch rather than keep patching a cache that is too
 * big to trust: a fresh build starts with no frozen years at all, so every slice — past
 * years, all years and the current year — comes back clean and small. writeSnapshot has
 * already deleted the oversized file by this point, so there is no window where a
 * too-large snapshot is still being served.
 */
async function store(snap: Snapshot): Promise<void> {
  // Only "too-large" earns a rebuild. An "io-error" would fail again immediately, so
  // rebuilding on it would fire a fresh 30-second fan-out every time the probe saw a
  // change — hammering the API because a folder is read-only.
  if ((await writeSnapshot(snap)) === "too-large") void buildAndStore().catch(noop);
}

/**
 * How old a snapshot may get before it rebuilds itself.
 *
 * The freshness probe keeps the project TOTALS exact within ~0.3s, but it deliberately
 * touches nothing else — so the per-state, per-district and per-cause counts in the
 * browse panel, and the carried clubsInvolved distinct count, only move on a full
 * rebuild. This is what keeps them honest without anyone scheduling anything.
 *
 * 12 hours because those counts run to five figures and shift by a few hundred a day:
 * invisible drift, against a rebuild that costs ~30s of slow queries. Halve it if you
 * want the browse counts tighter; it is just this constant.
 */
const MAX_SNAPSHOT_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * The snapshot, or null if there isn't one yet.
 *
 * NEVER blocks on a build, in either direction:
 *  - no snapshot  → kick off a build and return null, so the first visitor after a
 *                   deploy gets the live fallback path rather than a 30-second wait.
 *  - stale snapshot → serve it AS IS and rebuild behind the request. Slightly old
 *                   browse counts beat making someone wait for fresh ones.
 */
export async function getSnapshot(): Promise<Snapshot | null> {
  const snap = await readSnapshot<Snapshot>();
  // A snapshot from before the counting rules changed holds numbers the API would no longer
  // produce. Serving it for even one request would put a different project total on the page
  // than the one the daily report emails, which is the whole thing these rules exist to stop.
  if (!snap || snap.rulesVersion !== RULES_VERSION) {
    if (snap) await discardSnapshot();
    void buildAndStore().catch(noop); // fire-and-forget
    return null;
  }

  const builtAt = Date.parse(snap.builtAt);
  // An unparseable builtAt counts as stale — a snapshot that can't say how old it is
  // is one we should replace, not trust.
  if (Number.isNaN(builtAt) || Date.now() - builtAt > MAX_SNAPSHOT_AGE_MS) {
    void buildAndStore().catch(noop);
  }
  return snap;
}

/** Full rebuild, awaited. For the secret-guarded refresh endpoint only. */
export async function rebuild(): Promise<Snapshot | null> {
  await discardSnapshot();
  return buildAndStore();
}

// ── Derived reads ──────────────────────────────────────────────────

/** Additive metrics only — see the clubsInvolved caveat at the top of this file. */
export function allYearsSummary(snap: Snapshot): SummaryStat {
  const d = snap.current;
  const b = snap.currentAtBuild;
  return {
    totalProjects: snap.allAtBuild.totalProjects + (d.totalProjects - b.totalProjects),
    valueInr: snap.allAtBuild.valueInr + (d.valueInr - b.valueInr),
    beneficiaries: snap.allAtBuild.beneficiaries + (d.beneficiaries - b.beneficiaries),
    manHours: snap.allAtBuild.manHours + (d.manHours - b.manHours),
    clubsInvolved: snap.allAtBuild.clubsInvolved, // distinct count — carried, never drifted
  };
}

/** The overview with the same drift applied, so the header totals and the stat strip
 *  can never disagree about how many projects exist. */
export function driftedOverview(snap: Snapshot): Overview {
  const d = snap.current;
  const b = snap.currentAtBuild;
  const dProjects = d.totalProjects - b.totalProjects;
  return {
    ...snap.overview,
    totalProjects: snap.overview.totalProjects + dProjects,
    totalCost: snap.overview.totalCost + (d.valueInr - b.valueInr),
    totalBeneficiaries: snap.overview.totalBeneficiaries + (d.beneficiaries - b.beneficiaries),
    totalManHours: snap.overview.totalManHours + (d.manHours - b.manHours),
    currentYear: snap.overview.currentYear
      ? {
          ...snap.overview.currentYear,
          totalProjects: d.totalProjects,
          totalCost: d.valueInr,
          totalBeneficiaries: d.beneficiaries,
        }
      : null,
  };
}

/** A single year's summary: the live slice for the current year, a frozen slice for a
 *  past one. A past year missing from the cache is fetched once (~1s) and frozen — that
 *  is why the ~25 historical years never have to be built up front. */
export async function yearSummary(
  snap: Snapshot,
  yearId: number
): Promise<SummaryStat | null> {
  if (yearId === snap.currentYearId) return snap.current;

  const hit = snap.frozenYears[String(yearId)];
  if (hit) return hit;

  const fresh = await fetchYearSummary(yearId);
  if (!fresh) return null;
  snap.frozenYears[String(yearId)] = fresh;
  await store(snap);
  return fresh;
}

/**
 * Re-read the current year (~0.3s) and swap it in if it moved.
 *
 * This is the entire freshness mechanism: one narrow query, and every all-years figure
 * follows by arithmetic. Nothing else in the snapshot is touched — the frozen years,
 * state list, district list and area list are left exactly as they were.
 */
export async function probeCurrentYear(): Promise<{
  changed: boolean;
  current: SummaryStat | null;
}> {
  const snap = await readSnapshot<Snapshot>();
  // Same version guard as getSnapshot: never patch a fresh current-year figure into a
  // snapshot whose other numbers were counted under the old rules.
  if (!snap || snap.rulesVersion !== RULES_VERSION) {
    if (snap) await discardSnapshot();
    void buildAndStore().catch(noop);
    return { changed: false, current: null };
  }

  const fresh = await fetchYearSummary(snap.currentYearId);
  if (!fresh) return { changed: false, current: snap.current }; // upstream blip — keep what we have

  const changed = (Object.keys(fresh) as (keyof SummaryStat)[]).some(
    (k) => fresh[k] !== snap.current[k]
  );
  if (changed) {
    snap.current = fresh;
    await store(snap);
    void refreshCards().catch(noop); // background — see below for why this is not awaited
  }
  return { changed, current: fresh };
}

/**
 * Shortest gap between two card refreshes.
 *
 * The zone-wide listing is a 21-second query and this API sees projects added
 * continuously, so this floor is the only thing keeping one from running permanently.
 * At 60s that query is in flight roughly a third of the time during busy hours — the
 * deliberate trade for new projects reaching the unfiltered grid within a minute.
 * Raise it if the database feels the load; refreshingCards already prevents two from
 * overlapping, so the floor only controls frequency, never concurrency.
 */
const CARD_REFRESH_FLOOR_MS = 60_000;
let cardsRefreshedAt = 0;
let refreshingCards = false;

/**
 * Pull page 1 of the zone-wide listing into the snapshot.
 *
 * Never awaited by the probe, and that is the whole point: page 1 of the all-years
 * listing is the single most expensive query on this API — 21 SECONDS, worse than the
 * 8-10s aggregates — because it unions every year table and then sorts. Awaiting it
 * would put the slowest query in the product directly onto the path of a probe that
 * exists to be fast, which is exactly the delay this cache was built to remove.
 *
 * The visible consequence is bounded and deliberate: the stat numbers are exact within
 * ~0.3s of any change, while a brand-new project takes up to CARD_REFRESH_FLOOR_MS to
 * appear at the top of the unfiltered card grid. Filtered views are unaffected — those
 * are scoped queries and go upstream live.
 */
async function refreshCards(force = false): Promise<void> {
  const now = Date.now();
  // force = a cold build with no cards at all. The floor exists to stop a busy API being
  // hammered by repeat refreshes, not to leave a fresh cache without its listing.
  if (refreshingCards || (!force && now - cardsRefreshedAt < CARD_REFRESH_FLOOR_MS)) return;
  refreshingCards = true;
  cardsRefreshedAt = now;
  try {
    const page1 = await get<ProjectPage>("/projects?page=1&pageSize=50");
    if (!page1) return;
    // Re-read rather than reusing the caller's object: 21 seconds is long enough for
    // another request to have added a frozen year slice, and writing a stale in-memory
    // copy over the top would silently drop it.
    const latest = await readSnapshot<Snapshot>();
    if (!latest) return;
    latest.projectsPage1 = page1;
    await store(latest);
  } catch {
    /* upstream blip — the snapshot keeps the cards it already has */
  } finally {
    refreshingCards = false;
  }
}
