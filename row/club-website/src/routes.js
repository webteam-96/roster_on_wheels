// ─────────────────────────────────────────────────────────────────────────────
// The single place that knows what every page's URL is.
//
// The ASP.NET original addresses pages by file name (Home.aspx, AboutUs.aspx,
// AllProjects.aspx?pr=CP). This port serves clean routes instead (/, /about,
// /projects?pr=CP) — but the club MENUS still come back from the API as .aspx
// file names or as the dashboard's own route slugs, so every incoming link value
// is normalised through toRoute() here rather than in a dozen call sites.
//
// Adding a page = one row in PAGES + one <Route> in App.jsx.
// ─────────────────────────────────────────────────────────────────────────────

/** aspx file name (lower-case) -> clean route path. */
export const PAGES = {
  'home.aspx': '/',
  'default.aspx': '/',
  'aboutus.aspx': '/about',
  'allprojects.aspx': '/projects',
  'projectdetail.aspx': '/project',
  'allspecialdates.aspx': '/calendar',
  'directors.aspx': '/directors',
  'directory.aspx': '/directory',
  'donate.aspx': '/donate',
  'pastpresidents.aspx': '/past-presidents',
  'newsletter.aspx': '/newsletters',
  'stories.aspx': '/stories',
  'bulletin.aspx': '/bulletin',
  'gallery.aspx': '/gallery',
  'upcomingevent.aspx': '/events',
  'eventdetail.aspx': '/event',
  'diginitary.aspx': '/dignitary',
  'under_maintenance.aspx': '/under-maintenance',
  'expiredwebsite.aspx': '/expired',
  'sitenotconfigured.aspx': '/not-configured',
  // The theme Homes, reachable directly for side-by-side review.
  'homewarmmodern.aspx': '/home-warm-modern',
  'homecivicbold.aspx': '/home-civic-bold',
  'homeverdigrisledger.aspx': '/home-verdigris-ledger',
  'homehandloom.aspx': '/home-handloom',
  // ROW only (gap agent): the district's business directory.
  'businessdirectory.aspx': '/business-directory',
}

/** The dashboard stores many menu links as its own Next.js route slugs. */
const SLUGS = {
  home: '/',
  about: '/about',
  directors: '/directors',
  directory: '/directory',
  donate: '/donate',
  calendar: '/calendar',
  projects: '/projects',
  events: '/events',
  newsletters: '/newsletters',
  newsletter: '/newsletters',
  stories: '/stories',
  bulletin: '/bulletin',
  gallery: '/gallery',
  'past-presidents': '/past-presidents',
  past_presidents: '/past-presidents',
  'club-service': '/projects?pr=CE',
  club_service: '/projects?pr=CE',
  community_service: '/projects?pr=CP',
  'community-service': '/projects?pr=CP',
  vocational_service: '/projects?pr=VS',
  'vocational-service': '/projects?pr=VS',
  international_service: '/projects?pr=IS',
  'international-service': '/projects?pr=IS',
  new_generation_service: '/projects?pr=NGS',
  'new-generation-service': '/projects?pr=NGS',
  public_image_initiative: '/projects?pr=PII',
  'public-image-initiative': '/projects?pr=PII',
  // Website extras: a menu item with link value "search" or "social".
  search: '/search',
  social: '/social',
}

/**
 * Pages that pin their own shell regardless of what the theme chain resolves to.
 *
 * The ASP.NET equivalent is an .aspx whose MasterPageFile is NOT
 * SiteRotary.Master: RotaryPage.OnPreInit only swaps the master when it is, so
 * HomeWarmModern.aspx keeps SiteWarmModern.Master — and that master hardcodes
 * <html data-theme="warm-modern"> and loads warm's stylesheets — even when the
 * club (or a port/query preview) resolves to something else.
 *
 * ThemeProvider consults this so the CSS follows the PAGE here, not the port.
 * Without it, /home-madras on the classic-blue port rendered madras markup
 * dressed in classic-blue's stylesheet.
 */
export const PINNED_THEME = {
  '/home-warm-modern': 'warm-modern',
  '/home-civic-bold': 'civic-bold',
  '/home-verdigris-ledger': 'verdigris-ledger',
  '/home-gold': 'gold',
  '/home-handloom': 'handloom',
}

/** Every clean route this app serves — used to decide what the SPA intercepts. */
export const ALL_ROUTES = new Set([
  ...Object.values(PAGES).map((r) => r.split('?')[0]),
  ...Object.values(SLUGS).map((r) => r.split('?')[0]),
])

/**
 * Normalise ANY link value onto this app's clean route.
 *   'AboutUs.aspx'            -> '/about'
 *   'AllProjects.aspx?pr=CP'  -> '/projects?pr=CP'
 *   'community_service'       -> '/projects?pr=CP'
 *   '/directory'              -> '/directory'   (already clean)
 *   'https://example.org'     -> unchanged
 * An unrecognised value is returned unchanged, so a club can still point a menu
 * at something this app doesn't know about without the link being mangled.
 */
export function toRoute(value) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw || raw === '#') return raw
  if (/^(https?:)?\/\//i.test(raw) || /^(mailto:|tel:)/i.test(raw)) return raw

  const qi = raw.indexOf('?')
  const query = qi >= 0 ? raw.slice(qi) : ''
  let path = qi >= 0 ? raw.slice(0, qi) : raw

  // Uploaded documents and other real files keep their path.
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|svg)$/i.test(path)) return raw

  const file = path.split('/').filter(Boolean).pop() || ''
  const mapped = PAGES[file.toLowerCase()]
  if (mapped) {
    // A slug entry can carry its own query (community_service -> ?pr=CP); an
    // .aspx entry never does, so the caller's query simply wins.
    return mapped + query
  }

  const slug = SLUGS[path.replace(/^\/+|\/+$/g, '').toLowerCase()]
  if (slug) return query ? slug.split('?')[0] + query : slug

  return raw
}

/**
 * A stable key for "which page is this", used to light up the active nav item.
 * Both the current pathname and a menu href go through it, so they compare even
 * when the menu still stores .aspx names.
 */
export function routeKey(hrefOrPath) {
  const route = toRoute(hrefOrPath)
  if (/^(https?:)?\/\//i.test(route)) return null      // external: never active
  const path = route.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase()
  return path || 'home'
}
