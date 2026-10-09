// Message-file parity check (master plan WS2-26). For every language folder,
// fails when a key exists in English but not in the language, a key exists in
// the language but not in English, or a message's ICU arguments differ from the
// English source. --allow-missing reports missing keys without failing (used
// until a language's review is complete; Gate B requires it off).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const allowMissing = process.argv.includes("--allow-missing");

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

// Top-level argument names: "{count, plural, …}" -> "count", "{name}" -> "name".
function args(message) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === "{") {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z0-9_]+)/.exec(message.slice(i));
        if (m) names.add(m[1]);
      }
      depth++;
    } else if (message[i] === "}") depth--;
  }
  return [...names].sort().join(",");
}

const read = (lang, file) => flatten(JSON.parse(readFileSync(join(root, lang, file), "utf8")));
const english = Object.fromEntries(
  readdirSync(join(root, "en")).filter((f) => f.endsWith(".json")).map((f) => [f, read("en", f)]),
);
const languages = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "en" && d.name !== "en-XA")
  .map((d) => d.name);

let errors = 0;
let warnings = 0;
for (const lang of languages) {
  for (const [file, source] of Object.entries(english)) {
    const path = join(root, lang, file);
    const target = existsSync(path) ? read(lang, file) : {};
    for (const key of Object.keys(source)) {
      if (!(key in target)) {
        allowMissing ? warnings++ : errors++;
        if (!allowMissing) console.error(`${lang}/${file}: missing ${key}`);
      } else if (args(source[key]) !== args(target[key])) {
        errors++;
        console.error(`${lang}/${file}: ${key} has arguments {${args(target[key])}}, English has {${args(source[key])}}`);
      }
    }
    for (const key of Object.keys(target)) {
      if (!(key in source)) {
        errors++;
        console.error(`${lang}/${file}: ${key} is not in English`);
      }
    }
  }
}
console.log(`i18n:check ${languages.length} language(s): ${errors} error(s)${allowMissing ? `, ${warnings} missing key(s) allowed` : ""}`);
process.exit(errors ? 1 : 0);
