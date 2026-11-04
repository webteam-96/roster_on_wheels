'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Project sharing — one source of truth for every theme's share row.
//
// The API now publishes a share payload per project
// (GET /api/public/projects/{id}/share?yearId=N), which is authoritative in a way
// the website cannot be: it knows the club's own public domain, its display name
// and district, and it renders a 1200x630 share card PNG. The dashboard and the
// mobile app already send links built from it, so using anything else here would
// mean one project has two different "canonical" URLs in circulation.
//
//   {
//     id, yearId, title, clubName, clubDisplayName, districtNumber, areaOfFocus,
//     summary,               plain-text overview, already truncated
//     shareText,             multi-line: title / club | district / summary / url
//     shareTextSingleLine,   the same as one sentence, for character-capped fields
//     shareUrl,              https://<club domain>/projects/<id>
//     imageUrl,              https://.../share-image.png  (1200x630, CORS *)
//     hasClubWebsite, clubWebsiteUrl
//   }
//
// ⚠ yearId is NOT optional in practice. Projects live in year-partitioned tables
//   and pk_project_id is unique only WITHIN a year, so a request without it makes
//   the API scan years and answer with the FIRST id match. Verified live: id
//   23342 with no yearId returns a DIFFERENT club's project. Always pass the
//   project's own yearId.
//
// Everything degrades: on a 404, a network failure, or an API build that predates
// the endpoint, the hook returns the locally-built fallback and the share row
// looks and behaves exactly as it did before.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/site/clubApi.js'

const enc = encodeURIComponent

/** True for something we can actually put in an href — absolute http(s) only. */
function usableUrl(u) {
  return !!u && /^https?:\/\/[^\s]+$/i.test(String(u).trim())
}

/**
 * Cleans a stored ClientDomain to a bare host, or null when it's blank / "NA" /
 * an obvious placeholder / not a real domain.
 */
export function normalizeShareDomain(raw) {
  if (!raw || !String(raw).trim()) return null
  let d = String(raw).trim().toLowerCase()
    .replace('https://', '').replace('http://', '')
    .replace(/\/+$/, '')
  if (d.startsWith('www.')) d = d.slice(4)
  const slash = d.indexOf('/')
  if (slash >= 0) d = d.slice(0, slash)
  if (d.length === 0 || !d.includes('.')) return null
  switch (d) {
    case 'na': case 'n/a': case 'google.com':
    case 'example.com': case 'test.com': case 'localhost':
      return null                                       // placeholder / junk
  }
  return d
}

/**
 * Public URL to share. Like the old website, every club is shared on its OWN
 * domain — never the rotaryindia.org subdomain — so the link is built from the
 * club's custom client domain when it has one; only clubs without one fall back
 * to the current request host.
 *
 * pathAndQuery is explicit for callers that share something OTHER than the page
 * they are on (an event card in a list shares /event?id=N, not /events).
 */
export function shareUrlFor(club, pathAndQuery) {
  // Also runs on the server (pages are server-rendered): there the request host comes from the club context.
  const browser = typeof window !== 'undefined'
  const path = pathAndQuery || (browser ? window.location.pathname + window.location.search : '/')
  const cd = normalizeShareDomain(club && club.tenant ? club.tenant.clientDomain : null)
  const host = cd || (browser ? window.location.hostname : (club && club.host) || '')
  if (!host) return browser ? window.location.href : path
  return 'https://' + host + path
}

/**
 * Resolved share data for one project + the per-channel links built from it.
 *
 * @param {object} opts
 *   projectId — the club-scoped project id (same one in ?pid=)
 *   yearId    — the project's OWN yearId, off the detail payload (see note above)
 *   fallback  — { url, title, text, singleLine, image } built from page data,
 *               used until/unless the API answers
 */
