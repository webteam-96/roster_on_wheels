// Site search across the club's pages, events, projects and newsletters (API WebsiteExtrasService.SearchClubAsync).
// The query lives in the URL (?q=) so a search can be bookmarked and the back button works.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import Breadcrumb, { EmptyState } from '../shared/Breadcrumb.jsx'
import Skeleton from '../shared/Skeleton.jsx'
import { safeSitePath } from '../shared/websiteExtras.js'

const KIND = { page: 'Page', event: 'Event', project: 'Project', newsletter: 'Newsletter' }

export default function Search() {
  const { clubId } = useClub()
  const location = useLocation()
  const navigate = useNavigate()
  const q = (new URLSearchParams(location.search).get('q') || '').trim().slice(0, 80)
  const [draft, setDraft] = useState(q)
  const [hits, setHits] = useState(undefined) // undefined = loading, null = error

  useEffect(() => { setDraft(q) }, [q])

  useEffect(() => {
    if (!clubId || q.length < 2) { setHits([]); return }
    let cancelled = false
    setHits(undefined)
    api.searchSite(clubId, q).then((rows) => { if (!cancelled) setHits(rows) })
    return () => { cancelled = true }
  }, [clubId, q])

  function submit(e) {
    e.preventDefault()
    const next = draft.trim()
    if (next.length >= 2) navigate('/search?q=' + encodeURIComponent(next))
  }

  const links = (hits || []).flatMap((h) => {
    const href = safeSitePath(h.path)
    return href ? [{ ...h, href }] : []
  })

  return (
    <>
      <Breadcrumb eyebrow="" title="Search" crumbLabel="Search" />
      <section className="bg-canvas py-12">
        <div className="container-x" style={{ maxWidth: 820 }}>
          <form role="search" onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
            <label htmlFor="site-search" className="sr-only">Search this website</label>
            <input id="site-search" type="search" value={draft} onChange={(e) => setDraft(e.target.value)}
              minLength={2} maxLength={80} required placeholder="Search pages, events, projects and newsletters"
              style={{ flex: 1, minWidth: 0, height: 48, padding: '0 16px', border: '1px solid rgba(0,0,0,.25)', borderRadius: 6, background: 'transparent', color: 'inherit', fontSize: 16 }} />
            <button type="submit"
              style={{ height: 48, padding: '0 20px', borderRadius: 6, fontWeight: 600, border: '1px solid #17458F', background: '#17458F', color: '#F7F7F4' }}>Search</button>
          </form>

          <div style={{ marginTop: 32 }} aria-live="polite">
            {q.length < 2 ? (
              <p className="text-sm text-muted">Type at least two letters.</p>
            ) : hits === undefined ? (
              <Skeleton label="Searching" rows={3} />
            ) : hits === null ? (
              <EmptyState title="Search is not available" message="Please try again in a moment." />
            ) : links.length === 0 ? (
              <EmptyState title="No results" message={'Nothing on this website matches "' + q + '".'} />
            ) : (
              <>
                <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
                  {links.length} result{links.length === 1 ? '' : 's'} for "{q}"
                </p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid rgba(0,0,0,.12)' }}>
                  {links.map((h) => (
                    <li key={h.kind + h.href} style={{ borderBottom: '1px solid rgba(0,0,0,.12)' }}>
                      <a href={h.href} style={{ display: 'block', padding: '16px 4px', color: 'inherit', textDecoration: 'none' }}>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.7 }}>{KIND[h.kind] || 'Page'}</span>
                        <span style={{ display: 'block', marginTop: 4, fontSize: 17, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>{h.title}</span>
                        {h.snippet && <span style={{ display: 'block', marginTop: 4, fontSize: 14, opacity: 0.8 }}>{h.snippet}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
