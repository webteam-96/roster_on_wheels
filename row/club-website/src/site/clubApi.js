// Port of Library/Api/PublicClubApiService.cs — typed access to the public
// club-website endpoints, same routes, same v2 choices, same cache scopes.
//
// ONE DELIBERATE DIFFERENCE, and it is forced: the ASP.NET version resolves the
// tenant by querying club_websites over MySQL directly (TenantResolver.cs). A
// browser cannot open a MySQL socket, so resolveWebsiteByHost() calls the API's
// anonymous /public/club-website/by-host endpoint instead — which runs the same
// JOIN + status derivation server-side and returns the same TenantDto shape.
import { getOrNull, getOrEmpty } from './http.js'
import { getOrAdd, getOrAddRequest } from './apiCache.js'

// ── URL / cache-key helpers ─────────────────────────────────────────────────
function clubUrl(clubId, segment, yearId) {
  return appendYear('/public/club/' + clubId + '/' + segment, yearId)
}

function appendYear(url, yearId) {
  if (yearId === null || yearId === undefined || yearId === '') return url
  return url + (url.includes('?') ? '&' : '?') + 'yearId=' + yearId
}

function key(clubId, yearId, segment) {
  return 'api:' + clubId + ':' + (yearId === null || yearId === undefined ? 'cur' : yearId) + ':' + segment
}

// ── Tenant resolution ───────────────────────────────────────────────────────
export function resolveWebsiteByHost(host) {
  if (!host || !String(host).trim()) return Promise.resolve(null)
  const h = String(host).trim().toLowerCase()
  // Per-request (per navigation) only, like the C#: the row carries the
  // subscription status, so a dashboard expire/reactivate reflects on the very
  // next page view.
  return getOrAddRequest('api:tenant:' + h, () =>
    getOrNull('/public/club-website/by-host?host=' + encodeURIComponent(h)))
}

// ── Years ───────────────────────────────────────────────────────────────────
// years / about / banners / advertisements / bod / gallery / impact use the
// API's hardened "v2" endpoints (v1's default-year path 500s in production).
export function getYears(clubId) {
  return getOrAdd('api:' + clubId + ':years',
    () => getOrEmpty('/public/club/' + clubId + '/v2/years'))
}

// ── Year-scoped content ─────────────────────────────────────────────────────
export function getAbout(clubId, yearId) {
  // No cross-request cache: fresh on every page load so admin changes to logos,
  // contacts and meeting info reflect INSTANTLY.
  return getOrAddRequest(key(clubId, yearId, 'about'),
    () => getOrNull(clubUrl(clubId, 'v2/about', yearId)))
}

export function getBanners(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'banners'),
    () => getOrEmpty(clubUrl(clubId, 'v2/banners', yearId)))
}

export function getAdvertisements(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'ads'),
    () => getOrEmpty(clubUrl(clubId, 'v2/advertisements', yearId)))
}

export function getBod(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'bod'),
    () => getOrEmpty(clubUrl(clubId, 'v2/bod', yearId)))
}

/** Aggregate impact totals for the home stat band (v2/impact). */
export function getImpact(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'impact'),
    () => getOrNull(clubUrl(clubId, 'v2/impact', yearId)))
}

export function getProjects(clubId, yearId) {
  // v2/projects also carries projectType (one_time / ongoing), which drives the
  // Project-Type filter on AllProjects.
  return getOrAdd(key(clubId, yearId, 'projects'),
    () => getOrEmpty(clubUrl(clubId, 'v2/projects', yearId)))
}