export function useProjectShare({ projectId, yearId, fallback }) {
  const [payload, setPayload] = useState(null)

  useEffect(() => {
    if (!projectId) { setPayload(null); return undefined }
    let cancelled = false
    setPayload(null)
    api.getProjectShare(projectId, yearId).then((d) => {
      if (!cancelled) setPayload(d || null)
    })
    return () => { cancelled = true }
  }, [projectId, yearId])

  const fb = fallback || {}
  // Field by field, not payload-or-fallback wholesale: a payload that carries
  // text but no usable URL (a club with no website) still contributes its text.
  const url = (payload && usableUrl(payload.shareUrl) && payload.hasClubWebsite !== false)
    ? payload.shareUrl
    : (fb.url || '')
  const title = (payload && payload.title) || fb.title || ''
  const image = (payload && usableUrl(payload.imageUrl)) ? payload.imageUrl : (fb.image || '')

  // The API's texts already END with the share URL, so channels that take free
  // text must not append it a second time. When we fall back, the local text
  // doesn't carry the URL, so it is added here instead.
  const apiText = payload && payload.shareText
  const apiLine = payload && payload.shareTextSingleLine
  const text = apiText || [fb.text, url].filter(Boolean).join('\n\n')
  const singleLine = apiLine || [fb.singleLine || fb.text, url].filter(Boolean).join(' ')

  const [copied, setCopied] = useState(null)   // 'link' | 'text' | null
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback((what, value) => {
    const flash = () => {
      setCopied(what)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 1400)
    }
    // execCommand path for insecure origins and older browsers, where
    // navigator.clipboard is undefined or rejects.
    const legacy = () => {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      try { document.execCommand('copy') } catch (err) { /* clipboard denied */ }
      document.body.removeChild(ta)
      flash()
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(flash).catch(legacy)
    } else legacy()
  }, [])

  /**
   * The OS share sheet — the single control that reaches every app the visitor
   * actually has (Instagram, Telegram, Signal, Drive…), which no fixed row of
   * buttons can. The share card PNG is attached when the browser accepts files,
   * because a WhatsApp/Instagram post with the card reads far better than a bare
   * link; the API serves it with Access-Control-Allow-Origin: *, so it can be
   * fetched as a blob. Text-only if anything about that fails.
   */
  const native = useCallback(async () => {
    if (!navigator.share) return
    const base = { title, text, url }
    try {
      if (image && navigator.canShare) {
        try {
          const res = await fetch(image, { mode: 'cors' })
          if (res.ok) {
            const blob = await res.blob()
            const file = new File([blob], 'project-' + projectId + '.png', { type: blob.type || 'image/png' })
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ ...base, files: [file] })
              return
            }
          }
        } catch (err) { /* fall through to the text-only sheet */ }
      }
      await navigator.share(base)
    } catch (err) {
      // AbortError = the visitor dismissed the sheet. Nothing to report.
    }
  }, [title, text, url, image, projectId])

  return {
    fromApi: !!payload,
    url, title, text, singleLine, image,
    summary: (payload && payload.summary) || '',
    clubDisplayName: (payload && payload.clubDisplayName) || '',
    districtNumber: (payload && payload.districtNumber) || '',

    // ── Channels. `popup: true` = open in the centred share window. ──
    whatsapp: 'https://wa.me/?text=' + enc(text),
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + enc(url) + '&quote=' + enc(singleLine),
    twitter: 'https://twitter.com/intent/tweet?url=' + enc(url) + '&text=' + enc(title),
    linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(url),
    mail: 'mailto:?subject=' + enc(title) + '&body=' + enc(text),

    copied,
    copyLink: () => copy('link', url),
    copyText: () => copy('text', text),
    canNative: typeof navigator !== 'undefined' && !!navigator.share,
    native,
  }
}

/**
 * Open a share URL in the standard centred popup, with a new-tab fallback when
 * the popup is blocked. Same behaviour every theme had inline; kept here so the
 * share row is one import.
 */
export function sharePopup(e) {
  e.preventDefault()
  const href = e.currentTarget.href
  const w = 600, h = 620
  const x = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
  const y = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
  const win = window.open(href, 'rotaryShare',
    'popup=yes,noopener,width=' + w + ',height=' + h + ',left=' + x + ',top=' + y)
  if (!win) window.open(href, '_blank', 'noopener')
}

// ── Channel icons, shared so the themes differ in CHROME, not in iconography ──
export const SHARE_ICONS = {
  // The real WhatsApp mark (filled, 24x24) — a hand-drawn "phone in a circle"
  // approximation read as a generic call button next to the other brand glyphs.
  whatsapp: <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.885 3.488" />,
  facebook: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  twitter: <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />,
  linkedin: <><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  card: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-4.5-4.5L7 21" /></>,
  more: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>,
}

/**
 * The channel row every theme renders, in order. `fill` icons need no stroke;
 * everything else is drawn with the surrounding currentColor stroke.
 *
 * Built from a resolved share object so a theme maps over ONE list instead of
 * hand-writing eight anchors — and so adding a channel later reaches all six
 * themes at once.
 */
export function shareChannels(s) {
  const list = [
    { key: 'whatsapp', label: 'Share on WhatsApp', href: s.whatsapp, icon: SHARE_ICONS.whatsapp, fill: true, brand: '#25D366', popup: true },
    { key: 'facebook', label: 'Share on Facebook', href: s.facebook, icon: SHARE_ICONS.facebook, brand: '#1877F2', popup: true },
    { key: 'twitter', label: 'Share on X', href: s.twitter, icon: SHARE_ICONS.twitter, fill: true, brand: '#000000', popup: true },
    { key: 'linkedin', label: 'Share on LinkedIn', href: s.linkedin, icon: SHARE_ICONS.linkedin, brand: '#0A66C2', popup: true },
    { key: 'mail', label: 'Share via email', href: s.mail, icon: SHARE_ICONS.mail },
  ]
  // Only offered when the API actually rendered a card for this project.
  if (s.image) {
    list.push({ key: 'card', label: 'Open the share card image', href: s.image, icon: SHARE_ICONS.card, external: true })
  }
  list.push({
    key: 'link', label: 'Copy link', icon: SHARE_ICONS.link,
    onClick: s.copyLink, done: s.copied === 'link', doneLabel: 'Copied',
  })
  // Desktop browsers mostly have no share sheet; showing a button that does
  // nothing would be worse than not showing it.
  if (s.canNative) {
    list.push({ key: 'more', label: 'More sharing options', icon: SHARE_ICONS.more, onClick: s.native })
  }
  return list
}
