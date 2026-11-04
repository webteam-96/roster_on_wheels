'use client'
// Meetings and upcoming speakers. ROW only: the RIZones club site has no such page, so it is built from the shared
// pages' own parts (Breadcrumb, EmptyState, the event-card styling) and fits every theme's shell the same way.
import Breadcrumb, { EmptyState } from '@/themes/shared/Breadcrumb.jsx'
import { formatDate, plainText } from '@/themes/shared/homeData.js'
import { media, wheelFallback } from '@/themes/shared/rotaryPage.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useClub } from '@/site/ClubContext.jsx'

function dateOf(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : formatDate(d)
}

export default function Meetings({ data }) {
  const club = useClub()
  const meetings = [...(data.meetings || [])]
    .sort((a, b) => new Date(b.projectDate || 0).getTime() - new Date(a.projectDate || 0).getTime())
  const speakers = data.speakers || []

  useRotaryAnim([meetings.length, speakers.length])

  return (
    <>
      <Breadcrumb eyebrow="Club" title="Meetings" crumbLabel="Meetings" titleClass="uppercase tracking-wide" />

      <section className="bg-canvas py-12">
        <div className="container-x space-y-12">
          {speakers.length > 0 && (
            <div>
              <h2 className="mb-6 font-heading text-2xl font-extrabold text-navy">Upcoming speakers</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {speakers.map((s, i) => (
                  <article key={i} className="reveal flex h-full gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
                    <img src={media(s.photoPath) || '/images/logo/wheel.png'} alt="" onError={wheelFallback}
                      className="h-16 w-16 shrink-0 rounded-full bg-white object-cover" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{dateOf(s.meetingDate)}</p>
                      <h3 className="font-heading text-base font-bold leading-snug text-navy">{s.name}</h3>
                      {s.topic && <p className="mt-1 text-sm text-ink/80">{s.topic}</p>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-6 font-heading text-2xl font-extrabold text-navy">
              Meetings{club.selectedYearLabel ? ' ' + club.selectedYearLabel : ''}
            </h2>
            {meetings.length === 0 ? (
              <EmptyState title="No meetings yet" message="Meetings for the selected year will appear here once they are recorded." />
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {meetings.map((m) => (
                  <article key={m.id + '@' + m.yearId} className="reveal h-full">
                    <a href={'/project?pid=' + m.id + '&pr=CE'} className="group flex h-full flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-cardHover">
                      <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{dateOf(m.projectDate)}</span>
                      <h3 className="line-clamp-2 font-heading text-base font-bold leading-snug text-navy group-hover:text-gold-cta">{m.title}</h3>
                      {m.description && <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{plainText(m.description)}</p>}
                      {m.location && <p className="mt-auto pt-3 text-xs font-semibold text-ink/70">{m.location}</p>}
                    </a>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