// Year-scoped, because project ids are NOT unique across years: RC Mumbai
// Mahim's 29045 is "Ration Distribution" (2026-27) with ?yearId=52 but
// "Weekly meeting" (2022) without it, and that stray showed up as an update of
// "Ration Distribution for TB patients". So pass the project's OWN yearId (list
// rows carry it). `orAnyYear`: only the detail page, whose link may carry the
// wrong year (old shares), retries unscoped after a 404 - that can be another
// project with the same id, so list figures/filters never take it.
export function getProjectDetail(clubId, projectId, yearId, orAnyYear = false) {
  const url = '/public/club/' + clubId + '/projects/' + projectId
  if (!yearId) return getOrAdd('api:' + clubId + ':project:' + projectId + ':', () => getOrNull(url))
  return getOrAdd('api:' + clubId + ':project:' + projectId + ':' + yearId + (orAnyYear ? ':any' : ''),
    async () => (await getOrNull(appendYear(url, yearId))) || (orAnyYear ? getOrNull(url) : null))
}

/**
 * The API's share payload for a project — canonical share URL on the club's own
 * public domain, ready-made share texts and a 1200x630 share-card PNG. See
 * shared/projectShare.jsx for the field list and how it is used.
 *
 * NOT club-scoped, and `yearId` decides which project you get: projects live in
 * year-partitioned tables, so pk_project_id is unique only WITHIN a year. Without
 * it the API scans year tables and returns the FIRST id match — verified live,
 * id 23342 answers as a different club's project. Always pass the project's own
 * `yearId` (the detail payload carries it).
 *
 * getOrNull, so a 404 / older API build / network failure yields null and the
 * caller falls back to locally-built share links.
 */
export function getProjectShare(projectId, yearId) {
  const url = appendYear('/public/projects/' + projectId + '/share', yearId)
  return getOrAdd('api:share:' + projectId + ':' +
    (yearId === null || yearId === undefined ? 'any' : yearId), () => getOrNull(url))
}

export function getMeetings(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'meetings'),
    () => getOrEmpty(clubUrl(clubId, 'meetings', yearId)))
}

export function getInternationalPresident(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'ip'),
    () => getOrNull(clubUrl(clubId, 'international-president', yearId)))
}

export function getDistrictGovernor(clubId, yearId) {
  return getOrAdd(key(clubId, yearId, 'dg'),
    () => getOrNull(clubUrl(clubId, 'district-governor', yearId)))
}

// Newsletters render EXACTLY what the public API returns for the selected year —
// no site-side workarounds BY DECISION; the dashboard-vs-API gaps are the
// backend team's to fix.
export function getNewsletters(clubId, yearId, limit = 12) {
  const url = '/public/club/' + clubId + '/newsletters?limit=' + limit +
    (yearId === null || yearId === undefined ? '' : '&yearId=' + yearId)
  return getOrAdd(key(clubId, yearId, 'news:' + limit), () => getOrEmpty(url))
}

export function getGallery(clubId, yearId, page = 1, pageSize = 24) {
  const url = '/public/club/' + clubId + '/v2/gallery?page=' + page + '&pageSize=' + pageSize +
    (yearId === null || yearId === undefined ? '' : '&yearId=' + yearId)
  return getOrAdd(key(clubId, yearId, 'gallery:' + page + ':' + pageSize), () => getOrNull(url))
}

export function getPastEvents(clubId, yearId, limit = 99) {
  const url = '/public/club/' + clubId + '/past-events?limit=' + limit +
    (yearId === null || yearId === undefined ? '' : '&yearId=' + yearId)
  return getOrAdd(key(clubId, yearId, 'pastevents:' + limit), () => getOrEmpty(url))
}

// ── Year-independent content ────────────────────────────────────────────────
export function getDirectory(clubId) {
  return getOrAdd('api:' + clubId + ':directory',
    () => getOrEmpty('/public/club/' + clubId + '/directory'))
}

export function getPastPresidents(clubId) {
  return getOrAdd('api:' + clubId + ':pastpres',
    () => getOrEmpty('/public/club/' + clubId + '/past-presidents'))
}

