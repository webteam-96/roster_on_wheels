'use client'
// Port of AllSpecialDates.aspx + AllSpecialDates.aspx.cs — the Calendar page:
// month stat cards, a month grid, and three lists (birthdays / anniversaries /
// events) for the displayed month.
//
// The page shows the WHOLE displayed month by default (like the old site /
// React Calendar). Clicking a day filters the three lists to that day.
//
// The month grid is built as an HTML STRING (CalendarGrid() in the code-behind)
// and injected, so the day buttons the client script binds to stay byte-identical.
// That client script is ported as an effect at the bottom — a <script> tag in JSX
// never executes.
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, initials } from '@/themes/shared/rotaryPage.js'
import Breadcrumb, { enc } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

// ── InvariantCulture date formatting (the C# formats with CultureInfo.InvariantCulture) ──
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad2 = (n) => String(n).padStart(2, '0')

/** "MMMM yyyy" */
const monthLabelOf = (year, month) => MONTHS[month - 1] + ' ' + year
/** "dd MMM" */
const dayLabelOf = (year, month, day) => pad2(day) + ' ' + MONTHS_ABBR[month - 1]
/** "dd MMMM yyyy" */
const fullDayLabelOf = (year, month, day) => pad2(day) + ' ' + MONTHS[month - 1] + ' ' + year
/** "yyyy-MM" — the month links' query value */
const monthParamOf = (year, month) => year + '-' + pad2(month)

/**
 * ResolveContext():
 *   ?date=yyyy-MM-dd → that month, with the day selected (filtered).
 *   ?month=yyyy-MM   → that month, whole-month view.
 *   neither          → current month, whole-month view.
 */
export function resolveContext(search, today) {
  const q = new URLSearchParams(search)
  const rawDate = q.get('date')
  const rawMonth = q.get('month')

  let m
  if (rawDate && rawDate.trim() && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate.trim()))) {
    const y = +m[1], mo = +m[2], d = +m[3]
    // TryParseExact also rejects a non-existent date (e.g. 2026-02-31).
    const dt = new Date(y, mo - 1, d)
    if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) {
      return { year: y, month: mo, selectedDay: d }
    }
  }
  if (rawMonth && rawMonth.trim() && (m = /^(\d{4})-(\d{2})$/.exec(rawMonth.trim()))) {
    const mo = +m[2]
    if (mo >= 1 && mo <= 12) return { year: +m[1], month: mo, selectedDay: null }
  }
  return { year: today.getFullYear(), month: today.getMonth() + 1, selectedDay: null }
}

/** DisplayMonth.AddMonths(n) → "yyyy-MM" */
export function addMonths(year, month, n) {
  const d = new Date(year, month - 1 + n, 1)
  return monthParamOf(d.getFullYear(), d.getMonth() + 1)
}

/**
 * Builds the month grid (weekday headers + day cells). Each day is a
 * <button data-cal-day> — the client-side script selects/toggles it and filters
 * the lists WITHOUT a page reload (month nav stays as real links). Dots come from
 * the cached month data; the selected-day styling is applied by the script.
 */
