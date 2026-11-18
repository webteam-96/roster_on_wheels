// ─────────────────────────────────────────────────────────────────────────────
// Port of Faster_ClubWebsite/ThemeResolver.cs — SAME precedence chain, SAME
// aliases, SAME fail-soft behaviour.
//
//   (a0) ThemePreviewKey live demo  (?theme=X&pk=KEY + session cookie)
//   (a)  ?theme=           — LOCAL requests only
//   (a2) DevThemePortMap   — LOCAL requests only, per-port pin
//   (b)  DevThemeOverride
//   (c)  ClubThemeMap      — production per-club pin
//   (d)  ForcedTheme       — production global lock
//   (e)  the club's ThemeKey from the DB (dashboard pick) — madras-legacy is
//        restricted to RC Madras at this step only; see fromClubTheme()
//   ->   classic-blue
//
// Only KNOWN keys activate a theme — junk/unknown values fall through to the
// next source, so bad DB data degrades safely.
// ─────────────────────────────────────────────────────────────────────────────
import { appSettings, isLocalRequest } from '../config.js'

export const CLASSIC_BLUE = 'classic-blue'
export const WARM_MODERN = 'warm-modern'
/** Theme 3: the RC Madras legacy design (old "template 4"). */
export const MADRAS_LEGACY = 'madras-legacy'
/** Theme 4: "Civic Bold" — dark, high-contrast Swiss/civic treatment. */
export const CIVIC_BOLD = 'civic-bold'
/** Theme 5: "The Verdigris Ledger" — editorial peacock-teal on sea-paper. */
export const VERDIGRIS_LEDGER = 'verdigris-ledger'
/** Theme 6: "Gold" — cream and navy with a hallmarked gold accent. */
export const GOLD = 'gold'
/** Theme 7: "The Handloom" — greige cloth, brand green, madder accent. */
export const HANDLOOM = 'handloom'

// Theme 8 family — the scroll-animated designs (samples A, C, E, F, G, H in
// Theme8-Samples/). Each lives in its own folder under src/themes/ and is found
// by src/themes/registry.js. Released 2026-10-07: a club picks one by its gemstone name.
export const CINEMATIC = 'cinematic'
export const SPLIT_STORY = 'split-story'
export const LIQUID_MOTION = 'liquid-motion'
export const HORIZONTAL_JOURNEY = 'horizontal-journey'
export const PHOTO_COLLAGE = 'photo-collage'
export const SUNRISE = 'sunrise'
export const THEME8_KEYS = [CINEMATIC, SPLIT_STORY, LIQUID_MOTION, HORIZONTAL_JOURNEY, PHOTO_COLLAGE, SUNRISE]

export const THEME_KEYS = [CLASSIC_BLUE, WARM_MODERN, MADRAS_LEGACY, CIVIC_BOLD, VERDIGRIS_LEDGER, GOLD, HANDLOOM, ...THEME8_KEYS]

const PREVIEW_COOKIE = 'rotary_theme_preview'

/**
 * The name this theme carries in the admin dashboard (theme_master.theme_name).
 * Inverse of the mapping in normalize(). madras-legacy has no dashboard row on
 * purpose, so it reports its own key.
 */
export function dbName(themeKey) {
  switch (themeKey) {
    case CLASSIC_BLUE: return 'Sapphire'
    case WARM_MODERN: return 'Topaz'
    case CIVIC_BOLD: return 'Ruby'
    // Gold used to be a second name for classic-blue. Theme 6 claims the row, so
    // a club set to Gold in the dashboard now gets the Gold theme.
    case GOLD: return 'Gold'
    case VERDIGRIS_LEDGER: return 'Platinum'
    case MADRAS_LEGACY: return 'Madras'
    // The gemstone for the green theme (2026-09-21): the dashboard row to add
    // is "Emerald", slugified by the API to `emerald` - see normalize().
    case HANDLOOM: return 'Emerald'
    // Theme 8 gemstones (2026-10-07) - see normalize()
    case CINEMATIC: return 'Onyx'
    case SPLIT_STORY: return 'Lapis'
    case LIQUID_MOTION: return 'Aquamarine'
    case HORIZONTAL_JOURNEY: return 'Opal'
    case PHOTO_COLLAGE: return 'Garnet'
    case SUNRISE: return 'Sunstone'
    default: return themeKey
  }
}

/**
 * Resolve the theme for this page view.
 * @param {object|null} club  the resolved tenant: { clubId, subdomain, themeKey }
 */
