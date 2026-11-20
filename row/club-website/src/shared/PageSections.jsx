// Renders a website builder page (custom page or home layout) inside the club's theme shell. The API has already
// checked every section: rich text sanitised, embeds rebuilt as YouTube / Vimeo / Google Maps player URLs, picture
// URLs limited to site paths and https. Data widgets read live ROW data through api/clubService.js, the same calls
// the theme pages make. Styling sticks to the shared theme tokens (container-x, bg-canvas, text-navy, text-ink,
// text-muted, shadow-card), so every theme recolours it.
import { useEffect, useRef, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import { http } from '../lib/http.js'
import { media, externalUrl } from './rotaryPage.js'
import { formatDate } from './homeData.js'
import { EmptyState } from './Breadcrumb.jsx'
import Skeleton from './Skeleton.jsx'

function Card({ href, img, title, meta }) {
  const body = (
    <>
      {img ? <img src={img} alt="" loading="lazy" className="h-44 w-full object-cover" /> : null}
      <div className="p-4">
        <p className="font-heading font-bold leading-snug text-navy">{title}</p>
        {meta ? <p className="mt-1 text-[13px] text-muted">{meta}</p> : null}
      </div>
    </>
  )
  return (
    <li className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      {href ? <a href={href} className="block">{body}</a> : body}
    </li>
  )
}

const grid = 'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'

/** Loads one widget's rows; undefined while loading. */
function useRows(load, deps) {
  const [rows, setRows] = useState(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    Promise.resolve(load()).then((r) => { if (!cancelled) setRows(r || []) }, () => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return rows
}

function DataWidget({ section }) {
  const { clubId, selectedYearId } = useClub()
  const limit = section.limit || 6
  const rows = useRows(async () => {
    switch (section.type) {
      case 'events': return api.getUpcomingEvents(clubId, limit)
      case 'officers': return api.getBod(clubId, selectedYearId)
      case 'news': return api.getNewsletters(clubId, selectedYearId, limit)
      case 'projects': return ((await api.getProjects(clubId, selectedYearId)) || []).filter((p) => !p.parentProjectId)
      case 'gallery': return ((await api.getGallery(clubId, selectedYearId, 1, limit)) || {}).photos || []
      case 'sponsors': return api.getAdvertisements(clubId, selectedYearId)
      default: return []
    }
  }, [section.type, clubId, selectedYearId, limit])

  if (rows === undefined) return <Skeleton label="Loading" rows={2} />
  const top = rows.slice(0, limit)
  if (!top.length) return <EmptyState title="Nothing to show yet" message="Please check back soon." />

  switch (section.type) {
    case 'events':
      return <ul className={grid}>{top.map((e) => (
        <Card key={e.id} href={'/event?id=' + e.id} img={media(e.imagePath)} title={e.title}
              meta={[e.eventDate ? formatDate(new Date(e.eventDate)) : '', e.venue].filter(Boolean).join(' | ')} />
      ))}</ul>
    case 'officers':
      return <ul className={grid}>{top.map((b) => (
        <Card key={b.id || b.memberId} img={media(b.profilePhotoPath)} title={b.memberName} meta={b.designation} />
      ))}</ul>
    case 'news':
      return <ul className={grid}>{top.map((n) => (
        <Card key={n.id} href={n.filePath ? media(n.filePath) : externalUrl(n.linkUrl) || '/newsletters'} title={n.title}
              meta={n.publishDateTime ? formatDate(new Date(n.publishDateTime)) : ''} />
      ))}</ul>
    case 'projects':
      return <ul className={grid}>{top.map((p) => (
        <Card key={p.id} href={'/project?pid=' + p.id} img={media(p.primaryPhotoPath)} title={p.title} meta={p.moduleName} />
      ))}</ul>
    case 'gallery':
      return (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {top.map((p, i) => (
            <li key={p.id || i}><a href="/gallery"><img src={media(p.imagePath)} alt={p.Title || p.title || ''} loading="lazy" className="aspect-square w-full rounded-xl object-cover" /></a></li>
          ))}
        </ul>
      )
    case 'sponsors':
      return (
        <ul className="flex flex-wrap items-center gap-8">
          {top.map((a) => {
            const img = <img src={media(a.advertisementImagePath)} alt={a.description || 'Sponsor'} loading="lazy" className="h-20 w-auto max-w-[220px] object-contain" />
            const link = externalUrl(a.linkUrl)
            return <li key={a.id}>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{img}</a> : img}</li>
          })}
        </ul>
      )
    default:
      return null
  }
}

/** Enquiry form: posts to the public join endpoint (rate limit, honeypot, minimum fill time, daily cap there). */
function ContactForm() {
  const { clubId } = useClub()
  const shownAt = useRef(Date.now())
  const [form, setForm] = useState({ name: '', email: '', message: '', consent: false, website: '' })
  const [state, setState] = useState({ busy: false, done: '', error: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setState({ busy: true, done: '', error: '' })
    try {
      const res = await http.post('/public/join', {
        clubId, name: form.name, email: form.email, message: form.message, consent: form.consent,
        website: form.website, elapsedMs: Date.now() - shownAt.current,
      })
      setState({ busy: false, done: (res.data && res.data.message) || 'Thank you.', error: '' })
    } catch (err) {
      const msg = err && err.response && err.response.data && err.response.data.message
      setState({ busy: false, done: '', error: msg || 'Sending failed. Please try again later.' })
    }
  }

  if (state.done) return <p role="status" className="text-[15px] text-ink">{state.done}</p>
  const input = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-ink focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20'
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-2xl gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-card sm:p-10">
      <label className="grid gap-1 text-sm font-semibold text-navy">Your name
        <input required maxLength={150} value={form.name} onChange={set('name')} className={input} autoComplete="name" /></label>
      <label className="grid gap-1 text-sm font-semibold text-navy">Your email
        <input required type="email" maxLength={200} value={form.email} onChange={set('email')} className={input} autoComplete="email" /></label>
      <label className="grid gap-1 text-sm font-semibold text-navy">Message
        <textarea maxLength={1000} rows={5} value={form.message} onChange={set('message')} className={input} /></label>
      {/* honeypot: hidden from people, filled by bots */}
      <input tabIndex={-1} aria-hidden="true" autoComplete="off" value={form.website} onChange={set('website')} className="hidden" />
      <label className="flex items-start gap-2 text-[13px] text-muted">
        <input type="checkbox" required checked={form.consent} onChange={set('consent')} className="mt-1" />
        I agree that the club keeps my details to reply to me.</label>
      {state.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      <button type="submit" disabled={state.busy} className="justify-self-start rounded-full bg-navy px-6 py-3 text-sm font-bold text-white disabled:opacity-60">
        {state.busy ? 'Sending' : 'Send'}
      </button>
    </form>
  )
}

function Section({ section }) {
  let body = null
  switch (section.type) {
    case 'richtext':
      // Cleaned by the API (WebsitePageRules.CleanHtml) on save and on read, and by lib/http.js (DOMPurify) on fetch.
      body = section.html ? <div className="wb-rich text-[16px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: section.html }} /> : null
      break
    case 'image': {
      if (!section.url) return null
      const img = <img src={media(section.url)} alt={section.caption || ''} loading="lazy" className="w-full rounded-2xl object-cover" />
      const link = section.linkUrl && (section.linkUrl.startsWith('/') ? section.linkUrl : externalUrl(section.linkUrl))
      body = (
        <figure>
          {link ? <a href={link} {...(/^https?:/i.test(link) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{img}</a> : img}
          {section.caption ? <figcaption className="mt-2 text-[13px] text-muted">{section.caption}</figcaption> : null}
        </figure>
      )
      break
    }
    case 'file': {
      // Members-only files arrive as a short-lived signed link, and only for a signed-in member.
      if (!section.url) return null
      const href = media(section.url)
      body = (
        <a href={href} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-2 rounded-full border-2 border-navy px-5 py-2.5 text-sm font-bold text-navy">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          {section.caption || 'Open file'}
        </a>
      )
      break
    }
    case 'embed':
      if (!/^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|www\.google\.com\/maps\/embed)/.test(section.url || '')) return null
      body = (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl">
          <iframe src={section.url} title={section.title || 'Embedded video or map'} loading="lazy" allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                  className="absolute inset-0 h-full w-full border-0" />
        </div>
      )
      break
    case 'contact':
      body = <ContactForm />
      break
    default:
      body = <DataWidget section={section} />
  }
  return (
    <section className="py-12 odd:bg-canvas">
      <div className="container-x">
        {section.title ? <h2 className="mb-6 font-heading text-2xl font-extrabold text-navy sm:text-3xl">{section.title}</h2> : null}
        {body}
      </div>
    </section>
  )
}

// Editor (Quill) output: give it readable rhythm in every theme; colours come from the theme via currentColor.
const RICH_CSS = `
.wb-rich *{max-width:100%;box-sizing:border-box}
.wb-rich p{margin:.75rem 0}
.wb-rich h1,.wb-rich h2,.wb-rich h3{margin:1.5rem 0 .5rem;font-weight:800;line-height:1.2}
.wb-rich h1{font-size:1.9rem}.wb-rich h2{font-size:1.5rem}.wb-rich h3{font-size:1.2rem}
.wb-rich ul,.wb-rich ol{margin:.75rem 0;padding-left:1.5rem}
.wb-rich ul{list-style:disc}.wb-rich ol{list-style:decimal}
.wb-rich a{text-decoration:underline}
.wb-rich img{height:auto;border-radius:12px}
.wb-rich .ql-align-center{text-align:center}.wb-rich .ql-align-right{text-align:right}
`

export default function PageSections({ page }) {
  if (!page.sections.length) {
    return <section className="py-12"><div className="container-x"><EmptyState title="Nothing here yet" message="This page has no content yet." /></div></section>
  }
  return <><style>{RICH_CSS}</style>{page.sections.map((s) => <Section key={s.id} section={s} />)}</>
}