function calendarGrid(year, month, today, monthFlags, civicActive) {
  let sb = ''
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7   // Monday-first

  const week = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  for (const w of week)
    sb += '<div class="pb-1 text-[10px] font-bold text-muted">' + w + '</div>'

  for (let i = 0; i < lead; i++)
    sb += '<div></div>'

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = year === today.getFullYear() && month === today.getMonth() + 1 && d === today.getDate()

    let flags = monthFlags[d] || 0

    // Resting style (today vs default). The "selected" gold style is applied by
    // the client script so day clicks never reload the page.
    const cls = isToday ? 'bg-navy-deep font-extrabold text-white' : 'text-ink hover:bg-canvas'
    const label = fullDayLabelOf(year, month, d)

    sb += '<button type="button" data-cal-day data-day="' + d +
      '" data-today="' + (isToday ? '1' : '0') +
      '" data-label="' + enc(label) +
      '" class="cal-day relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-full pb-1 text-[12px] font-semibold transition ' +
      cls +
      '"><span>' + d + '</span>'

    // Civic-bold shows EVENTS only (see AllSpecialDates.aspx), so mask off the
    // birthday (1) and anniversary (2) bits here too — otherwise the grid would
    // still dot days whose only entries are hidden from every list below it.
    if (civicActive) flags &= 4

    if (flags !== 0) {
      sb += '<span class="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap leading-none">'
      if ((flags & 1) !== 0) sb += '<span class="mx-px inline-block rounded-full bg-emerald-500" style="width:5px;height:5px"></span>'
      if ((flags & 2) !== 0) sb += '<span class="mx-px inline-block rounded-full bg-orange-500" style="width:5px;height:5px"></span>'
      if ((flags & 4) !== 0) sb += '<span class="mx-px inline-block rounded-full bg-blue-500" style="width:5px;height:5px"></span>'
      sb += '</span>'
    }

    sb += '</button>'
  }

  return sb
}

