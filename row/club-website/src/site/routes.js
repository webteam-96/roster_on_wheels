// Every public page's URL, and the mapping from club menu values onto it.
// Ported from the RIZones club site (routes.js). Menus come back from the API as old .aspx file names or as the
// dashboard's route slugs, so every incoming link value goes through toRoute() here.

/** aspx file name (lower-case) -> route path. */
export const PAGES = {
  'home.aspx': '/',
  'default.aspx': '/',
  'aboutus.aspx': '/about',
  'allprojects.aspx': '/projects',
  'projectdetail.aspx': '/project',
  'allspecialdates.aspx': '/calendar',
  'directors.aspx': '/directors',
  'directory.aspx': '/directory',
  'pastpresidents.aspx': '/past-presidents',
  'newsletter.aspx': '/newsletters',
  'gallery.aspx': '/gallery',
  'upcomingevent.aspx': '/events',
  'eventdetail.aspx': '/event',
  'diginitary.aspx': '/dignitary',
  'sisterclubs.aspx': '/sister-clubs',
  'youthpartners.aspx': '/youth-partners',
}

/** The dashboard stores many menu links as its own route slugs. */
const SLUGS = {
  home: '/',
  about: '/about',
  directors: '/directors',
  directory: '/directory',
  calendar: '/calendar',
  projects: '/projects',
  events: '/events',
  newsletters: '/newsletters',
  newsletter: '/newsletters',
  gallery: '/gallery',
  meetings: '/meetings',
  join: '/join',
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
  'sister-clubs': '/sister-clubs',
  'youth-partners': '/youth-partners',
}

/**
 * Normalise any link value onto a route: 'AboutUs.aspx' -> '/about', 'community_service' -> '/projects?pr=CP'.
 * External URLs, files and unknown values come back unchanged.
 */
export function toRoute(value) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw || raw === '#') return raw
  if (/^(https?:)?\/\//i.test(raw) || /^(mailto:|tel:)/i.test(raw)) return raw

  const qi = raw.indexOf('?')
  const query = qi >= 0 ? raw.slice(qi) : ''
  const path = qi >= 0 ? raw.slice(0, qi) : raw

  if (/\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|svg)$/i.test(path)) return raw

  const file = path.split('/').filter(Boolean).pop() || ''
  const mapped = PAGES[file.toLowerCase()]
  if (mapped) return mapped + query

  const slug = SLUGS[path.replace(/^\/+|\/+$/g, '').toLowerCase()]
  if (slug) return query ? slug.split('?')[0] + query : slug

  return raw
}

/** A stable key for "which page is this", used to light up the active nav item. */
export function routeKey(hrefOrPath) {
  const route = toRoute(hrefOrPath)
  if (/^(https?:)?\/\//i.test(route)) return null
  const path = route.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase()
  return path || 'home'
}
