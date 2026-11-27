import { useMemo, useState } from "react";
import { TOTALS } from "@/components/pages/projects/data";
import { ChoiceBrowser } from "@/components/pages/projects/ChoiceBrowser";
import { UniversalSearch } from "@/components/pages/projects/UniversalSearch";
import { AREA_TABS, ChoiceCard, ChoiceCardGrid, EmptyState, areaColor, FilterChips, Pagination, StatStrip, fmt, inrParts, isClubService, niceDate, normArea, parseTime, rotaryYearOf, titleCase, type CardData, type SampleProject } from "@/components/pages/projects/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencySymbol } from "@/lib/appFormat";
import { PAGE_SIZE, searchRank, BrowseTab, BrowseLink, countBy, ListingHead, CardGrid } from "./projectsHubParts";

/* ——— Fallback hub — analytics from bundled TOTALS, drill-down from the fetched sample.
       Rendered while the live-stats probe is pending, and kept when it fails. ——— */

export function SampleHub({
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
     The live hub's `q` also matches club, state, district and area —
     SearchSqlAsync() in PublicProjectStatsController.cs. */
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
                  className="min-h-10 w-full gap-2 rounded-xl border-navy-950/15 bg-card px-4 text-[13px] font-semibold text-navy-950 shadow-none focus:ring-2 focus:ring-gold-dark sm:w-auto"
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