export function resolve(club) {
  // (a0) LIVE demo preview. Must be first: it has to beat ForcedTheme (d) and
  //      ClubThemeMap (c), or the production lock would mask it.
  const preview = fromPreview()
  if (preview) return preview

  // (a) ?theme= preview override — honoured only for local requests.
  if (isLocalRequest()) {
    const params = new URLSearchParams(window.location.search)
    const q = normalize(params.get('theme'))
    if (q) return q

    // (a2) DevThemePortMap — local per-port preview, ';'-separated port=theme
    //      pairs. Beats DevThemeOverride so each port keeps its theme.
    const map = appSettings.DevThemePortMap
    if (map && map.trim()) {
      const port = window.location.port
      for (const pair of map.split(';')) {
        const kv = pair.split('=')
        if (kv.length === 2 && kv[0].trim() === port) {
          const mapped = normalize(kv[1])
          if (mapped) return mapped
        }
      }
    }
  }

  // (b) DevThemeOverride — local preview convenience.
  const dev = normalize(appSettings.DevThemeOverride)
  if (dev) return dev

  // (c) ClubThemeMap — PRODUCTION per-club pin, checked BEFORE the global
  //     ForcedTheme lock so a specific club can run its own theme while
  //     everyone else stays locked.
  const pinned = fromClubThemeMap(club)
  if (pinned) return pinned

  // (d) ForcedTheme — PRODUCTION-SAFE global lock.
  const forced = normalize(appSettings.ForcedTheme)
  if (forced) return forced

  // (e) The club's theme from the DB (via the tenant lookup).
  return fromClubTheme(club)
}

/**
 * RC Madras — the ONLY club allowed to render madras-legacy. Matched on club id
 * or subdomain label, the same two things ClubThemeMap keys on.
 */
// ROW: empty. 2037 / rcmadras were RC Madras on the RIZones platform; in ROW id 2037 is an
// unrelated club. madras-legacy stays reachable only through ClubThemeMap / ForcedTheme / preview.
const MADRAS_CLUBS = []

/** Is this the club madras-legacy was built for? */
export function isMadrasClub(club) {
  if (!club) return false
  const id = String(club.clubId || '').trim().toLowerCase()
  const sub = normalizeLabel(club.subdomain)
  return MADRAS_CLUBS.includes(id) || (sub !== null && MADRAS_CLUBS.includes(sub))
}

/**
 * Step (e) of the chain: the club's own dashboard pick, with one restriction.
 *
 * madras-legacy is not a generic theme — it is RC Madras's own legacy "template
 * 4" design, carrying their layout and their identity. The dashboard's
 * theme_master table still lists "Madras" as a selectable row, so any club could
 * pick it and end up wearing another club's site. Every OTHER club that lands on
 * it falls back to classic-blue (Sapphire), which is also what a club with no
 * pick at all gets.
 *
 * Deliberately applied HERE and not to steps (a)-(d): an explicit ClubThemeMap
 * pin, a ForcedTheme lock and the ?theme=/preview overrides are all decisions
 * someone made on purpose, and must still be able to show madras-legacy anywhere
 * (that is how it gets previewed and how RC Madras itself is pinned).
 */
export function fromClubTheme(club) {
  const key = normalize(club ? club.themeKey : null)
  if (key === MADRAS_LEGACY && !isMadrasClub(club)) return CLASSIC_BLUE
  if (UNRELEASED_THEMES.includes(key)) return CLASSIC_BLUE
  return key || CLASSIC_BLUE
}

/**
 * Themes that exist in the code but must NOT be handed to a real club yet.
 *
 * EMPTY as of the gold release: a club whose dashboard theme is "Gold" now gets
 * theme 6 (the gold theme) instead of being bounced to classic-blue. The list
 * itself stays — it is the mechanism for holding the NEXT unfinished theme back,
 * and re-adding a key is the whole rollback.
 */
// Theme 8 released 2026-10-07 under its gemstone names (normalize()); Handloom released 2026-11-18
const UNRELEASED_THEMES = []

/**
 * LIVE theme preview — lets one person walk every page in any theme WITHOUT
 * changing what any club sees. Steps (a)/(a2) are gated on "is this localhost"
 * and so are useless in production; this is their production equivalent, gated
 * on a shared key.
 *
 *   1. open  https://<club-domain>/Home.aspx?theme=civic-bold&pk=<ThemePreviewKey>
 *   2. click through the nav normally — a SESSION cookie carries the theme
 *   3. ?theme=off&pk=… (any unknown value) ends the preview
 *
 * A BLANK ThemePreviewKey disables this completely, so the feature is inert
 * until deliberately switched on.
 */
function fromPreview() {
  const key = appSettings.ThemePreviewKey
  if (!key || !key.trim() || typeof window === 'undefined') return null

  const params = new URLSearchParams(window.location.search)
  const raw = params.get('theme')
  if (raw && raw.trim() && params.get('pk') === key.trim()) {
    const picked = normalize(raw)     // null for ?theme=off -> clears the cookie
    writeCookie(PREVIEW_COOKIE, picked || '', picked === null)
    if (picked) return picked
    return null                       // preview ended -> fall through to the normal chain
  }

  return normalize(readCookie(PREVIEW_COOKIE))
}

function readCookie(name) {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

function writeCookie(name, value, expire) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  const expires = expire ? '; Expires=Thu, 01 Jan 1999 00:00:00 GMT' : ''
  document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; SameSite=Lax' + secure + expires
}

