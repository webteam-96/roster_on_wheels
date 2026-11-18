// Port of the DATA half of Faster_ClubWebsite/RotaryMasterBase.cs — club/menu
// lookups shared by all five layouts, so they cannot drift. The markup-emitting
// Render* helpers stay in each layout, because they encode theme-specific classes.
import { useEffect, useState } from 'react'
import { mediaUrl } from '../lib/media.js'
import { getMenus } from '../api/clubService.js'
import { useClub } from '../context/ClubProvider.jsx'
import { toRoute } from '../routes.js'

export const LOGO_PLACEHOLDER = '/images/logo/wheel.png'

/** "2025-2026" -> "2025-26"; pass through anything already short. */
export function formatYear(label) {
  if (!label) return label
  const parts = String(label).split('-')
  if (parts.length === 2 && parts[1].length === 4) return parts[0] + '-' + parts[1].slice(2)
  return label
}

// Fallback menu used only when the API returns no menu for the club.
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

// A linkValue that points at an uploaded file on the media server.
function isMediaPath(v) {
  if (!v || !String(v).trim()) return false
  const s = String(v).trim().toLowerCase()
  return s.startsWith('/documents/') || s.startsWith('/uploads/') || s.endsWith('.pdf')
}

// A club's menu links arrive as EITHER .aspx file names (Home.aspx,
// AllProjects.aspx?pr=CP) or the dashboard's own Next.js route slugs (about,
// projects, community_service). Both shapes — and this app's clean routes —
// normalise through toRoute() in ../routes.js, which is the one place that
// knows what each page's URL is. Unknown values fall through unchanged, so a
// club can still point a menu somewhere this app doesn't know about.
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
  return t === 'external' || t === 'url' || t === 'document'
    || isMediaPath(v)
    || /^https?:\/\//i.test(v)
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

/** The per-club menu, with the fallback applied — RotaryMasterBase.Menus. */
export function useMenus() {
  const { clubId } = useClub()
  const [menus, setMenus] = useState([])

  useEffect(() => {
    if (!clubId) return
    let cancelled = false
    getMenus(clubId).then((m) => {
      if (cancelled) return
      setMenus(m && m.length > 0 ? m : defaultMenus())
    })
    return () => { cancelled = true }
  }, [clubId])

  return menus
}

const MINOR = new Set(['of', 'and', 'the', 'for', 'in', 'to', 'at', 'on', 'a', 'an', '&'])
/** "PAST PRESIDENTS" -> "Past Presidents"; mixed-case labels are the club's own choice and stay. */
export function titleCase(label) {
  if (!label || label !== label.toUpperCase()) return label
  return label.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w) || !/[A-Z]/.test(w)) return w
    if (w.length <= 2 && !MINOR.has(w.toLowerCase())) return w       // RI, DG, PP
    const low = w.toLowerCase()
    return i > 0 && MINOR.has(low) ? low : low.charAt(0).toUpperCase() + low.slice(1)
  }).join('')
}
