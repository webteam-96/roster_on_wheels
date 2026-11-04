'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · DIRECTORY — the name wall.
//
// A club directory is a list of NAMES, so the default view is a wall of them:
// one ruled line each, the name set large in the display face, the profession
// tracked out on the right, the portrait small and desaturated until you point
// at it. Scanning 200 members is the actual job of this page and a wall does it
// far better than 200 cards; the card grid is still there, second, for people
// who want faces.
//
// The shared page ports its original inline <script> verbatim — hand-written DOM
// filtering, pagination and view toggling. None of that is needed here: the same
// behaviour is ~15 lines of React state, which is also why this page can afford
// two views at once.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useDirectoryGold, initials } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

const PAGE_SIZE = 30

export default function DirectoryGold({ data }) {
  const club = useClub()
  const members = useDirectoryGold(data)
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Directory')

  // Portraits lead (user's call): faces are what most visitors come here for.
  // The name wall stays one click away for scanning a long roster.
  const [view, setView] = useState('cards')     // 'cards' | 'wall'
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const inputRef = useRef(null)

  const list = members || []
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((m) => (m.name + ' ' + m.work).toLowerCase().indexOf(q) !== -1)
  }, [list, query])

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const cur = Math.min(Math.max(page, 1), totalPages)
  const start = (cur - 1) * PAGE_SIZE
  const shown = matched.slice(start, start + PAGE_SIZE)

  useRotaryAnim([members, view, cur])
  useRevealReplay('gdir-page', [members, view, cur])

  const onSearch = (v) => { setQuery(v); setPage(1) }

  return (
    <div className="gdir-page">

      {/* ══ 01 · The standard band — the count is its headline ══ */}
      {/* The figure only becomes true once the roster has loaded, so the title
          stays a plain noun until then. */}
      <GPageHead
        crumbs={[{ label: menuName || 'Directory' }]}
        eyebrow="Our members"
        title={members === null ? 'Members' : <><em>{list.length}</em> members</>}
        aside={(
          <div className="gdir-views" role="tablist" aria-label="Directory view">
            <button type="button" role="tab" aria-selected={view === 'cards'}
                    className={'gdir-view' + (view === 'cards' ? ' is-on' : '')}
                    onClick={() => setView('cards')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
              Portraits
            </button>
            <button type="button" role="tab" aria-selected={view === 'wall'}
                    className={'gdir-view' + (view === 'wall' ? ' is-on' : '')}
                    onClick={() => setView('wall')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              Name wall
            </button>
          </div>
        )}
      >
        {/* One big field, underlined — the page's only control, so it gets to
            be the size of the thing it does. Enter is swallowed: filtering is
            live, and a submit would reload the page in the Web Forms original. */}
        <div className="gdir-find">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input ref={inputRef} type="text" value={query} autoComplete="off"
                 aria-label="Search members by name or profession"
                 placeholder="Search by name or profession…"
                 onChange={(e) => onSearch(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
          {query && (
            <button type="button" aria-label="Clear search"
                    onClick={() => { onSearch(''); if (inputRef.current) inputRef.current.focus() }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
      </GPageHead>

      {/* ══ 02 · The wall (or the portraits) ══ */}
      <section className="gdir-body">
        <div className="gld-x">
          {members === null ? null : matched.length === 0 ? (
            <GEmpty
              title={list.length === 0 ? 'No members published' : 'No match'}
              message={list.length === 0
                ? 'This club has not published its member directory yet.'
                : 'Nobody in the directory matches “' + query.trim() + '”.'}
              action={list.length > 0 ? (
                <button type="button" className="gld-btn gld-btn--ghost" onClick={() => onSearch('')}>
                  Clear search <Arrow />
                </button>
              ) : null}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>}
            />
          ) : view === 'wall' ? (
            <div className="gdir-wall">
              {shown.map((m, i) => (
                <div className="gdir-row" key={m.i}>
                  <span className="gp-idx gdir-row__no">{String(start + i + 1).padStart(3, '0')}</span>
                  {/* Monogram underneath, portrait on top — a photo that 404s
                      just uncovers the initials instead of leaving a hole. */}
                  <span className="gdir-av" aria-hidden="true">
                    <i>{initials(m.name)}</i>
                    {m.img && <img src={m.img} alt="" loading="lazy" onError={hideOnError} />}
                  </span>
                  <span className="gdir-row__n">{m.name}</span>
                  <span className="gdir-row__w">{m.work}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="gdir-grid gld-stagger">
              {shown.map((m) => (
                <article className="gdir-card reveal" key={m.i}>
                  <span className="gdir-card__ph">
                    <i aria-hidden="true">{initials(m.name)}</i>
                    {m.img && <img src={m.img} alt={m.name} loading="lazy" onError={hideOnError} />}
                  </span>
                  <span className="gdir-card__b">
                    <h3 className="gdir-card__n">{m.name}</h3>
                    {m.work && <p className="gdir-card__w">{m.work}</p>}
                  </span>
                </article>
              ))}
            </div>
          )}

          {matched.length > 0 && (
            <>
              <div className="gp-count">
                Showing {start + 1}&ndash;{Math.min(start + PAGE_SIZE, matched.length)} of {matched.length}
                {club.clubDisplayName ? ' · ' + club.clubDisplayName : ''}
              </div>
              {totalPages > 1 && (
                <div className="gp-pager" style={{ marginTop: 'var(--g-3)' }}>
                  <button type="button" onClick={() => setPage(cur - 1)} disabled={cur === 1} aria-label="Previous page">&lsaquo;</button>
                  {Array.from({ length: totalPages }, (_, n) => n + 1)
                    .filter((n) => n === 1 || n === totalPages || Math.abs(n - cur) <= 1)
                    .map((n, i, arr) => (
                      <span key={n} style={{ display: 'contents' }}>
                        {i > 0 && n - arr[i - 1] > 1 && <span>…</span>}
                        <button type="button" className={n === cur ? 'is-on' : ''}
                                aria-current={n === cur ? 'page' : undefined}
                                onClick={() => setPage(n)}>{n}</button>
                      </span>
                    ))}
                  <button type="button" onClick={() => setPage(cur + 1)} disabled={cur === totalPages} aria-label="Next page">&rsaquo;</button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  )
}
