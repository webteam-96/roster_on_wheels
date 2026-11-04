'use client'
// Port of Newsletter.aspx + Newsletter.aspx.cs.
//
// Two layouts live here, exactly as in the original: the warm-modern "postmark
// card grid" (feature card + month-grouped rows + live search) and the ORIGINAL
// card grid every other theme keeps, gated on WarmActive.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media } from '@/themes/shared/rotaryPage.js'
import Breadcrumb, { EmptyState } from '@/themes/shared/Breadcrumb.jsx'
import { formatDate, newsletterLink } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** DateTime.MinValue equivalent: the API left publishDateTime out. */
const stamp = (n) => (n.publishDateTime ? new Date(n.publishDateTime).getTime() : -Infinity)

// Show EVERY newsletter for the selected year — the old cap of 24 silently
// dropped issues for clubs that publish fortnightly/weekly (e.g. a year with
// 25 showed only 24). 500 is effectively "all" (a single year can't exceed
// ~52 weekly issues) without fetching unrelated years.
// OrderByDescending is explicit (not just relying on API order) so the
// "latest issue" feature card is always correct even if that ever drifts.
//
// MonthLabel/IsNewMonth are WARM-only additions (month-grouped listing) —
// the shared Date field ("dd MMM yyyy") is untouched so classic-blue,
// civic-bold, verdigris-ledger and madras-legacy render exactly as before;
// they simply don't read the two new fields.
export function buildItems(newsletters) {
  let prevMonth = null
  return [...newsletters]
    .sort((a, b) => { const x = stamp(a), y = stamp(b); return x === y ? 0 : y - x })
    .map((n) => {
      const d = n.publishDateTime ? new Date(n.publishDateTime) : null
      const month = !d ? 'Undated' : MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear()
      const isNewMonth = month !== prevMonth
      prevMonth = month
      // "dd MMM yyyy" -> the postmark date-stamp fields for the WARM card grid.
      const parts = d ? formatDate(d).split(' ') : null
      return {
        title: n.title,
        date: d ? formatDate(d) : '',
        url: n.linkUrl ? newsletterLink(n.linkUrl) : media(n.filePath),
        monthLabel: month,
        isNewMonth,
        dayNum: parts ? parts[0] : '--',
        monAbbr: parts ? parts[1].toUpperCase() : '',
      }
    })
}

