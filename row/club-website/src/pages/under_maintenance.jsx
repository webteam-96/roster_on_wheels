// Port of under_maintenance.aspx + under_maintenance.aspx.cs.
//
// Standalone status page shown while the club website is temporarily
// offline for maintenance. Rendered inside the theme shell with a
// self-contained centered hero card (no breadcrumb).
import { useClub } from '../context/ClubProvider.jsx'
import { usePageTitle } from '../shared/rotaryPage.js'
import { useRotaryAnim } from '../shared/useRotaryAnim.js'

export default function UnderMaintenance() {
  const club = useClub()

  usePageTitle('Under Maintenance')

  useRotaryAnim([club.clubName])

  return (
    <>
      {/* ══ Under maintenance ══ */}
      <section className="relative flex min-h-[70vh] items-center overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-deep py-16 text-white sm:py-20">

        <div className="aurora opacity-40">
          <span className="aurora-band aurora-band-1"></span>
          <span className="aurora-band aurora-band-2"></span>
          <span className="aurora-band aurora-band-3"></span>
        </div>
        <div className="pointer-events-none absolute -right-10 top-1/2 -translate-y-1/2 opacity-[0.06]">
          <img src="images/logo/wheel.png" alt="" className="breadcrumb-wheel h-72 w-72" />
        </div>

        <div className="container-x relative">
          <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-card sm:p-10">

            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#FBF6EC]">
              <img src="images/logo/wheel.png" alt="Rotary" className="h-12 w-12" />
            </div>

            <p className="label-eyebrow mb-3 text-gold">Under Maintenance</p>

            <h1 className="font-heading text-2xl font-extrabold tracking-tight text-navy md:text-3xl">
              We&rsquo;ll be back soon
            </h1>

            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              The <strong className="text-navy">{club.clubName}</strong>
              {' '}website is undergoing some routine maintenance. We&rsquo;re polishing
              a few things and will have everything back up and running shortly.
            </p>

            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Thank you for your patience &mdash; please check back in a little while.
            </p>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <a href="/" className="btn-gold">Refresh Page</a>
            </div>

          </div>
        </div>
      </section>
    </>
  )
}
