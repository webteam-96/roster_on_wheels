// ─────────────────────────────────────────────────────────────────────────────
// Currency for cost figures.
//
// The platform is no longer India-only — rccolombowest (club 35164) is in Sri
// Lanka — and every cost on the site used to be hard-coded to "₹" with Indian
// digit grouping and crore/lakh shorthand. That printed Sri Lankan rupees as
// Indian ones.
//
// WHERE THE CURRENCY COMES FROM. The API already answers it, per club, on
// /public/club/<id>/v2/about and /public/club/<id>/v2/impact:
//
//     club 35164 (Colombo West)  -> "currency":"LKR"
//     clubs 2765 / 2037 / 31536  -> "currency":"INR"
//
// It is read from the CLUB, never from the project. v2/projects carries a
// per-project `currency` too, but it is unreliable: measured 2026-09-03, six of
// Colombo West's twenty-four projects say "INR" on a Sri Lankan club, and the
// project-detail endpoint says "INR" as well. Trusting it would print ₹ on a
// quarter of that club's projects — exactly the reported bug. The club-level
// value is consistent, so that is the single source of truth.
//
// UNKNOWN CURRENCIES FAIL SOFT to the ISO code as a prefix ("BDT 12,000"),
// which is wrong-looking but never MISLEADING — the one thing a money figure
// must not do is claim the wrong currency.
//
// INR IS THE DEFAULT, so the ~1300 Indian clubs render byte-identically to
// before this change: same ₹, same {3,2} grouping, same Cr / L shorthand.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * symbol  — what precedes the digits. A trailing space is part of the symbol
 *           for alphabetic ones ("Rs 500"), absent for glyphs ("₹500").
 * locale  — digit grouping only. en-IN gives {3,2} (16,52,030); the western
 *           locales give {3,3} (1,652,030).
 * scale   — 'indian' unlocks the Cr / L shorthand, which is meaningless
 *           elsewhere; 'western' uses M / B.
 */
const CURRENCIES = {
  INR: { symbol: '₹', locale: 'en-IN', scale: 'indian' },   // ₹
  // Sri Lanka and Nepal print their code, not "Rs", which reads as Indian (client, 2026-10-27)
  LKR: { symbol: 'LKR ', locale: 'en-US', scale: 'western' },
  NPR: { symbol: 'NPR ', locale: 'en-IN', scale: 'indian' },
  PKR: { symbol: 'Rs ', locale: 'en-US', scale: 'western' },
  BDT: { symbol: '৳ ', locale: 'en-US', scale: 'western' }, // ৳
  USD: { symbol: '$', locale: 'en-US', scale: 'western' },
  EUR: { symbol: '€', locale: 'en-US', scale: 'western' },  // €
  GBP: { symbol: '£', locale: 'en-US', scale: 'western' },  // £
  AED: { symbol: 'AED ', locale: 'en-US', scale: 'western' },
  SGD: { symbol: 'S$', locale: 'en-US', scale: 'western' },
  MYR: { symbol: 'RM ', locale: 'en-US', scale: 'western' },
  AUD: { symbol: 'A$', locale: 'en-US', scale: 'western' },
  CAD: { symbol: 'C$', locale: 'en-US', scale: 'western' },
  ZAR: { symbol: 'R ', locale: 'en-US', scale: 'western' },
}

// ROW: the API's Brand.DefaultCurrency; a club's own currency (about.currency) always wins.
export const DEFAULT_CURRENCY = 'USD'

/** Is this a rupee club? (picks the ₹ glyph over a neutral coin) */
export const isInr = (currency) => String(currency || DEFAULT_CURRENCY).toUpperCase() === 'INR'

/**
 * The currency ONE project's cost is in: the one picked on the project (client, 2026-10-27: "if a club
 * selects any currency for a project, show that"), else the club's. Except INR on a non-INR club - that
 * is the old default, not a choice (Colombo West, LKR: 12 of 49 projects still say INR, see the header).
 * Sums over several projects keep the club's currency.
 */
export function projectCurrency(projectCur, clubCur) {
  const p = codeOf(projectCur)
  const c = codeOf(clubCur) || DEFAULT_CURRENCY
  return p && !(p === 'INR' && c !== 'INR') ? p : c
}

/** Normalise whatever the API sent onto a known code, else null. */
function codeOf(currency) {
  const c = String(currency || '').trim().toUpperCase()
  return c || null
}

function spec(currency) {
  const c = codeOf(currency)
  if (!c) return CURRENCIES[DEFAULT_CURRENCY]
  return CURRENCIES[c] || { symbol: c + ' ', locale: 'en-US', scale: 'western' }
}

