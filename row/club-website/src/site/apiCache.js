// Port of Library/Api/ApiCache.cs.
//
// The ASP.NET version has two scopes: HttpContext.Cache (cross-request, TTL =
// CacheTimeInMinutes) and HttpContext.Items (per-request, always fresh but
// deduped within one render). A SPA has no "request", so a PAGE VIEW plays that
// role: `newRequestScope()` is called on every route change, which drops the
// per-request map exactly like a new HTTP request would.
//
// CacheTimeInMinutes = 0 (the default) therefore still means INSTANT: content is
// re-fetched on every navigation and admin edits reflect immediately, while a
// single page render makes at most one call per key.
import { appSettings } from './config.js'

const ttlCache = new Map()      // key -> { value, expires }
let requestCache = new Map()    // key -> Promise (dropped on each navigation)

/** Start a new "request" scope — call once per route change. */
export function newRequestScope() {
  requestCache = new Map()
}

function minutesDefault() {
  const m = appSettings.CacheTimeInMinutes
  return Number.isFinite(m) && m >= 0 ? m : 0
}

/**
 * Read-through cache. `minutes` defaults to CacheTimeInMinutes; <= 0 falls back
 * to the per-request scope (fresh every navigation, deduped within one).
 */
export function getOrAdd(key, factory, minutes) {
  // The server holds no cross-request cache: every page view reads the API fresh (admin saves show at once).
  if (typeof window === 'undefined') return Promise.resolve(factory())
  const mins = minutes === undefined || minutes === null ? minutesDefault() : minutes
  if (mins <= 0) return getOrAddRequest(key, factory)

  const hit = ttlCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const value = Promise.resolve(factory()).then((v) => {
    // Mirror the C#: only a non-null value is cached, so a failed call retries.
    if (v === null || v === undefined) ttlCache.delete(key)
    return v
  })
  ttlCache.set(key, { value, expires: Date.now() + mins * 60_000 })
  return value
}

/** Per-request (per page view) dedupe only — the C# HttpContext.Items path. */
export function getOrAddRequest(key, factory) {
  if (typeof window === 'undefined') return Promise.resolve(factory())
  const hit = requestCache.get(key)
  if (hit !== undefined) return hit

  const value = Promise.resolve(factory())
  requestCache.set(key, value)
  return value
}

export function remove(key) {
  ttlCache.delete(key)
  requestCache.delete(key)
}

export function clearAll() {
  ttlCache.clear()
  requestCache = new Map()
}
