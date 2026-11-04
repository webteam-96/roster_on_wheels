'use client'
// Port of SisterClubs.aspx + SisterClubs.aspx.cs.
//
// Bespoke static content page: the club's international Sister Clubs.
// Uses SiteRotary (our header/footer) + the shared design system.
// The list is static content (there is no public API endpoint for sister clubs).
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

export const CLUBS = [
  { Name: 'RC Alor Star', Rid: 'RID 3300, Malaysia' },
  { Name: 'RC Grand Baie', Rid: 'RID 9220, Mauritius' },
  { Name: 'RC Penang', Rid: 'RID 3300, Malaysia' },
  { Name: 'RC Colombo', Rid: 'RID 3220, Sri Lanka' },
  { Name: 'RC Port Blair', Rid: 'RID 3291, India' },
  { Name: 'RC Alexandria', Rid: 'RID 2450, Egypt' },
]

export default function SisterClubs() {
  useRotaryAnim([])

  return (
    <>
      <Breadcrumb eyebrow="International Fellowship" title="Sister Clubs" crumbLabel="Sister Clubs" />

      {/* ══ Sister clubs grid ══ */}
      <section className="bg-canvas py-12">
        <div className="container-x">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="reveal text-sm leading-relaxed text-muted md:text-base">We are proud to partner with Rotary clubs across the world &mdash; building international friendship, goodwill and service beyond borders.</p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CLUBS.map((c) => (
              <div className="reveal group h-full" key={c.Name + c.Rid}>
                <div className="flex h-full flex-col items-center rounded-2xl border border-navy/10 bg-white p-6 text-center shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-gold/40 hover:shadow-cardHover">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-light text-navy shadow-lg shadow-gold/30 transition-transform duration-300 group-hover:scale-110">
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>
                  </div>
                  <h3 className="font-heading text-lg font-bold leading-snug text-navy transition-colors duration-300 group-hover:text-gold-cta">{c.Name}</h3>
                  <p className="mt-1.5 text-sm font-medium text-muted">{c.Rid}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
