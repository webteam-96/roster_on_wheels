// Member stories an editor approved (ROW gap #6, api/public/club/{id}/stories). Text only, no author contact data.
import { useEffect, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import Breadcrumb, { EmptyState } from '../shared/Breadcrumb.jsx'
import { formatDate } from '../shared/homeData.js'
import Skeleton from '../shared/Skeleton.jsx'

export default function Stories() {
  const { clubId } = useClub()
  const [items, setItems] = useState(null)

  useEffect(() => {
    if (!clubId) return
    let cancelled = false
    api.getStories(clubId).then((rows) => { if (!cancelled) setItems(rows) })
    return () => { cancelled = true }
  }, [clubId])

  return (
    <>
      <Breadcrumb eyebrow="" title="Club Stories" crumbLabel="Stories" />
      <section className="bg-canvas py-12">
        <div className="container-x mx-auto max-w-3xl">
          {items === null ? <Skeleton label="Loading stories" rows={3} />
            : items.length === 0 ? <EmptyState title="No stories yet" message="Stories from our members appear here once the club has published them." />
            : (
              <div className="space-y-10">
                {items.map((s) => (
                  <article key={s.id} className="border-b border-navy/10 pb-8 last:border-0">
                    <h2 className="font-heading text-2xl font-bold text-navy">{s.title}</h2>
                    {s.publishedDate && <p className="mt-1 text-sm text-muted">{formatDate(new Date(s.publishedDate))}</p>}
                    <p className="mt-4 whitespace-pre-line leading-relaxed text-ink">{s.body}</p>
                  </article>
                ))}
              </div>
            )}
          <p className="mt-10 text-sm text-muted">
            Want these by email? <a href="/bulletin" className="font-semibold text-navy underline underline-offset-4">Get the club bulletin</a>.
          </p>
        </div>
      </section>
    </>
  )
}
