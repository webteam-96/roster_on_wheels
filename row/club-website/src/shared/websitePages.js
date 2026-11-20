// Website builder pages (admin: Website Data, Pages and Layout). Custom pages live at /p/<slug>; the page with the
// slug "home" is the home layout. Only the published copy is public. Members-only pages and files need the club's
// website member session (email + password sign-in on this site, see MemberSignIn.jsx); the API never returns them
// without it. Rich text comes back cleaned by the API and is cleaned again here (safeString, DOMPurify).
import { useCallback, useEffect, useState } from 'react'
import { http, safeString } from '../lib/http.js'

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** /p/<slug> paths are app routes too (the anchor interceptor routes them without a reload). */
export function isCustomPagePath(pathname) {
  const m = /^\/p\/([^/]+)$/.exec(pathname || '')
  return !!m && SLUG_RE.test(m[1])
}

// ── Member session (per club, this browser only) ─────────────────────────────
const KEY = (clubId) => 'row-site-member:' + clubId

export function readMemberSession(clubId) {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY(clubId)) || 'null')
    return s && s.token && Date.parse(s.expiresAt) > Date.now() ? s : null
  } catch { return null }
}

export function forgetMemberSession(clubId) {
  try { window.localStorage.removeItem(KEY(clubId)) } catch { /* storage blocked: nothing kept */ }
}

/** Email + password sign-in for members of this club. Resolves the session, or throws an Error with the API message. */
export async function signInMember(clubId, email, password) {
  try {
    const { data } = await http.post('/public/website-session/club/' + clubId, { email, password })
    const s = { token: data.token, name: data.name || '', expiresAt: data.expiresAt }
    try { window.localStorage.setItem(KEY(clubId), JSON.stringify(s)) } catch { /* works for this page view only */ }
    return s
  } catch (err) {
    const status = err && err.response && err.response.status
    const msg = err && err.response && err.response.data && err.response.data.message
    throw new Error(status === 429 ? 'Too many attempts. Please wait a minute and try again.' : msg || 'Sign-in failed. Please try again.')
  }
}

function cleanPage(p) {
  return {
    ...p,
    title: String(p.title || ''),
    sections: (p.sections || []).map((s) => ({ ...s, html: s.html ? safeString(String(s.html)) : s.html })),
  }
}

/**
 * { status: 'ok', page } | { status: 'members' } (members-only and not signed in) | { status: 'missing' }.
 * Sends the member session when there is one.
 */
export async function getClubWebsitePage(clubId, slug) {
  if (!clubId || !SLUG_RE.test(slug || '') || slug.length > 60) return { status: 'missing' }
  const s = readMemberSession(clubId)
  try {
    const res = await http.get('/public/website-pages/club/' + clubId + '/' + slug, {
      headers: s ? { 'X-Site-Session': s.token } : {},
      validateStatus: (st) => st === 200 || st === 401 || st === 404,
    })
    if (res.status === 401) {
      if (s) forgetMemberSession(clubId) // expired or no longer a member: sign in again
      return { status: 'members' }
    }
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.sections)) return { status: 'missing' }
    return { status: 'ok', page: cleanPage(res.data) }
  } catch {
    return { status: 'missing' }
  }
}

/** undefined while loading, else the getClubWebsitePage result; reload() fetches again (after sign-in / sign-out). */
export function useWebsitePage(clubId, slug) {
  const [state, setState] = useState(undefined)
  const [n, setN] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState(undefined)
    if (!clubId) return undefined // the club is still resolving: stay in loading, never "missing"
    getClubWebsitePage(clubId, slug).then((r) => { if (!cancelled) setState(r) })
    return () => { cancelled = true }
  }, [clubId, slug, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return [state, reload]
}
