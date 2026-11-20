// Third-party content of a club site (website extras): Google Analytics and the social feeds. Nothing third-party
// loads until the visitor allows it; the choice is kept in this browser (shared/websiteExtras.js).
import { useEffect, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import { CONSENT_EVENT, hasFeeds, readConsent, saveConsent, validGaId } from './websiteExtras.js'

const storage = () => (typeof window === 'undefined' ? null : window.localStorage)

/** The visitor's choice ('all' | 'essential' | null) and a setter that tells every other component. */
export function useConsent() {
  const [consent, setConsent] = useState(() => { const s = storage(); return s ? readConsent(s) : null })
  useEffect(() => {
    const onChange = (e) => setConsent(e.detail)
    window.addEventListener(CONSENT_EVENT, onChange)
    return () => window.removeEventListener(CONSENT_EVENT, onChange)
  }, [])
  const choose = (value) => {
    const s = storage()
    if (s) saveConsent(s, value)
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }))
  }
  return [consent, choose]
}

/** This club's extras, fetched once per club. */
export function useWebsiteExtras() {
  const { clubId } = useClub()
  const [extras, setExtras] = useState(undefined) // undefined = loading
  useEffect(() => {
    if (!clubId) return
    let cancelled = false
    api.getWebsiteExtras(clubId).then((e) => { if (!cancelled) setExtras(e) })
    return () => { cancelled = true }
  }, [clubId])
  return extras
}

function loadGa(id) {
  if (document.getElementById('row-ga')) return
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  window.gtag('config', id, { anonymize_ip: true })
  const s = document.createElement('script')
  s.id = 'row-ga'
  s.async = true
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id)
  document.head.appendChild(s)
}

/**
 * Mounted once by App: asks the visitor before any third-party content (only when the club has some), then starts
 * Google Analytics with the club's own measurement ID.
 */
export default function SiteThirdParty() {
  const extras = useWebsiteExtras()
  const [consent, choose] = useConsent()
  const ga = validGaId(extras && extras.gaMeasurementId)

  useEffect(() => { if (ga && consent === 'all') loadGa(ga) }, [ga, consent])

  if (!extras || consent !== null || !(ga || hasFeeds(extras))) return null
  return (
    <div role="dialog" aria-label="Cookie settings" aria-live="polite"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, background: '#F7F7F4', color: '#1d1d1b', borderTop: '1px solid rgba(0,0,0,.15)', padding: '14px 16px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 14, flex: '1 1 320px' }}>
          This site uses only the cookies it needs to work. Visitor statistics (Google Analytics) and social media feeds
          (Facebook, Instagram, X) set their own cookies, so they load only if you allow them.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => choose('essential')}
            style={{ padding: '8px 16px', borderRadius: 999, border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 14 }}>
            Essential only
          </button>
          <button type="button" onClick={() => choose('all')}
            style={{ padding: '8px 16px', borderRadius: 999, border: '1px solid #17458F', background: '#17458F', color: '#F7F7F4', fontWeight: 600, fontSize: 14 }}>
            Allow all
          </button>
        </div>
      </div>
    </div>
  )
}
