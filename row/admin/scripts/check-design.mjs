// FRONTEND-RULES gate for the Fellowship port. Counts what the central token changes cannot fix.
// Usage: node scripts/check-design.mjs [folder ...]   (folders relative to src/, default: all of src)
// Exits 1 while any count is non-zero.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const targets = process.argv.slice(2).map((d) => path.join(root, d));
const REMAPPED = "blue|indigo|sky|cyan|teal|violet|purple|fuchsia|pink|slate|gray|zinc|neutral|stone|yellow|orange";

const checks = {
  lucide: /from\s+["']lucide-react["']/g,
  gradient: /\bbg-gradient-to-|\b(?:linear|radial|conic)-gradient\(/g,
  hex: /(?<![&\w])#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b(?![0-9A-Fa-f])/g, // (?<!&) skips &#123; entities
  emDash: /—/g,
  emoji: /(?![©®™↔↕])\p{Extended_Pictographic}/gu, // typographic symbols are text, not emoji
  whiteOnLight: new RegExp(`(?=[^"'\`]*\\btext-white\\b)[^"'\`]*(?<![:\\w-])bg-(?:${REMAPPED})-(?:50|100|200|300)\\b`, "g"),
  shadowArbitrary: /\bshadow-\[(?!var\(--shadow-)/g, // --shadow-soft/--shadow-lift are 1px/2px rings
};

// Colours that are data, not chrome: they must render exactly as the source defines them.
const ALLOW = {
  "app/clubs/[id]/website-data/theme/page.tsx": "club website theme presets (previews of the public site's palette)",
  "app/clubs/[id]/website-data/theme/v2/page.tsx": "club website theme presets",
  "components/pages/projects/shared.tsx": "Rotary areas-of-focus brand colours",
  "components/pages/about/ImpactAreas.tsx": "Rotary areas-of-focus brand colours",
  "components/site/AreasOfFocus.tsx": "Rotary areas-of-focus brand colours",
};

// Hex is fine when it is a Fellowship scale step, or a semantic red/green (left unmapped, like the Tailwind remap).
const PALETTE = new Set(fs.readFileSync(path.resolve(import.meta.dirname, "../tailwind.config.ts"), "utf8")
  .match(/#[0-9A-Fa-f]{6}\b/g).map((v) => v.toUpperCase()));
function offPalette(hex) {
  let h = hex.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (PALETTE.has("#" + h.toUpperCase())) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d < 0.2) return true; // neutral not on the Fellowship neutral scale
  const hue = ((mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return !(hue < 15 || hue >= 335 || (hue >= 80 && hue < 170)); // red / green are semantic
}

// Comments are not UI: drop them before counting.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) yield p;
  }
}

const totals = Object.fromEntries(Object.keys(checks).map((k) => [k, 0]));
const worst = [];
for (const dir of targets.length ? targets : [root]) {
  for (const file of walk(dir)) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    // A line marked `design-allow: <reason>` is a deliberate, reviewed exception.
    const src = stripComments(fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.includes("design-allow:")).join("\n"));
    let fileTotal = 0;
    for (const [k, re] of Object.entries(checks)) {
      if (ALLOW[rel] && (k === "hex" || k === "gradient")) continue;
      const hits = src.match(re) ?? [];
      const n = k === "hex" ? hits.filter(offPalette).length : hits.length;
      totals[k] += n;
      fileTotal += n;
    }
    if (fileTotal) worst.push([fileTotal, path.relative(root, file)]);
  }
}

console.table(totals);
worst.sort((a, b) => b[0] - a[0]);
for (const [n, f] of worst.slice(0, 15)) console.log(String(n).padStart(5), f);
process.exit(Object.values(totals).some(Boolean) ? 1 : 0);
