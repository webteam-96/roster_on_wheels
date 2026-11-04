'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · DIRECTORY — every member, A to Z.
//
// Paper band after the ink hero. A glass letter bar (sticky under the header on
// desktop) filters by first letter; the hero search filters by name or
// profession; both combine and the member count rolls like an odometer. The
// list is grouped by letter: on desktop each group opens with a giant outlined
// letter that sticks in a left column and fills with azure, like a glass, as
// you scroll through its members (and leans with scroll speed). Cards are
// arched portraits (initials when there is no photo) + name + profession.
// Fields, search rule and copy follow the shared/Gold directory.
// ─────────────────────────────────────────────────────────────────────────────
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentMenuName, usePageTitle, useDirectoryData } from '../../_shared/data.js'
import { PageHero, Band, SearchField, Chips, Odometer, EmptyState, Loading, Portrait, Pill, clean } from '../kit.jsx'
import { usePageMotion, useScene, gsap, onScrollVelocity, onRevert, scrollToY } from '../motion.js'
import './Directory.css'

const OTHER = '#'
/** A–Z key of a name (accents folded: É -> E); digits, punctuation and other scripts file under #. */
const letterOf = (name) => {
  const ch = clean(name).charAt(0).normalize('NFD').charAt(0).toUpperCase()
  return /[A-Z]/.test(ch) ? ch : OTHER
}
const byKey = (a, b) => (a === OTHER) - (b === OTHER) || (a < b ? -1 : a > b ? 1 : 0)
const letterLabel = (k) => (k === OTHER ? 'Other names' : 'Names starting with ' + k)
const plural = (n) => (n === 1 ? 'member' : 'members')

