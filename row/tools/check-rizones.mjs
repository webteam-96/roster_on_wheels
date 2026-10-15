// Fails when ROW (.NET edition) code contains RIZones identity: names, domains,
// vendor, phone numbers, people. Same rules as row/api/tools/check-rizones.mjs.
// India-only behaviour (providers, ₹, India time) is reported separately with --india.
// Usage: node tools/check-rizones.mjs [--india] [dir ...]   (default: api admin club-website workers)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IDENTITY = [
  [/rizones/i, "RIZones name or domain"],
  [/rotary\s*zones?\s*4/i, "RIZones product name"],
  [/zones?\s*4\s*[-–]\s*8|zones?\s*4,\s*5,\s*6/i, "RIZones zone set"],
  [/rotaryindia/i, "RIZones club-site domain"],
  [/rotary\s*india\b/i, "RIZones name"],
  [/kaizen/i, "RIZones vendor"],
  [/8424064369|8928755144|9821130855/, "RIZones help-line / staff number"],
  [/\+91[\s-]?[6-9]\d|tel:\+?91|\b[6-9]\d{4}\s?\d{5}\b/, "Indian phone number (staff / help-line)"],
];
const INDIA = [
  [/\bcashfree\b|\brazorpay\b|\binterakt\b/i, "India-only provider"],
  [/Asia\/Kolkata|India Standard Time|\bIST\b/, "India time zone"],
  [/["'`]INR["'`]|₹|en-IN/, "Indian currency / locale"],
  [/\+91\b/, "India phone prefix"],
];
// Well-known fake numbers used in examples, placeholders and masks.
const FAKE_NUMBERS = /\+?(?:91[\s-]?)?(?:98765[\s-]?4321\d|98765-?432\d\d|9999999999|7700[\s-]?900\d{3}|77009 00\d{3}|9000000\d{3}|90000 00\d{3}|6600000000|6591234567|9187654321|98XXXXXX\d\d|\d{3}234567\d|7700…)/g;
const SKIP_DIRS =new Set(["node_modules", ".next", "bin", "obj", "dist", "out", ".git"]);
const EXT = /\.(cs|cshtml|ts|tsx|js|mjs|json|sql|html|css)$/;
const ALLOW = [/check-rizones\.mjs$/, /package-lock\.json$/];

const args = process.argv.slice(2);
const india = args.includes("--india");
const roots = args.filter((a) => a !== "--india");
const rules = india ? INDIA : IDENTITY;
const hits = [];
function walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) if (!SKIP_DIRS.has(name)) walk(join(path, name));
    return;
  }
  if (!EXT.test(path) || ALLOW.some((a) => a.test(path))) return;
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    // Placeholder / example numbers are not anyone's phone: ignore them before testing.
    line = line.replace(FAKE_NUMBERS, "");
    for (const [re, why] of rules) if (re.test(line)) hits.push(`${relative(process.cwd(), path)}:${i + 1}: ${why}: ${line.trim().slice(0, 140)}`);
  });
}
(roots.length ? roots : ["api", "admin", "club-website", "workers"]).forEach(walk);
hits.forEach((h) => console.log(h));
console.log(`check-rizones${india ? " --india" : ""}: ${hits.length} finding(s)`);
process.exit(hits.length && !india ? 1 : 0);
