// Menu and footer helpers shared by every theme shell (ported from the RIZones club site, shared/menus.js).
import { mediaUrl } from './media.js'
import { toRoute } from './routes.js'
import { useClub } from './ClubContext.jsx'

export const LOGO_PLACEHOLDER = '/images/logo/wheel.png'

/** "2025-2026" -> "2025-26". */
export function formatYear(label) {
  if (!label) return label
  const parts = String(label).split('-')
  if (parts.length === 2 && parts[1].length === 4) return parts[0] + '-' + parts[1].slice(2)
  return label
}

/** The menu a club gets before it has configured its own. */
export function defaultMenus() {
  return [
    { menuName: 'Home', linkType: 'page', linkValue: 'Home.aspx' },
    { menuName: 'About', linkType: 'page', linkValue: 'AboutUs.aspx' },
    { menuName: 'Directors', linkType: 'page', linkValue: 'Directors.aspx' },
    { menuName: 'Directory', linkType: 'page', linkValue: 'Directory.aspx' },
    { menuName: 'Calendar', linkType: 'page', linkValue: 'AllSpecialDates.aspx' },
    { menuName: 'Projects', linkType: 'page', linkValue: 'AllProjects.aspx?pr=CP' },
    { menuName: 'Events', linkType: 'page', linkValue: 'AllProjects.aspx?pr=CE' },
    { menuName: 'Past Presidents', linkType: 'page', linkValue: 'PastPresidents.aspx' },
  ]
}

function isMediaPath(v) {
  if (!v || !String(v).trim()) return false
  const s = String(v).trim().toLowerCase()
  return s.startsWith('/documents/') || s.startsWith('/uploads/') || s.endsWith('.pdf')
}

export function menuHref(linkType, linkValue) {
  if (!linkValue || !String(linkValue).trim()) return '#'
  const v = String(linkValue).trim()
  const t = String(linkType || '').trim().toLowerCase()
  if (t === 'document' || isMediaPath(v)) return mediaUrl(v)
  return toRoute(v)
}

export function menuExternal(linkType, linkValue) {
  const t = String(linkType || '').trim().toLowerCase()
  const v = String(linkValue || '').trim()
  return t === 'external' || t === 'url' || t === 'document' || isMediaPath(v) || /^https?:\/\//i.test(v)
}

export function socialLabel(key) {
  switch (key) {
    case 'facebook': return 'Facebook'
    case 'twitter': case 'x': return 'Twitter'
    case 'instagram': return 'Instagram'
    case 'linkedin': return 'Linkedin'
    case 'youtube': return 'YouTube'
    case 'website': case 'web': return 'Website'
    default: return !key ? 'Link' : key.charAt(0).toUpperCase() + key.slice(1)
  }
}

const MINOR = new Set(['of', 'and', 'the', 'for', 'in', 'to', 'at', 'on', 'a', 'an', '&'])
/** ALL-CAPS labels -> Title Case; short words (RI, DG, PP) stay as they are. */
export function titleCase(label) {
  if (!label || label !== label.toUpperCase()) return label
  return label.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w) || !/[A-Z]/.test(w)) return w
    if (w.length <= 2 && !MINOR.has(w.toLowerCase())) return w
    const low = w.toLowerCase()
    return i > 0 && MINOR.has(low) ? low : low.charAt(0).toUpperCase() + low.slice(1)
  }).join('')
}

/** HTML-escape for the string-built nav and footer markup. */
export function enc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The club's menu, for client components (the server supplies the default menu when the club has none). */
export function useMenus() {
  return useClub().menus
}
