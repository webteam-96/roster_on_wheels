// Self-check for the two pieces of this cache that can silently produce WRONG NUMBERS
// rather than merely fail: the 1 MB size guard, and the all-years drift arithmetic.
//
//   node src/lib/statsCache.check.mjs
//
// The logic is re-stated here rather than imported because the modules are TypeScript
// with "@/" path aliases — no build step, no test framework, no dependency.

import { promises as fs } from "fs";
import assert from "assert";
import os from "os";
import path from "path";

const MAX_BYTES = 2 * 1024 * 1024;

// ── mirror of projectStatsServer.trimAreas ──
const normArea = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const CANONICAL = ["Basic Education & Literacy", "Environment", "Water, Sanitation & Hygiene"];
function trimAreas(areas) {
  const canonical = new Set(CANONICAL.map(normArea));
  const kept = areas.filter((a) => canonical.has(normArea(a.name)));
  return kept.length === 0 && areas.length > 0 ? areas : kept;
}

// ── mirror of statsCache.writeSnapshot ──
async function write(file, data) {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body) > MAX_BYTES) {
    await fs.rm(file, { force: true });
    return "too-large";
  }
  try {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, file);
    return "ok";
  } catch {
    return "io-error";
  }
}

// ── mirror of projectStatsServer.allYearsSummary ──
const allYears = (allAtBuild, currentAtBuild, current) => ({
  totalProjects: allAtBuild.totalProjects + (current.totalProjects - currentAtBuild.totalProjects),
  valueInr: allAtBuild.valueInr + (current.valueInr - currentAtBuild.valueInr),
  beneficiaries: allAtBuild.beneficiaries + (current.beneficiaries - currentAtBuild.beneficiaries),
  manHours: allAtBuild.manHours + (current.manHours - currentAtBuild.manHours),
  clubsInvolved: allAtBuild.clubsInvolved,
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stats-check-"));
const file = path.join(dir, "snap.json");

// 1. A normal snapshot is written and reads back intact.
assert.strictEqual(await write(file, { current: { totalProjects: 11385 } }), "ok");
assert.strictEqual(JSON.parse(await fs.readFile(file, "utf8")).current.totalProjects, 11385);

// 2. Over the ceiling: refused AND the old file is discarded, so nothing stale survives.
const oversized = { blob: "x".repeat(MAX_BYTES + 1) };
assert.strictEqual(await write(file, oversized), "too-large");
assert.strictEqual(await fs.stat(file).then(() => true, () => false), false,
  "oversized write must delete the previous snapshot, not keep serving it");

// 3. Drift: real numbers off the live API. 2026-27 gains 15 projects worth 50,000.
const build = { totalProjects: 252013, valueInr: 11480000000, beneficiaries: 500, manHours: 20000000, clubsInvolved: 2275 };
const curAtBuild = { totalProjects: 11385, valueInr: 498220370, beneficiaries: 100, manHours: 344955, clubsInvolved: 1471 };
const curNow = { ...curAtBuild, totalProjects: 11400, valueInr: 498270370 };
const out = allYears(build, curAtBuild, curNow);
assert.strictEqual(out.totalProjects, 252028, "all-years must follow the current year exactly");
assert.strictEqual(out.valueInr, 11480050000);

// 4. clubsInvolved is a COUNT(DISTINCT) — it must NEVER drift, or clubs active in two
//    years get double counted and the figure inflates every single year.
assert.strictEqual(out.clubsInvolved, 2275);

// 5. No change at all → the all-years figures are byte-identical to the build.
assert.deepStrictEqual(allYears(build, curAtBuild, curAtBuild), build);

// 6. The areas trim must leave the UI's lookup returning the IDENTICAL row — that lookup
//    is `find(first match by normalised name)`, so both membership and ORDER matter.
const raw = [
  { areaOfFocusId: 1, name: "BASIC EDUCATION AND LITERACY", projects: 78610 },
  { areaOfFocusId: 9, name: "Others", projects: 109288 },
  { areaOfFocusId: 7, name: "ENVIRONMENT", projects: 4000 },
  { areaOfFocusId: 31, name: "tree plantation drive", projects: 3 },
  { areaOfFocusId: 6, name: "Water, Sanitation & Hygiene", projects: 900 },
];
const trimmed = trimAreas(raw);
assert.strictEqual(trimmed.length, 3, "only canonical causes survive the trim");
for (const key of CANONICAL) {
  const before = raw.find((a) => normArea(a.name) === normArea(key));
  const after = trimmed.find((a) => normArea(a.name) === normArea(key));
  assert.deepStrictEqual(after, before, `lookup for "${key}" must return the same row`);
}

// 7. Fail open: an API rename that matches nothing must keep the full list, never ship
//    a cache that silently breaks every cause tab.
const unmatched = [{ areaOfFocusId: 1, name: "Renamed Cause", projects: 5 }];
assert.deepStrictEqual(trimAreas(unmatched), unmatched);
assert.deepStrictEqual(trimAreas([]), []);

// 8. An unwritable cache directory must RESOLVE "io-error", never reject. Every caller
//    is fire-and-forget, so a thrown error here would be an unhandled rejection — which
//    terminates the Node process. A read-only folder must not take the site down.
const io = await write(path.join(dir, "no", "such", "dir", "snap.json"), { a: 1 });
assert.strictEqual(io, "io-error", "a failed write must resolve, not throw");

// 9. And "io-error" must be distinguishable from "too-large": only the latter may
//    trigger a rebuild, or a read-only folder would refetch the API on every probe.
assert.notStrictEqual(io, "too-large");

await fs.rm(dir, { recursive: true, force: true });
console.log("statsCache self-check: 9/9 passed");
