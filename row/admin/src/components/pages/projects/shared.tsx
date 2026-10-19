// THE shared presentational layer for the projects pages — SampleHub, LiveHub,
// ProjectsExplorer and the /projects/[id] "more projects" rail all render these
// pieces, so the card/console/ledger anatomy exists exactly once.
//
// No "use client" on purpose: server components (the detail page) may import
// the cards; the interactive pieces receive handlers from client parents and
// compile into their client graph.

import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "@/components/icons";
import { CardMedia } from "@/components/pages/projects/CardMedia";
import type { Project } from "@/lib/projectsApi";

import { appLocale, currencySymbol } from "@/lib/appFormat";
/* ——— Formatting ——— */

export const fmt = (n: number) => n.toLocaleString(appLocale());

/** A value in compact units — { target, decimals, suffix } for data-counter + display (K / M / B; the original used lakh / crore). */
export function inrParts(n: number): { target: number; decimals: number; suffix: string } {
  if (n >= 1e9) return { target: Number((n / 1e9).toFixed(1)), decimals: 1, suffix: " B" };
  if (n >= 1e6) return { target: Number((n / 1e6).toFixed(1)), decimals: 1, suffix: " M" };
  if (n >= 1e4) return { target: Number((n / 1e3).toFixed(0)), decimals: 0, suffix: " K" };
  return { target: n, decimals: 0, suffix: "" };
}

/** Compact amount in the brand's currency — the one money voice across every projects surface. */
export function inrCompact(n: number): string {
  const p = inrParts(n);
  return `${currencySymbol()}${p.target.toLocaleString(appLocale(), { maximumFractionDigits: p.decimals })}${p.suffix}`;
}

/** Epoch millis for a project's done-date, or null when missing / unparseable. */
export function parseTime(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (isNaN(t) || new Date(t).getFullYear() < 1990) return null;
  return t;
}

export function niceDate(t: number | null): string | null {
  if (t === null) return null;
  return new Date(t).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" });
}

