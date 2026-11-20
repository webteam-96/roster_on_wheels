// Business directory (ROW only, member map + business directory gap agent): members' businesses across the club's
// district, approved by a club or district admin (api/public/club/{id}/business-directory). Built from the shared
// parts (Breadcrumb, EmptyState, Skeleton) so it sits in every theme's shell. The search lives in the URL (?q=), so a
// search can be shared and the back button works.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import Breadcrumb, { EmptyState } from '../shared/Breadcrumb.jsx'
import Skeleton from '../shared/Skeleton.jsx'
import { useRotaryAnim } from '../shared/useRotaryAnim.js'

const safeUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : null)

export default function BusinessDirectory() {
  const club = useClub()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [text, setText] = useState(q)
  const [listings, setListings] = useState(null)

  useEffect(() => {
    if (!club.clubId) return
    let cancelled = false
    setListings(null)
    api.getBusinessDirectory(club.clubId, q).then((rows) => { if (!cancelled) setListings(rows || []) })
    return () => { cancelled = true }
  }, [club.clubId, q])

  useRotaryAnim([listings ? listings.length : -1])

  const submit = (e) => {
    e.preventDefault()
    const t = text.trim()
    setParams(t ? { q: t } : {})
  }

  return (
    <>
      <Breadcrumb eyebrow="District" title="Business directory" crumbLabel="Business directory" titleClass="uppercase tracking-wide" />

      <section className="bg-canvas py-12">
        <div className="container-x space-y-8">
          <form onSubmit={submit} className="flex max-w-xl gap-2" role="search">
            <label htmlFor="bd-q" className="sr-only">Search the directory</label>
            <input id="bd-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={100}
              placeholder="Business, classification, member or club"
              className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-ink" />
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">Search</button>
          </form>

          {listings === null ? (
            <Skeleton label="Loading the directory" rows={4} />
          ) : listings.length === 0 ? (
            <EmptyState title="No businesses found" message={q ? 'Try a different search.' : 'Members of the district have not listed a business yet.'} />
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((l) => (
                <article key={l.id} className="reveal flex h-full flex-col rounded-2xl border border-gray-100 bg-white p-5">
                  {l.classification && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l.classification}</p>}
                  <h2 className="font-heading text-base font-bold leading-snug text-navy">{l.businessName}</h2>
                  <p className="mt-1 text-sm text-ink/80">{l.memberName}, {l.clubName}</p>
                  {l.description && <p className="mt-2 text-[13px] leading-relaxed text-muted">{l.description}</p>}
                  <div className="mt-auto space-y-1 pt-3 text-sm">
                    {safeUrl(l.website) && (
                      <a href={safeUrl(l.website)} target="_blank" rel="noopener noreferrer nofollow" className="block break-all font-semibold text-navy underline">
                        {l.website}
                      </a>
                    )}
                    {l.phone && <a href={'tel:' + l.phone.replace(/[^0-9+]/g, '')} className="block text-ink/70">{l.phone}</a>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
