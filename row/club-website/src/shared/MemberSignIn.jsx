// Sign-in for members-only website pages: the member's ROW email and password (the same as in the ROW app).
import { useState } from 'react'
import { signInMember } from './websitePages.js'

export default function MemberSignIn({ clubId, clubName, onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInMember(clubId, email.trim(), password)
      onSignedIn()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const input = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-ink focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20'
  return (
    <section className="bg-canvas py-12">
      <div className="container-x">
        <form onSubmit={submit} className="mx-auto grid max-w-md gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-card sm:p-8">
          <div>
            <h2 className="font-heading text-2xl font-extrabold text-navy">Members only</h2>
            <p className="mt-1 text-[14px] text-muted">
              This page is for members of {clubName || 'the club'}. Sign in with the email and password you use in the ROW app.
            </p>
          </div>
          <label className="grid gap-1 text-sm font-semibold text-navy">Email
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Password
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></label>
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <button type="submit" disabled={busy} className="justify-self-start rounded-full bg-navy px-6 py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? 'Signing in' : 'Sign in'}
          </button>
          <p className="text-[12px] text-muted">No password yet, or forgot it? Set one from the sign-in screen of the ROW app.</p>
        </form>
      </div>
    </section>
  )
}
