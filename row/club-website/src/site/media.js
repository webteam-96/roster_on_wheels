// API-relative media paths -> absolute URLs on the API origin.
const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '')

/** Absolutise an API-relative media path; "" when null/empty. */
export function mediaUrl(path) {
  if (path === null || path === undefined) return ''
  const p = String(path)
  if (!p.trim()) return ''
  if (/^(https?:|data:)/i.test(p)) return p
  return BASE + (p.startsWith('/') ? p : '/' + p)
}

/** Resolve a list of paths, dropping null/empty entries. */
export function mediaUrlAll(paths) {
  if (!Array.isArray(paths)) return []
  return paths.map(mediaUrl).filter(Boolean)
}

const MODULE_TO_AVENUE = {
  community_service: 'CP', club_service: 'CS', vocational_service: 'VS', new_generation_service: 'NGS',
  international_service: 'IS', public_image: 'PII', public_image_initiative: 'PII', club_events: 'CE',
  communityservice: 'CP', clubservice: 'CS', vocationalservice: 'VS', newgenerationservice: 'NGS',
  internationalservice: 'IS', publicimage: 'PII', publicimageinitiative: 'PII', clubevents: 'CE',
}

/** Project module key -> avenue code; unknown keys pass through unchanged. */
export function avenueFromModuleKey(moduleKey) {
  if (!moduleKey) return ''
  const k = String(moduleKey)
  return MODULE_TO_AVENUE[k.toLowerCase()] || k
}
