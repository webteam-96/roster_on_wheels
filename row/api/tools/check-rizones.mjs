// Fails when ROW code contains RIZones-specific literals (names, domains,
// phone numbers, India-only providers). ROW shares RIZones' architecture only.
// Usage: node tools/check-rizones.mjs [dir ...]   (default: src)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PATTERNS = [
  [/rizones/i, "RIZones name or domain"],
  [/rotary\s*zones\s*4/i, "RIZones product name"],
  [/rotaryindia\.org/i, "RIZones club-site domain"],
  [/kaizeninfotech/i, "RIZones vendor address"],
  [/8424064369|8928755144/, "RIZones help-line number"],
  [/\bcashfree\b|\brazorpay\b|\binterakt\b/i, "India-only provider"],
  [/Asia\/Kolkata|\bIST\b/, "India time zone"],
  [/["'`]INR["'`]|₹/, "Indian currency literal"],
];
// Files that may name these on purpose (this checker, the porting guide).
const ALLOW = [/check-rizones\.mjs$/, /PORTING\.md$/, /\.spec\.ts$/];

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["src"];
const hits = [];
function walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) if (name !== "node_modules" && name !== "dist") walk(join(path, name));
    return;
  }
  if (!/\.(ts|tsx|js|mjs|json|sql|html)$/.test(path) || ALLOW.some((a) => a.test(path))) return;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Comments may say where code came from; only code and data are checked.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const [re, why] of PATTERNS) if (re.test(line)) hits.push(`${relative(process.cwd(), path)}:${i + 1}: ${why}: ${line.trim().slice(0, 120)}`);
  });
}
roots.forEach(walk);
hits.forEach((h) => console.log(h));
console.log(`check-rizones: ${hits.length} finding(s)`);
process.exit(hits.length ? 1 : 0);
