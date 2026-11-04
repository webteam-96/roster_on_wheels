'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Directors — the board for the selected Rotary year, told as the
// theme's split: the sticky royal panel ticks 01 → 02 → … with each director's
// role and name as their card crosses the middle of the screen. President and
// secretary lead on night plates (DirectorsGold's rule); the rest of the board
// follows in the hook's order (the club's own designation order). Portraits open
// through the iris / diagonal wipe; long bios expand in place.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useDirectorsData, usePageTitle, useCurrentMenuName, plainText } from '../../_shared/data.js'
import { PageHero, Split, Chapter, fig, Button, SearchField, ResultCount, EmptyState, Loading, PersonPhoto, excerpt, yearText } from '../kit.jsx'
import { useScene, useRefreshOnImages, refreshSoon, gsap, photosIn, revealBatch, titleOnScroll } from '../motion.js'
import './Directors.css'

/** The offices that lead the page, in this order. A club that files neither gets the board only. */
const LEAD = ['president', 'secretary']
const LEAD_T = 'Leading the club'
const BOARD_T = 'The board'

const stateOf = (d, n, title) => ({ title, value: n, from: n - 1, fmt: 'pad', caption: d.role, sub: d.name })

function Director({ d, n, title, lead }) {
  const [open, setOpen] = useState(false)
  const cut = lead ? 320 : 220
  const long = d.text.length > cut
  const bioId = 'spl-bod-bio-' + d._i
  return (
    <li className={'spl-bod-item' + (lead ? ' spl-bod-item--lead spl-on-dark' : '')} {...fig(stateOf(d, n, title))}>
      {lead ? <span className="spl-bod-ring" aria-hidden="true"><i /></span> : null}
      <div className="spl-bod-photo" aria-hidden="true">
        <PersonPhoto src={d.img} name={d.name} alt="" className="spl-bod-img" monoClass="spl-bod-mono" width="400" height="500" />
      </div>
      <div className="spl-bod-head">
        {d.role ? <p className="spl-bod-role">{d.role}</p> : null}
        <h3 className="spl-bod-name" key={d.name}>{d.name}</h3>
      </div>
      {d.text ? (
        <div className="spl-bod-text">
          <p className="spl-bod-bio" id={bioId}>{open || !long ? d.text : excerpt(d.text, cut)}</p>
          {long ? (
            <Button variant={lead ? 'light' : 'ghost'} arrow={false} className="spl-bod-more"
                    aria-expanded={open ? 'true' : 'false'} aria-controls={bioId}
                    onClick={() => { setOpen((o) => !o); refreshSoon() }}>
              {open ? 'Show less' : 'Read more'}<span className="spl-sr">{' about ' + d.name}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export default function Directors({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Directors'
  usePageTitle(title)
  const directors = useDirectorsData(data)          // null while loading
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  // President + secretary lead (DirectorsGold's split); numbers follow the page order, so a search never renumbers.
  const { leads, rest, order } = useMemo(() => {
    const all = (directors || []).map((d) => ({ ...d, text: plainText(d.bio) }))
    const taken = new Set()
    const leads = []
    for (const kw of LEAD) {
      const i = all.findIndex((d, k) => !taken.has(k) && String(d.role || '').toLowerCase().indexOf(kw) >= 0)
      if (i >= 0) { taken.add(i); leads.push(all[i]) }
    }
    const rest = all.filter((_, k) => !taken.has(k))
    return { leads, rest, order: new Map(leads.concat(rest).map((d, k) => [d, k + 1])) }
  }, [directors])

  // Name / designation filter, as the shared Directors page does it.
  const q = query.trim().toLowerCase()
  const hit = (d) => !q || (String(d.name || '') + ' ' + String(d.role || '')).toLowerCase().indexOf(q) !== -1
  const shownLeads = leads.filter(hit)
  const shownRest = rest.filter(hit)
  const total = leads.length + rest.length
  const shown = shownLeads.length + shownRest.length
  const rail = [shownLeads.length && LEAD_T, shownRest.length && BOARD_T].filter(Boolean)
  const key = String(club.selectedYearId) + '|' + shownLeads.concat(shownRest).map((d) => d._i + ':' + d.name + ':' + d.role).join('|')
  const year = yearText(club.selectedYearLabel)

  useRefreshOnImages(ref, [key])
  useScene(ref, (c, ctx) => {
    const r = ref.current
    revealBatch(r.querySelectorAll('.spl-bod-item'))
    photosIn(r.querySelectorAll('.spl-bod-photo'))
    r.querySelectorAll('.spl-bod-item--lead .spl-bod-name').forEach((el) => titleOnScroll(ctx, el))
    // The sample's orbit: the lead plates' sky ring turns with the scroll.
    r.querySelectorAll('.spl-bod-ring').forEach((ring) => {
      gsap.fromTo(ring, { rotation: -80 }, { rotation: 80, ease: 'none', scrollTrigger: { trigger: ring.parentElement, start: 'top bottom', end: 'bottom top', scrub: 1 } })
    })
  }, [key])

  const clear = () => {
    setQuery('')
    const el = document.getElementById('spl-bod-search')
    if (el) el.focus()
  }

  const item = (d, t, lead) => <Director key={d._i + '|' + d.name} d={d} n={order.get(d)} title={t} lead={lead} />

  return (
    <div className="spl-bod" ref={ref}>
      <PageHero title={title} eyebrow={'Board of directors' + (year ? ' · ' + year : '')}
                stat={total ? { value: total, label: 'On the board' } : null}>
        {rest.length > 0 ? (
          <div className="spl-bod-find">
            <SearchField id="spl-bod-search" label="Search the board" placeholder="Name or designation" value={query} onChange={setQuery} />
            <ResultCount count={shown} total={total} noun={['director', 'directors']} />
          </div>
        ) : null}
      </PageHero>

      {directors === null ? (
        <section className="spl-section"><div className="spl-x"><Loading label="Loading the board" /></div></section>
      ) : total === 0 ? (
        <section className="spl-section"><div className="spl-x">
          <EmptyState title="No board published" message="This club has not published its board of directors for the selected Rotary year." />
        </div></section>
      ) : shown === 0 ? (
        <section className="spl-section"><div className="spl-x">
          <EmptyState title="No match" message={'No director matches “' + query.trim() + '”.'}
                      action={<Button variant="royal" arrow={false} onClick={clear}>Clear search</Button>} />
        </div></section>
      ) : (
        <Split rail={rail} deps={[key]}>
          {shownLeads.length ? (
            <Chapter id="spl-bod-lead" title={LEAD_T} state={stateOf(shownLeads[0], order.get(shownLeads[0]), LEAD_T)}>
              <ul className="spl-bod-list">{shownLeads.map((d) => item(d, LEAD_T, true))}</ul>
            </Chapter>
          ) : null}
          {shownRest.length ? (
            <Chapter id="spl-bod-board" title={BOARD_T} state={stateOf(shownRest[0], order.get(shownRest[0]), BOARD_T)}>
              <ul className="spl-bod-list">{shownRest.map((d) => item(d, BOARD_T, false))}</ul>
            </Chapter>
          ) : null}
        </Split>
      )}
    </div>
  )
}