/** The prefix for a bare figure: "₹", "Rs ", "$", or "XYZ " for an unknown code. */
export function moneySymbol(currency) {
  return spec(currency).symbol
}

/** Digit grouping ONLY — no symbol. Indian clubs keep {3,2} grouping. */
export function groupInt(value, currency) {
  const v = Math.round(Number(value) || 0)
  return v.toLocaleString(spec(currency).locale, { maximumFractionDigits: 0 })
}

/**
 * Port of ToString("#,#", hi-IN): grouped digits, no decimals, and EMPTY STRING
 * for zero — callers lean on the empty string to HIDE a zero-cost stat rather
 * than print "₹0". Now currency-aware; the INR path is unchanged.
 */
export function groupIntBlankZero(value, currency) {
  const v = Math.round(Number(value) || 0)
  return v === 0 ? '' : groupInt(v, currency)
}

/**
 * A full money string: symbol + grouped digits. "₹16,52,030" / "Rs 1,652,030".
 * @param {object} [opts]
 * @param {boolean} [opts.compact] shorten large figures (Cr/L on INR, M/B elsewhere)
 */
export function formatMoney(value, currency, opts) {
  const v = Number(value) || 0
  const s = spec(currency)
  if (!opts || !opts.compact) return s.symbol + groupInt(v, currency)

  if (s.scale === 'indian') {
    if (v >= 1e7) return s.symbol + (v / 1e7).toFixed(2) + ' Cr'
    if (v >= 1e5) return s.symbol + (v / 1e5).toFixed(2) + ' L'
  } else {
    if (v >= 1e9) return s.symbol + (v / 1e9).toFixed(2) + ' B'
    if (v >= 1e6) return s.symbol + (v / 1e6).toFixed(2) + ' M'
  }
  return s.symbol + groupInt(v, currency)
}

// ── self-check ───────────────────────────────────────────────────────────────
// Run with:  node src/shared/money.js
// Kept tiny and dependency-free on purpose; it exists so the INR path can never
// silently drift while someone is adding a currency.
export function demo() {
  const eq = (got, want, what) => {
    if (got !== want) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
  // INR is unchanged from the pre-currency behaviour
  eq(moneySymbol('INR'), '₹', 'INR symbol')
  eq(moneySymbol(null), '₹', 'blank falls back to INR')
  eq(moneySymbol(undefined), '₹', 'undefined falls back to INR')
  eq(groupInt(1652030, 'INR'), '16,52,030', 'INR grouping is {3,2}')
  eq(formatMoney(12000, 'INR'), '₹12,000', 'INR full')
  eq(formatMoney(39000000, 'INR', { compact: true }), '₹3.90 Cr', 'INR crore')
  eq(formatMoney(425000, 'INR', { compact: true }), '₹4.25 L', 'INR lakh')
  // Sri Lanka: the reported bug
  eq(moneySymbol('LKR'), 'LKR ', 'LKR prints its code')
  eq(moneySymbol('NPR'), 'NPR ', 'NPR prints its code')
  eq(groupInt(1652030, 'LKR'), '1,652,030', 'LKR grouping is {3,3}')
  eq(formatMoney(8160001, 'LKR'), 'LKR 8,160,001', 'LKR full')
  eq(formatMoney(8160001, 'LKR', { compact: true }), 'LKR 8.16 M', 'LKR compact uses M, never Cr')
  eq(formatMoney(8160001, 'lkr'), 'LKR 8,160,001', 'code is case-insensitive')
  // a project's own currency
  eq(projectCurrency('USD', 'INR'), 'USD', 'a picked currency wins')
  eq(projectCurrency(null, 'LKR'), 'LKR', 'none picked -> the club')
  eq(projectCurrency('INR', 'LKR'), 'LKR', 'INR on a non-INR club is the old default')
  eq(projectCurrency('inr', null), 'INR', 'INR club')
  // Never mislead on an unknown code
  eq(formatMoney(12000, 'XYZ'), 'XYZ 12,000', 'unknown code prefixes the code itself')
  // Zero hides the stat
  eq(groupIntBlankZero(0, 'INR'), '', 'zero is blank so the stat hides')
  eq(groupIntBlankZero(0, 'LKR'), '', 'zero is blank on every currency')
  eq(groupIntBlankZero(500, 'LKR'), '500', 'non-zero still prints')
  return 'money.js: all checks passed'
}

if (typeof process !== 'undefined' && process.argv && /money\.js$/.test(process.argv[1] || '')) {
  console.log(demo())
}
