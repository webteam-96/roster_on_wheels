'use client'
// Port of Directory.aspx + Directory.aspx.cs — the club member directory.
//
// The same member list is rendered TWICE (a grid container and a list
// container); the page's own script toggles which one is visible and drives the
// search / pagination. That structure is kept verbatim: "The same data feeds
// both the grid and the list repeater; client-side JS toggles which container is
// visible (mirrors Directory.jsx view state)."
//
// That inline <script> is ported as an effect at the bottom — a <script> tag in
// JSX never executes, and the original runs at parse time when the cards are
// already in the DOM, which here only happens after the API responds.
import { useEffect, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, initials } from '@/themes/shared/rotaryPage.js'
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

/** Warm-modern's arch card always shows a portrait, so a missing photo falls
 *  back to the bundled placeholder art instead of the initials medallion. */
const NOIMG = '/img/noimg.png'

export default function Directory({ data }) {
  const club = useClub()
  const { isWarm, isHandloom } = useTheme()

  // BindMembers(): name + (profession, else designation) + resolved photo URL.

  const members = (data.directory || []).map((m) => ({
    name: m.memberName,
    work: (!m.profession || !String(m.profession).trim()) ? m.designation : m.profession,
    img: media(m.profilePhotoPath),
  }))

  // Number of members rendered (drives the toolbar count badge).
  const count = members.length

  // ── the page's inline <script>, ported verbatim as an effect ──────────────
  // Re-runs whenever the cards change (data lands, theme flips), and unbinds the
  // listeners it added to the toolbar controls so a re-run can't double-fire.
  useEffect(() => {
    // 20 ON HANDLOOM, 16 EVERYWHERE ELSE (2026-09-09, asked for). Not a global
    // change: this page is shared by all seven themes and the other six still
    // lay their grid out four across, where 16 is four clean rows. Handloom's
    // grid is five across at xl, so 20 is the same four rows there.
    var PAGE_SIZE = isHandloom ? 20 : 16;
    var WARM = isWarm;
    var grid = document.querySelector('[data-dir-grid]');
    var list = document.querySelector('[data-dir-list]');
    if (!grid || !list) return;

    var offs = [];
    function on(el, type, fn) {
      el.addEventListener(type, fn);
      offs.push(function () { el.removeEventListener(type, fn); });
    }

    // theme-matched control classes (warm-modern uses gold accents, classic-blue navy)
    var NAV_CLS = WARM
      ? 'flex h-9 w-9 items-center justify-center rounded-lg border border-navy/15 bg-white text-ink/70 transition hover:border-gold hover:bg-gold hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-navy/15 disabled:hover:bg-white disabled:hover:text-ink/70'
      : 'flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-navy transition hover:bg-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-navy';
    var PAGE_ON = WARM
      ? 'flex h-9 min-w-[36px] items-center justify-center rounded-lg px-2 text-sm font-bold transition bg-gold text-white shadow-sm'
      : 'flex h-9 min-w-[36px] items-center justify-center rounded-lg px-2 text-sm font-bold transition bg-navy text-white shadow-sm';
    var PAGE_OFF = WARM
      ? 'flex h-9 min-w-[36px] items-center justify-center rounded-lg px-2 text-sm font-bold transition border border-navy/15 bg-white text-ink/70 hover:border-gold/50 hover:text-gold-cta'
      : 'flex h-9 min-w-[36px] items-center justify-center rounded-lg px-2 text-sm font-bold transition border border-gray-200 bg-white text-navy hover:bg-canvas';
    var VIEW_ON = WARM
      ? 'flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white shadow-sm transition'
      : 'flex items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm font-bold text-white shadow-sm transition';
    var VIEW_OFF = WARM
      ? 'flex items-center gap-2 rounded-xl border border-navy/15 px-4 py-2.5 text-sm font-bold text-ink/70 transition hover:border-gold/50 hover:text-gold-cta'
      : 'flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-navy transition hover:bg-canvas';

    var searchInput = document.querySelector('[data-dir-search]');
    var clearBtn = document.querySelector('[data-dir-clear]');
    var countEl = document.querySelector('[data-dir-count]');
    var emptyEl = document.querySelector('[data-dir-empty]');
    var emptyQEl = document.querySelector('[data-dir-empty-q]');
    var pager = document.querySelector('[data-dir-pager]');
    var viewBtns = Array.prototype.slice.call(document.querySelectorAll('[data-dir-view]'));

    var query = '';
    var view = 'grid';   // 'grid' | 'list'
    var page = 1;

    // SVG chevrons for prev/next
    var chevL = '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    var chevR = '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    function activeContainer() { return view === 'grid' ? grid : list; }
    function cards(container) { return Array.prototype.slice.call(container.querySelectorAll('[data-dir-card]')); }

    // filtered cards computed against the active container's cards
    function filteredCards() {
      var q = query.trim().toLowerCase();
      return cards(activeContainer()).filter(function (c) {
        if (!q) return true;
        var name = (c.getAttribute('data-name') || '').toLowerCase();
        var work = (c.getAttribute('data-work') || '').toLowerCase();
        return name.indexOf(q) !== -1 || work.indexOf(q) !== -1;
      });
    }

    // page-number list with ellipsis for long ranges (mirrors pageNums)
    function pageNums(cur, total) {
      if (total <= 7) {
        var all = [];
        for (var i = 1; i <= total; i++) all.push(i);
        return all;
      }
      var out = [1];
      var start = Math.max(2, cur - 1);
      var end = Math.min(total - 1, cur + 1);
      if (start > 2) out.push('…');
      for (var p = start; p <= end; p++) out.push(p);
      if (end < total - 1) out.push('…');
      out.push(total);
      return out;
    }

    function render() {
      // hide every card in both containers, then reveal the active page slice
      cards(grid).forEach(function (c) { c.style.display = 'none'; });
      cards(list).forEach(function (c) { c.style.display = 'none'; });

      var matches = filteredCards();
      var total = matches.length;
      if (countEl) countEl.textContent = total;

      var pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page > pageCount) page = pageCount;
      var safePage = Math.min(page, pageCount);
      var startIdx = (safePage - 1) * PAGE_SIZE;
      var slice = matches.slice(startIdx, startIdx + PAGE_SIZE);

      slice.forEach(function (c) { c.style.display = 'flex'; });

      // container visibility
      var isEmpty = total === 0;
      grid.classList.toggle('hidden', view !== 'grid' || isEmpty);
      list.classList.toggle('hidden', view !== 'list' || isEmpty);
      list.classList.toggle('grid', view === 'list' && !isEmpty);

      // empty state
      if (emptyEl) {
        emptyEl.classList.toggle('hidden', !isEmpty);
        emptyEl.classList.toggle('flex', isEmpty);
        if (isEmpty && emptyQEl) emptyQEl.textContent = query;
      }

      renderPager(safePage, pageCount, isEmpty);
    }

    function renderPager(safePage, pageCount, isEmpty) {
      if (!pager) return;
      pager.innerHTML = '';
      if (isEmpty || pageCount <= 1) {
        pager.classList.add('hidden');
        pager.classList.remove('flex');
        return;
      }
      pager.classList.remove('hidden');
      pager.classList.add('flex');

      var prev = document.createElement('button');
      prev.type = 'button';
      prev.setAttribute('aria-label', 'Previous page');
      prev.className = NAV_CLS;
      prev.innerHTML = chevL;
      prev.disabled = safePage === 1;
      prev.addEventListener('click', function () { goPage(safePage - 1); });
      pager.appendChild(prev);

      pageNums(safePage, pageCount).forEach(function (p) {
        if (p === '…') {
          var dots = document.createElement('span');
          dots.className = 'px-2 text-sm text-muted';
          dots.textContent = '…';
          pager.appendChild(dots);
          return;
        }
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = p;
        if (p === safePage) {
          b.className = PAGE_ON;
        } else {
          b.className = PAGE_OFF;
        }
        b.addEventListener('click', function () { goPage(p); });
        pager.appendChild(b);
      });

      var next = document.createElement('button');
      next.type = 'button';
      next.setAttribute('aria-label', 'Next page');
      next.className = NAV_CLS;
      next.innerHTML = chevR;
      next.disabled = safePage === pageCount;
      next.addEventListener('click', function () { goPage(safePage + 1); });
      pager.appendChild(next);
    }

    function goPage(p) {
      page = p;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function setView(v) {
      view = v;
      viewBtns.forEach(function (btn) {
        var on = btn.getAttribute('data-dir-view') === v;
        if (on) {
          btn.className = VIEW_ON;
        } else {
          btn.className = VIEW_OFF;
        }
        // re-insert the preserved icon + label
        btn.innerHTML = btn.getAttribute('data-icon') + btn.getAttribute('data-label');
      });
      render();
    }

    // preserve each toggle button's icon + label so re-styling keeps them
    viewBtns.forEach(function (btn) {
      var svg = btn.querySelector('svg');
      btn.setAttribute('data-icon', svg ? svg.outerHTML : '');
      btn.setAttribute('data-label', btn.getAttribute('data-dir-view') === 'grid' ? ' Grid View' : ' List View');
      on(btn, 'click', function () { setView(btn.getAttribute('data-dir-view')); });
    });

    if (searchInput) {
      on(searchInput, 'input', function () {
        query = searchInput.value;
        page = 1;
        if (clearBtn) clearBtn.classList.toggle('hidden', query.length === 0);
        render();
      });
      // Enter must not submit the Web Forms <form> (reloads the page).
      on(searchInput, 'keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); }
      });
    }
    if (clearBtn) {
      on(clearBtn, 'click', function () {
        query = '';
        page = 1;
        if (searchInput) searchInput.value = '';
        clearBtn.classList.add('hidden');
        render();
      });
    }

    render();

    return function () { offs.forEach(function (f) { f(); }); };
  }, [isWarm, isHandloom, members]);

  useRotaryAnim([members])

  return (
    <>
      <Breadcrumb eyebrow="Our Members" title="Directory" crumbLabel="Directory" titleClass="uppercase tracking-wide" />

      <div className="bg-canvas">
        <div className="container-x py-10">

          {/* ── toolbar: count · search · view toggle ── */}
          <div className={isWarm ? 'mb-6 flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-4 shadow-card lg:flex-row lg:items-center' : 'mb-6 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-card lg:flex-row lg:items-center'}>
            <div className="flex shrink-0 items-center gap-3">
              <span className={isWarm ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold-cta' : 'flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy'}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </span>
              <div>
                <p data-dir-count className="font-heading text-2xl font-extrabold leading-none text-navy">{count}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Members</p>
              </div>
            </div>

            <label className={isWarm ? 'flex flex-1 items-center gap-2 rounded-full border border-navy/15 bg-canvas px-4 py-2.5 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20' : 'flex flex-1 items-center gap-2 rounded-full border border-gray-200 bg-canvas px-4 py-2.5 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20'}>
              <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input data-dir-search type="text" aria-label="Search members by name or profession"
                     placeholder="Search by name or profession..."
                     className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" />
              <button data-dir-clear type="button" aria-label="Clear search" className="hidden text-muted hover:text-navy">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </label>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button data-dir-view="grid" type="button"
                      className={isWarm ? 'flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white shadow-sm transition' : 'flex items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm font-bold text-white shadow-sm transition'}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                {' Grid View'}
              </button>
              <button data-dir-view="list" type="button"
                      className={isWarm ? 'flex items-center gap-2 rounded-xl border border-navy/15 px-4 py-2.5 text-sm font-bold text-ink/70 transition hover:border-gold/50 hover:text-gold-cta' : 'flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-navy transition hover:bg-canvas'}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                {' List View'}
              </button>
            </div>
          </div>

          {/* ── members: grid view ── */}
          <div data-dir-grid className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {members.map((m, i) => (
              <article key={i} data-dir-card data-idx={i}
                       data-name={m.name}
                       data-work={m.work}
                       className={isWarm ? 'reveal group relative flex h-full flex-col overflow-hidden arch-mask border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover' : 'reveal spotlight-card group relative flex h-full flex-col items-center rounded-2xl border border-gray-100 bg-white px-5 py-6 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-cardHover'}>
                {/* WARM: arch-topped portrait card — the photo fills the arch, text sits below. */}
                {isWarm ? (
                <>
                  <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-white">
                    <img src={!m.img ? NOIMG : m.img} alt={m.name} loading="lazy"
                         onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = NOIMG }}
                         className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white/70 to-transparent"></div>
                  </div>
                  <div className="flex flex-1 flex-col items-center px-4 pb-5 pt-3 text-center">
                    <h3 className="font-heading text-[15px] font-bold leading-tight text-navy transition-colors group-hover:text-gold-cta">{m.name}</h3>
                    <p className="mt-1.5 line-clamp-2 min-h-[32px] text-xs leading-relaxed text-muted">{m.work}</p>
                    <span className="mt-auto block h-1 w-8 rounded-full bg-gold/60 transition-all duration-300 group-hover:w-14 group-hover:bg-gold"></span>
                  </div>
                </>
                ) : (
                <>
                  <span className="glare"></span>
                  {!m.img ? (
                    <span className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy to-navy-deep font-heading text-xl font-bold leading-none text-gold ring-4 ring-gray-100" aria-hidden="true">{initials(m.name)}</span>
                  ) : (
                    <img src={m.img} alt={m.name} loading="lazy"
                         onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                         className="h-20 w-20 rounded-full object-cover object-top shadow-sm ring-4 ring-gray-100 transition-all duration-300 group-hover:ring-gold/40" />
                  )}

                  <h3 className="mt-4 font-heading text-[15px] font-bold leading-tight text-navy">{m.name}</h3>
                  <p className="mt-2 line-clamp-2 min-h-[32px] text-xs leading-relaxed text-muted">{m.work}</p>
                </>
                )}
              </article>
            ))}
          </div>

          {/* ── members: list view ── */}
          <div data-dir-list className="hidden grid-cols-1 gap-4 lg:grid-cols-2">
            {members.map((m, i) => (
              <article key={i} data-dir-card data-idx={i}
                       data-name={m.name}
                       data-work={m.work}
                       className={isWarm ? 'reveal group relative flex items-center gap-4 rounded-2xl border border-navy/10 bg-white p-4 shadow-card transition-all duration-300 hover:border-gold/40 hover:shadow-cardHover' : 'reveal spotlight-card group relative flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-card transition-all duration-300 hover:shadow-cardHover'}>
                {isWarm ? (
                  <img src={!m.img ? NOIMG : m.img} alt={m.name} loading="lazy"
                       onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = NOIMG }}
                       className="h-14 w-14 shrink-0 rounded-full object-cover object-top ring-2 ring-gold/20" />
                ) : (!m.img ? (
                  <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy to-navy-deep font-heading text-base font-bold leading-none text-gold ring-2 ring-gray-100" aria-hidden="true">{initials(m.name)}</span>
                ) : (
                  <img src={m.img} alt={m.name} loading="lazy"
                       onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                       className="h-14 w-14 shrink-0 rounded-full object-cover object-top ring-2 ring-gray-100" />
                ))}

                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-heading text-[15px] font-bold text-navy">{m.name}</h3>
                  {!m.work ? null : (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><svg className="h-3 w-3 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> {m.work}</p>
                  )}
                </div>

              </article>
            ))}
          </div>

          {/* ── no results ── */}
          <div data-dir-empty className="hidden flex-col items-center gap-3 py-16 text-center text-muted">
            <svg className="h-10 w-10 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>No members found matching &ldquo;<span data-dir-empty-q></span>&rdquo;.</span>
          </div>

          {/* ── pagination ── */}
          <div data-dir-pager className="mt-10 hidden items-center justify-center gap-1.5"></div>

        </div>
      </div>
    </>
  )
}
