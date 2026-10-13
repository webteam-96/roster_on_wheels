"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TOTALS } from "@/components/pages/projects/data";
import { ChoiceBrowser } from "@/components/pages/projects/ChoiceBrowser";
import { UniversalSearch } from "@/components/pages/projects/UniversalSearch";
import RotaryLoader from "@/components/RotaryLoader";
import {
  AREA_TABS,
  ChoiceCard,
  ChoiceCardGrid,
  EmptyState,
  areaColor,
  FilterChips,
  Pagination,
  ProjectCard,
  StatStrip,
  fmt,
  inrParts,
  isClubService,
  niceDate,
  normArea,
  parseTime,
  rotaryYearOf,
  titleCase,
  type CardData,
  type SampleProject,
} from "@/components/pages/projects/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { photoUrl } from "@/lib/projectsApi";
import {
  getAllDistricts,
  getAreas,
  getClubs,
  getDistricts,
  getOverview,
  getProjects,
  getScopeAreas,
  getStates,
  getSummary,
  statsAvailable,
  type AreaStat,
  type ClubStat,
  type DistrictStat,
  type Overview,
  type ProjectPage,
  type StateStat,
  type SummaryStat,
} from "@/lib/projectStats";

import { currencySymbol } from "@/lib/appFormat";
const PAGE_SIZE = 50;

/* Search pacing. Both exist because one project search costs the API a scan across
   ~27 year tables — seconds, not milliseconds — so the goal is to send ONE query
   per thing the user actually meant, never one per keystroke.
   ponytail: fixed numbers, tuned against the measured timings in the search effect
   below. If the listing ever gets a real index (FULLTEXT on title, or a search
   table), both can come down. */
const SEARCH_DEBOUNCE_MS = 500;
const SEARCH_MIN_CHARS = 3;

/** 0 = the title IS the query, 1 = it contains the query as a phrase, 2 = the rest. */
function searchRank(query: string, title: string) {
  const q = query.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  return t === q ? 0 : t.includes(q) ? 1 : 2;
}

/** The four browsable dimensions, plus "" for "no card grid open". */
type BrowseTab = "" | "areas" | "states" | "districts" | "clubs";

/**
 * One browse dimension as a BUTTON — a pill that fills navy when its panel is
 * open, with the reachable-count as a small badge. The count is deliberately
 * quiet: it says how many choices are behind the name, which is menu
 * information, not an achievement.
 */
function BrowseLink({
  label,
  count,
  active,
  onClick,
  dot,
}: {
  label: string;
  /** null = the list this counts hasn't answered yet. Rendered as a pulse, because
   *  "0" is a claim, and one the page kept making through every slow or failed
   *  zone-wide query. */
  count: number | null;
  active: boolean;
  onClick: () => void;
  /** Cause colour, shown only once a cause is actually chosen. */
  dot?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={
        "inline-flex min-h-10 w-full items-center justify-center gap-2.5 rounded-xl px-4 py-2 text-[14px] font-semibold tracking-[-0.005em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:w-auto sm:justify-start " +
        (active
          ? "bg-navy-950 text-cream shadow-soft"
          : "bg-white text-navy-950 ring-1 ring-navy-950/[0.12] hover:ring-gold-dark")
      }
    >
      {dot && (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ background: dot }}
        />
      )}
      <span>{label}</span>
      <span
        className={
          "figure rounded-full px-1.5 py-0.5 text-[11px] transition-colors " +
          (active ? "bg-cream/15 text-cream" : "bg-navy-950/[0.06] text-navy-950/70")
        }
      >
        {count === null ? (
          <span className="inline-block h-2 w-4 animate-pulse rounded-full bg-current/40 align-middle" />
        ) : (
          fmt(count)
        )}
      </span>
    </button>
  );
}

/* ——— Derivation helpers ——— */

/** Unique non-empty values of a field with occurrence counts, sorted A→Z. */
function countBy(
  list: SampleProject[],
  pick: (p: SampleProject) => string | null
): { value: string; count: number }[] {
  const map = new Map<string, number>();
  for (const p of list) {
    const v = (pick(p) ?? "").trim();
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/* ——— Shared listing header (gold rule + H2) ——— */

function ListingHead() {
  return (
    <div className="mt-16 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div data-animate="rule" className="rule-gold" />
        <h2
          data-animate="up"
          data-animate-duration="0.7"
          className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
        >
          Find projects, your way
        </h2>
      </div>
    </div>
  );
}

/* ——— FEATURE+GRID listing ——— */

function CardGrid({ cards }: { cards: CardData[] }) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <ProjectCard key={c.key} p={c} />
      ))}
    </div>
  );
}

/* ——— Fallback hub — analytics from bundled TOTALS, drill-down from the fetched sample.
       Rendered while the live-stats probe is pending, and kept when it fails. ——— */

