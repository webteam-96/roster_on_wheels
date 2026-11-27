import { useEffect, useMemo, useRef, useState } from "react";
import { ChoiceBrowser } from "@/components/pages/projects/ChoiceBrowser";
import { UniversalSearch } from "@/components/pages/projects/UniversalSearch";
import RotaryLoader from "@/components/RotaryLoader";
import { AREA_TABS, ChoiceCard, ChoiceCardGrid, EmptyState, areaColor, FilterChips, Pagination, StatStrip, fmt, inrParts, isClubService, niceDate, normArea, parseTime, titleCase, type CardData } from "@/components/pages/projects/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { photoUrl } from "@/lib/projectsApi";
import { getAllDistricts, getAreas, getClubs, getDistricts, getProjects, getScopeAreas, getStates, getSummary, type AreaStat, type ClubStat, type DistrictStat, type Overview, type ProjectPage, type StateStat, type SummaryStat } from "@/lib/projectStats";
import { currencySymbol } from "@/lib/appFormat";
import { PAGE_SIZE, SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS, BrowseTab, BrowseLink, ListingHead, CardGrid, useFreshnessProbe } from "./projectsHubParts";

/* ——— Live hub — header totals from /overview, cascading filters and paged
       cards straight from the project-stats API. Same layout as SampleHub. ——— */

export function LiveHub({ overview, initialArea }: { overview: Overview; initialArea?: string }) {
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
                  className="min-h-10 w-full gap-2 rounded-xl border-navy-950/15 bg-card px-4 text-[13px] font-semibold text-navy-950 shadow-none focus:ring-2 focus:ring-gold-dark sm:w-auto"
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
                      There are thousands of clubs across the zones: type a club&rsquo;s name
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
                className="overflow-hidden rounded-2xl border-l-[3px] border-navy-950/10 bg-card shadow-soft ring-1 ring-navy-950/[0.08]"
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
