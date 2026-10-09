// Self-check for the one rule the Projects stat strip must never break:
//
//   with a filter on, the zone-wide all-years /overview figures are a WRONG answer.
//
// Reported from production: picking the current year while the totals were still in
// flight left the strip showing 6,26,502 projects / ₹7,903 Cr / "Clubs involved 0"
// under a "2026-27" label — the whole zone's numbers wearing one year's name. The
// same shape appeared whenever /summary failed, because a null answer was recorded
// as if it were this filter's totals.
//
//   node src/components/pages/projects/statStrip.check.mjs
//
// The logic is re-stated here rather than imported because the module is TSX with
// "@/" path aliases — no build step, no test framework, no dependency. Keep the two
// in step: this mirrors scopedSummary / statsStale / shown in ProjectsHub.tsx.

import assert from "assert";

const OVERVIEW = { totalProjects: 626502, totalCost: 79_029_971_984, totalManHours: 135455835 };
const YEAR_SUMMARY = { totalProjects: 16705, clubsInvolved: 1705, valueInr: 671432416, manHours: 519113 };

/** Mirror of the strip's derivation in LiveHub. */
function strip({ summary, summaryKey, filterKey, isScoped }) {
  const scopedSummary = summaryKey === filterKey ? summary : null;
  const statsStale = isScoped
    ? scopedSummary === null
    : summaryKey !== null && summaryKey !== filterKey;
  const shown = {
    projects: scopedSummary?.totalProjects ?? OVERVIEW.totalProjects,
    inr: scopedSummary?.valueInr ?? OVERVIEW.totalCost,
    clubs: scopedSummary?.clubsInvolved ?? 0,
    hours: scopedSummary?.manHours ?? OVERVIEW.totalManHours,
  };
  // StatStrip renders placeholders instead of the figures while `loading`.
  return { statsStale, visible: statsStale ? null : shown };
}

const YEAR = "52||||";
const ALL = "||||";

// 1. THE REPORTED BUG. Year picked, no summary has ever landed this mount
//    (summaryKey null — the case the old `summaryKey !== null` guard exempted).
{
  const r = strip({ summary: null, summaryKey: null, filterKey: YEAR, isScoped: true });
  assert.strictEqual(r.statsStale, true, "scoped + unanswered must read as loading");
  assert.strictEqual(r.visible, null, "zone-wide totals must never show under a year filter");
}

// 2. Same shape via a FAILED /summary: getSummary resolves null, and the effect must
//    not stamp the key. Stamping it is what made the wrong numbers look final.
{
  const r = strip({ summary: null, summaryKey: null, filterKey: YEAR, isScoped: true });
  assert.strictEqual(r.statsStale, true, "a failed summary must not present overview figures");
}

// 3. Totals belonging to the PREVIOUS filter are not this filter's answer.
{
  const r = strip({ summary: YEAR_SUMMARY, summaryKey: ALL, filterKey: YEAR, isScoped: true });
  assert.strictEqual(r.statsStale, true, "totals for another filterKey must read as loading");
}

// 4. The answer for THIS filter shows, and it is the year's own numbers.
{
  const r = strip({ summary: YEAR_SUMMARY, summaryKey: YEAR, filterKey: YEAR, isScoped: true });
  assert.strictEqual(r.statsStale, false);
  assert.strictEqual(r.visible.projects, 16705);
  assert.strictEqual(r.visible.clubs, 1705, "clubs involved must be the year's, never 0");
}

// 5. NOT a regression of the deliberate first paint: unfiltered, /overview IS the
//    right zone-wide answer, so the strip opens with real figures, not a placeholder.
{
  const r = strip({ summary: null, summaryKey: null, filterKey: ALL, isScoped: false });
  assert.strictEqual(r.statsStale, false, "first paint must not regress to a skeleton");
  assert.strictEqual(r.visible.projects, OVERVIEW.totalProjects);
}

// 6. Unfiltered, but the user has been elsewhere and come back — the strip still
//    waits for the answer rather than mixing a stale one in.
{
  const r = strip({ summary: YEAR_SUMMARY, summaryKey: YEAR, filterKey: ALL, isScoped: false });
  assert.strictEqual(r.statsStale, true);
}

// ── Pill badges: an unanswered list is not a list of zero ──
const pill = (list) => (list === null ? null : list.length);
assert.strictEqual(pill(null), null, "unanswered list must render a placeholder, not 0");
assert.strictEqual(pill([]), 0, "a genuinely empty list still reads 0");
assert.strictEqual(pill([1, 2, 3]), 3);

console.log("statStrip.check: all assertions passed");
