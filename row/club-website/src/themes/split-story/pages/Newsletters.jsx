'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Newsletters — the bulletin, filed month by month.
//
// Every issue is a gold wipe row (the sample's newsletters chapter): the row
// fills with gold from the left on hover/focus and the royal "Read newsletter"
// pill leans toward the pointer. When the year spans two or more months the
// list is a Split: the sticky panel's month rises letter by letter as each
// month crosses mid-screen, and its gold figure counts to the day each issue
// was filed, the issue's title underneath. One month, or a search, is a flat
// list under condensed month subheads.
//
// Data, ordering and month grouping: useNewslettersData (Gold's hook, which
// runs the shared buildItems). Search rule and its "> 6 issues" threshold:
// NewslettersGold.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useNewslettersData, usePageTitle, useCurrentMenuName } from '../../_shared/data.js'
import {
  PageHero, Split, Chapter, WipeList, WipeRow, Tag, Button, SearchField, ResultCount, EmptyState, Loading, yearText,
} from '../kit.jsx'
import { useScene, revealBatch, titleOnScroll } from '../motion.js'
import './Newsletters.css'

const SEARCH_FROM = 7                      // NewslettersGold shows its search above 6 issues
const PDF_RE = /\.pdf(?:$|[?#])/i
const word = (n) => (n === 1 ? 'issue' : 'issues')
const hintFor = (url) => (PDF_RE.test(url) ? ' (PDF, opens in a new tab)' : ' (opens in a new tab)')

/** One issue. No url = no file to open: the title is shown, but it is not a link (the kit's off row). */
function Issue({ n, latest, state }) {
  const meta = n.date || latest
    ? <>{n.date}{latest ? <Tag tone="royal">Latest</Tag> : null}</>
    : null
  return <WipeRow href={n.url} title={n.title || 'Newsletter'} meta={meta} cta="Read newsletter" external
                  srHint={n.url ? hintFor(n.url) : undefined} status="No file attached" state={state} />
}

export default function Newsletters({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Newsletters'
  usePageTitle(title)
  const items = useNewslettersData(data)          // null while loading, newest first
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  const all = items || []
  const latest = all[0] || null
  const q = query.trim().toLowerCase()
  const searchable = all.length >= SEARCH_FROM
  const searching = searchable && !!q

  // Gold's rule: title substring; month captions are re-derived from what matched,
  // so a search never leaves a month heading with nothing under it.
  const groups = useMemo(() => {
    const out = []
    ;(items || []).forEach((n, i) => {
      if (searching && String(n.title || '').toLowerCase().indexOf(q) === -1) return
      const last = out[out.length - 1]
      const row = { n, i }
      if (!last || last.label !== n.monthLabel) out.push({ label: n.monthLabel, rows: [row] })
      else last.rows.push(row)
    })
    return out
  }, [items, searching, q])
  const matched = groups.reduce((s, g) => s + g.rows.length, 0)
  const split = !searching && groups.length >= 2

  // Rows fade up in batches (opacity only, so they stay focusable); month
  // subheads rise once. Rebuilt on load and on entering/leaving search, not on
  // every keystroke.
  useScene(ref, (c, ctx) => {
    const r = ref.current
    revealBatch(r.querySelectorAll('.spl-nl-rows > li'), { y: 32, stagger: 0.06 })
    r.querySelectorAll('.spl-nl-month').forEach((el) => titleOnScroll(ctx, el))
  }, [items, searching])

  const yearLabel = yearText(club.selectedYearLabel)
  const clear = () => {
    setQuery('')
    const input = document.getElementById('spl-nl-search')
    if (input) input.focus()
  }

  const rowsOf = (g, inSplit) => (
    <WipeList className="spl-nl-rows" watch={g.rows.map((r) => r.i).join(',')}>
      {g.rows.map(({ n, i }) => {
        const day = parseInt(n.dayNum, 10)
        const state = inSplit
          ? { title: g.label, value: Number.isFinite(day) ? day : '—', from: 1, fmt: 'pad', caption: n.title || '', sub: n.date || '' }
          : null
        return <Issue key={'nl' + i} n={n} latest={i === 0 && all.length > 1} state={state} />
      })}
    </WipeList>
  )

  // In the Split the chapter's own <h2> is visually hidden (the panel shows the
  // month), so the visible month here is decoration; in the flat list it is the h2.
  const head = (g, inSplit) => {
    const H = inSplit ? 'p' : 'h2'
    return (
      <div className="spl-nl-head" aria-hidden={inSplit ? 'true' : undefined}>
        <H className="spl-nl-month" key={g.label}>{g.label}</H>
        <p className="spl-nl-n">{g.rows.length + ' ' + word(g.rows.length)}</p>
      </div>
    )
  }

  let body
  if (items === null) {
    body = <Loading label="Loading newsletters" />
  } else if (all.length === 0) {
    body = (
      <section className="spl-section"><div className="spl-x">
        <EmptyState
          title="Nothing published yet"
          message={'Issues of this club’s bulletin will appear here as they are filed' + (yearLabel ? ' for ' + yearLabel : '') + '.'}
        />
      </div></section>
    )
  } else if (matched === 0) {
    body = (
      <section className="spl-section"><div className="spl-x">
        <EmptyState
          title={'No issue matches “' + query.trim() + '”'}
          message="Check the spelling, or search for a word from the issue’s title."
          action={<Button variant="ghost" arrow={false} onClick={clear}>Show all issues</Button>}
        />
      </div></section>
    )
  } else if (split) {
    body = (
      <Split className="spl-nl-split" rail={groups.map((g) => g.label)} deps={[items]}>
        {groups.map((g, k) => (
          <Chapter
            key={g.label}
            id={'spl-nl-m' + k}
            title={g.label}
            className="spl-nl-ch"
            state={{
              value: g.rows.length, fmt: 'plain', suffix: ' ' + word(g.rows.length),
              caption: yearLabel ? 'Rotary year ' + yearLabel : '',
            }}
          >
            {head(g, true)}
            {rowsOf(g, true)}
          </Chapter>
        ))}
      </Split>
    )
  } else {
    body = (
      <section className="spl-section spl-nl-flat"><div className="spl-x">
        {groups.map((g) => (
          <div className="spl-nl-group" key={g.label}>
            {head(g, false)}
            {rowsOf(g, false)}
          </div>
        ))}
      </div></section>
    )
  }

  const showLatest = all.length > 1 && latest && latest.url
  return (
    <div className="spl-nl" ref={ref}>
      <PageHero
        title={title}
        eyebrow={club.clubDisplayName || undefined}
        lead={all.length ? 'Every issue the club has filed' + (yearLabel ? ' for ' + yearLabel : '') + ', newest first.' : undefined}
        stat={all.length ? { value: all.length, label: all.length === 1 ? 'Issue' : 'Issues' } : null}
      >
        {showLatest || searchable ? (
          <div className={'spl-nl-tools' + (showLatest && searchable ? ' is-pair' : '')}>
            {showLatest ? (
              <div className="spl-nl-latest">
                <p className="spl-nl-latest-k">Latest issue{latest.date ? ' · ' + latest.date : ''}</p>
                <p className="spl-nl-latest-t">{latest.title || 'Newsletter'}</p>
                <Button href={latest.url} variant="gold" external srHint={hintFor(latest.url)}>Read the latest issue</Button>
              </div>
            ) : null}
            {searchable ? (
              <div className="spl-nl-find">
                <SearchField id="spl-nl-search" label="Search issues by title" value={query} onChange={setQuery} placeholder="Issue title" />
                <ResultCount count={matched} total={all.length} noun={['issue', 'issues']} />
              </div>
            ) : null}
          </div>
        ) : null}
      </PageHero>
      {body}
    </div>
  )
}
