// Website extras: the club's social feeds and Google Analytics ID (API WebsiteExtrasService), the embed addresses
// built from them, and the visitor's consent for third-party content. The API already validates every value; the
// checks here are a second guard because the values end up in iframe src attributes and a script URL.
// Pure module (no React, no config) so `node --test src/shared/websiteExtras.test.js` can run it.

const FB = /^https:\/\/www\.facebook\.com\/(?:profile\.php\?id=\d{1,25}|[A-Za-z0-9.-]{1,80}(?:\/[A-Za-z0-9.-]{1,80})?)$/
const IG = /^[A-Za-z0-9._]{1,30}$/
const X = /^[A-Za-z0-9_]{1,15}$/
const GA = /^G-[A-Z0-9]{4,15}$/

/** Facebook's Page plugin (timeline tab) as an iframe address; null when the link is not a Facebook page. */
export function facebookEmbedSrc(pageUrl, width = 500, height = 640) {
  if (!pageUrl || !FB.test(pageUrl)) return null
  const q = new URLSearchParams({
    href: pageUrl, tabs: 'timeline', width: String(width), height: String(height),
    small_header: 'true', adapt_container_width: 'true', hide_cover: 'false', show_facepile: 'false',
  })
  return 'https://www.facebook.com/plugins/page.php?' + q.toString()
}

/** The Instagram profile address (Instagram has no embeddable profile feed, only single posts). */
export function instagramProfileUrl(username) {
  return username && IG.test(username) ? 'https://www.instagram.com/' + username : null
}

/** The X profile address that X's timeline widget turns into a feed. */
export function xTimelineHref(username) {
  return username && X.test(username) ? 'https://twitter.com/' + username : null
}

export function validGaId(id) {
  return id && GA.test(id) ? id : null
}

export function hasFeeds(extras) {
  return !!extras && !!(facebookEmbedSrc(extras.facebookPageUrl) || instagramProfileUrl(extras.instagramUsername)
    || xTimelineHref(extras.xUsername))
}

/** Only site-relative paths from the API become links (never another host or a script URL). */
export function safeSitePath(path) {
  return typeof path === 'string' && /^\/(?!\/)[^\s\\]*$/.test(path) ? path : null
}

// ── Consent: third-party feeds and analytics load only after the visitor allows them ──
export const CONSENT_KEY = 'row_third_party_consent'
export const CONSENT_EVENT = 'row-consent-change'

/** 'all', 'essential', or null when the visitor has not chosen yet (or storage is blocked). */
export function readConsent(storage) {
  try {
    const v = storage.getItem(CONSENT_KEY)
    return v === 'all' || v === 'essential' ? v : null
  } catch {
    return null
  }
}

export function saveConsent(storage, value) {
  try { storage.setItem(CONSENT_KEY, value) } catch { /* blocked storage: the choice lasts for this page only */ }
}
