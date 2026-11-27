import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pages are put together from the shared components (design.md 8.3); they do not build their own header, button, field
// or form section. Counts may only go down: convert one, then lower its number here.
const ROOT = join(process.cwd(), "src");
const SKIP = /\(site\)|components[\\/](site|pages|public|motion|ui|row|form)[\\/]/;

function sources(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? sources(p) : p.endsWith(".tsx") && !SKIP.test(p) ? [p] : [];
  });
}
const files = sources().map((p) => ({ p, t: readFileSync(p, "utf8") }));
const count = (re: RegExp) => files.reduce((n, f) => n + (f.t.match(re)?.length ?? 0), 0);

describe("shared parts", () => {
  it("no page copies a shared form part", () => {
    const own = files.filter((f) => /\nfunction (FieldLabel|Req|OptLabel|RadioPill|DetailRow|PageHeader)\(/.test(f.t)).map((f) => f.p);
    expect(own).toEqual([]);
  });

  it.each([
    ["<h1", /<h1\b/g, 35],
    // Left on purpose (2026-11-27): buttons = sidebar nav item (the nav part itself), CMR v2 step indicator, dev preview;
    // tables = the CMR print sheets.
    ["<button", /<button\b/g, 3],
    ["<select", /<select\b/g, 17],
    ["<textarea", /<textarea\b/g, 4],
    ["<table", /<table\b/g, 6],
    ["pixel corner", /rounded-\[\d+px\]/g, 10],
  ])("hand-written %s does not grow", (_name, re, max) => {
    expect(count(re)).toBeLessThanOrEqual(max);
  });
});
