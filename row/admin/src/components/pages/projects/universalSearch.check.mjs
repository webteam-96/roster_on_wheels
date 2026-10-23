// Self-check for the projects search box's matcher.
//
// The rule it must never break: a subject typed the way a person types it has to
// reach the choice that covers it. Reported from the page: typing "blood donations"
// said "Nothing matches" while blood-donation projects sat in the grid below, because
// matching was whole-phrase against the choice's NAME only — and "Blood donation
// drive" does not contain the string "blood donations".
//
//   node src/components/pages/projects/universalSearch.check.mjs
//
// The logic is re-stated here rather than imported because the module is TSX with
// "@/" path aliases — no build step, no test framework, no dependency. Keep the two
// in step: this mirrors `terms` + the filter in UniversalSearch.tsx, and the
// AREA_KEYWORDS table in shared.tsx.

import assert from "assert";

/** Mirror of UniversalSearch.tsx. */
function matches(query, item) {
  const q = query.trim().toLowerCase();
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/(?<!s)s$/, "") : w));
  const hay = `${item.label} ${item.sub ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** The two cause rows the reported cases depend on (mirror of shared.tsx AREA_KEYWORDS). */
const DISEASE = {
  label: "Disease Prevention",
  keywords:
    "health healthcare medical medicine doctor hospital clinic camp blood donation checkup screening cancer eye dental polio vaccination immunisation",
};
const ENVIRONMENT = {
  label: "Environment",
  keywords:
    "environment green tree plantation planting sapling forest climate waste plastic recycling solar pollution",
};
const CLUB = { label: "Kolhapur Rotary", sub: "Kolhapur · RID 3170" };

/* The subject reaches the cause, in singular and plural, in either word order. */
assert.ok(matches("health", DISEASE), "'health' must reach Disease Prevention");
assert.ok(matches("blood donation", DISEASE), "exact subject must match");
assert.ok(matches("blood donations", DISEASE), "PLURAL must match — the reported bug");
assert.ok(matches("donation blood", DISEASE), "word ORDER must not matter");
assert.ok(matches("health camps", DISEASE), "'camps' must reach 'camp'");
assert.ok(matches("tree plantation", ENVIRONMENT), "'tree plantation' must reach Environment");
assert.ok(matches("plantations", ENVIRONMENT), "plural of a keyword must match");

/* A name still matches on its own, and the second line is still searchable. */
assert.ok(matches("kolhapur", CLUB), "club name must still match");
assert.ok(matches("rotary kolhapur", CLUB), "reversed club words must match");
assert.ok(matches("3170", CLUB), "the sub line must stay searchable");

/* Every word must be present — one hit out of two is not a match. */
assert.ok(!matches("blood pressure", DISEASE), "'pressure' is absent, so this must NOT match");
assert.ok(!matches("tree", DISEASE), "an unrelated subject must NOT match");
assert.ok(!matches("kolhapur mumbai", CLUB), "both words must be present");

/* Trimming a trailing "s" must never break a short word that ends in one. */
assert.ok(matches("eye", DISEASE), "3-letter word is left alone");
assert.strictEqual(
  matches("gas", { label: "gas" }),
  true,
  "a 3-letter word ending in s must not be trimmed to 'ga'"
);

/* ——— The "ss" guard ———
   A word ending in "ss" keeps it: the s is part of the word, not a plural. The
   first cut of this stemmed "mass" to "ma", whose LIKE '%ma%' matched most of the
   database (Mahila, Grama, Samaj, Marathon...) while presenting itself as a search
   for mass vaccination. Every case below is a word a user would really type. */
const stem = (w) => (w.length > 3 ? w.replace(/(?<!s)s$/, "") : w);
for (const [word, expected] of [
  ["donations", "donation"], // real plural -> stemmed
  ["camps", "camp"],
  ["plantations", "plantation"],
  ["mass", "mass"], // "ss" -> left alone
  ["class", "class"],
  ["cross", "cross"],
  ["press", "press"],
  ["ssss", "ssss"], // must never collapse to "" (LIKE '%%' matches everything)
  ["eye", "eye"], // too short to touch
]) {
  assert.strictEqual(stem(word), expected, `stem("${word}") must be "${expected}"`);
}

/* The consequence, end to end: "mass" must NOT match a project that merely
   contains "ma" somewhere. */
assert.ok(
  !matches("mass", { label: "Mahila Empowerment Programme" }),
  "'mass' must not match 'Mahila' — the regression that made the search useless"
);

/* ——— The PROJECT search (ProjectsHub `terms` + `filtered`, and the title leg of
   SearchSqlAsync() in PublicProjectStatsController.cs) ———
   Reported from the page: "heart surgery" also listed "Spine surgery", "Heartline
   Surgery" and "Happy street", because each word was matched as a substring of the
   title, area, category, club or state independently. The rule now: every word
   must be a WHOLE word of the TITLE (a trailing plural "s" allowed), any order.
   (The live API also lets a word match the club, state, district or area — this
   checks only the title rule the two share.) */
function matchesProject(query, title) {
  const terms = query
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem);
  if (terms.length === 0) return !query.trim();
  return terms.every((t) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${t}s?([^\\p{L}\\p{N}]|$)`, "iu").test(title)
  );
}