function SampleHub({
  projects: allProjects,
  initialArea,
}: {
  projects: SampleProject[];
  initialArea?: string;
}) {
  // Drop Club Service (internal avenue) and future-dated rows from the public
  // listing — a "done" date that hasn't happened yet is bad data.
  const projects = useMemo(
    () =>
      allProjects.filter(
        (p) => !isClubService(p) && (parseTime(p.projectDate) ?? 0) <= Date.now()
      ),
    [allProjects]
  );

  /* Cascading selections — "" = not chosen */
  const [stateSel, setStateSel] = useState("");
  const [districtSel, setDistrictSel] = useState("");
  const [clubSel, setClubSel] = useState("");
  const [areaSel, setAreaSel] = useState(initialArea ?? "");
  const [page, setPage] = useState(1);

  /* Which browse dimension is open. "" = none, so the listing is what you see
     first; the cards for a dimension appear only once its tab is clicked. */
  const [browseTab, setBrowseTab] = useState<BrowseTab>("");

  /* The search box's text. Unlike the live hub this hub holds every bundled row
     in memory, so the same query filters the listing directly — no debounce, no
     fetch. searchActive swaps the results box in for the browse panel. */
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const searchActive = typed.length > 0;
  const clearSearch = () => {
    setQuery("");
    setPage(1);
  };

  /* Rotary years present in the sample, newest first */
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      const t = parseTime(p.projectDate);
      if (t !== null) set.add(rotaryYearOf(t));
    }
    return Array.from(set).sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)));
  }, [projects]);

  /* Default view = the most recent Rotary year present in the data — unless that
     year is too thin in the sample (< 6 projects), then start on "All years" so
     the first paint never looks empty. A cause deep-link also starts on all
     years so the pre-filter has the whole sample to draw from. */
  const [yearSel, setYearSel] = useState(() => {
    if (initialArea) return "all";
    let newest: number | null = null;
    for (const p of projects) {
      const t = parseTime(p.projectDate);
      if (t !== null && (newest === null || t > newest)) newest = t;
    }
    if (newest === null) return "all";
    const year = rotaryYearOf(newest);
    const inYear = projects.filter((p) => {
      const t = parseTime(p.projectDate);
      return t !== null && rotaryYearOf(t) === year;
    }).length;
    return inYear >= 6 ? year : "all";
  });

  /* Selection handlers. The three geography picks REPLACE each other — a club
     sits inside exactly one district inside one state, so stacking them adds
     nothing, and one chip is easier to read and clear than three. Area of Focus
     is deliberately kept: it is an independent facet that combines with the
     geography in both directions (pick a cause and the geo lists narrow to the
     places that worked on it — and vice versa). */
  const pickState = (v: string) => {
    setStateSel(v);
    setDistrictSel("");
    setClubSel("");
    setPage(1);
  };
  const pickDistrict = (v: string) => {
    setDistrictSel(v);
    setStateSel("");
    setClubSel("");
    setPage(1);
  };
  const pickClub = (v: string) => {
    setClubSel(v);
    setStateSel("");
    setDistrictSel("");
    setPage(1);
  };
  const pickArea = (v: string) => {
    setAreaSel(v);
    setPage(1);
  };
  const pickYear = (v: string) => {
    setYearSel(v);
    setPage(1);
  };
  const clearAll = () => {
    setStateSel("");
    setDistrictSel("");
    setClubSel("");
    setAreaSel("");
    setYearSel("all");
    setQuery("");
    setPage(1);
  };

  /**
   * Applying a card.
   *
   * `replace` is the difference between the two places a card can be clicked.
   * A grid opened from a Browse by tab is a fresh start — it REPLACES whatever
   * was selected, so the browse row never carries more than one filter at once.
   * A grid shown underneath an existing selection (the scoped ones: "States
   * working on Environment") is the inner filter, and there picking ADDS to
   * what you already have. Clicking the active card clears it either way.
   */
  const pickBrowse = (
    apply: (v: string) => void,
    value: string,
    current: string,
    replace: boolean
  ) => {
    const clearing = value === current;
    if (replace && !clearing) {
      setAreaSel("");
      setStateSel("");
      setDistrictSel("");
      setClubSel("");
    }
    apply(clearing ? "" : value);
    setBrowseTab("");
  };

  /* Year + cause scope — the base every geography facet derives from, so
     selecting a cause narrows the state / district / club lists to the ones
     that actually did a project in it. */
  const scoped = useMemo(() => {
    const key = normArea(areaSel);
    return projects.filter((p) => {
      if (yearSel !== "all") {
        const t = parseTime(p.projectDate);
        if (t === null || rotaryYearOf(t) !== yearSel) return false;
      }
      // Normalised so home-page cause deep-links (?area=…) hit the API's
      // free-text spellings.
      return !areaSel || normArea(p.areaOfFocus ?? "") === key;
    });
  }, [projects, yearSel, areaSel]);

  const inState = useMemo(
    () => (stateSel ? scoped.filter((p) => (p.clubState ?? "").trim() === stateSel) : scoped),
    [scoped, stateSel]
  );
  const inDistrict = useMemo(
    () =>
      districtSel
        ? inState.filter((p) => (p.districtNumber ?? "").trim() === districtSel)
        : inState,
    [inState, districtSel]
  );
  const inClub = useMemo(
    () => (clubSel ? inDistrict.filter((p) => (p.clubName ?? "").trim() === clubSel) : inDistrict),
    [inDistrict, clubSel]
  );

  /* Every dropdown lists EVERY option still reachable at its level — districts
     and clubs are not gated behind a shallower pick, they simply narrow when
     one is made: state → its districts and its clubs, district → its clubs. */
  const states = useMemo(() => countBy(scoped, (p) => p.clubState), [scoped]);
  const districts = useMemo(() => countBy(inState, (p) => p.districtNumber), [inState]);
  const clubs = useMemo(() => countBy(inDistrict, (p) => p.clubName), [inDistrict]);

  /* Universal search draws from the year+cause scope only — it exists to JUMP
     anywhere, so the current geography pick must not hide places from it. */

  /* Cause-tab counts read the geo + year scope with the cause filter LIFTED, so
     each tab shows what picking it would actually yield. */
  const areaBase = useMemo(
    () =>
      projects.filter((p) => {
        if (yearSel !== "all") {
          const t = parseTime(p.projectDate);
          if (t === null || rotaryYearOf(t) !== yearSel) return false;
        }
        if (stateSel && (p.clubState ?? "").trim() !== stateSel) return false;
        if (districtSel && (p.districtNumber ?? "").trim() !== districtSel) return false;
        if (clubSel && (p.clubName ?? "").trim() !== clubSel) return false;
        return true;
      }),
    [projects, yearSel, stateSel, districtSel, clubSel]
  );

  const areaCounts = useMemo(() => {
    const c: Record<string, number> = { "": areaBase.length };
    for (const t of AREA_TABS) {
      const key = normArea(t.key);
      c[t.key] = areaBase.filter((p) => normArea(p.areaOfFocus ?? "") === key).length;
    }
    return c;
  }, [areaBase]);

  /* The same numbers as cards — causes with nothing behind them are dropped so
     the grid never offers a choice that leads to an empty listing. */
  const areaChoices = useMemo(
    () =>
      AREA_TABS.map((t) => ({ value: t.key, count: areaCounts[t.key] ?? 0 }))
        .filter((a) => a.count > 0)
        .sort((a, b) => b.count - a.count),
    [areaCounts]
  );

  /* Listing: every active filter applied, sorted by done-date DESC — most
     recent project first, undated last. */
  /* Every word must be a WHOLE word of the project TITLE (a plural "s" on
     either side allowed), order-independent — so "heart surgery" no longer
     lists "Heartline Surgery". Title only: this is the bundled-sample fallback.
     The live hub's `q` also matches club, state, district, area, category and
     sub category — SearchSqlAsync() in PublicProjectStatsController.cs. */
  const terms = useMemo(
    () =>
      typed
        .toLowerCase()
        .replace(/['’]/g, "") // "children's" is one word, not "children" + "s"
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        // Drop one plural "s", but never from a word ending "ss" ("mass", "class"),
        // where it belongs to the word. Must stay identical to SearchSqlAsync() in
        // PublicProjectStatsController.cs — see universalSearch.check.mjs.
        .map((w) => (w.length > 3 ? w.replace(/(?<!s)s$/, "") : w))
        .map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}s?([^\\p{L}\\p{N}]|$)`, "iu")),
    [typed]
  );
  const filtered = useMemo(
    () =>
      inClub
        // A query of only punctuation ("---") has no terms: it matches nothing, not everything.
        .filter((p) => (terms.length ? terms.every((t) => t.test(p.title ?? "")) : !typed))
        .map((p) => ({ p, t: parseTime(p.projectDate), r: searchRank(typed, p.title ?? "") }))
        // Exact title first, then titles containing the phrase, then the rest — newest
        // first within each. Mirrors SearchRankSql() in PublicProjectStatsController.cs.
        .sort((a, b) => a.r - b.r || (b.t ?? -Infinity) - (a.t ?? -Infinity)),
    [inClub, terms, typed]
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* Stat strip. With nothing filtered it reports the bundled zone-wide
     cumulative truth scraped from example.org. The moment ANY filter is on
     it reports that selection instead, summed from the rows actually listed —
     otherwise the tiles would still claim 4.3 lakh projects while the listing
     below showed six. */
  const filteredStats = useMemo(() => {
    const rows = filtered.map((x) => x.p);
    return {
      projects: rows.length,
      inr: rows.reduce((s, p) => s + (p.projectCost ?? 0), 0),
      clubs: new Set(rows.map((p) => p.clubName).filter(Boolean)).size,
      manHours: rows.reduce((s, p) => s + (p.manHours ?? 0), 0),
    };
  }, [filtered]);

  const hasSelection = Boolean(areaSel || stateSel || districtSel || clubSel || typed);
  const isScoped = hasSelection || yearSel !== "all";
  const shown = isScoped ? filteredStats : TOTALS;
  const cost = inrParts(shown.inr);
  const hours = inrParts(shown.manHours);
  const plus = isScoped ? "" : "+";

  /* Removable filter chips */
  const chips: { label: string; onRemove: () => void }[] = [];
  if (stateSel) chips.push({ label: stateSel, onRemove: () => pickState("") });
  if (districtSel) chips.push({ label: `RID ${districtSel}`, onRemove: () => pickDistrict("") });
  if (clubSel) chips.push({ label: clubSel, onRemove: () => pickClub("") });
  if (areaSel) chips.push({ label: titleCase(areaSel), onRemove: () => pickArea("") });
  if (typed) chips.push({ label: `“${typed}”`, onRemove: clearSearch });

  /* What the body shows. An explicitly-opened tab shows that one grid. With no
     tab open but a filter chosen, every dimension still unpicked opens up —
     pick a cause and you get the states, districts and clubs working on it,
     with that cause's projects below. Nothing chosen at all = straight to the
     listing. */
  const selectedOf: Record<Exclude<BrowseTab, "">, string> = {
    areas: areaSel,
    states: stateSel,
    districts: districtSel,
    clubs: clubSel,
  };
  /* Geography is a hierarchy — a deeper pick implies the shallower levels
     (a district fixes its state), so those lists would only be noise. */
  const impliedByDeeperPick: Record<Exclude<BrowseTab, "">, boolean> = {
    areas: false,
    states: Boolean(districtSel || clubSel),
    districts: Boolean(clubSel),
    clubs: false,
  };
  const showGrid = (key: Exclude<BrowseTab, "">) =>
    browseTab === key ||
    (browseTab === "" && hasSelection && !selectedOf[key] && !impliedByDeeperPick[key]);

  /** "in Karnataka" / "in RID 3181" / "working on Environment" — the scope a
      grid is already narrowed to, so each heading says what you're looking at. */
  const scopeNote = districtSel
    ? `in RID ${districtSel}`
    : stateSel
      ? `in ${stateSel}`
      : areaSel
        ? `working on ${titleCase(areaSel)}`
        : "";

  const cards: CardData[] = pageItems.map(({ p, t }) => ({
    key: p.id,
    href: `/projects/${p.id}`,
    title: p.title,
    area: p.areaOfFocus?.trim() || null,
    where: [p.clubName ?? "Rotary Club", p.districtNumber ? `RID ${p.districtNumber}` : ""]
      .filter(Boolean)
      .join(" · "),
    date: niceDate(t),
    cost: p.projectCost,
    beneficiaries: p.directBeneficiaries,
    photo: p.primaryPhoto,
  }));

  return (
    <section className="bg-paper pb-24 lg:pb-28">
      <div className="container-rotary">
        {/* BROWSE — four dimension buttons + the year filter in one wrapping
            row. Each name carries its reachable count as a small badge: menu
            information, not a headline. */}
        <div className="pt-12 lg:pt-14">
          <p className="microlabel">Browse by</p>

          {/* Four dimension BUTTONS + the year filter, one wrapping row — pills
              reflow cleanly on phones where attached tabs broke the layout. */}
          <div
            role="group"
            aria-label="Choose what to browse by"
            className="relative mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <BrowseLink
              label="Area of Focus"
              count={areaChoices.length}
              active={browseTab === "areas"}
              onClick={() => setBrowseTab(browseTab === "areas" ? "" : "areas")}
              dot={areaSel ? areaColor(areaSel) : undefined}
            />
            <BrowseLink
              label="States"
              count={states.length}
              active={browseTab === "states"}
              onClick={() => setBrowseTab(browseTab === "states" ? "" : "states")}
            />
            <BrowseLink
              label="Districts"
              count={districts.length}
              active={browseTab === "districts"}
              onClick={() => setBrowseTab(browseTab === "districts" ? "" : "districts")}
            />
            <BrowseLink
              label="Clubs"
              count={clubs.length}
              active={browseTab === "clubs"}
              onClick={() => setBrowseTab(browseTab === "clubs" ? "" : "clubs")}
            />
            {/* ONE search over every dimension — replaces the per-panel inputs. */}
            <UniversalSearch
              query={query}
              onQueryChange={setQuery}
              note={
                <>
                  <span className="figure">{fmt(filtered.length)}</span>{" "}
                  {filtered.length === 1 ? "project matches" : "projects match"} &ldquo;{typed}&rdquo;
                  {" "}&mdash; shown below.
                </>
              }
            />
            <div className="order-first sm:order-none sm:ml-auto">
              <Select value={yearSel} onValueChange={pickYear}>
                <SelectTrigger
                  aria-label="Filter by Rotary year"
                  className="min-h-10 w-full gap-2 rounded-xl border-navy-950/15 bg-white px-4 text-[13px] font-semibold text-navy-950 shadow-none focus:ring-2 focus:ring-gold-dark sm:w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-md border-navy-950/10">
                  <SelectItem value="all" className="text-[13px] font-medium">
                    All years
                  </SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={y} className="text-[13px] font-medium">
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* PANEL — its own rounded surface beneath the button row. Hidden
              while a search query is live: the results box IS the panel then. */}
          {!searchActive && (browseTab !== "" || hasSelection) && (
            <div className="mt-4 rounded-xl border border-navy-950/[0.10] bg-porcelain px-6 py-7 lg:px-8">
              {showGrid("areas") && areaChoices.length > 0 && (
                <ChoiceCardGrid heading={`Areas of focus ${scopeNote}`.trim()}>
                  {areaChoices.map((a) => (
                    <ChoiceCard
                      key={a.value}
                      label={a.value}
                      count={a.count}
                      accent={areaColor(a.value)}
                      active={a.value === areaSel}
                      onClick={() => pickBrowse(pickArea, a.value, areaSel, browseTab === "areas")}
                    />
                  ))}
                </ChoiceCardGrid>
              )}

              {showGrid("states") && states.length > 0 && (
                <ChoiceBrowser
                  heading={`States ${scopeNote}`.trim()}
                  items={states.map((s) => ({
                    value: s.value,
                    label: s.value,
                    count: s.count,
                    active: s.value === stateSel,
                  }))}
                  onPick={(v) => pickBrowse(pickState, v, stateSel, browseTab === "states")}
                  collapsible={browseTab !== "states"}
                />
              )}

              {showGrid("districts") && districts.length > 0 && (
                <ChoiceBrowser
                  heading={`Districts ${scopeNote}`.trim()}
                  items={[...districts]
                    .sort((a, b) => Number(a.value) - Number(b.value))
                    .map((d) => ({
                      value: d.value,
                      label: `RID ${d.value}`,
                      count: d.count,
                      active: d.value === districtSel,
                    }))}
                  onPick={(v) => pickBrowse(pickDistrict, v, districtSel, browseTab === "districts")}
                  collapsible={browseTab !== "districts"}
                  keepOrder
                />
              )}

              {showGrid("clubs") && clubs.length > 0 && (
                <ChoiceBrowser
                  heading={`Clubs ${scopeNote}`.trim()}
                  items={clubs.map((c) => ({
                    value: c.value,
                    label: c.value,
                    count: c.count,
                    active: c.value === clubSel,
                  }))}
                  onPick={(v) => pickBrowse(pickClub, v, clubSel, browseTab === "clubs")}
                  collapsible={browseTab !== "clubs"}
                />
              )}
            </div>
          )}

          <div className="mt-5">
            {chips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="microlabel">Filtering by</span>
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={c.onRemove}
                    aria-label={`Remove filter ${c.label}`}
                    className="group inline-flex items-center gap-2 border-b border-navy-950/25 pb-0.5 text-[14px] font-semibold text-navy-950 transition-colors hover:border-gold-deep hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
                  >
                    {c.label}
                    <span aria-hidden className="text-ink/35 group-hover:text-gold-deep">
                      &times;
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[12px] font-medium text-ink/45 transition-colors hover:text-gold-deep"
                >
                  Clear all
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                Every project across the zones. Pick one above to narrow it down.
              </p>
            )}
          </div>
        </div>

        {/* Totals — zone-wide until you filter, then the selection's own numbers */}
        <StatStrip
          className="mt-10"
          stats={[
            {
              label: "Projects",
              target: shown.projects,
              suffix: plus,
            },
            {
              label: "Invested in service",
              target: cost.target,
              decimals: cost.decimals,
              prefix: currencySymbol(),
              suffix: cost.suffix,
              sub: undefined,   // ROW: one currency (the original added a $ line under the ₹ total)
              wide: true,
            },
            {
              label: isScoped ? "Clubs involved" : "Active clubs",
              target: shown.clubs,
              suffix: plus,
            },
            {
              label: "Volunteer man-hours",
              target: hours.target,
              decimals: hours.decimals,
              suffix: hours.suffix + plus,
            },
          ]}
        />

        <ListingHead />

        <FilterChips
          chips={chips}
          right={
            <>
              <span className="figure">{fmt(filtered.length)}</span>{" "}
              {filtered.length === 1 ? "project" : "projects"} &middot; page{" "}
              <span className="figure">{safePage}</span> of{" "}
              <span className="figure">{Math.max(totalPages, 1)}</span>
            </>
          }
        />

        <CardGrid cards={cards} />

        {filtered.length === 0 && (
          <EmptyState onClear={clearAll}>
            Nothing in the sample matches this combination for the selected Rotary year. Try
            removing a filter or widening to all years.
          </EmptyState>
        )}

        {totalPages > 1 && (
          <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
        )}
      </div>
    </section>
  );
}

/* ——— Freshness probe ———
   Asks the server "has the current rotary year moved since the cached snapshot?" once
   per visit, AFTER paint, and again whenever the tab is brought back to the front.

   It costs one ~0.3s request because it only ever looks at the current year: the
   zone-wide equivalent unions every year-partitioned table and takes 8-10 SECONDS. The
   all-years figures are derived from this one number by arithmetic on the server
   (see allYearsSummary in src/lib/projectStatsServer.ts), so nothing else is queried.

   Nobody waits on it — the page is already fully rendered from the snapshot when this
   fires. If nothing changed, and that is the normal case, it does nothing at all: no
   refetch, no re-render, no flicker. */
const PROBE_THROTTLE_MS = 60_000;

function useFreshnessProbe(onChanged: () => void) {
  // Held in a ref so a new closure each render can't re-arm the listeners.
  const cb = useRef(onChanged);
  cb.current = onChanged;

  useEffect(() => {
    let cancelled = false;
    let lastRun = 0;

    const probe = () => {
      const now = Date.now();
      if (now - lastRun < PROBE_THROTTLE_MS) return;
      lastRun = now;
      fetch("/site-data/projects-freshness", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d?.changed) cb.current();
        })
        .catch(() => {
          /* offline or a blip — the page keeps showing cached truth */
        });
    };

    probe();
    // A tab left open for hours catches up the moment someone looks at it again —
    // native visibility events, so there is no polling timer running in the background.
    const onWake = () => {
      if (document.visibilityState === "visible") probe();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);
}

/* ——— Live hub — header totals from /overview, cascading filters and paged
       cards straight from the project-stats API. Same layout as SampleHub. ——— */

function LiveHub({ overview, initialArea }: { overview: Overview; initialArea?: string }) {
  /* Cascading selections — null = not chosen (areaSel 0 = the uncategorised bucket) */
  const [stateSel, setStateSel] = useState("");
  const [districtSel, setDistrictSel] = useState<number | null>(null);
  const [clubSel, setClubSel] = useState<number | null>(null);
  // Cause tab: the selected canonical area key ("" = All) — the UI source of
  // truth; the API's areaOfFocusId is derived from it (see areaByKey below).
  const [areaKeySel, setAreaKeySel] = useState(() => {
    const m = AREA_TABS.find((t) => normArea(t.key) === normArea(initialArea ?? ""));
    return m?.key ?? "";
  });
  const [yearSel, setYearSel] = useState<number | null>(null); // null = every year (API omits yearId)
  const [page, setPage] = useState(1);

  /* Bumped when the freshness probe finds the current rotary year has moved. Listed in
     the deps of the two effects that show NUMBERS (summary) and CARDS (projects), so a
     change pulls exactly those back through the proxy — which by then is serving the
     snapshot the probe already corrected. The option lists are deliberately left alone. */
  const [freshNonce, setFreshNonce] = useState(0);
  useFreshnessProbe(() => setFreshNonce((n) => n + 1));

  /* Which browse dimension is open. "" = none, so the listing is what you see
     first; a dimension's cards appear only once its tab is clicked. */
  const [browseTab, setBrowseTab] = useState<BrowseTab>("");

  /* The search box's raw text, and the debounced copy that actually filters the
     listing. Declared up here with the other filter state because searchSel is one
     of filterKey's inputs; the effects that maintain them sit further down. */
  const [query, setQuery] = useState("");
  const [searchSel, setSearchSel] = useState("");
  const typed = query.trim();

  /* Option lists + the current page of cards, all fetched from the API.
     null = NOT ANSWERED YET, the same convention pageData already uses. It has to
     be distinguishable from []: the pill badges count these lists, and an empty
     array rendered "States 0 · Districts 0 · Clubs 0" — a confident, wrong claim —
     for the whole 10-20s a cold zone-wide query takes, and for as long as an
     upstream failure lasted. */
  const [states, setStates] = useState<StateStat[] | null>(null);
  const [districts, setDistricts] = useState<DistrictStat[] | null>(null);
  const [clubs, setClubs] = useState<ClubStat[] | null>(null);
  /* Universal-search sources: every district regardless of the state pick, and
     the zone-wide club list — fetched lazily on the first club-ish query. */
  const [allDistricts, setAllDistricts] = useState<DistrictStat[]>([]);
  /* Club picked FROM search — its name, so the chip can label itself before
     the district's own club list has loaded. */
  const [areas, setAreas] = useState<AreaStat[] | null>(null);
  const [scopeAreas, setScopeAreas] = useState<AreaStat[] | null>(null);
  const [pageData, setPageData] = useState<ProjectPage | null>(null);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryStat | null>(null);
  /* Which filter set `summary` actually describes. The zone-wide /summary unions
     every yearly table and runs ~8s cold, so between a filter change and its
     answer the strip would otherwise keep showing the PREVIOUS selection's
     totals — a wrong answer wearing the new filter's label. */
  const [summaryKey, setSummaryKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* Latest geo selections, readable inside fetch callbacks without re-running
     effects — used to drop a selection that vanishes when the year changes. */
  const districtRef = useRef(districtSel);
  districtRef.current = districtSel;
  const clubRef = useRef(clubSel);
  clubRef.current = clubSel;

  const yearId = yearSel ?? undefined;

  /* ——— Cause TAB SECTION plumbing (top-level area filter) ———
     Map the selected canonical key ↔ the API's areaOfFocusId via the area list
     for the current scope. resolvedAreaId is undefined until an id is available,
     so a tab responds visually before real filtering can switch on.

     A picked club is the narrowest scope, so its OWN areas (/clubs/{id}/areas)
     win. /areas takes only state+district — it has no clubId — so preferring it
     whenever it had rows showed the whole district's causes over a single club:
     every club in a district offered the same tabs, with the district's counts. */
  const areaList = clubSel !== null ? areas : scopeAreas;
  const areaByKey = useMemo(() => {
    const m = new Map<string, AreaStat>();
    for (const t of AREA_TABS) {
      const hit = (areaList ?? []).find((a) => normArea(a.name) === normArea(t.key));
      if (hit) m.set(t.key, hit);
    }
    return m;
  }, [areaList]);
  const areaCounts = useMemo(() => {
    const c: Record<string, number> = {};
    areaByKey.forEach((stat, key) => {
      c[key] = stat.projects;
    });
    return c;
  }, [areaByKey]);
  const resolvedAreaId = areaKeySel ? areaByKey.get(areaKeySel)?.areaOfFocusId : undefined;
  /* Identity of the filter set the totals are for — compared against the one
     `summary` was actually fetched for, to tell "totals for what you picked"
     from "totals for what you picked a moment ago". Must list every input the
     /summary effect depends on. */
  const filterKey = `${yearId ?? ""}|${stateSel}|${districtSel ?? ""}|${clubSel ?? ""}|${resolvedAreaId ?? ""}|${searchSel}`;
  /* The totals ONLY if they were fetched for the filter set now on screen. null means
     "not answered yet" — pending, or an upstream failure getSummary swallowed. */
  const scopedSummary = summaryKey === filterKey ? summary : null;

  /* Year options newest-first; the default option = the API's current rotary year */
  const years = useMemo(
    () => [...overview.years].sort((a, b) => b.yearLabel.localeCompare(a.yearLabel)),
    [overview.years]
  );

  /* Each fetch guards against out-of-order responses: the effect cleanup marks
     the in-flight request stale before a newer one can apply its result. */
  useEffect(() => {
    let stale = false;
    getStates(yearId).then((list) => {
      if (!stale) setStates(list);
    });
    return () => {
      stale = true;
    };
  }, [yearId]);

  /* Every district, for the universal search — independent of the state pick. */
  useEffect(() => {
    let stale = false;
    getAllDistricts(undefined, yearId).then((list) => {
      if (!stale) setAllDistricts(list);
    });
    return () => {
      stale = true;
    };
  }, [yearId]);

  /* searchActive swaps the browse panel out for the results panel — one box at
     a time, never both. */
  const searchActive = typed.length > 0;

  /* THE PROJECT SEARCH — debounced, and only once the query is worth asking about.

     Every change refetches a page AND a summary from an API that unions ~27 year
     tables, so each one is seconds of work. Measured against the live data:

         q=b                17.4s   a leading-wildcard LIKE matching nearly every
                                    project, so the union filters almost nothing out
         q=blood            11.1s
         q=blood donations  10.2s

     The one-character query is both the MOST expensive and the LEAST useful, and
     ordinary typing speed walks straight through it. So: wait for a pause, and wait
     for enough letters to mean something. Below the minimum the term clears, which
     restores the full listing rather than leaving a half-typed filter applied.
     Page resets with it — a new search on page 7 would otherwise ask for a page the
     new result may not have. */
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchSel(typed.length >= SEARCH_MIN_CHARS ? typed : "");
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [typed]);

  /* Top-level Area-of-Focus list, scoped to the current state/district — powers
     the cause TAB SECTION before a club is chosen. [] until the API ships it. */
  useEffect(() => {
    let stale = false;
    getScopeAreas({ state: stateSel || undefined, districtId: districtSel ?? undefined, yearId }).then(
      (list) => {
        if (!stale) setScopeAreas(list);
      }
    );
    return () => {
      stale = true;
    };
  }, [stateSel, districtSel, yearId]);

  /* Districts for the Districts tab: the chosen state's, or EVERY district when no
     state is picked — the browse tabs are top-level, so the grid must never be empty. */
  useEffect(() => {
    let stale = false;
    const req = stateSel ? getDistricts(stateSel, yearId) : getAllDistricts(undefined, yearId);
    req.then((list) => {
      if (stale) return;
      setDistricts([...list].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      // A year change can drop the selected district — clear it and everything deeper.
      if (districtRef.current !== null && !list.some((d) => d.districtId === districtRef.current)) {
        setDistrictSel(null);
        setClubSel(null);
        setPage(1);
      }
    });
    return () => {
      stale = true;
    };
  }, [stateSel, yearId]);

  useEffect(() => {
    if (districtSel === null) {
      setClubs([]);
      return;
    }
    let stale = false;
    getClubs(districtSel, yearId).then((list) => {
      if (stale) return;
      setClubs(list);
      // A year change can drop the selected club — clear it.
      if (clubRef.current !== null && !list.some((c) => c.clubId === clubRef.current)) {
        setClubSel(null);
        setPage(1);
      }
    });
    return () => {
      stale = true;
    };
  }, [districtSel, yearId]);

  // Per-club areas — the fallback source for the cause tabs until the top-level
  // scope-areas endpoint ships.
  useEffect(() => {
    if (clubSel === null) {
      setAreas([]);
      return;
    }
    let stale = false;
    getAreas(clubSel, yearId).then((list) => {
      if (!stale) setAreas(list);
    });
    return () => {
      stale = true;
    };
  }, [clubSel, yearId]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    getProjects({
      yearId,
      state: stateSel || undefined,
      districtId: districtSel ?? undefined,
      clubId: clubSel ?? undefined,
      areaOfFocusId: resolvedAreaId,
      q: searchSel || undefined,
      page,
      pageSize: PAGE_SIZE,
    }).then((res) => {
      if (stale) return;
      // getProjects returns a real page for a genuinely empty result and null ONLY on
      // failure. Substituting an empty page for null turned "we couldn't ask" into
      // "this year has no projects" — same class of lie as the totals above.
      setPageData(res);
      // Which filter set + page these cards actually describe. Without it the
      // search dropdown reported the PREVIOUS query's totalCount under the new
      // query's name — 6,35,716 "match blood donations" while that fetch was
      // still in flight. Same class of wrong-answer-wearing-the-new-label the
      // stat strip guards against with summaryKey.
      setPageKey(`${filterKey}|${page}`);
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [yearId, stateSel, districtSel, clubSel, resolvedAreaId, searchSel, page, freshNonce]);

  /* Totals for the current selection — the stat strip switches to these the moment
     any filter is on, so it never claims 5 lakh projects over a six-project listing.
     Page-independent, so it isn't refetched while paging. */
  useEffect(() => {
    let stale = false;
    getSummary({
      yearId,
      state: stateSel || undefined,
      districtId: districtSel ?? undefined,
      clubId: clubSel ?? undefined,
      areaOfFocusId: resolvedAreaId,
      q: searchSel || undefined,
    }).then((res) => {
      if (stale) return;
      // getSummary resolves null on ANY upstream failure (house style, never throws).
      // Stamping the key on that recorded "these are the totals for this filter" over
      // an answer that never arrived, and the strip then presented the zone-wide
      // /overview figures as the filtered result. Leave it unstamped: the strip keeps
      // reading as loading until a real answer lands.
      if (!res) return;
      setSummary(res);
      setSummaryKey(filterKey);
    });
    return () => {
      stale = true;
    };
    // filterKey is derived from exactly these — listing it too would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId, stateSel, districtSel, clubSel, resolvedAreaId, searchSel, freshNonce]);

  /* Selection handlers — geo pickers reset deeper GEO levels + page; the cause
     tab is orthogonal (top-level) and persists across geo changes. */
  const pickState = (v: string) => {
    setStateSel(v);
    setDistrictSel(null);
    setClubSel(null);
    setPage(1);
  };
  const pickDistrict = (v: string) => {
    setDistrictSel(v ? Number(v) : null);
    setClubSel(null);
    setPage(1);
  };
  const pickClub = (v: string) => {
    setClubSel(v ? Number(v) : null);
    setPage(1);
  };
  const selectAreaTab = (key: string) => {
    setAreaKeySel(key === areaKeySel ? "" : key);
    setPage(1);
  };
  const pickYear = (v: string) => {
    setYearSel(v ? Number(v) : null);
    setPage(1);
  };
  const clearAll = () => {
    pickState("");
    setAreaKeySel("");
    setYearSel(null);
    // The text filter is a filter like any other — "Clear all" that left the
    // listing still narrowed by a search would be lying about what it cleared.
    clearSearch();
  };
  /* Clears the box AND the applied term in one go. Going through setSearchSel
     rather than waiting for the debounce keeps the listing from lingering on the
     old query for another 350ms after the chip is dismissed. */
  const clearSearch = () => {
    setQuery("");
    setSearchSel("");
    setPage(1);
  };

  /* Picking a card closes the panel; clicking the open choice clears it. */
  const pickBrowse = (apply: (v: string) => void, value: string, isActive: boolean) => {
    apply(isActive ? "" : value);
    setBrowseTab("");
  };

  /* Causes with nothing behind them are dropped, so the grid never offers a
     choice that leads to an empty listing. null while the area list is unanswered. */
  const areaChoices = useMemo(
    () =>
      areaList === null
        ? null
        : AREA_TABS.map((t) => ({ value: t.key, label: t.label, count: areaCounts[t.key] ?? 0 }))
            .filter((a) => a.count > 0)
            .sort((a, b) => b.count - a.count),
    [areaCounts, areaList]
  );

  const hasSelection = Boolean(
    areaKeySel || stateSel || districtSel !== null || clubSel !== null || searchSel
  );

  /* Pill badges read the CURRENT selection, not the raw option lists. A pick
     pins its own level — and, since geography is a strict hierarchy here, every
     level above it — to one. The club figure falls back to /summary's
     clubsInvolved (the same number the "Active clubs" tile shows) while no
     district is picked, because the API only serves clubs per district and the
     list is empty until then — the pill said 0 over a zone with thousands.
     ponytail: a district spanning two states still reads 1; /states can't be
     scoped by district without a backend change.
     A null count is "not answered yet" and renders as a placeholder, not a zero. */
  const geoPinned = districtSel !== null || clubSel !== null;
  const stateCount = stateSel || geoPinned ? 1 : states === null ? null : states.length;
  const districtCount = geoPinned ? 1 : districts === null ? null : districts.length;
  const clubCount =
    clubSel !== null ? 1 : clubs?.length || scopedSummary?.clubsInvolved || null;

  /* What the body shows: an explicitly-opened tab shows that grid; with no tab
     open but a filter chosen, the still-unpicked dimensions open up — except
     geography levels a deeper pick already implies (a district fixes its
     state; a club fixes both), which would only be noise. The next drill
     level (district → clubs) is what actually helps. */
  const selectedOf: Record<Exclude<BrowseTab, "">, boolean> = {
    areas: Boolean(areaKeySel),
    states: Boolean(stateSel),
    districts: districtSel !== null,
    clubs: clubSel !== null,
  };
  const impliedByDeeperPick: Record<Exclude<BrowseTab, "">, boolean> = {
    areas: false,
    states: districtSel !== null || clubSel !== null,
    districts: clubSel !== null,
    clubs: false,
  };
  const showGrid = (key: Exclude<BrowseTab, "">) =>
    browseTab === key ||
    (browseTab === "" && hasSelection && !selectedOf[key] && !impliedByDeeperPick[key]);

  /* Analytics numbers. Zone-wide cumulative truth from /overview until ANY filter
     is on, then the selection's own totals from /summary — otherwise the tiles
     would still claim 5 lakh projects above a six-project listing. The people/hours
     figures run past a billion, so they use Indian L/Cr compaction to fit the strip. */
  const isScoped = hasSelection || yearSel !== null;
  /* /summary answers for the CURRENT selection (no filters = zone-wide), so one
     source drives the strip in both states; /overview covers the first paint
     before summary lands. Every figure is exact, so nothing carries a "+".
     Only the answer fetched for THIS filterKey counts — anything else belongs to
     a selection the user has already left (see scopedSummary above). */
  const shown = {
    projects: scopedSummary?.totalProjects ?? overview.totalProjects,
    inr: scopedSummary?.valueInr ?? overview.totalCost,
    clubs: scopedSummary?.clubsInvolved ?? 0,
    hours: scopedSummary?.manHours ?? overview.totalManHours,
  };
  /* /overview is zone-wide, all-years — the right answer ONLY while nothing is
     filtered, which is why the first paint may use it. With a filter on it is a
     WRONG answer wearing the filter's label: a year picked before the summary
     landed (or one whose summary failed) showed the whole zone's 6.2 lakh
     projects and "Clubs involved 0" under "2026-27". Scoped and unanswered
     therefore reads as loading, never as numbers. */
  const statsStale = isScoped
    ? scopedSummary === null
    : summaryKey !== null && summaryKey !== filterKey;
  const cost = inrParts(shown.inr);
  const hours = inrParts(shown.hours);

  /* Removable filter chips — labels resolved from the fetched option lists */
  const districtNo = (
    (districts ?? []).find((d) => d.districtId === districtSel) ??
    allDistricts.find((d) => d.districtId === districtSel)
  )?.districtNumber;
  // A club can now only be picked from the Clubs browse pill, which fills `clubs`
  // first — so the name is always there by the time a chip needs it. (The old
  // fallback existed for clubs picked out of the search shortlist, before that
  // district's club list had loaded.)
  const clubName = (clubs ?? []).find((c) => c.clubId === clubSel)?.clubName;
  const areaLabel = AREA_TABS.find((t) => t.key === areaKeySel)?.label;
  const chips: { label: string; onRemove: () => void }[] = [];
  if (stateSel) chips.push({ label: stateSel, onRemove: () => pickState("") });
  if (districtSel !== null)
    chips.push({ label: `RID ${districtNo ?? districtSel}`, onRemove: () => pickDistrict("") });
  if (clubSel !== null) chips.push({ label: clubName ?? "Club", onRemove: () => pickClub("") });
  if (areaKeySel)
    chips.push({ label: areaLabel ?? "Area of focus", onRemove: () => setAreaKeySel("") });
  // The search term reads as a filter because that is exactly what it now is.
  if (searchSel) chips.push({ label: `“${searchSel}”`, onRemove: clearSearch });

  /** "in Karnataka" / "in RID 3181" / "working on Environment" — the scope a grid is
      already narrowed to, so each heading says what you're looking at. */
  const scopeNote =
    districtSel !== null
      ? `in RID ${districtNo ?? districtSel}`
      : stateSel
        ? `in ${stateSel}`
        : areaKeySel
          ? `working on ${areaLabel ?? titleCase(areaKeySel)}`
          : "";
  /* The causes grid is the only one that narrows past a club, so it's the only
     heading that names one — "Clubs in <club>" would be nonsense. */
  const areaScopeNote = clubSel !== null ? `in ${clubName ?? "this club"}` : scopeNote;

  // Drop Club Service (internal avenue) items the stats feed still returns,
  // and future-dated rows — a project "done" on a date that hasn't happened is
  // bad data, and date-DESC sorting would pin it to the top of page 1.
  // Interim: the feed carries no avenue field, so counts stay server-side until
  // the API excludes these upstream; see isClubService().
  const items = (pageData?.items ?? []).filter(
    (p) => !isClubService(p) && (parseTime(p.projectDate) ?? 0) <= Date.now()
  );
  /* True only when the cards on screen were fetched for the text now in the box.
     TWO windows have to be covered, and only one of them is visible in filterKey:

       1. the fetch window — request sent, answer not back. pageKey covers this.
       2. the DEBOUNCE window — the box already shows "blood" but searchSel is still
          "", so filterKey has not changed yet and pageKey still matches. Checking
          pageKey alone reported the old 6,35,716 total under the new query for the
          full 350ms before the request was even sent.

     Comparing the debounced term against the typed one closes the second. */
  const pageFresh = pageKey === `${filterKey}|${page}` && searchSel === typed;
  // The cards (and their count) are out of date: first load, a refetch, or a
  // search still in its debounce window.
  const listingLoading =
    pageData === null || loading || (typed.length >= SEARCH_MIN_CHARS && !pageFresh);
  const totalCount = pageData?.totalCount ?? 0;
  const totalPages = pageData?.totalPages ?? 0;
  const safePage = Math.min(page, Math.max(totalPages, 1));

  const cards: CardData[] = items.map((p) => ({
    key: `${p.yearId}-${p.clubId}-${p.id}`,
    href: `/projects/${p.id}?yearId=${p.yearId}`,
    title: p.title,
    area: p.areaOfFocus?.trim() || null,
    where: [
      p.clubName ?? "Rotary Club",
      [p.city, p.state].filter(Boolean).join(", "),
      p.districtNumber ? `RID ${p.districtNumber}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    date: niceDate(parseTime(p.projectDate)),
    cost: p.projectCost,
    beneficiaries: p.directBeneficiaries,
    photo: p.primaryPhoto ? photoUrl(p.primaryPhoto) : null,
  }));

  return (
    <section className="bg-paper pb-24 lg:pb-28">
      <div className="container-rotary">
        {/* BROWSE — four dimension buttons + the year filter in one wrapping
            row. Each name carries its reachable count as a small badge: menu
            information, not a headline. Same shape as the bundled hub, but
            every list here is fetched live from the stats API. */}
        <div className="pt-12 lg:pt-14">
          <p className="microlabel">Browse by</p>

          {/* Four dimension BUTTONS + the year filter, one wrapping row — pills
              reflow cleanly on phones where attached tabs broke the layout. */}
          <div
            role="group"
            aria-label="Choose what to browse by"
            className="relative mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <BrowseLink
              label="Area of Focus"
              count={areaChoices === null ? null : areaChoices.length}
              active={browseTab === "areas"}
              onClick={() => setBrowseTab(browseTab === "areas" ? "" : "areas")}
              dot={areaKeySel ? areaColor(areaKeySel) : undefined}
            />
            <BrowseLink
              label="States"
              count={stateCount}
              active={browseTab === "states"}
              onClick={() => setBrowseTab(browseTab === "states" ? "" : "states")}
            />
            <BrowseLink
              label="Districts"
              count={districtCount}
              active={browseTab === "districts"}
              onClick={() => setBrowseTab(browseTab === "districts" ? "" : "districts")}
            />
            <BrowseLink
              label="Clubs"
              count={clubCount}
              active={browseTab === "clubs"}
              onClick={() => setBrowseTab(browseTab === "clubs" ? "" : "clubs")}
            />
            {/* ONE search over every dimension — replaces the per-panel inputs.
                Clubs come from the lazy zone-wide fan-out; until it lands the
                clubs section reports itself as loading. */}
            <UniversalSearch
              query={query}
              onQueryChange={setQuery}
              note={
                typed.length < SEARCH_MIN_CHARS ? (
                  <>Keep typing &mdash; at least {SEARCH_MIN_CHARS} letters.</>
                ) : !pageFresh || pageData === null ? (
                  <RotaryLoader size="sm" label={`Searching projects for “${typed}”…`} />
                ) : (
                  <>
                    <span className="figure">{fmt(totalCount)}</span>{" "}
                    {totalCount === 1 ? "project matches" : "projects match"} &ldquo;{typed}&rdquo;
                    {" "}&mdash; shown below.
                  </>
                )
              }
            />
            <div className="order-first sm:order-none sm:ml-auto">
              <Select
                value={yearSel === null ? "all" : String(yearSel)}
                onValueChange={(v) => pickYear(v === "all" ? "" : v)}
              >
                <SelectTrigger
                  aria-label="Filter by Rotary year"
                  className="min-h-10 w-full gap-2 rounded-xl border-navy-950/15 bg-white px-4 text-[13px] font-semibold text-navy-950 shadow-none focus:ring-2 focus:ring-gold-dark sm:w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-md border-navy-950/10">
                  <SelectItem value="all" className="text-[13px] font-medium">
                    All years
                  </SelectItem>
                  {years.map((y) => (
                    <SelectItem
                      key={y.yearId}
                      value={String(y.yearId)}
                      className="text-[13px] font-medium"
                    >
                      {y.yearLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* PANEL — its own rounded surface beneath the button row. Hidden
              while a search query is live: the results box IS the panel then. */}
          {!searchActive && (browseTab !== "" || hasSelection) && (
            <div className="mt-4 rounded-xl border border-navy-950/[0.10] bg-porcelain px-6 py-7 lg:px-8">
              {showGrid("areas") && (areaChoices?.length ?? 0) > 0 && (
                <ChoiceCardGrid heading={`Areas of focus ${areaScopeNote}`.trim()}>
                  {(areaChoices ?? []).map((a) => (
                    <ChoiceCard
                      key={a.value}
                      label={a.label}
                      count={a.count}
                      accent={areaColor(a.value)}
                      active={a.value === areaKeySel}
                      onClick={() => {
                        selectAreaTab(a.value);
                        setBrowseTab("");
                      }}
                    />
                  ))}
                </ChoiceCardGrid>
              )}

              {showGrid("states") && (states?.length ?? 0) > 0 && (
                <ChoiceBrowser
                  heading={`States ${scopeNote}`.trim()}
                  items={(states ?? []).map((s) => ({
                    value: s.state,
                    label: s.state,
                    count: s.projects,
                    active: s.state === stateSel,
                  }))}
                  onPick={(v, active) => pickBrowse(pickState, v, active)}
                  collapsible={browseTab !== "states"}
                />
              )}

              {showGrid("districts") && (districts?.length ?? 0) > 0 && (
                <ChoiceBrowser
                  heading={`Districts ${scopeNote}`.trim()}
                  items={[...(districts ?? [])]
                    .sort((a, b) => Number(a.districtNumber) - Number(b.districtNumber))
                    .map((d) => ({
                      value: String(d.districtId),
                      label: `RID ${d.districtNumber}`,
                      count: d.projects,
                      active: d.districtId === districtSel,
                    }))}
                  onPick={(v, active) => pickBrowse(pickDistrict, v, active)}
                  collapsible={browseTab !== "districts"}
                  keepOrder
                />
              )}

              {showGrid("clubs") &&
                ((clubs?.length ?? 0) > 0 ? (
                  <ChoiceBrowser
                    heading={`Clubs ${scopeNote}`.trim()}
                    items={(clubs ?? []).map((c) => ({
                      value: String(c.clubId),
                      label: c.clubName,
                      count: c.projects,
                      active: c.clubId === clubSel,
                    }))}
                    onPick={(v, active) => pickBrowse(pickClub, v, active)}
                    collapsible={browseTab !== "clubs"}
                  />
                ) : (
                  browseTab === "clubs" && (
                    <p className="text-[13px] text-muted">
                      There are thousands of clubs across the zones — type a club&rsquo;s name
                      into the search box above, or pick a district to list its clubs here.
                    </p>
                  )
                ))}
            </div>
          )}

          <div className="mt-5">
            {chips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="microlabel">Filtering by</span>
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={c.onRemove}
                    aria-label={`Remove filter ${c.label}`}
                    className="group inline-flex items-center gap-2 border-b border-navy-950/25 pb-0.5 text-[14px] font-semibold text-navy-950 transition-colors hover:border-gold-deep hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
                  >
                    {c.label}
                    <span aria-hidden className="text-ink/35 group-hover:text-gold-deep">
                      &times;
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[12px] font-medium text-ink/45 transition-colors hover:text-gold-deep"
                >
                  Clear all
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                Every project across the zones. Pick one above to narrow it down.
              </p>
            )}
          </div>
        </div>

        {/* Totals — zone-wide until you filter, then the selection's own numbers.
            Live from /summary + /overview, so these are exact, not estimates. */}
        <StatStrip
          className="mt-10"
          loading={statsStale}
          stats={[
            {
              label: "Projects",
              target: shown.projects,
            },
            {
              label: "Invested in service",
              target: cost.target,
              decimals: cost.decimals,
              prefix: currencySymbol(),
              suffix: cost.suffix,
              sub: undefined,   // ROW: one currency (the original added a $ line under the ₹ total)
              wide: true,
            },
            {
              label: isScoped ? "Clubs involved" : "Active clubs",
              target: shown.clubs,
            },
            {
              label: "Volunteer man-hours",
              target: hours.target,
              decimals: hours.decimals,
              suffix: hours.suffix,
            },
          ]}
        />

        <ListingHead />

        <FilterChips
          chips={chips}
          right={
            listingLoading ? (
              <>Loading projects&hellip;</>
            ) : (
              <>
                <span className="figure">{fmt(totalCount)}</span>{" "}
                {totalCount === 1 ? "project" : "projects"} &middot; page{" "}
                <span className="figure">{safePage}</span> of{" "}
                <span className="figure">{Math.max(totalPages, 1)}</span>
              </>
            )
          }
        />

        {/* Grid — skeleton cards on the first load AND on every refetch (search,
            filter, page), so stale cards are never shown under a new query. The
            pageFresh check also covers a search's debounce window, before
            `loading` is set. */}
        {listingLoading ? (
          <div aria-busy className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border-l-[3px] border-navy-950/10 bg-white shadow-soft ring-1 ring-navy-950/[0.08]"
                aria-hidden
              >
                <div className="aspect-[16/9] animate-pulse bg-paper-200" />
                <div className="p-6">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-paper-200" />
                  <div className="mt-4 h-5 w-4/5 animate-pulse rounded bg-paper-200" />
                  <div className="mt-2 h-5 w-3/5 animate-pulse rounded bg-paper-200" />
                  <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-paper-200" />
                  <div className="mt-8 h-4 w-1/2 animate-pulse rounded bg-paper-200" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <CardGrid cards={cards} />
        )}

        {!loading && pageData !== null && items.length === 0 && (
          <EmptyState onClear={clearAll}>
            Nothing on record matches this combination for the selected Rotary year. Try removing
            a filter or switching to another year.
          </EmptyState>
        )}

        {totalPages > 1 && (
          <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
        )}
      </div>
    </section>
  );
}

/* ——— Entry point: probe the live stats API once, then pick the experience.
       While probing (and when the probe fails) the bundled sample renders,
       so there is never a flash of empty UI. ——— */

/** Last overview the stats API returned, kept in localStorage so a repeat
 *  visitor goes STRAIGHT to the live hub instead of watching the bundled
 *  fallback while a cold probe takes seconds — the probe refreshes it in the
 *  background. */
const OVERVIEW_CACHE_KEY = "rotary-project-stats-overview-v1";

export function ProjectsHub({
  projects,
  initialArea,
  initialOverview = null,
}: {
  projects: SampleProject[];
  initialArea?: string;
  /** The server's cached overview, rendered into the HTML by app/(site)/projects/page.tsx.
   *  When present the live hub is what paints FIRST — no probe, no sample-hub swap. Null
   *  means the snapshot was cold, and the client-probe path below still covers it. */
  initialOverview?: Overview | null;
}) {
  const [overview, setOverview] = useState<Overview | null>(initialOverview);
  const [live, setLive] = useState<boolean | null>(initialOverview ? true : null);

  useEffect(() => {
    // Read the cache here, not in the state initializer — the server render
    // has no localStorage, and diverging on hydration would be a mismatch.
    // Skipped entirely when the server already handed us an overview: this
    // per-browser copy is older and narrower than the shared snapshot, and
    // letting it overwrite the SSR value would be a step backwards.
    if (!initialOverview) {
      try {
        const cached = window.localStorage.getItem(OVERVIEW_CACHE_KEY);
        if (cached) {
          setOverview(JSON.parse(cached) as Overview);
          setLive(true);
        }
      } catch {
        /* corrupt/blocked storage — fall through to the probe */
      }
    }

    let cancelled = false;
    statsAvailable()
      .then((ok) => (ok ? getOverview() : null))
      .then((ov) => {
        if (cancelled) return;
        if (ov) {
          setOverview(ov);
          setLive(true);
          try {
            window.localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(ov));
          } catch {
            /* private mode / quota — cache is best-effort */
          }
        } else {
          // Probe failed. Only fall back if there's no cached truth to stand
          // on — flipping a working live hub back to the sample would discard
          // the user's filters for a transient error.
          setLive((prev) => prev ?? false);
        }
      });
    return () => {
      cancelled = true;
    };
    // Mount-only. initialOverview is read here but must NOT be a dep: a fresh object
    // arrives from the server on every navigation, which would re-arm this each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (live && overview) return <LiveHub overview={overview} initialArea={initialArea} />;
  return <SampleHub projects={projects} initialArea={initialArea} />;
}