/** Rotary year (July–June) label for a timestamp, e.g. "2025-2026". */
export function rotaryYearOf(t: number): string {
  const d = new Date(t);
  const y = d.getFullYear();
  return d.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Loose cause-name key: "Peacebuilding & Conflict Prevention" ≡ "PEACE BUILDING AND CONFLICT PREVENTION". */
export function normArea(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/* ——— Official cause colours (brand-mandated, byte-exact) matched on free-text API names ——— */

export const AREA_COLORS: { match: RegExp; color: string }[] = [
  { match: /educat|literac/i, color: "#FF7600" },
  { match: /economic/i, color: "#F0A80C" },
  { match: /disease|treatment/i, color: "#E02927" },
  { match: /environment/i, color: "#009739" },
  { match: /maternal|child/i, color: "#D41E8B" },
  { match: /peace|conflict/i, color: "#901F93" },
  { match: /water|sanitation|hygiene/i, color: "#00A2E0" },
];

export function areaColor(name: string): string {
  return AREA_COLORS.find((a) => a.match.test(name))?.color ?? "#0A57A8";
}

/* ——— Everyday words each cause answers to, for the search box ———
   People search the subject, not the Rotary label. "Health" appears nowhere in
   "Disease Prevention & Treatment", yet that is the cause someone typing it
   wants. Matched only — never displayed.
   ponytail: a hand-written list, one line per official cause. Swap it for a
   synonym index if the vocabulary ever has to grow past these seven. */
const AREA_KEYWORDS: { match: RegExp; words: string }[] = [
  { match: /disease|treatment/i, words: "health healthcare medical medicine doctor hospital clinic camp blood donation checkup screening cancer eye dental polio vaccination immunisation" },
  { match: /maternal|child/i, words: "health healthcare mother maternity women child children baby infant nutrition" },
  { match: /water|sanitation|hygiene/i, words: "water drinking borewell toilet sanitation hygiene handwash" },
  { match: /environment/i, words: "environment green tree plantation planting sapling forest climate waste plastic recycling solar pollution" },
  { match: /educat|literac/i, words: "education school college student teacher literacy books scholarship classroom" },
  { match: /economic/i, words: "economic livelihood employment jobs income skill training vocational entrepreneurship farmer agriculture" },
  { match: /peace|conflict/i, words: "peace conflict harmony" },
];

/** Hidden search words for a cause name — "" when it is none of the seven. */
export function areaKeywords(name: string): string {
  return AREA_KEYWORDS.find((a) => a.match.test(name))?.words ?? "";
}

/** Solid white base + 10% cause tint — the at-rest cause wash for cards/rows. */
function tintBg(hex: string, alpha = "1A"): string {
  return `linear-gradient(0deg, ${hex}${alpha}, ${hex}${alpha}) #FCFDFE`;
}

/* ——— Data shapes ——— */

/** A /projects sample project with its primary photo resolved server-side. */
export type SampleProject = Project & { primaryPhoto: string | null };

// Club Service is an internal Avenue of Service (BOD meetings, club assemblies,
// charter days) — the API's per-club spec already keeps it OUT of "Projects"
// (Meetings = Club Service only). The aggregate stats feed doesn't yet carry the
// avenue/module, so this predicate prefers a real avenue field the moment the API
// returns one (moduleKey/moduleName/category), and falls back to title patterns
// for the current data. Remove the title fallback once the feed exposes the avenue.
const CLUB_SERVICE_AVENUE_RE = /club[\s_-]*service/i;
const CLUB_SERVICE_TITLE_RE =
  /(?:\bbod\b|board of directors|club assembly|club service|charter\s+(?:day|night|celebration|anniversary)|installation ceremony|(?:weekly|regular|fellowship|club)\s+meeting)/i;

/** True for internal Club Service items that must not appear in the public listing. */
export function isClubService(p: {
  title?: string | null;
  areaOfFocus?: string | null;
  category?: string | null;
  subCategory?: string | null;
  moduleKey?: string | null;
  moduleName?: string | null;
}): boolean {
  const avenue = [p.moduleKey, p.moduleName, p.category, p.subCategory, p.areaOfFocus]
    .filter(Boolean)
    .join(" ");
  if (CLUB_SERVICE_AVENUE_RE.test(avenue)) return true;
  return CLUB_SERVICE_TITLE_RE.test(p.title ?? "");
}

/** Everything a card needs, pre-resolved — hubs/explorer/rail adapt into this. */
export type CardData = {
  key: string | number;
  href: string;
  title: string;
  area: string | null;
  where: string;
  date: string | null;
  cost: number | null;
  beneficiaries: number | null;
  photo: string | null;
};

/* ——— Cards ——— */

/**
 * Grid card — cause-colour 3px left rule + permanent 10% tint, finished at
 * zero hover. LEDGER SETTLE pacing (0.35s utility rows).
 */
export function ProjectCard({ p }: { p: CardData }) {
  const color = areaColor(p.area ?? "");
  return (
    <Link
      href={p.href}
      data-animate="up"
      data-animate-duration="0.35"
      className="group flex h-full flex-col overflow-hidden rounded-2xl shadow-soft ring-1 ring-navy-950/[0.08] transition-all duration-300 ease-out-expo hover:-translate-y-1 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      style={{ borderLeft: `3px solid ${color}`, background: tintBg(color) }}
    >
      {p.photo && <CardMedia src={p.photo} className="media-grade aspect-[16/9]" />}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {p.area && <span className="microlabel">{titleCase(p.area)}</span>}
          {p.date && (
            <span className="figure ml-auto text-[11px] tracking-normal text-ink/45">{p.date}</span>
          )}
        </div>
        <h3 className="mt-3 font-display text-[1.15rem] font-[450] leading-snug tracking-[-0.01em] text-navy-950">
          {titleCase(p.title)}
        </h3>
        <p className="mt-2 truncate text-[13px] text-muted">{p.where}</p>
        <div className="mt-auto flex items-center gap-5 border-t border-navy-950/10 pt-4">
          {p.cost != null && p.cost > 0 && (
            <span className="figure text-[15px] text-navy-950">{inrCompact(p.cost)}</span>
          )}
          {p.beneficiaries != null && p.beneficiaries > 0 && (
            <span className="text-[13px] text-muted">
              <span className="figure text-[15px] text-navy-950">{fmt(p.beneficiaries)}</span> served
            </span>
          )}
          <ArrowUpRight
            className="ml-auto h-4 w-4 text-gold-deep transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden
          />
        </div>
      </div>
    </Link>
  );
}

/* ——— Totals strip — the porcelain-with-gold-figure tile voice, one row ——— */

export type StripStat = {
  label: string;
  target: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Companion figure shown after the main one as "main / sub" in the same
   *  voice — e.g. the $ conversion. Plain text, not counter-animated, so it
   *  may change (rate arriving) without remounting the tile. */
  sub?: string;
  /** Give this tile a double column on desktop — for the two-figure tiles. */
  wide?: boolean;
};

export function StatStrip({
  stats,
  className,
  /** Figures belong to a filter the user has already moved on from — show the
   *  placeholder instead. The zone-wide /summary unions every yearly table and
   *  can take ~8s, and rendering the previous selection's totals under the new
   *  filter reads as a wrong answer rather than a pending one. */
  loading,
}: {
  stats: StripStat[];
  className?: string;
  loading?: boolean;
}) {
  /* A wide tile takes two columns, so the desktop grid grows to five tracks
     to keep the other three tiles at their usual width. */
  const cols = stats.some((s) => s.wide) ? "lg:grid-cols-5" : "lg:grid-cols-4";
  return (
    <div
      data-animate="up"
      data-animate-duration="0.7"
      className={
        `grid grid-cols-1 rounded-2xl bg-porcelain text-center ring-1 ring-navy-950/[0.06] sm:grid-cols-2 sm:text-left ${cols} ` +
        (className ?? "")
      }
    >
      {stats.map((s, i) => {
        const display =
          (s.prefix ?? "") +
          s.target.toLocaleString(appLocale(), { maximumFractionDigits: s.decimals ?? 0 }) +
          (s.suffix ?? "");
        /* Hairline dividers that make each tile its own cell of the box:
           stacked (1-col) = a line above every tile but the first; sm 2-col =
           a vertical line before the second column and a horizontal one before
           the second row; lg single row = vertical lines only. */
        const dividers =
          (i > 0 ? "border-t " : "") +
          (i === 1 ? "sm:border-t-0 " : "") +
          (i % 2 === 1 ? "sm:border-l " : "") +
          (i > 0 ? "lg:border-t-0 lg:border-l " : "");
        return (
          // Keyed by label ALONE, so a tile whose target changes keeps its node
          // and Animator re-aims the running count (it watches data-counter).
          // Keying on the target too remounted the tile on every new figure,
          // restarting the count at 0 — the strip visibly counted up, dropped
          // back and counted again as each API answer landed.
          <div
            key={s.label}
            className={
              "border-navy-950/[0.08] px-6 py-7 sm:px-8 " +
              dividers +
              (s.wide ? "lg:col-span-2 lg:text-center" : "")
            }
          >
            <div
              className={
                "flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1 sm:justify-start" +
                (s.wide ? " lg:justify-center" : "")
              }
            >
              {loading ? (
                // Sized to the figure's own line box so the strip keeps its
                // height and nothing below it jumps when the totals land.
                <span
                  aria-label="Loading totals"
                  role="status"
                  className="my-[0.22em] block h-[1.9rem] w-28 animate-pulse rounded-md bg-navy-950/[0.09] sm:h-[2.2rem] sm:w-32"
                />
              ) : (
                <>
                  <p
                    className="figure text-[1.9rem] leading-none text-gold-deep sm:text-[2.2rem]"
                    data-counter={s.target}
                    data-counter-prefix={s.prefix}
                    data-counter-suffix={s.suffix}
                    data-counter-decimals={s.decimals}
                  >
                    {display}
                  </p>
                  {s.sub && (
                    <p className="figure text-[1.9rem] leading-none text-gold-deep sm:text-[2.2rem]">
                      <span aria-hidden className="text-navy-950/25">
                        /{" "}
                      </span>
                      {s.sub}
                    </p>
                  )}
                </>
              )}
            </div>
            <p className="microlabel mt-2.5">{s.label}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ——— Filter console pieces ——— */

/** Pulled-up light-glass console — overlaps the banner seam by -mt-16. */
export function FilterConsole({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-animate="up"
      data-animate-duration="0.7"
      className="console-glass relative z-10 -mt-16 p-5 lg:p-6"
    >
      {children}
    </div>
  );
}

export function SelectField({
  label,
  disabled,
  children,
  ...props
}: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className={"microlabel" + (disabled ? " opacity-40" : "")}>{label}</span>
      <select
        {...props}
        disabled={disabled}
        className="select-ui mt-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
    </label>
  );
}

/** Cause filter pill — 3px rule + 10% tint at rest; active deepens the wash. */
export function AreaPill({
  name,
  count,
  active,
  onClick,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = areaColor(name);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-navy-950 transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark " +
        (active ? "" : "ring-1 ring-navy-950/10 hover:ring-navy-950/30")
      }
      style={{
        borderLeft: `3px solid ${color}`,
        background: tintBg(color, active ? "2E" : "1A"),
        boxShadow: active ? `inset 0 0 0 1.5px ${color}` : undefined,
      }}
    >
      {titleCase(name)}
      <span className={"figure " + (active ? "text-navy-950/70" : "text-ink/50")}>{fmt(count)}</span>
    </button>
  );
}

/** The seven canonical Rotary Areas of Focus — the fixed tab set (key = full
 *  name for normArea matching against data spellings; label = short display). */
export const AREA_TABS: { key: string; label: string; color: string }[] = [
  { key: "Basic Education & Literacy", label: "Basic Education", color: "#FF7600" },
  { key: "Community Economic Development", label: "Economic Development", color: "#F0A80C" },
  { key: "Disease Prevention & Treatment", label: "Disease Prevention", color: "#E02927" },
  { key: "Environment", label: "Environment", color: "#009739" },
  { key: "Maternal & Child Health", label: "Maternal & Child", color: "#D41E8B" },
  { key: "Peacebuilding & Conflict Prevention", label: "Peacebuilding", color: "#901F93" },
  { key: "Water, Sanitation & Hygiene", label: "Water & Sanitation", color: "#00A2E0" },
];

/**
 * Area-of-Focus FILTER — the primary projects filter. "All Projects" + the
 * seven causes as a WRAPPING set of colour pills (no horizontal scroll — every
 * cause is visible at once). Selecting a pill drives the same area filter the
 * dropdown cascade used; the geo filters (state/district/club) stay secondary.
 */
export function AreaTabs({
  active,
  onSelect,
  counts,
  tabs = AREA_TABS,
}: {
  /** Currently selected area key, or "" for All. */
  active: string;
  onSelect: (key: string) => void;
  /** Optional per-key project counts, keyed by tab.key (and "" for All). */
  counts?: Record<string, number>;
  /** Override the tab set (LiveHub supplies scope-scoped areas). */
  tabs?: { key: string; label: string; color: string }[];
}) {
  const all = [{ key: "", label: "All Projects", color: "#A96D00" }, ...tabs];
  return (
    <div
      role="tablist"
      aria-label="Filter by area of focus"
      className="flex flex-wrap gap-2 border-b border-navy-950/10 pb-5"
    >
      {all.map((t) => {
        const isActive = t.key === "" ? active === "" : normArea(active) === normArea(t.key);
        const count = counts?.[t.key];
        return (
          <button
            key={t.key || "all"}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.key)}
            style={isActive ? { backgroundColor: t.color, borderColor: t.color } : undefined}
            className={
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-1 " +
              (isActive
                ? "border-transparent text-white shadow-sm"
                : "border-navy-950/15 bg-white text-muted hover:border-navy-950/40 hover:text-navy-950")
            }
          >
            {t.key !== "" && (
              <span
                aria-hidden
                className="h-2 w-2 rounded-full ring-1 ring-inset ring-black/10"
                style={{ background: isActive ? "rgba(255,255,255,0.9)" : t.color }}
              />
            )}
            {t.label}
            {count !== undefined && (
              <span className={"figure text-[11px] " + (isActive ? "text-white/75" : "text-ink/40")}>
                {fmt(count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * DRILL CHOICE CARD — one state / district / club / area of focus in the browse
 * grids, in the same card language as ProjectCard (rounded, ringed, lifts on
 * hover) so a choice and a project read as the same family. `accent` tints the
 * card for areas of focus; geography cards use the house navy.
 */
export function ChoiceCard({
  label,
  count,
  onClick,
  accent,
  active = false,
}: {
  label: string;
  /** Projects behind this choice, under the filters already applied. */
  count: number;
  onClick: () => void;
  /** Cause colour for area-of-focus cards; omitted for geography. */
  accent?: string;
  active?: boolean;
}) {
  const color = accent ?? "#0A2240";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-animate="up"
      data-animate-duration="0.35"
      className={
        "group flex items-center gap-4 rounded-2xl px-5 py-4 text-left shadow-soft ring-1 transition-all duration-300 ease-out-expo hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-paper " +
        (active ? "ring-2 ring-navy-950" : "ring-navy-950/[0.08]")
      }
      style={{ borderLeft: `3px solid ${color}`, background: tintBg(color, active ? "26" : "0D") }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[1.05rem] font-[450] leading-snug tracking-[-0.01em] text-navy-950">
          {label}
        </span>
        <span className="mt-1 block text-[12px] text-muted">
          <span className="figure text-[13px] text-navy-950">{fmt(count)}</span>{" "}
          {count === 1 ? "project" : "projects"}
        </span>
      </span>
      <ArrowUpRight
        className="h-4 w-4 shrink-0 text-gold-deep transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden
      />
    </button>
  );
}

/** Section wrapper for a ChoiceCard grid — ruled heading + responsive columns. */
export function ChoiceCardGrid({
  heading,
  children,
}: {
  heading: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-12 first:mt-0">
      <p className="eyebrow border-b border-navy-950/10 pb-4">{heading}</p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

export function FilterChips({
  chips,
  right,
}: {
  chips: { label: string; onRemove: () => void }[];
  right: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.onRemove}
          aria-label={`Remove filter ${c.label}`}
          className="chip-gold min-h-8 transition-colors hover:bg-gold/25"
        >
          {c.label}
          <X className="h-3 w-3" aria-hidden />
        </button>
      ))}
      <span className="microlabel ml-auto">{right}</span>
    </div>
  );
}

/* ——— Empty state & pagination ——— */

export function EmptyState({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear?: () => void;
}) {
  return (
    <div className="mt-5 rounded-2xl bg-porcelain px-6 py-16 text-center ring-1 ring-navy-950/[0.06]">
      <p className="font-display text-xl font-[450] tracking-tight text-navy-950">
        No projects found
      </p>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">{children}</p>
      {onClear && (
        <button type="button" onClick={onClear} className="btn-ghost mt-7">
          Clear all filters
        </button>
      )}
    </div>
  );
}

/** Pagination window: 1 … around current … last. */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const around = [current - 1, current, current + 1].filter((p) => p > 1 && p < total);
  const out: (number | "…")[] = [1];
  if (around[0] !== undefined && around[0] > 2) out.push("…");
  out.push(...around);
  if (around.length > 0 && around[around.length - 1] < total - 1) out.push("…");
  out.push(total);
  return out;
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  return (
    <nav className="mt-12 flex items-center justify-center gap-2" aria-label="Projects pagination">
      <button
        type="button"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex h-10 w-10 items-center justify-center rounded-full text-navy-950 ring-1 ring-navy-950/20 transition-colors hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-ink/40" aria-hidden>
            &hellip;
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={
              "figure flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-[13px] transition-colors " +
              (p === page
                ? "bg-gold text-midnight"
                : "text-navy-950 ring-1 ring-navy-950/20 hover:bg-navy-50")
            }
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="flex h-10 w-10 items-center justify-center rounded-full text-navy-950 ring-1 ring-navy-950/20 transition-colors hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
