// ─────────────────────────────────────────────────────────────────────────────
// Port of Library/Api/ClubContext.cs — per-page-view resolution of the current
// club (multi-tenant) and the selected Rotary year.
//
// Year selection order, unchanged: ?yearId= → ?year= label → current Rotary year
// computed from the date in IST (1 Jul–30 Jun) → the API "isCurrent" flag → the
// most recent API year.
//
// The selected year lives ONLY in the URL, as ?yearId=, and it STAYS there:
// it can be bookmarked and shared, it survives a refresh, and App.jsx's anchor
// interceptor carries it across internal navigation so picking a year on
// Projects and clicking Directors keeps that year. Open the site with no
// ?yearId= and you get the current Rotary year — there is still NO cookie.
// (Do NOT re-add a cookie: the API's isCurrent flag lags the 1 July rollover,
// which is exactly why the year is computed from the date here.)
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { appSettings, isLocalRequest } from '../config.js'
import { resolveWebsiteByHost, getYears, getAbout } from '../api/clubService.js'
import { newRequestScope } from '../lib/apiCache.js'
import { DEFAULT_CURRENCY } from '../shared/money.js'

const Ctx = createContext(null)

/** Start year of the current Rotary year, evaluated in IST (every club is Indian). */
export function currentRotaryYearStart() {
  // IST is a fixed UTC+5:30 (no DST).
  const nowIst = new Date(Date.now() + (5 * 60 + 30) * 60_000)
  const m = nowIst.getUTCMonth() + 1
  const y = nowIst.getUTCFullYear()
  return m >= 7 ? y : y - 1
}

/** Current Rotary year as a short label, e.g. "2026-27". */
export function currentRotaryYearLabel() {
  const start = currentRotaryYearStart()
  return start + '-' + String((start + 1) % 100).padStart(2, '0')
}

/** 4-digit start year of a label like "2026-27"; null when it has none. */
function startYearOf(yearLabel) {
  if (!yearLabel) return null
  const m = String(yearLabel).match(/\d{4}/)
  return m ? parseInt(m[0], 10) : null
}

function labelsMatch(a, b) {
  if (!a || !b) return false
  const na = String(a).replace(/-/g, ''), nb = String(b).replace(/-/g, '')
  return na === nb || a === b || na.startsWith(nb) || nb.startsWith(na)
}

function pickYear(years, search, remembered) {
  const params = new URLSearchParams(search)

  // (a) explicit ?yearId=
  const rawId = params.get('yearId')
  if (rawId) {
    const q = parseInt(rawId, 10)
    if (!Number.isNaN(q)) {
      const y = years.find((o) => o.id === q)
      if (y) return { id: y.id, label: y.yearLabel, fromUrl: true }
      if (years.length === 0) return { id: q, label: null, fromUrl: true } // trust caller
    }
  }

  // (b) ?year=2025-26 label (legacy backward-compat)
  const rawLabel = params.get('year')
  if (rawLabel) {
    const match = years.find((y) => labelsMatch(y.yearLabel, rawLabel))
    if (match) return { id: match.id, label: match.yearLabel, fromUrl: true }
  }

  // The year the user picked for THIS view, after the params were stripped from
  // the address bar (the ASP.NET build does the same strip in rotary-anim.js).
  if (remembered) {
    const y = years.find((o) => o.id === remembered)
    if (y) return { id: y.id, label: y.yearLabel, fromUrl: false }
  }

  // (c) No cookie fallback — by design.

  // (d) Default to the CURRENT Rotary year computed from the date. The API's
  //     isCurrent flag is NOT trusted as the primary signal: it can lag the
  //     1 July rollover and would pin every website to the previous year.
  const currentStart = currentRotaryYearStart()
  const current =
    years.find((y) => startYearOf(y.yearLabel) === currentStart) ||
    years.find((y) => y.isCurrent) ||
    [...years].sort((a, b) => (startYearOf(b.yearLabel) ?? -Infinity) - (startYearOf(a.yearLabel) ?? -Infinity))[0]

  return current
    ? { id: current.id, label: current.yearLabel, fromUrl: false }
    : { id: null, label: null, fromUrl: false }
}

const EMPTY = {
  clubId: 0, clubName: '', subdomain: null, isConfigured: true, themeKey: null, status: null,
  daysRemaining: 0, trialEndsAt: null, paidUntil: null, tenant: null,
  years: [], selectedYearId: null, selectedYearLabel: null, loading: true,
  /** ISO code driving every cost figure; INR unless v2/about says otherwise. */
  currency: DEFAULT_CURRENCY,
}

