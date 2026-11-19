// Port of ExpiredWebsite.aspx + ExpiredWebsite.aspx.cs.
//
// Standalone full-screen status page shown when a club's website subscription
// or free trial has lapsed (tenant status "expired" / "trial_expired"). Does not
// use the site master (no nav to gated pages) and opts out of the expiry gate —
// the expired page must never redirect to itself (App.jsx routes it OUTSIDE
// <Gate>, which is the BypassExpiryGate override).
//
// PORT NOTE: the original is a whole HTML document (its own <head>, its own
// <style>). React can only render inside #root, so the <style> block and the
// Google-Fonts <link>s are emitted in the body — browsers apply both from there
// — and the static <title> becomes usePageTitle().
import { useEffect, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import { media, usePageTitle } from '../shared/rotaryPage.js'
import { getOrNull } from '../lib/http.js'
import * as api from '../api/clubService.js'
import { useRotaryAnim } from '../shared/useRotaryAnim.js'
import { appSettings } from '../config.js'

const CSS = `
        :root{ --gold:#F7A600; --gold-d:#E08C00; --gold-l:#FFB81C; --navy:#0A2472; --navy-d:#0B1F5E; --ink:#1A1A2E; --muted:#6B7280; }
        *{ box-sizing:border-box; }
        html,body{ margin:0; height:100%; }
        body{ font-family:'Figtree',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }

        .stage{ position:relative; min-height:100vh; display:flex; align-items:center; justify-content:center;
            padding:48px 18px; overflow:hidden;
            background:radial-gradient(1100px 620px at 50% -12%, #163e96 0%, var(--navy) 42%, var(--navy-d) 100%); }
        /* warm glow + soft vignette */
        .vignette{ position:absolute; inset:0; pointer-events:none;
            background:radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(5,14,46,.55)); }
        /* faint dotted texture */
        .dots{ position:absolute; inset:0; pointer-events:none; opacity:.5;
            background-image:radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px); background-size:26px 26px;
            -webkit-mask-image:radial-gradient(70% 60% at 50% 45%, #000, transparent 75%);
                    mask-image:radial-gradient(70% 60% at 50% 45%, #000, transparent 75%); }
        /* drifting wheels */
        .wheel{ position:absolute; pointer-events:none; }
        .wheel--r{ right:-130px; top:50%; width:440px; opacity:.06; animation:drift 11s ease-in-out infinite; }
        .wheel--l{ left:-160px; bottom:-90px; width:330px; opacity:.045; animation:spin 60s linear infinite; }
        @keyframes drift{ 0%,100%{ transform:translateY(-50%) rotate(0); } 50%{ transform:translateY(-56%) rotate(12deg); } }
        @keyframes spin{ to{ transform:rotate(360deg); } }

        .card{ position:relative; width:100%; max-width:530px; animation:rise .7s cubic-bezier(.22,1,.36,1) both; }
        @keyframes rise{ from{ opacity:0; transform:translateY(22px) scale(.985); } to{ opacity:1; transform:none; } }
        .accent{ height:6px; border-radius:26px 26px 0 0; background:linear-gradient(90deg,var(--gold-d),var(--gold-l),var(--gold-d)); }
        .panel{ background:#fff; border-radius:0 0 26px 26px; padding:46px 42px 40px; text-align:center;
            box-shadow:0 50px 90px -28px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04); }

        /* logo + rings + lock */
        .logo{ position:relative; width:112px; height:112px; margin:6px auto 26px; }
        .logo .ring{ position:absolute; border-radius:50%; }
        .logo .r1{ inset:-9px; border:1.5px solid rgba(247,166,0,.30); }
        .logo .r2{ inset:-20px; border:1.5px solid rgba(247,166,0,.14); }
        .logo .tile{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
            background:#FBF6EC; border-radius:22px; padding:14px; box-shadow:inset 0 0 0 1px rgba(247,166,0,.18); }
        .logo .tile img{ width:100%; height:100%; object-fit:contain; }
        .logo .lock{ position:absolute; right:-8px; bottom:-8px; width:44px; height:44px; display:flex; align-items:center; justify-content:center;
            color:var(--navy); background:linear-gradient(160deg,var(--gold-l),var(--gold-d)); border-radius:50%;
            box-shadow:0 8px 18px rgba(224,140,0,.45); border:4px solid #fff; }

        .pill{ display:inline-flex; align-items:center; gap:7px; padding:7px 15px; border-radius:999px;
            background:#FFF4DE; color:#9a6a00; font-weight:800; font-size:11px; letter-spacing:.14em; text-transform:uppercase; }
        .pill .dot{ width:7px; height:7px; border-radius:50%; background:var(--gold-d); box-shadow:0 0 0 4px rgba(247,166,0,.18); }

        h1{ font-family:'Bricolage Grotesque',sans-serif; color:var(--navy); font-weight:800; line-height:1.12;
            font-size:30px; letter-spacing:-.01em; margin:18px 0 0; }
        .sub{ margin:8px 0 0; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; }
        .rule{ width:56px; height:4px; border-radius:999px; background:var(--gold); margin:20px auto 0; }
        .msg{ margin:22px 0 0; color:#3a3a4d; font-size:15px; line-height:1.65; }
        .msg strong{ color:var(--navy); }

        .date{ display:inline-flex; align-items:center; gap:9px; margin:20px 0 0; padding:9px 16px; border-radius:14px;
            background:#FBF6EC; color:var(--navy); font-weight:700; font-size:13.5px; box-shadow:inset 0 0 0 1px rgba(247,166,0,.2); }
        .date svg{ color:var(--gold-d); }

        .cta{ display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin:30px 0 0; }
        .btn{ display:inline-flex; align-items:center; justify-content:center; gap:9px; padding:13px 24px; border-radius:999px;
            font-weight:700; font-size:14px; text-decoration:none; transition:transform .25s ease, box-shadow .25s ease, background .25s ease; }
        .btn:hover{ transform:translateY(-2px); }
        .btn-gold{ background:linear-gradient(160deg,var(--gold-l),var(--gold)); color:var(--navy); box-shadow:0 12px 24px -8px rgba(224,140,0,.6); }
        .btn-gold:hover{ box-shadow:0 16px 30px -8px rgba(224,140,0,.7); }
        .btn-ghost{ background:#fff; color:var(--navy); box-shadow:inset 0 0 0 2px rgba(10,36,114,.14); }
        .btn-ghost:hover{ box-shadow:inset 0 0 0 2px rgba(10,36,114,.4); }

        .foot{ margin:26px 0 0; text-align:center; color:rgba(255,255,255,.42); font-size:11px; letter-spacing:.24em; text-transform:uppercase; }

        /* support contact */
        .support{ margin:26px 0 0; padding-top:22px; border-top:1px solid #EEF0F4; }
        .support-label{ margin:0 0 13px; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; }
        .support-row{ display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:10px; }
        .support-item{ display:inline-flex; align-items:center; gap:9px; padding:10px 16px; border-radius:13px;
            background:#F6F8FB; color:var(--navy); font-size:13.5px; font-weight:700; text-decoration:none;
            transition:background .2s ease, color .2s ease; }
        .support-item svg{ color:var(--gold-d); flex-shrink:0; }
        .support-item:hover{ background:#FFF4DE; color:var(--gold-d); }

        @media (max-width:480px){ .panel{ padding:38px 26px 32px; } h1{ font-size:25px; } .support-item{ width:100%; justify-content:center; } }
`

/** ExpiredWebsite.RenewFallbackUrl */
const RENEW_FALLBACK_URL = appSettings.RenewUrl

/** DateTime.ToString("dd MMMM yyyy", CultureInfo.InvariantCulture) — "30 June 2025". */
function formatExpiredOn(when) {
  if (!when) return ''
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function ExpiredWebsite() {
  const club = useClub()

  // The static <title> of the standalone document. (The C# deliberately has no
  // SetTitle here: its <head> is non-server markup, so setting Page.Title threw.)
  usePageTitle('Website Unavailable')

  const [clubLogoUrl, setClubLogoUrl] = useState('images/logo/wheel.png')
  const [renewUrl, setRenewUrl] = useState(RENEW_FALLBACK_URL)

  /** True when it's a lapsed free trial rather than a paid expiry. */
  const isTrialExpired = String(club.status || '').toLowerCase() === 'trial_expired'
  const clubDisplayName = club.clubDisplayName
  const expiredOnText = formatExpiredOn(isTrialExpired ? club.trialEndsAt : club.paidUntil)

  useEffect(() => {
    if (!club.clubId) return
    let cancelled = false

    ;(async () => {
      const about = await api.getAbout(club.clubId, club.selectedYearId)
      if (cancelled) return
      const logo = media(about ? about.clubLogoPath : null)
      setClubLogoUrl(!logo ? 'images/logo/wheel.png' : logo)

      // Ask the API for THIS club's own dynamic renewal pay link — a fresh, per-club
      // token minted server-side (only the API holds the signing key; the website can't
      // mint it). getOrNull returns null when the endpoint isn't deployed yet, so the
      // button always has a working href (the portal renewal page) as a fallback.
      const renew = await getOrNull('/public/club-website/renew-link?clubId=' + club.clubId)
      if (cancelled) return
      if (renew && renew.websitePayLink && renew.websitePayLink.trim()) setRenewUrl(renew.websitePayLink)
    })()

    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearId])

  useRotaryAnim([clubDisplayName, clubLogoUrl, expiredOnText])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&display=swap" rel="stylesheet" />

      <div className="stage">
        <div className="dots"></div>
        <div className="vignette"></div>
        <img className="wheel wheel--r" src="images/logo/wheel.png" alt="" />
        <img className="wheel wheel--l" src="images/logo/wheel.png" alt="" />

        <div className="card">
          <div className="accent"></div>
          <div className="panel">

            <div className="logo">
              <span className="ring r2"></span>
              <span className="ring r1"></span>
              <span className="tile">
                <img src={clubLogoUrl} alt={clubDisplayName}
                     onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }} />
              </span>
              <span className="lock">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
            </div>

            {/* Subscription wording ONLY (user decision 2026-07-20): a lapsed free trial
                is presented as an expired subscription too, so "Free Trial Ended" is
                never shown. isTrialExpired still decides WHICH date to print. */}
            <span className="pill"><span className="dot"></span>Subscription Expired</span>

            <h1>{clubDisplayName}</h1>
            <p className="sub">Website Currently Unavailable</p>

            <div className="rule"></div>

            <p className="msg">
              This club&rsquo;s website subscription has expired, so it has been temporarily switched off.
            </p>

            {!!expiredOnText && (
            <span className="date">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              {/* One expression, so the space before the date can't be lost the way
                  the live build renders it ("Trial ended on30 June 2025"). */}
              {'Expired on ' + expiredOnText}
            </span>
            )}

            <p className="msg" style={{ marginTop: '14px', fontSize: '14px', color: '#6B7280' }}>
              If you manage this club, please renew the subscription to bring the website back online.
            </p>

            <div className="cta">
              <a className="btn btn-gold" href={renewUrl} target="_blank" rel="noopener noreferrer">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
                Renew Subscription
              </a>
            </div>

            {(appSettings.SupportEmail || appSettings.SupportPhone) && (
            <div className="support">
              <p className="support-label">Need help? Contact our support team</p>
              <div className="support-row">
                {appSettings.SupportEmail && (
                  <a className="support-item" href={'mailto:' + appSettings.SupportEmail + ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    {appSettings.SupportEmail}
                  </a>
                )}
                {appSettings.SupportPhones.map((phone) => (
                  <a key={phone} className="support-item" href={'tel:' + phone.replace(/[^+0-9]/g, '')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    {phone}
                  </a>
                ))}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>

      <p className="foot" style={{ position: 'fixed', left: 0, right: 0, bottom: '18px' }}>Powered by Roster On Wheels</p>
    </>
  )
}