/**
 * Theme pinned to THIS club by the ClubThemeMap setting, or null. Fails soft:
 * unknown keys/values or an unresolved tenant simply skip the map.
 */
function fromClubThemeMap(club) {
  const map = appSettings.ClubThemeMap
  if (!map || !map.trim() || !club) return null
  try {
    const clubId = String(club.clubId || '')
    const sub = normalizeLabel(club.subdomain)
    for (const pair of map.split(';')) {
      const kv = pair.split('=')
      if (kv.length !== 2) continue
      const k = kv[0].trim().toLowerCase()
      if (!k) continue
      if (k === clubId || (sub && k === sub)) {
        const theme = normalize(kv[1])
        if (theme) return theme
      }
    }
  } catch {
    /* tenant unavailable -> no per-club pin */
  }
  return null
}

/** Reduce a stored Subdomain ("https://rcmadras/") to its bare label. */
function normalizeLabel(raw) {
  if (!raw || !String(raw).trim()) return null
  let v = String(raw).trim().toLowerCase()
    .replace('https://', '').replace('http://', '').replace(/\/+$/, '')
  if (v.startsWith('www.')) v = v.slice(4)
  const dot = v.indexOf('.')
  if (dot > 0) v = v.slice(0, dot)
  return v.length === 0 ? null : v
}

/**
 * Map a raw value onto a KNOWN theme key; null when unknown/blank so the next
 * source in the precedence chain is consulted.
 */
export function normalize(raw) {
  if (raw === null || raw === undefined) return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null

  // Exact theme keys (and short aliases).
  if (v === CLASSIC_BLUE || v === 'classic') return CLASSIC_BLUE
  if (v === WARM_MODERN || v === 'warm') return WARM_MODERN
  if (v === MADRAS_LEGACY || v === 'madras') return MADRAS_LEGACY
  if (v === CIVIC_BOLD || v === 'civic') return CIVIC_BOLD
  if (v === VERDIGRIS_LEDGER || v === 'verdigris') return VERDIGRIS_LEDGER
  if (v === GOLD) return GOLD
  if (v === HANDLOOM || v === 'loom') return HANDLOOM
  // Theme 8: the exact keys (the dashboard names are mapped below).
  if (THEME8_KEYS.includes(v)) return v

  // ---- THE SELECTABLE THEMES (dashboard -> here) --------------------------
  // A club picks its theme in the admin dashboard, which stores a theme_master
  // row id. The API hands us the row's theme_name slugified, so what arrives
  // here is the DB NAME, not our internal folder key.
  //
  //   Sapphire -> classic-blue      Topaz    -> warm-modern
  //   Ruby     -> civic-bold        Gold     -> gold (theme 6)
  //   Platinum -> verdigris-ledger  Madras   -> madras-legacy (alias above)
  if (v === 'sapphire') return CLASSIC_BLUE
  if (v === 'topaz') return WARM_MODERN
  if (v === 'ruby') return CIVIC_BOLD
  if (v === 'gold') return GOLD
  if (v === 'platinum') return VERDIGRIS_LEDGER
  // Emerald -> handloom: the gemstone name for the green theme, in the same
  // family as the five above (2026-09-21). Note it lands in fromClubTheme(),
  // where UNRELEASED_THEMES still turns it into classic-blue until Handloom is
  // released - adding the row in the dashboard is safe before that day.
  if (v === 'emerald') return HANDLOOM
  // Handloom also claims the dashboard's placeholder row "Compact Card". Both
  // spellings: the API slugifies, but a hand-entered DB value may not be.
  if (v === 'compact-card' || v === 'compact card') return HANDLOOM
  // Theme 8 (2026-10-07), the same gemstone family:
  //   Onyx -> cinematic   Lapis -> split-story          Aquamarine -> liquid-motion
  //   Opal -> horizontal-journey   Garnet -> photo-collage   Sunstone -> sunrise
  // Matched with spaces/hyphens/underscores dropped: the API slugs "Sun Stone" to sun-stone
  const g = v.replace(/[\s_-]+/g, '')
  if (g === 'onyx') return CINEMATIC
  if (g === 'lapis' || g === 'lapislazuli') return SPLIT_STORY
  if (g === 'aquamarine') return LIQUID_MOTION
  if (g === 'opal') return HORIZONTAL_JOURNEY
  if (g === 'garnet') return PHOTO_COLLAGE
  if (g === 'sunstone') return SUNRISE

  // ---- Secondary aliases (no live club sits on these) ---------------------
  // theme_master rows 6-15 are placeholders seeded by the API's
  // DatabaseInitializer. Not offered as real choices but still selectable, so
  // map the ones with an obvious counterpart instead of dropping to blue.
  if (v === 'modern-minimal' || v === 'modern' || v === 'minimal') return WARM_MODERN
  if (v === 'bold-color' || v === 'bold') return CIVIC_BOLD
  if (v === 'editorial' || v === 'ledger') return VERDIGRIS_LEDGER

  return null
}
