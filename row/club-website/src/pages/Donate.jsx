// Donate: the club's open donation campaigns (api/Controllers/DonationsController.cs, gap #13). Each card shows the
// goal and progress and links to the campaign's giving page, where the donor pays on the provider's hosted page.
import { useEffect, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import { getOrEmpty } from '../lib/http.js'
import { media, usePageTitle } from '../shared/rotaryPage.js'
import Breadcrumb, { EmptyState } from '../shared/Breadcrumb.jsx'
import Skeleton from '../shared/Skeleton.jsx'
import { formatMoney } from '../shared/money.js'

export default function Donate() {
  const club = useClub()
  const { clubId } = club
  const [campaigns, setCampaigns] = useState(null)

  useEffect(() => {
    if (!clubId) return undefined
    let cancelled = false
    getOrEmpty('/public/club/' + clubId + '/donation-campaigns').then((rows) => { if (!cancelled) setCampaigns(rows || []) })
    return () => { cancelled = true }
  }, [clubId])

  usePageTitle('Donate')

  return (
    <>
      <Breadcrumb eyebrow="Donate" title={club.clubDisplayName} crumbLabel="Donate" />
      <div className="container-x py-14 md:py-16">
        {campaigns === null ? (
          <Skeleton label="Loading campaigns" rows={3} />
        ) : campaigns.length === 0 ? (
          <EmptyState title="No open campaigns" message="The club is not running a fundraising campaign right now." />
        ) : (
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
            {campaigns.map((c) => {
              const p = c.progress || { raised: 0, donors: 0, percent: 0 }
              return (
                <article key={c.id} className="rounded-xl border border-navy/10 bg-white p-6" style={{ display: 'grid', gap: '0.75rem', alignContent: 'start' }}>
                  {c.imageUrl && <img src={media(c.imageUrl)} alt="" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8 }} />}
                  <h2 className="font-heading text-xl font-extrabold text-navy">{c.title}</h2>
                  {c.description && <p className="text-[15px] leading-relaxed text-muted" style={{ whiteSpace: 'pre-line' }}>{c.description}</p>}
                  <p className="font-heading text-navy" style={{ fontWeight: 700 }}>
                    {formatMoney(p.raised, c.currency)}
                    {c.goalAmount > 0 && <span className="text-muted" style={{ fontWeight: 400 }}> raised of {formatMoney(c.goalAmount, c.currency)}</span>}
                  </p>
                  {c.goalAmount > 0 && (
                    <div role="progressbar" aria-valuenow={Math.round(p.percent)} aria-valuemin={0} aria-valuemax={100}
                         style={{ height: 8, borderRadius: 4, background: 'rgba(23,69,143,.12)', overflow: 'hidden' }}>
                      <div className="bg-gold" style={{ height: '100%', width: Math.min(100, p.percent) + '%' }} />
                    </div>
                  )}
                  <p className="text-sm text-muted">
                    {p.donors === 1 ? '1 donor' : p.donors + ' donors'}{c.endDate ? ', until ' + c.endDate : ''}
                  </p>
                  {c.givingUrl && (
                    <a href={c.givingUrl} className="font-heading text-navy" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                      Give to this campaign
                    </a>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
