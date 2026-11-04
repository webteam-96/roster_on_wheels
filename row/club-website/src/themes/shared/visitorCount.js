// Pure half of the footer visitor counter — no React, no config, no DOM beyond
// the storage objects you hand it. Kept separate from visitorCount.jsx so
// test-visitor-count.mjs can import it with plain `node` (Node cannot load .jsx).
//
// See visitorCount.jsx for what these numbers do and DO NOT mean.

/** UTC calendar day as YYYY-MM-DD, the same day boundary as ROW's visit counter API. (Name kept from the source.) */
export function istDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

const KEY = (clubId) => 'rv:visits:' + clubId
const SEEN = (clubId) => 'rv:counted:' + clubId

// Storage throws outright in some privacy modes, so every access is guarded.
export function safeLocal() { try { return window.localStorage } catch { return null } }
export function safeSession() { try { return window.sessionStorage } catch { return null } }

/**
 * Record one visit locally and return `{ total, today }` (null with no storage).
 *
 * A "visit" is a browser SESSION, not a page view: sessionStorage gates it, so
 * clicking through ten pages — or refreshing — counts once. The storages are
 * parameters so the self-check can drive it without touching the real ones.
 */
export function countLocalVisit(clubId, store, session, now = Date.now()) {
  if (store === undefined) store = safeLocal()
  if (session === undefined) session = safeSession()
  if (!store) return null

  const today = istDay(now)
  let rec = { t: 0, d: today, n: 0 }
  try {
    const raw = store.getItem(KEY(clubId))
    if (raw) rec = { ...rec, ...JSON.parse(raw) }
  } catch { /* corrupt/absent entry — start fresh rather than break the footer */ }

  if (rec.d !== today) { rec.d = today; rec.n = 0 }   // new IST day resets "today"

  if (!(session && session.getItem(SEEN(clubId)))) {
    rec.t += 1
    rec.n += 1
    try { store.setItem(KEY(clubId), JSON.stringify(rec)) } catch { /* private mode / quota */ }
    try { session && session.setItem(SEEN(clubId), '1') } catch { /* ignore */ }
  }
  return { total: rec.t, today: rec.n }
}