assert.ok(matchesProject("heart surgery", "Paediatric Heart Surgery"), "the subject itself must match");
assert.ok(matchesProject("heart surgery", "Emergency Medical Assistance – Open Heart Surgery"), "punctuation around words is fine");
assert.ok(matchesProject("surgery heart", "Surgery for heart patients"), "word ORDER must not matter");
assert.ok(matchesProject("blood donations", "Blood Donation Camp"), "plural query still reaches singular title");
assert.ok(matchesProject("heart surgery", "Little Hearts Surgery"), "plural 's' in the TITLE still counts");
assert.ok(matchesProject("covid-19", "COVID-19 relief kits"), "hyphenated terms still match");
assert.ok(!matchesProject("heart surgery", "FINANCIAL HEP FOR A SPINE SURGERY"), "'heart' absent from the title — must NOT match");
assert.ok(!matchesProject("heart surgery", "Heartline Surgery 800"), "'Heartline' is not the word 'heart'");
assert.ok(!matchesProject("heart surgery", "Happy street"), "category-only hits must NOT match");
assert.ok(!matchesProject("heart surgery", "Hand surgery camp"), "'hand surgery' is not 'heart surgery'");
assert.ok(!matchesProject("mass", "Mahila Empowerment Programme"), "no substring hits");
assert.ok(matchesProject("children's hospital", "Children Hospital ward"), "an apostrophe must not leave a stray 's' term");
assert.ok(matchesProject("women’s health", "Womens Health camp"), "curly apostrophe too");
assert.ok(!matchesProject("---", "Paediatric Heart Surgery"), "a query with no letters or digits matches NOTHING, not everything");

/* ——— Ranking (ProjectsHub `searchRank`, and SearchRankSql() in the controller) ———
   Reported: searching a project's exact name ("right to go") did not put that
   project first — the list was newest-first. Now: exact title, then titles that
   contain the phrase, then the rest; newest first within each. */
function searchRank(query, title) {
  const q = query.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  return t === q ? 0 : t.includes(q) ? 1 : 2;
}
const ranked = [
  { title: "Right to go handover", date: 3 },
  { title: "Water tank to go right", date: 4 },
  { title: "RIGHT TO GO", date: 1 },
  { title: "Right To Go- Visit to Agahi Village", date: 2 },
]
  .sort((a, b) => searchRank("right to go", a.title) - searchRank("right to go", b.title) || b.date - a.date)
  .map((r) => r.title);
assert.deepStrictEqual(
  ranked,
  ["RIGHT TO GO", "Right to go handover", "Right To Go- Visit to Agahi Village", "Water tank to go right"],
  "exact title first, then phrase matches (newest first), then the rest"
);

console.log("universalSearch.check: all assertions passed");