export default function Newsletter({ data }) {
  const { clubId, selectedYearId: yearId } = useClub()
  const { isWarm } = useTheme()
  const items = useMemo(() => buildItems(data.newsletters || []), [data.newsletters])
  const [query, setQuery] = useState('')


  const count = items.length
  // WARM only: the most recent issue, pulled out for the "on the stand now"
  // feature card above the archive list. Null when Count == 0.
  const latest = items.length > 0 ? items[0] : null

  useNewsletterSearch(isWarm && count > 6, [items])
  useRotaryAnim([isWarm, count])

  // Non-warm listing filter. Warm keeps the FULL list: its own DOM-driven search
  // filters the rendered cards, and its month grouping (isNewMonth) was computed
  // over the unfiltered order, so removing rows here would strand month headers.
  const shownItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (isWarm || !q) return items
    return items.filter((n) => String(n.title || '').toLowerCase().includes(q))
  }, [items, query, isWarm])

  return (
    <>
      {/* Eyebrow removed (was "HILLS ECHOES" — a hardcoded design-reference club
          name — then "IN PRINT"; empty eyebrow renders no kicker above the title). */}
      <Breadcrumb eyebrow="" title="Newsletters" crumbLabel="Newsletters" />

      {/* ══ Newsletters grid ══ */}
      <section className="bg-canvas py-12">
        <div className="container-x">
          {count === 0 ? (
            <EmptyState title="No newsletters found" message="There are no newsletter issues to show for the selected year yet. Please check back soon." />
          ) : (
            <>
              {isWarm ? (
                <>
                  {/* WARM: "on the stand now" feature card. A newsletter archive's single most
                      important fact isn't "how many issues exist" — it's "what's current." This
                      pulls the latest issue out of the list into its own showcase with a direct
                      read CTA; the searchable back-catalogue (latest included) follows below. */}
                  <div className="reveal mx-auto mb-8 max-w-3xl overflow-hidden rounded-3xl border border-navy/10 bg-gradient-to-br from-navy to-navy-deep p-7 shadow-card sm:p-9">
                    <div className="flex flex-wrap items-start justify-between gap-5">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
                          <span className="h-1.5 w-1.5 rounded-full bg-gold"></span> On the stand now
                        </p>
                        <h2 className="mt-4 font-heading text-2xl font-extrabold leading-tight text-white sm:text-3xl">{latest.title}</h2>
                        <p className="mt-2 font-script text-xl leading-none text-gold">our monthly e-bulletin{latest.date ? ' · ' + latest.date : ''}</p>
                      </div>
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-gold ring-1 ring-white/15">
                        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                      </span>
                    </div>
                    <a href={latest.url} target="_blank" rel="noopener noreferrer" data-magnetic className="btn-gold mt-6 inline-flex !rounded-full !px-6 !py-3">Read the Latest Issue
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </a>
                  </div>

                  <div className="reveal mx-auto mb-4 flex max-w-3xl items-end justify-between gap-3">
                    <h3 className="font-heading text-xl font-bold text-navy">Back Issues</h3>
                    <p className="text-sm text-muted"><span data-nl-count className="font-bold text-navy">{count}</span> <span data-nl-count-word>{count === 1 ? 'issue' : 'issues'}</span></p>
                  </div>

                  {/* Search — same pill pattern as the Directory page search, so it reads as
                      part of one design system rather than a one-off control. Only worth
                      showing once there's enough issues that scanning beats scrolling. */}
                  {count > 6 && (
                    <label className="reveal mx-auto mb-6 flex max-w-3xl items-center gap-2 rounded-full border border-navy/15 bg-canvas px-4 py-2.5 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
                      <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input data-nl-search type="text" aria-label="Search newsletter issues by title"
                             placeholder="Search issues by title..."
                             className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" />
                      <button data-nl-clear type="button" aria-label="Clear search" className="hidden text-muted hover:text-navy">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </label>
                  )}
                </>
              ) : (
                <>
                <div className={isWarm ? 'mb-8 flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-4 shadow-card lg:flex-row lg:items-center' : 'mb-8 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-card lg:flex-row lg:items-center'}>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={isWarm ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold-cta' : 'flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy'}>
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                    </span>
                    <div>
                      <p className="font-heading text-2xl font-extrabold leading-none text-navy">{shownItems.length}</p>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{shownItems.length === 1 ? 'Newsletter' : 'Newsletters'}</p>
                    </div>
                  </div>
                  <div className="w-full flex-1">
                    <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-3 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
                      <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input type="text" aria-label="Search newsletter issues by title"
                             placeholder="Search issues by title..." autoComplete="off"
                             value={query}
                             onChange={(e) => setQuery(e.target.value)}
                             onKeyDown={(e) => { if (e.key === 'Enter' || e.keyCode === 13) e.preventDefault() }}
                             className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" />
                    </label>
                  </div>
                </div>
                {shownItems.length === 0 && (
                  <p className="mb-8 text-center text-sm text-muted">No issues match &ldquo;{query.trim()}&rdquo;. Try a different search.</p>
                )}
                </>
              )}

              <div className={isWarm ? 'reveal mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2' : 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'}>
                {shownItems.map((n, i) => (
                  <Fragment key={i}>
                    {/* WARM: postmark card grid, grouped by month. A club e-bulletin is
                        something that gets POSTED — the dashed date-stamp box leans into
                        that instead of a generic icon, and doubles as a fast day-level
                        scan target (much quicker to spot than a full "20 Jul 2026"
                        string). Month header spans the full grid row (col-span-full) so
                        one flat Repeater can group a multi-column grid with no nested
                        containers — CSS just flows the next row of cards under it. */}
                    {isWarm && n.isNewMonth && (
                      <div data-nl-group-head={n.monthLabel} className="col-span-full flex items-center gap-3 pb-1 pt-6 first:pt-0">
                        <p className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-cta">{n.monthLabel}</p>
                        <span className="h-px flex-1 bg-navy/10"></span>
                      </div>
                    )}
                    {isWarm ? (
                      <a data-nl-row data-nl-group={n.monthLabel} data-nl-title={String(n.title === null || n.title === undefined ? '' : n.title).toLowerCase()}
                         href={n.url} target="_blank" rel="noopener noreferrer"
                         className="group flex items-start gap-4 rounded-2xl border border-navy/10 bg-white p-4 transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-card">
                        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-navy/20 text-navy transition-colors group-hover:border-gold/60">
                          <span className="font-heading text-xl font-extrabold leading-none">{n.dayNum}</span>
                          <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">{n.monAbbr}</span>
                        </div>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-heading text-[15px] font-bold text-navy transition-colors group-hover:text-gold-cta">{n.title}</h3>
                            {i === 0 && <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-cta">Latest</span>}
                          </div>
                          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-gold-cta opacity-0 transition-opacity duration-300 group-hover:opacity-100">Read issue
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                          </span>
                        </div>
                      </a>
                    ) : (
                      <a href={n.url} target="_blank" rel="noopener noreferrer"
                         className="reveal group flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-cardHover">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-navy to-navy-deep text-gold ring-2 ring-gold/30">
                          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-heading text-[15px] font-bold text-navy">{n.title}</h3>
                          <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                            <svg className="h-3.5 w-3.5 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                            {n.date}
                          </span>
                        </div>
                        <svg className="h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </a>
                    )}
                  </Fragment>
                ))}
                {isWarm && (
                  <div data-nl-empty className="col-span-full hidden flex-col items-center gap-2 rounded-2xl border border-navy/10 bg-white py-14 text-center">
                    <svg className="h-8 w-8 text-navy/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <p className="text-sm font-semibold text-navy/60">No issues match <span data-nl-empty-term className="text-navy"></span></p>
                    <button type="button" data-nl-empty-clear className="mt-1 text-xs font-bold uppercase tracking-wide text-gold-cta hover:text-navy">Clear search</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}

// Live client-side search over the newsletter list — no postback, no API call.
// Filters by title (data-nl-title, already lowercased), keeps the stat banner's
// count in sync, and shows a proper "no matches" state instead of an empty white
// box when a search comes up dry. Also hides a month's group header
// (data-nl-group-head) when every row under it gets filtered out — otherwise a
// search could leave a "JUNE 2026" label with nothing beneath it.
//
// The original is an inline <script> at the bottom of the page, gated on
// WarmActive && Count > 6; a <script> tag in JSX never executes, so the same
// IIFE lives here as an effect (listeners removed on teardown, which the
// one-shot page script never had to do).
function useNewsletterSearch(active, deps) {
  useEffect(() => {
    if (!active) return undefined

    var input = document.querySelector('[data-nl-search]')
    var clearBtn = document.querySelector('[data-nl-clear]')
    var rows = Array.prototype.slice.call(document.querySelectorAll('[data-nl-row]'))
    var groupHeads = Array.prototype.slice.call(document.querySelectorAll('[data-nl-group-head]'))
    var empty = document.querySelector('[data-nl-empty]')
    var emptyTerm = document.querySelector('[data-nl-empty-term]')
    var emptyClear = document.querySelector('[data-nl-empty-clear]')
    var countEl = document.querySelector('[data-nl-count]')
    var countWordEl = document.querySelector('[data-nl-count-word]')
    if (!input || !rows.length) return undefined

    function apply() {
      var term = input.value.trim().toLowerCase()
      clearBtn.classList.toggle('hidden', term === '')

      var shown = 0
      var visibleGroups = {}
      rows.forEach(function (row) {
        var match = term === '' || row.getAttribute('data-nl-title').indexOf(term) !== -1
        row.classList.toggle('hidden', !match)
        if (match) { shown++; visibleGroups[row.getAttribute('data-nl-group')] = true }
      })
      groupHeads.forEach(function (head) {
        head.classList.toggle('hidden', !visibleGroups[head.getAttribute('data-nl-group-head')])
      })

      if (empty) empty.classList.toggle('flex', shown === 0)
      if (empty) empty.classList.toggle('hidden', shown !== 0)
      if (emptyTerm) emptyTerm.textContent = term ? '"' + input.value.trim() + '"' : ''

      if (countEl) countEl.textContent = shown
      if (countWordEl) countWordEl.textContent = 'issue' + (shown === 1 ? '' : 's') + (term ? ' found' : '')
    }
    function reset() { input.value = ''; apply(); input.focus() }

    input.addEventListener('input', apply)
    clearBtn.addEventListener('click', reset)
    if (emptyClear) emptyClear.addEventListener('click', reset)
    return function () {
      input.removeEventListener('input', apply)
      clearBtn.removeEventListener('click', reset)
      if (emptyClear) emptyClear.removeEventListener('click', reset)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active].concat(deps))
}
