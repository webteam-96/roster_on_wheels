// Port of SiteNotConfigured.aspx + SiteNotConfigured.aspx.cs.
//
// Standalone full-screen page shown when the request host is not mapped to any
// club (and no DefaultWebsiteId is configured). Carries no club data and opts
// out of the site gate so it never redirects to itself (App.jsx routes it
// OUTSIDE <Gate>, which is the BypassExpiryGate override).
//
// PORT NOTE: the original is a whole HTML document (its own <head>, its own
// <style>). React can only render inside #root, so the <style> block and the
// Google-Fonts <link>s are emitted in the body — browsers apply both from there
// — and the static <title> becomes usePageTitle().
import { usePageTitle } from '../shared/rotaryPage.js'
import { useRotaryAnim } from '../shared/useRotaryAnim.js'
import { appSettings } from '../config.js'

const CSS = `
        :root{ --gold:#F7A600; --gold-d:#E08C00; --gold-l:#FFB81C; --navy:#0A2472; --navy-d:#0B1F5E; --muted:#6B7280; }
        *{ box-sizing:border-box; }
        html,body{ margin:0; height:100%; }
        body{ font-family:'Figtree',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }

        .stage{ position:relative; min-height:100vh; display:flex; align-items:center; justify-content:center;
            padding:48px 18px; overflow:hidden;
            background:radial-gradient(1100px 620px at 50% -12%, #163e96 0%, var(--navy) 42%, var(--navy-d) 100%); }
        .vignette{ position:absolute; inset:0; pointer-events:none;
            background:radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(5,14,46,.55)); }
        .dots{ position:absolute; inset:0; pointer-events:none; opacity:.5;
            background-image:radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px); background-size:26px 26px;
            -webkit-mask-image:radial-gradient(70% 60% at 50% 45%, #000, transparent 75%);
                    mask-image:radial-gradient(70% 60% at 50% 45%, #000, transparent 75%); }
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

        .logo{ position:relative; width:112px; height:112px; margin:6px auto 26px; }
        .logo .ring{ position:absolute; border-radius:50%; }
        .logo .r1{ inset:-9px; border:1.5px solid rgba(247,166,0,.30); }
        .logo .r2{ inset:-20px; border:1.5px solid rgba(247,166,0,.14); }
        .logo .tile{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
            background:#FBF6EC; border-radius:22px; padding:18px; box-shadow:inset 0 0 0 1px rgba(247,166,0,.18); }
        .logo .tile img{ width:100%; height:100%; object-fit:contain; }
        .logo .badge{ position:absolute; right:-8px; bottom:-8px; width:44px; height:44px; display:flex; align-items:center; justify-content:center;
            color:var(--navy); background:linear-gradient(160deg,var(--gold-l),var(--gold-d)); border-radius:50%;
            box-shadow:0 8px 18px rgba(224,140,0,.45); border:4px solid #fff; }

        .pill{ display:inline-flex; align-items:center; gap:7px; padding:7px 15px; border-radius:999px;
            background:#FFF4DE; color:#9a6a00; font-weight:800; font-size:11px; letter-spacing:.14em; text-transform:uppercase; }
        .pill .dot{ width:7px; height:7px; border-radius:50%; background:var(--gold-d); box-shadow:0 0 0 4px rgba(247,166,0,.18); }

        h1{ font-family:'Bricolage Grotesque',sans-serif; color:var(--navy); font-weight:800; line-height:1.16;
            font-size:27px; letter-spacing:-.01em; margin:18px 0 0; }
        .rule{ width:56px; height:4px; border-radius:999px; background:var(--gold); margin:20px auto 0; }
        .msg{ margin:22px 0 0; color:#3a3a4d; font-size:15px; line-height:1.65; }
        .msg strong{ color:var(--navy); }

        .support{ margin:26px 0 0; padding-top:22px; border-top:1px solid #EEF0F4; }
        .support-label{ margin:0 0 13px; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; }
        .support-row{ display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:10px; }
        .support-item{ display:inline-flex; align-items:center; gap:9px; padding:10px 16px; border-radius:13px;
            background:#F6F8FB; color:var(--navy); font-size:13.5px; font-weight:700; text-decoration:none;
            transition:background .2s ease, color .2s ease; }
        .support-item svg{ color:var(--gold-d); flex-shrink:0; }
        .support-item:hover{ background:#FFF4DE; color:var(--gold-d); }

        .foot{ position:fixed; left:0; right:0; bottom:18px; text-align:center; color:rgba(255,255,255,.42); font-size:11px; letter-spacing:.24em; text-transform:uppercase; }

        @media (max-width:480px){ .panel{ padding:38px 26px 32px; } h1{ font-size:23px; } .support-item{ width:100%; justify-content:center; } }
`

export default function SiteNotConfigured() {
  // No club to load; the page is fully static apart from support details.
  usePageTitle('Website Not Configured')

  useRotaryAnim([])

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
              <span className="tile"><img src="images/logo/wheel.png" alt="Rotary" /></span>
              <span className="badge">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </span>
            </div>

            <span className="pill"><span className="dot"></span>Setup Required</span>

            <h1>This Website Is Not Configured Yet</h1>

            <div className="rule"></div>

            <p className="msg">
              This domain isn&rsquo;t linked to a club yet, so there&rsquo;s nothing to show here.
            </p>
            <p className="msg" style={{ marginTop: '12px', fontSize: '14px', color: '#6B7280' }}>
              If you manage this club, please contact our team to map this domain to your club and bring the website online.
            </p>

            {(appSettings.SupportEmail || appSettings.SupportPhone) && (
            <div className="support">
              <p className="support-label">Need help? Contact our support team</p>
              <div className="support-row">
                {appSettings.SupportEmail && (
                  <a className="support-item" href={'mailto:' + appSettings.SupportEmail + '?subject=Configure%20club%20website%20domain'}>
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

      <p className="foot">Powered by Roster On Wheels</p>
    </>
  )
}
