'use client'
// Port of YouthPartners.aspx + YouthPartners.aspx.cs.
//
// Bespoke static content page: the club's Youth Partners — sponsored Rotaract
// and Interact clubs. Uses SiteRotary (our header/footer) + the shared design
// system. The lists are static content (there is no public API endpoint for
// youth partners).
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

export const ROTARACT = [
  'Rotaract Club of Guindy',
  'Saveetha Medical College',
  'Saveetha School of Law',
  'Stanley Medical College',
]

export const INTERACT = [
  'ELM. Fabricius Hr. Secondary School',
  'Govt. Girls Model Hr. Sec. School',
  'Kannada Sangha Higher Secondary School Ayanavaram',
]

export default function YouthPartners() {
  useRotaryAnim([])

  return (
    <>
      <Breadcrumb eyebrow="New Generations Service" title="Youth Partners" crumbLabel="Youth Partners" />

      <section className="bg-canvas py-12">
        <div className="container-x space-y-14">

          {/* ══ Rotaract ══ */}
          <div>
            <div className="reveal mb-6">
              <img src="/images/logo/rotaract-logo.png" alt="Rotaract" className="h-12 w-auto sm:h-14" />
              <p className="mt-3 text-sm text-muted">Our sponsored Rotaract clubs &amp; college partners</p>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ROTARACT.map((name) => (
                <div className="reveal group h-full" key={name}>
                  <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-navy/10 bg-white p-6 text-center shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-rose-400/50 hover:shadow-cardHover">
                    <span className="mb-3 h-1.5 w-8 rounded-full bg-rose-500 transition-all duration-300 group-hover:w-12"></span>
                    <h3 className="font-heading text-[15px] font-bold leading-snug text-navy transition-colors duration-300 group-hover:text-rose-600">{name}</h3>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ══ Interact ══ */}
          <div>
            <div className="reveal mb-6">
              <img src="/images/logo/interact-logo.png" alt="Interact" className="h-12 w-auto sm:h-14" />
              <p className="mt-3 text-sm text-muted">Our sponsored Interact clubs in schools</p>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {INTERACT.map((name) => (
                <div className="reveal group h-full" key={name}>
                  <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-navy/10 bg-white p-6 text-center shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-sky-400/50 hover:shadow-cardHover">
                    <span className="mb-3 h-1.5 w-8 rounded-full bg-sky-500 transition-all duration-300 group-hover:w-12"></span>
                    <h3 className="font-heading text-[15px] font-bold leading-snug text-navy transition-colors duration-300 group-hover:text-sky-600">{name}</h3>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>
    </>
  )
}
