// DISPLAY ONLY - the code stored on a project and every amount are untouched; this is what the
// screens print in front of a number. Sri Lanka and Nepal used to print "Rs", the same as each other
// and close enough to India's to be read as rupees, so a Colombo project showed "Rs 100.0K" with a
// ₹ icon beside it (user 2026-10-05). They now print their ISO code. India keeps ₹, USD keeps $.
export const CURRENCY_OPTIONS = [
  { code: "INR", label: "India (₹ INR)", symbol: "₹" },
  { code: "LKR", label: "Sri Lanka (LKR)", symbol: "LKR" },
  { code: "NPR", label: "Nepal (NPR)", symbol: "NPR" },
  { code: "USD", label: "Dollars (USD $)", symbol: "$" },
] as const;

// Which lucide icon belongs beside an amount. The rupee glyph is India's, so a Colombo or
// Kathmandu figure gets a neutral coin instead of contradicting itself (user 2026-10-05).
export function moneyIconName(code?: string | null): "rupee" | "dollar" | "coins" {
  const c = (code ?? "INR").toUpperCase();
  if (c === "INR") return "rupee";
  if (c === "USD") return "dollar";
  return "coins";
}

export function getCurrencySymbol(code?: string | null): string {
  return CURRENCY_OPTIONS.find((c) => c.code === code?.toUpperCase())?.symbol ?? "₹";
}

// Multi-char symbols (e.g. "Rs") read better with a space before the number; "₹"/"$" don't.
function sepFor(sym: string): string {
  return sym.length > 1 ? " " : "";
}

// Compact money with the correct currency symbol. INR uses Indian grouping (Cr/L/K);
// every other currency uses international K/M/B. Drop-in replacement for the old shortInr().
export function shortMoney(value?: number | null, code?: string | null): string {
  const n = Number(value) || 0;
  const sym = getCurrencySymbol(code);
  const sep = sepFor(sym);
  const abs = Math.abs(n);
  if ((code ?? "INR").toUpperCase() === "INR") {
    if (abs >= 1_00_00_000) return `${sym}${sep}${(n / 1_00_00_000).toFixed(1)}Cr`;
    if (abs >= 1_00_000) return `${sym}${sep}${(n / 1_00_000).toFixed(1)}L`;
    if (abs >= 1_000) return `${sym}${sep}${(n / 1_000).toFixed(1)}K`;
    return `${sym}${sep}${n}`;
  }
  if (abs >= 1_000_000_000) return `${sym}${sep}${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sym}${sep}${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${sep}${(n / 1_000).toFixed(1)}K`;
  return `${sym}${sep}${n}`;
}

// Full money with grouping (e.g. "₹1,05,000", "$105", "Rs 2,500"). INR uses en-IN grouping.
export function formatMoney(value?: number | null, code?: string | null): string {
  const n = Number(value) || 0;
  const sym = getCurrencySymbol(code);
  const sep = sepFor(sym);
  const locale = (code ?? "INR").toUpperCase() === "INR" ? "en-IN" : "en-US";
  return `${sym}${sep}${n.toLocaleString(locale)}`;
}

// Districts created before district_master.Country existed were backfilled from their OLD zone
// name (see RotaryApi/Services/DatabaseInitializer.cs) — most pre-existing Indian districts carry
// one of these literal artifacts rather than "India". Treat them (and null/blank) as INR.
const LEGACY_INDIA_ZONE_NAMES = new Set(["zone 4", "zone 5", "zone 6", "zone 0", "zone 7", "testzone1"]);

// Fallback guess from the club's district's country — only used when a SuperAdmin hasn't
// explicitly set district_master.DefaultCurrency yet (see resolveClubDefaultCurrency below).
export function resolveDefaultCurrency(districtCountry?: string | null): string {
  const c = (districtCountry ?? "").trim().toLowerCase();
  if (c === "nepal") return "NPR";
  if (c === "sri lanka") return "LKR";
  if (c === "" || c === "india" || LEGACY_INDIA_ZONE_NAMES.has(c)) return "INR";
  return "USD"; // Taiwan + any other world-sync country
}

// Pre-selects a project's currency: prefers the SuperAdmin-set district default (explicit,
// authoritative); falls back to guessing from the district's country only for districts nobody
// has configured yet. User can always override via the dropdown either way.
export function resolveClubDefaultCurrency(club: {
  districtDefaultCurrency?: string | null;
  districtCountry?: string | null;
}): string {
  const explicit = (club.districtDefaultCurrency ?? "").trim().toUpperCase();
  if (CURRENCY_OPTIONS.some((c) => c.code === explicit)) return explicit;
  return resolveDefaultCurrency(club.districtCountry);
}