export default function AllSpecialDates({ data }) {
  const club = useClub()
  const { isWarm, isCivic } = useTheme()
  const location = useLocation()

  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx
  const selectedDay = ctx.selectedDay
  const hasSelectedDay = selectedDay !== null

  // ── Header / nav helpers ──
  const monthLabel = monthLabelOf(year, month)
  const selectedDayLabel = hasSelectedDay ? fullDayLabelOf(year, month, selectedDay) : ''
  const prevMonthHref = '/calendar?month=' + addMonths(year, month, -1)
  const nextMonthHref = '/calendar?month=' + addMonths(year, month, 1)

  // BindLists(): the whole displayed month, plus the grid's dot flags (both come
  // out of the same cached month payload — GetCalendarMonthFlags derives from it).
  // The server loads the month the URL asks for (themes/shared/loaders.ts); the flags derive from it.
  const monthData = data.month || {}
  const monthFlags = useMemo(() => {
    const map = {}
    for (const day of Object.keys(monthData)) {
      const c = monthData[day]
      let flags = 0
      if (c) {
        if (c.birthdays && c.birthdays.length) flags |= 1
        if (c.anniversaries && c.anniversaries.length) flags |= 2
        if (c.events && c.events.length) flags |= 4
      }
      map[day] = flags
    }
    return map
  }, [monthData])

  const { birthdays, anniversaries, events } = useMemo(() => {
    const birthdays = []
    const anniversaries = []
    const events = []

    const days = Object.keys(monthData).map(Number).sort((a, b) => a - b)
    for (const day of days) {
      const c = monthData[day] || {}
      const dayLabel = dayLabelOf(year, month, day)
      if (c.birthdays)
        for (const p of c.birthdays)
          birthdays.push({ day, dayLabel, memberName: p.memberName, img: media(p.profilePhotoPath) })
      if (c.anniversaries)
        for (const p of c.anniversaries)
          anniversaries.push({ day, dayLabel, memberName: p.memberName, img: media(p.profilePhotoPath) })
      if (c.events)
        for (const ev of c.events)
          events.push({
            day,
            dayLabel,
            id: ev.id,
            title: ev.title,
            venue: (!ev.venue || !String(ev.venue).trim()) ? '' : ev.venue,
            registration: (!ev.registrationLink || !String(ev.registrationLink).trim()) ? '' : ev.registrationLink,
          })
    }
    return { birthdays, anniversaries, events }
  }, [monthData, year, month])

  // Month totals drive the stat cards.
  const birthdayCount = birthdays.length
  const anniversaryCount = anniversaries.length
  const eventCount = events.length
  const totalCount = birthdayCount + anniversaryCount + eventCount

  // The WHOLE month is always rendered (each item tagged data-day); clicking a
  // day now filters the lists CLIENT-SIDE (no page reload). The badges therefore
  // start at the month totals and JS adjusts them when a day is selected.
  const birthdayShown = birthdayCount
  const anniversaryShown = anniversaryCount
  const eventShown = eventCount

  /** Day pre-selected via the ?date= deep link (0 = whole-month view).
   *  Consumed by the client-side calendar script to apply the initial filter. */
  const initialSelectedDay = selectedDay || 0

  const gridHtml = useMemo(
    () => calendarGrid(year, month, today, monthFlags, isCivic),
    [year, month, today, monthFlags, isCivic]
  )

  // ── the page's inline calendar script, ported as an effect ────────────────
  // Calendar day selection is CLIENT-SIDE: clicking a day filters the three lists
  // (and their badges / empty states) without reloading the page. Month nav
  // (prev / next) stays as normal links since it loads a different month's data.
  useEffect(() => {
    var dayBtns = Array.prototype.slice.call(document.querySelectorAll('[data-cal-day]'));
    if (!dayBtns.length) return;
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-cal-item]'));
    var kinds = ['birthdays', 'anniversaries', 'events'];
    var counts = {}, empties = {};
    kinds.forEach(function (k) {
      counts[k] = document.querySelector('[data-list-count="' + k + '"]');
      empties[k] = document.querySelector('[data-empty="' + k + '"]');
    });
    var dayLabel = document.querySelector('[data-day-label]');
    var dayLabelText = document.querySelector('[data-day-label-text]');
    var wholeMonthBtn = document.querySelector('[data-whole-month]');

    var offs = [];
    function on(el, type, fn) {
      el.addEventListener(type, fn);
      offs.push(function () { el.removeEventListener(type, fn); });
    }

    var WARM = isWarm;
    var SEL = WARM
      ? ['bg-gold', 'font-extrabold', 'text-white', 'shadow-md', 'ring-2', 'ring-gold/40']
      : ['bg-gold', 'font-extrabold', 'text-navy', 'shadow-md', 'ring-2', 'ring-gold/40'];
    var TODAY = ['bg-navy-deep', 'font-extrabold', 'text-white'];
    var BASE = ['text-ink', 'hover:bg-canvas'];
    var ALL = SEL.concat(TODAY, BASE);

    var selectedDay = 0;   // 0 = whole month

    function styleDays() {
      dayBtns.forEach(function (b) {
        var d = parseInt(b.getAttribute('data-day'), 10);
        var isSel = selectedDay !== 0 && d === selectedDay;
        var isToday = b.getAttribute('data-today') === '1';
        ALL.forEach(function (c) { b.classList.remove(c); });
        (isSel ? SEL : isToday ? TODAY : BASE).forEach(function (c) { b.classList.add(c); });
      });
    }

    function apply() {
      var shown = { birthdays: 0, anniversaries: 0, events: 0 };
      items.forEach(function (it) {
        var d = parseInt(it.getAttribute('data-day'), 10);
        var visible = (selectedDay === 0 || d === selectedDay);
        it.classList.toggle('hidden', !visible);
        if (visible) { var k = it.getAttribute('data-kind'); if (shown.hasOwnProperty(k)) shown[k]++; }
      });
      kinds.forEach(function (k) {
        if (counts[k]) counts[k].textContent = shown[k];
        if (empties[k]) {
          empties[k].classList.toggle('hidden', shown[k] !== 0);
          var scope = empties[k].querySelector('[data-scope]');
          if (scope) scope.textContent = selectedDay === 0 ? 'this month' : 'on this day';
        }
      });
      var selBtn = dayBtns.filter(function (b) { return parseInt(b.getAttribute('data-day'), 10) === selectedDay; })[0];
      if (selectedDay !== 0 && selBtn) {
        if (dayLabelText) dayLabelText.textContent = selBtn.getAttribute('data-label');
        if (dayLabel) dayLabel.classList.remove('hidden');
        if (wholeMonthBtn) wholeMonthBtn.style.display = 'inline-flex';
      } else {
        if (dayLabel) dayLabel.classList.add('hidden');
        if (wholeMonthBtn) wholeMonthBtn.style.display = 'none';
      }
      styleDays();
    }

    dayBtns.forEach(function (b) {
      on(b, 'click', function () {
        var d = parseInt(b.getAttribute('data-day'), 10);
        selectedDay = (selectedDay === d) ? 0 : d;   // toggle off if same day
        apply();
      });
    });
    if (wholeMonthBtn) on(wholeMonthBtn, 'click', function () { selectedDay = 0; apply(); });

    selectedDay = parseInt(String(initialSelectedDay), 10) || 0;   // honour ?date= deep link
    apply();

    return function () { offs.forEach(function (f) { f(); }); };
  }, [isWarm, gridHtml, birthdays, anniversaries, events, initialSelectedDay]);

  useRotaryAnim([monthData, monthFlags])

  return (
    <>
      <Breadcrumb eyebrow="Special Dates" title="Calendar" crumbLabel="Calendar" titleClass="uppercase tracking-wide" />

      {/* `cv-cal` is a styling hook only. It is emitted for every theme but is
          acted on solely by [data-theme="civic-bold"] .cv-cal rules in
          civic-motion.css, so classic / warm / verdigris / madras render this
          shared page exactly as before. */}
      <div className="bg-canvas cv-cal">
        <div className="container-x py-10">

          {/* CIVIC-BOLD ONLY (2026-07-29, by request): this theme's Calendar shows EVENTS
              only — no birthdays, no anniversaries. Every exclusion below is gated on
              CivicActive so the other four themes render this shared page unchanged.
              The "Total Activities" card is dropped on civic too: TotalCount sums
              birthdays + anniversaries + events, so leaving it would print a number
              (e.g. 27) that doesn't reconcile with the only visible figure (Events 12).
              With one card left, the 4-up track would strand it at quarter width, so
              civic uses a single full-width column instead. */}
          {/* ══ Stat cards (counts for the selected day) ══ */}
          <div className={isCivic ? 'reveal grid grid-cols-1 gap-4' : 'reveal grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'}>
            {!isCivic && (
            <>
            {/* Birthdays */}
            <div className={isWarm ? 'flex items-center gap-4 rounded-2xl border border-navy/10 bg-white p-5 shadow-card' : 'flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-card'}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/></svg></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Birthdays</p>
                <p className="font-heading text-2xl font-extrabold leading-none text-navy">{birthdayCount}</p>
                <p className="mt-0.5 text-[11px] text-muted">This Month</p>
              </div>
            </div>
            {/* Anniversaries */}
            <div className={isWarm ? 'flex items-center gap-4 rounded-2xl border border-navy/10 bg-white p-5 shadow-card' : 'flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-card'}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-500"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Anniversaries</p>
                <p className="font-heading text-2xl font-extrabold leading-none text-navy">{anniversaryCount}</p>
                <p className="mt-0.5 text-[11px] text-muted">This Month</p>
              </div>
            </div>
            </>
            )}
            {/* Events */}
            <div className={isWarm ? 'flex items-center gap-4 rounded-2xl border border-navy/10 bg-white p-5 shadow-card' : 'flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-card'}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Events</p>
                <p className="font-heading text-2xl font-extrabold leading-none text-navy">{pad2(eventCount)}</p>
                <p className="mt-0.5 text-[11px] text-muted">This Month</p>
              </div>
            </div>
            {!isCivic && (
            <>
            {/* Total */}
            <div className={isWarm ? 'flex items-center gap-4 rounded-2xl border border-navy/10 bg-white p-5 shadow-card' : 'flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-card'}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total Activities</p>
                <p className="font-heading text-2xl font-extrabold leading-none text-navy">{totalCount}</p>
                <p className="mt-0.5 text-[11px] text-muted">This Month</p>
              </div>
            </div>
            </>
            )}
          </div>

          {/* ══ Month label (+ selected-day filter) ══ */}
          <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
            {/* The month name is printed by the calendar widget's own header,
                between the prev/next arrows, so repeating it here said it twice.
                The row stays because it still carries the selected-day filter
                label and the "Show whole month" button — both driven by the
                page script through [data-day-label] / [data-day-label-text]. */}
            <h2 className="font-heading text-xl font-extrabold text-navy">
              <span data-day-label className={'text-base font-bold text-gold-cta' + (hasSelectedDay ? '' : ' hidden')}><span data-day-label-text>{selectedDayLabel}</span></span>
            </h2>
            <button type="button" data-whole-month className="inline-flex items-center gap-1.5 rounded-full border border-navy/15 bg-white px-4 py-2 text-xs font-bold text-navy shadow-sm transition hover:border-gold hover:text-gold-cta" style={hasSelectedDay ? {} : { display: 'none' }}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              Show whole month
            </button>
          </div>

          {/* civic drops to a 2-up track: only the calendar and the Events list remain,
              so the xl:grid-cols-4 rule would leave two empty columns. */}
          {/* `min-w-0` on EVERY card below is load-bearing on phones. A grid item
              defaults to min-width:auto, so the single mobile column is forced at
              least as wide as its widest card's min-content — one long event venue
              pushed the track to 416px inside a 371px viewport and the cards were
              sliced off on the right (html{overflow-x:hidden} clips it rather than
              letting you scroll, so the content was simply gone). */}
          {/* ══ Calendar widget + lists ══ */}
          <div className={isCivic ? 'reveal grid gap-5 lg:grid-cols-2' : 'reveal grid gap-5 lg:grid-cols-2 xl:grid-cols-4'}>

            {/* Calendar widget (white body, navy header) */}
            <div className={'min-w-0 ' + (isWarm ? 'order-first flex flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card lg:order-none' : 'order-first flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card lg:order-none')}>
              {/* navy header bar with prev/next month nav (gold gradient on warm-modern) */}
              <div className={isWarm ? 'flex shrink-0 items-center justify-between bg-gradient-to-r from-gold to-gold-cta px-4 py-3.5' : 'flex shrink-0 items-center justify-between bg-navy-deep px-4 py-3.5'}>
                <a href={prevMonthHref} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </a>
                <span className="font-heading text-sm font-extrabold text-white">{monthLabel}</span>
                <a href={nextMonthHref} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </a>
              </div>

              {/* white date grid (weekday headers + day cells, built server-side) */}
              <div className="grid flex-1 grid-cols-7 content-center gap-0.5 px-3 py-3 text-center"
                   dangerouslySetInnerHTML={{ __html: gridHtml }} />

              {/* legend */}
              <div className={isWarm ? 'flex shrink-0 items-center justify-center gap-4 border-t border-navy/10 py-3' : 'flex shrink-0 items-center justify-center gap-4 border-t border-gray-100 py-3'}>
                {!isCivic && (
                <>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted"><span className="h-2 w-2 rounded-full bg-emerald-500"></span> Birthday</span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted"><span className="h-2 w-2 rounded-full bg-orange-500"></span> Anniversary</span>
                </>
                )}
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted"><span className="h-2 w-2 rounded-full bg-blue-500"></span> Event</span>
              </div>
            </div>

            {!isCivic && (
            <>
            {/* ── Birthdays list (emerald) ── */}
            <div className={'min-w-0 ' + (isWarm ? 'flex h-[360px] flex-col rounded-2xl border border-navy/10 bg-white shadow-card' : 'flex h-[360px] flex-col rounded-2xl border border-gray-100 bg-white shadow-card')}>
              <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/></svg>
                </span>
                <h3 className="font-heading text-[15px] font-extrabold text-navy">Birthdays</h3>
                <span data-list-count="birthdays" className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-muted">{birthdayShown}</span>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
                {birthdays.map((b, i) => (
                  <div key={i} data-cal-item data-kind="birthdays" data-day={b.day} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-canvas">
                    {b.img ? (
                    <>
                      <img src={b.img} alt={b.memberName} loading="lazy"
                           onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex' }}
                           className="h-9 w-9 shrink-0 rounded-full object-cover object-top ring-2 ring-gray-100" />
                      <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-600">{initials(b.memberName)}</span>
                    </>
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-600">{initials(b.memberName)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-tight text-navy">{b.memberName}</p>
                      <p className="text-[11px] text-muted">Birthday &middot; {b.dayLabel}</p>
                    </div>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20M12 8v3M12 4h.01"/></svg>
                    </span>
                  </div>
                ))}
                <p data-empty="birthdays" className={'px-2 py-10 text-center text-xs text-muted' + (birthdayShown === 0 ? '' : ' hidden')}>No birthdays <span data-scope>{hasSelectedDay ? 'on this day' : 'this month'}</span></p>
              </div>
            </div>

            {/* ── Anniversaries list (orange) ── */}
            <div className={'min-w-0 ' + (isWarm ? 'flex h-[360px] flex-col rounded-2xl border border-navy/10 bg-white shadow-card' : 'flex h-[360px] flex-col rounded-2xl border border-gray-100 bg-white shadow-card')}>
              <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-500">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>
                </span>
                <h3 className="font-heading text-[15px] font-extrabold text-navy">Anniversaries</h3>
                <span data-list-count="anniversaries" className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-muted">{anniversaryShown}</span>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
                {anniversaries.map((a, i) => (
                  <div key={i} data-cal-item data-kind="anniversaries" data-day={a.day} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-canvas">
                    {a.img ? (
                    <>
                      <img src={a.img} alt={a.memberName} loading="lazy"
                           onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex' }}
                           className="h-9 w-9 shrink-0 rounded-full object-cover object-top ring-2 ring-gray-100" />
                      <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-500">{initials(a.memberName)}</span>
                    </>
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-500">{initials(a.memberName)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-tight text-navy">{a.memberName}</p>
                      <p className="text-[11px] text-muted">Anniversary &middot; {a.dayLabel}</p>
                    </div>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>
                    </span>
                  </div>
                ))}
                <p data-empty="anniversaries" className={'px-2 py-10 text-center text-xs text-muted' + (anniversaryShown === 0 ? '' : ' hidden')}>No anniversaries <span data-scope>{hasSelectedDay ? 'on this day' : 'this month'}</span></p>
              </div>
            </div>
            </>
            )}

            {/* ── Events list (blue) ── */}
            <div className={'min-w-0 ' + (isWarm ? 'flex h-[360px] flex-col rounded-2xl border border-navy/10 bg-white shadow-card' : 'flex h-[360px] flex-col rounded-2xl border border-gray-100 bg-white shadow-card')}>
              <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                </span>
                <h3 className="font-heading text-[15px] font-extrabold text-navy">Events</h3>
                <span data-list-count="events" className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-muted">{eventShown}</span>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
                {events.map((ev, i) => (
                  <div key={i} data-cal-item data-kind="events" data-day={ev.day} className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-canvas">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-tight text-navy">{ev.title}</p>
                      <p className="truncate text-[11px] text-muted">
                        {!ev.venue ? ev.dayLabel : ev.venue + ' · ' + ev.dayLabel}
                      </p>
                    </div>
                    {/* Trailing element: a "Read more" arrow linking to the event's detail
                        page. The trailing glyph used to repeat the LEADING calendar icon,
                        which read as two calendar icons on one row. civic-bold got the arrow
                        first, warm-modern followed on 2026-08-03 after the same complaint,
                        and it is now universal — the duplicate was reported once more against
                        classic-blue, so there is no theme left that wants the old glyph.
                        NOTE: hover uses bg-navy, not bg-blue-600 — the latter is NOT compiled
                        into the civic-bold CSS and would silently do nothing. bg-blue-50 /
                        text-blue-600 / hover:bg-navy are verified present in every theme's
                        compiled sheet. */}
                    <a href={'/event?id=' + ev.id} aria-label={'Read more about ' + ev.title}
                       className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition hover:bg-navy hover:text-white">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </a>
                  </div>
                ))}
                <p data-empty="events" className={'px-2 py-10 text-center text-xs text-muted' + (eventShown === 0 ? '' : ' hidden')}>No events <span data-scope>{hasSelectedDay ? 'on this day' : 'this month'}</span></p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