export function ClubProvider({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [base, setBase] = useState(EMPTY)

  // The year applied for the current pathname, kept across the cosmetic URL
  // strip below so the view doesn't snap back to the default year.
  const applied = useRef({ path: null, yearId: null })
  const knownCurrency = useRef({})   // clubId -> currency, so re-resolving on navigation never flashes back to INR
  if (applied.current.path !== location.pathname) {
    applied.current = { path: location.pathname, yearId: null }
  }

  // ── 1) Resolve tenant + years once per page view ────────────────────────
  useEffect(() => {
    let cancelled = false
    newRequestScope()

    ;(async () => {
      // A DevHostOverride lets the site run on localhost while still resolving a
      // real club. ?host=rcfoo is honoured ONLY locally, so production can't be
      // spoofed.
      let host = appSettings.DevHostOverride
      if (isLocalRequest()) {
        const qHost = new URLSearchParams(window.location.search).get('host')
        if (qHost && qHost.trim()) host = qHost.trim()
      }
      if (!host || !host.trim()) host = window.location.hostname

      const tenant = await resolveWebsiteByHost(host)
      if (cancelled) return

      const next = { ...EMPTY, tenant, loading: false }

      if (tenant && tenant.clubId > 0) {
        next.clubId = tenant.clubId
        next.clubName = tenant.clubName || ''
        // ThemeResolver keys BOTH the madras-legacy restriction and every
        // ClubThemeMap pin on the subdomain as well as the club id. Without this
        // line club.subdomain is undefined, so those checks silently fell back
        // to the id alone and a `rcmadras=madras-legacy` style pin never matched.
        next.subdomain = tenant.subdomain || null
        next.themeKey = tenant.themeKey
        next.status = tenant.status
        next.daysRemaining = tenant.daysRemaining || 0
        next.trialEndsAt = tenant.trialEndsAt || null
        next.paidUntil = tenant.paidUntil || null
      } else {
        // Host isn't mapped to a club. Only fall back when a DefaultWebsiteId is
        // explicitly configured (local preview); otherwise the site is "not
        // configured" and the gate shows the setup page.
        const fallbackId = parseInt(appSettings.DefaultWebsiteId, 10)
        if (fallbackId > 0) {
          next.clubId = fallbackId
        } else {
          next.isConfigured = false
          setBase(next)
          return
        }
      }

      next.years = (await getYears(next.clubId)) || []
      if (cancelled) return

      // v2/about carries the club's CURRENCY (and, as a fallback, its name).
      // Resolved once here rather than per page so every cost figure on the site
      // agrees with every other one, and keyed on the SAME yearId the pages
      // themselves use — getAbout is getOrAddRequest-cached, so on any page that
      // already fetches about (every Home) this costs no extra network call.
      // Not read from the project: v2/projects' per-project `currency` is
      // unreliable (see shared/money.js).
      // Awaited only when the name is missing; otherwise the page renders first and the
      // currency lands a moment later (INR is the default until then).
      if (knownCurrency.current[next.clubId]) next.currency = knownCurrency.current[next.clubId]
      const aboutP = next.clubId > 0
        ? getAbout(next.clubId, pickYear(next.years, window.location.search, null).id)
        : Promise.resolve(null)
      if (!next.clubName) {
        const about = await aboutP
        if (cancelled) return
        // If the tenant couldn't be resolved by host, fill the club name from
        // the API so the brand and page titles still show the real club.
        if (about && about.clubName) next.clubName = about.clubName
        if (about && about.currency) next.currency = about.currency
      }

      setBase(next)
      aboutP.then((about) => {
        if (about && about.currency) knownCurrency.current[next.clubId] = about.currency
        if (!cancelled && about && about.currency && about.currency !== next.currency) {
          setBase((b) => (b.clubId === next.clubId ? { ...b, currency: about.currency } : b))
        }
      })
    })()

    return () => { cancelled = true }
    // Re-resolves on every navigation, mirroring the per-request C# context.
  }, [location.key])

  // ── 2) Pick the selected year for this view ─────────────────────────────
  const year = useMemo(
    () => pickYear(base.years, location.search, applied.current.yearId),
    [base.years, location.search, location.pathname]
  )

  // ── 3) Normalise the year param in the visible URL ───────────────────────
  // The chosen year STAYS in the address bar as ?yearId=. The port used to
  // strip it here (copying the Web Forms page, which re-rendered server-side),
  // and the result was that the year lived nowhere at all: picking 2025-26 on
  // Projects and clicking Directors silently snapped back to the current year,
  // and a year could not be bookmarked or shared. The doc comment at the top of
  // this file always said the year "lives ONLY in the URL" — now it actually
  // does. Still NO cookie: close the tab and you are back on the current year.
  //
  // Only ?year= (the label form) is normalised away, since ?yearId= is the
  // canonical form and carrying both would let them disagree.
  useEffect(() => {
    if (!year.fromUrl || year.id == null) return
    applied.current = { path: location.pathname, yearId: year.id }
    const params = new URLSearchParams(location.search)
    if (!params.has('year')) return
    params.delete('year')
    params.set('yearId', String(year.id))
    navigate(location.pathname + '?' + params.toString() + location.hash, { replace: true })
  }, [year.fromUrl, year.id, location.pathname, location.search, location.hash, navigate])

  const value = useMemo(() => ({
    ...base,
    selectedYearId: year.id,
    selectedYearLabel: year.label,
    /** Club name for display — never empty, so titles are never blank. */
    clubDisplayName: base.clubName || 'Rotary Club',
  }), [base, year.id, year.label])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The resolved club + year for this page view (RotaryPage.Club / .ClubId / .YearId). */
export function useClub() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useClub must be used inside <ClubProvider>')
  return v
}
