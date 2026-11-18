// Port of Library/Api/MediaUrl.cs (MediaUrl + Avenue).
import { appSettings } from '../config.js'

const BASE = appSettings.MediaBaseUrl

/** Absolutise an API-relative media path; "" when null/empty. */
export function mediaUrl(path) {
  if (path === null || path === undefined) return ''
  const p = String(path)
  if (!p.trim()) return ''
  if (/^https?:\/\//i.test(p)) return p
  return BASE + (p.startsWith('/') ? p : '/' + p)
}

/** Resolve a list of paths, dropping null/empty entries. */
export function mediaUrlAll(paths) {
  if (!Array.isArray(paths)) return []
  return paths.map(mediaUrl).filter(Boolean)
}

// Maps the API's module keys to the legacy single-char avenue codes the pages
// and query strings use (?pr=CP etc).
const MODULE_TO_AVENUE = {
  community_service: 'CP',
  club_service: 'CS',
  vocational_service: 'VS',
  new_generation_service: 'NGS',
  international_service: 'IS',
  public_image: 'PII',
  public_image_initiative: 'PII',
  club_events: 'CE',
  // PascalCase variants seen in some payloads
  communityservice: 'CP',
  clubservice: 'CS',
  vocationalservice: 'VS',
  newgenerationservice: 'NGS',
  internationalservice: 'IS',
  publicimage: 'PII',
  publicimageinitiative: 'PII',
  clubevents: 'CE',
}

/** Avenue.FromModuleKey — unknown keys pass through unchanged. */
export function avenueFromModuleKey(moduleKey) {
  if (!moduleKey) return ''
  const k = String(moduleKey)
  return MODULE_TO_AVENUE[k.toLowerCase()] || k
}
