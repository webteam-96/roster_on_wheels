// Port of Library/Api/ApiClient.cs — one shared client, and calls that degrade
// gracefully: GetOrNull/GetOrEmpty swallow every error so a page always renders.
import axios from 'axios'
import DOMPurify from 'dompurify'
import { appSettings } from '../config.js'

export const http = axios.create({
  baseURL: appSettings.ApiBaseUrl,
  headers: { Accept: 'application/json' },
  timeout: appSettings.ApiTimeoutSeconds * 1000,
})

// ROW build: NO contact details anywhere on the site. Every phone / email field
// is dropped from every API response here, once, so all 13 themes render their
// header strips, footers, menus, About and Dignitary contact rows empty — each
// theme already hides those spots when the data is blank.
const CONTACT_KEY = /^(contacts|e-?mail(id|address)?|phone(no|number)?|mobile(no|number)?|contact(no|number)|whatsapp(no|number)?|landline|fax)$/i

// ROW security: the themes render admin-typed text (project / event descriptions, bios, About, menu
// names and links) as raw HTML in ~100 places, and several public endpoints do not sanitise it. So
// every string that looks like markup is cleaned HERE, once, before any page sees it, and script URLs
// are blanked (menu / registration links become hrefs as they are).
const LOOKS_LIKE_HTML = /<[a-z!/?]/i
const SCRIPT_URL = /^[\s\u0000-\u001f]*(javascript|vbscript)\s*:|^[\s\u0000-\u001f]*data\s*:(?!image\/(png|jpe?g|gif|webp|avif);)/i
export function safeString(s) {
  if (SCRIPT_URL.test(s)) return ''
  return LOOKS_LIKE_HTML.test(s) ? DOMPurify.sanitize(s) : s
}

function clean(v) {
  if (typeof v === 'string') return safeString(v)
  if (Array.isArray(v)) return v.map(clean)
  if (!v || typeof v !== 'object') return v
  const out = {}
  for (const k of Object.keys(v)) if (!CONTACT_KEY.test(k)) out[k] = clean(v[k])
  return out
}

/** GET → data, or null on 204 / any failure. */
export async function getOrNull(url, config) {
  try {
    const res = await http.get(url, config)
    if (res.status === 204) return null
    return res.data === undefined ? null : clean(res.data)
  } catch {
    return null
  }
}

/** GET → array (never null), for list endpoints. */
export async function getOrEmpty(url, config) {
  const data = await getOrNull(url, config)
  return Array.isArray(data) ? data : []
}
