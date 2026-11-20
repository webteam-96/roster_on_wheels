// Bulletin sign-up for people who are not members (ROW gap #6). Double opt-in: the API emails a confirm link and
// sends nothing else until it is clicked. The "website" field is a honeypot people never see.
import { useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import Breadcrumb from '../shared/Breadcrumb.jsx'

export default function BulletinSignup() {
  const { clubId, clubDisplayName } = useClub()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState({ busy: false, done: '', error: '' })

  async function submit(e) {
    e.preventDefault()
    setState({ busy: true, done: '', error: '' })
    const res = await api.subscribeBulletin(clubId, { email: email.trim(), name: name.trim() || null, website })
    setState(res.ok ? { busy: false, done: res.message, error: '' } : { busy: false, done: '', error: res.message })
  }

  const field = 'mt-1 w-full rounded-md border border-navy/20 bg-white/80 px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-navy/30'
  return (
    <>
      <Breadcrumb eyebrow="" title="Club Bulletin" crumbLabel="Bulletin" />
      <section className="bg-canvas py-12">
        <div className="container-x mx-auto max-w-xl">
          <p className="text-ink">
            Get the {clubDisplayName || 'club'} bulletin by email: club news, member stories and upcoming events.
            You do not need to be a member.
          </p>
          {state.done ? (
            <p role="status" className="mt-8 rounded-md border border-navy/15 p-4 text-ink">{state.done}</p>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
              <label className="block text-sm font-semibold text-navy">Email address
                <input type="email" required autoComplete="email" maxLength={254} value={email}
                  onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
              <label className="block text-sm font-semibold text-navy">Name (optional)
                <input type="text" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              <label aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
              <label className="flex items-start gap-3 text-sm text-ink">
                <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
                <span>I agree to receive this club&apos;s email bulletin. I can unsubscribe at any time with the link in each email.</span>
              </label>
              {state.error && <p role="alert" className="text-sm font-semibold text-red-700">{state.error}</p>}
              <button type="submit" disabled={state.busy || !agreed || !email.trim()}
                className="rounded-full bg-navy px-6 py-3 font-semibold text-white disabled:opacity-50">
                {state.busy ? 'Sending...' : 'Subscribe'}
              </button>
              <p className="text-xs text-muted">We send you an email to confirm. Nothing else is sent until you confirm.</p>
            </form>
          )}
        </div>
      </section>
    </>
  )
}
