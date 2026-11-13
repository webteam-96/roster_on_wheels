// Post-build step (part of `npm run build`).
// Next.js static export writes small inline bootstrap <script>s (the RSC flight data,
// `self.__next_f.push(...)`) into every exported HTML page. Instead of allowing
// 'unsafe-inline' in the CSP, hash each inline script and write the hashes into
// out/web.config in place of the __CSP_SCRIPT_HASHES__ placeholder.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const PLACEHOLDER = "__CSP_SCRIPT_HASHES__";
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

const hashes = new Set();
let pages = 0;
for (const file of htmlFiles(OUT)) {
  pages++;
  for (const [, attrs, body] of readFileSync(file, "utf8").matchAll(SCRIPT_TAG)) {
    if (/\bsrc\s*=/i.test(attrs)) continue; // external script — covered by 'self'
    hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
}

const configPath = join(OUT, "web.config");
const config = readFileSync(configPath, "utf8");
const occurrences = config.split(PLACEHOLDER).length - 1;
if (occurrences !== 1) {
  console.error(`csp-hashes: expected exactly one ${PLACEHOLDER} in out/web.config, found ${occurrences}.`);
  process.exit(1);
}
writeFileSync(configPath, config.replace(PLACEHOLDER, [...hashes].sort().join(" ")));
console.log(`csp-hashes: ${hashes.size} inline script hash(es) from ${pages} page(s) written to out/web.config`);