export default function Directory({ data }) {
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Directory'
  usePageTitle(title)
  const members = useDirectoryData(data)            // null while loading
  const [q, setQ] = useState('')
  const [letter, setLetter] = useState('all')
  const dq = useDeferredValue(q)
  const ref = useRef(null), barRef = useRef(null), listRef = useRef(null), jump = useRef(false)

  // display order only: grouped by letter, then by name
  const roster = useMemo(() => (members || [])
    .map((m) => ({ ...m, n: clean(m.name), w: clean(m.work), k: letterOf(m.name) }))
    .sort((a, b) => byKey(a.k, b.k) || a.n.localeCompare(b.n, undefined, { sensitivity: 'base' })), [members])
  const needle = dq.trim().toLowerCase()
  const matched = useMemo(
    () => (needle ? roster.filter((m) => (m.n + ' ' + m.w).toLowerCase().includes(needle)) : roster),
    [roster, needle])
  // letters that have a match (the pressed one stays, so it never vanishes under the pointer)
  const letters = useMemo(() => {
    const ks = [...new Set(matched.map((m) => m.k))]
    if (letter !== 'all' && !ks.includes(letter)) ks.push(letter)
    return ks.sort(byKey)
  }, [matched, letter])
  const list = letter === 'all' ? matched : matched.filter((m) => m.k === letter)
  const groups = []
  list.forEach((m) => {
    const g = groups[groups.length - 1]
    if (g && g.k === m.k) g.items.push(m); else groups.push({ k: m.k, items: [m] })
  })

  const total = members ? members.length : 0
  const none = members !== null && total === 0

  usePageMotion(ref, [members, dq, letter])

  // the one moment: sticky letters fill like a glass through their group and lean with scroll speed
  useScene(ref, (c) => {
    if (!c.wide) return
    gsap.utils.toArray('.liq-dir-group').forEach((g) => {
      const ink = g.querySelector('.liq-dir-letter__ink')
      if (!ink) return
      gsap.fromTo(ink, { clipPath: 'inset(100% 0% 0% 0%)' }, {
        clipPath: 'inset(0% 0% 0% 0%)', ease: 'none',
        scrollTrigger: { trigger: g, start: 'clamp(top 62%)', end: 'clamp(bottom 62%)', scrub: true },
      })
    })
    const glyphs = gsap.utils.toArray('.liq-dir-letter__glyph')
    if (!glyphs.length) return
    const sets = glyphs.map((el) => gsap.quickSetter(el, 'skewX', 'deg'))
    let last = 0
    const off = onScrollVelocity(({ v }) => {
      const k = Math.round(-v * 90) / 10
      if (k !== last) { last = k; sets.forEach((s) => s(k)) }
    })
    onRevert(() => { off(); gsap.set(glyphs, { clearProps: 'transform' }) })
  }, [members, dq, letter])

  // sticky letters sit under the (wrapping) letter bar: publish its height
  useEffect(() => {
    const bar = barRef.current, root = ref.current
    if (!bar || !root || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => root.style.setProperty('--liq-dir-bh', bar.offsetHeight + 'px'))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [total])

  // a letter pressed deep in the list brings the list top back under the stuck bar
  const pick = (v) => { jump.current = true; setLetter(v) }
  useEffect(() => {
    if (!jump.current) return
    jump.current = false
    const bar = barRef.current, el = listRef.current
    if (!bar || !el || getComputedStyle(bar).position !== 'sticky') return
    const off = bar.getBoundingClientRect().bottom + 24
    const top = el.getBoundingClientRect().top
    if (top < off) scrollToY(window.scrollY + top - off)
  }, [letter])

  const clearSearch = () => {
    setQ('')
    const input = document.getElementById('liq-dir-q')
    if (input) input.focus()
  }
  const allLetters = () => {
    pick('all')
    const chip = barRef.current && barRef.current.querySelector('.liq-chip')
    if (chip) chip.focus()
  }

  const shownQ = dq.trim()
  const filtered = list.length !== total

  return (
    <div className="liq-dir" ref={ref}>
      <PageHero title={title}>
        {none ? null : (
          <SearchField id="liq-dir-q" label="Search members by name or profession" value={q} onChange={setQ}
                       placeholder="Search by name or profession" />
        )}
      </PageHero>

      <Band tone="paper" className="liq-dir-band" aria-label="Members">
        {members === null ? <Loading label="Loading members" />
          : none ? (
            <EmptyState as="h3" title="No members published" text="This club has not published its member directory yet." />
          ) : (
            <>
              <div className="liq-dir-bar" ref={barRef}>
                <Chips className="liq-dir-az" label="Show members by first letter" value={letter} onChange={pick}
                       options={[{ value: 'all', label: 'All' }, ...letters.map((k) => ({
                         value: k,
                         label: k === OTHER ? <><span aria-hidden="true">#</span><span className="liq-sr">Other names</span></> : k,
                       }))]} />
                <p className="liq-dir-count" aria-live="polite">
                  <span className="liq-dir-count__n"><Odometer value={String(list.length)} live /></span>
                  <span className="liq-dir-count__t">{filtered ? 'of ' + total + ' ' + plural(total) : plural(list.length)}</span>
                </p>
              </div>

              <div className="liq-dir-list" ref={listRef}>
                {groups.length ? groups.map((g) => (
                  <div className="liq-dir-group" key={g.k}>
                    <h3 className="liq-dir-letter">
                      <span className="liq-sr">{letterLabel(g.k)}</span>
                      <span className="liq-dir-letter__glyph" aria-hidden="true">
                        <span className="liq-dir-letter__line">{g.k}</span>
                        <span className="liq-dir-letter__ink">{g.k}</span>
                      </span>
                    </h3>
                    <ul className="liq-dir-grid">
                      {g.items.map((m) => (
                        <li className="liq-dir-card liq-rv" key={m.i}>
                          <Portrait src={m.img} name={m.n} className="liq-dir-card__pic" />
                          <div className="liq-dir-card__txt">
                            <h4 className="liq-dir-card__name">{m.n}</h4>
                            {m.w ? <p className="liq-dir-card__work">{m.w}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )) : (
                  <EmptyState as="h3" title="No members match"
                    text={shownQ
                      ? 'Nobody in the directory matches “' + shownQ + '”' + (letter !== 'all' ? ' under ' + (letter === OTHER ? 'other names' : letter) : '') + '.'
                      : 'No member names start with ' + letter + '.'}
                    action={(
                      <>
                        {shownQ ? <Pill variant="ink" onClick={clearSearch}>Clear search</Pill> : null}
                        {letter !== 'all' ? <Pill variant="line" onClick={allLetters}>Show all letters</Pill> : null}
                      </>
                    )} />
                )}
              </div>
            </>
          )}
      </Band>
    </div>
  )
}