export function getMenus(clubId) {
  // Menus drive the nav and are edited from the admin, so instant mode: a
  // freshly-added/edited menu reflects on the next page load.
  return getOrAdd('api:' + clubId + ':menus',
    () => getOrEmpty('/public/club/' + clubId + '/menus'))
}

export function getCalendar(clubId, date = null) {
  const url = '/public/club/' + clubId + '/calendar' +
    (date ? '?date=' + encodeURIComponent(date) : '')
  return getOrAdd('api:' + clubId + ':calendar:' + (date || 'today'), () => getOrNull(url))
}

export function getUpcomingEvents(clubId, limit = 6) {
  return getOrAdd('api:' + clubId + ':upcoming:' + limit,
    () => getOrEmpty('/public/club/' + clubId + '/upcoming-events?limit=' + limit))
}

/**
 * Day-of-month -> that day's full calendar payload for the WHOLE month. The
 * public API only exposes a single-date calendar endpoint, so this fans out one
 * request per day (as the C# does) and caches the assembled month for 2 minutes
 * even in instant mode.
 */
export function getCalendarMonth(clubId, year, month) {
  return getOrAdd('api:' + clubId + ':calmonthfull:' + year + ':' + month,
    () => fetchCalendarMonth(clubId, year, month), 2)
}

/**
 * Day-of-month -> flags bitmask (1=birthday, 2=anniversary, 4=event), derived
 * from the cached month payload (no extra requests).
 */
export async function getCalendarMonthFlags(clubId, year, month) {
  const month_ = await getCalendarMonth(clubId, year, month)
  const map = {}
  for (const day of Object.keys(month_)) {
    const c = month_[day]
    let flags = 0
    if (c) {
      if (c.birthdays && c.birthdays.length) flags |= 1
      if (c.anniversaries && c.anniversaries.length) flags |= 2
      if (c.events && c.events.length) flags |= 4
    }
    map[day] = flags
  }
  return map
}

async function fetchCalendarMonth(clubId, year, month) {
  const days = new Date(year, month, 0).getDate()
  const pad = (n) => String(n).padStart(2, '0')

  const results = await Promise.all(
    Array.from({ length: days }, (_, i) => i + 1).map(async (day) => {
      const url = '/public/club/' + clubId + '/calendar?date=' +
        year + '-' + pad(month) + '-' + pad(day)
      const cal = await getOrNull(url)
      return [day, cal || {}]
    })
  )

  const map = {}
  for (const [day, cal] of results) map[day] = cal
  await mergeEventsIntoMonth(map, clubId, year, month)
  return map
}

/**
 * WORKAROUND for a production API gap: /calendar?date= ALWAYS returns an empty
 * "events" array even on a date that demonstrably has one (birthdays and
 * anniversaries populate correctly). Top the month up from /upcoming-events +
 * /past-events, which DO return events — fixing the Calendar page's lists and
 * the month-grid dots at once.
 *
 * SAFE TO DELETE once the API fills in calendar events: the dedupe keys on event
 * id, so when the endpoint starts returning them this merge adds nothing.
 */
async function mergeEventsIntoMonth(map, clubId, year, month) {
  const [upcoming, past] = await Promise.all([
    getUpcomingEvents(clubId, 99),
    getPastEvents(clubId, null, 99),
  ])

  for (const ev of [...upcoming, ...past]) {
    if (!ev || !ev.eventDate) continue
    const d = new Date(ev.eventDate)
    if (Number.isNaN(d.getTime())) continue
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue

    const dayNo = d.getDate()
    if (!map[dayNo]) map[dayNo] = {}
    if (!map[dayNo].events) map[dayNo].events = []
    if (!map[dayNo].events.some((e) => e && e.id === ev.id)) {
      map[dayNo].events.push({
        id: ev.id,
        title: ev.title,
        description: ev.description,
        imagePath: ev.imagePath,
        eventDate: ev.eventDate,
        venue: ev.venue,
        registrationLink: ev.registrationLink,
      })
    }
  }
}
