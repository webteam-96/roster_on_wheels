// The club's Facebook, Instagram and X feeds, as set in the admin (Website extras). The feeds are third-party
// embeds, so they load only after the visitor allows them (shared/ThirdParty.jsx).
import { useEffect, useRef, useState } from 'react'
import Breadcrumb, { EmptyState } from '../shared/Breadcrumb.jsx'
import Skeleton from '../shared/Skeleton.jsx'
import { useConsent, useWebsiteExtras } from '../shared/ThirdParty.jsx'
import { facebookEmbedSrc, hasFeeds, instagramProfileUrl, xTimelineHref } from '../shared/websiteExtras.js'

const FEED_HEIGHT = 640
const BOX = { position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 8, border: '1px solid rgba(0,0,0,.15)' }
const SHADE = { position: 'absolute', inset: 0, padding: 16 }

function FrameFeed({ title, src }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div style={{ ...BOX, height: FEED_HEIGHT }}>
      {!loaded && <div style={SHADE}><Skeleton label={'Loading ' + title} rows={4} /></div>}
      <iframe title={title} src={src} loading="lazy" onLoad={() => setLoaded(true)}
        style={{ position: 'relative', width: '100%', height: '100%', border: 0 }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
    </div>
  )
}

/** X's timeline widget: an anchor its script turns into the feed. */
function XFeed({ href, name }) {
  const box = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const done = new MutationObserver(() => { if (el.querySelector('iframe')) setLoaded(true) })
    done.observe(el, { childList: true, subtree: true })
    // X often refuses timelines to signed-out visitors (HTTP 429); then the box becomes a plain link.
    const giveUp = setTimeout(() => { if (!el.querySelector('iframe')) setFailed(true) }, 10000)
    if (window.twttr && window.twttr.widgets) window.twttr.widgets.load(el)
    else if (!document.getElementById('x-widgets')) {
      const s = document.createElement('script')
      s.id = 'x-widgets'
      s.async = true
      s.src = 'https://platform.twitter.com/widgets.js'
      document.body.appendChild(s)
    }
    return () => { done.disconnect(); clearTimeout(giveUp) }
  }, [])
  if (failed && !loaded) return <ProfileLink network="X" url={'https://x.com/' + name} name={name} />
  return (
    <div ref={box} style={{ ...BOX, minHeight: FEED_HEIGHT }}>
      {!loaded && <div style={SHADE}><Skeleton label="Loading the X feed" rows={4} /></div>}
      <a className="twitter-timeline" data-height={FEED_HEIGHT} data-dnt="true" href={href}>Posts by @{name}</a>
    </div>
  )
}

/**
 * A plain link to the club's profile. Instagram offers no embeddable profile feed (only single posts), and X falls
 * back to this when it will not show its timeline.
 */
function ProfileLink({ network, url, name }) {
  return (
    <div style={{ ...BOX, padding: 24 }}>
      <p style={{ margin: 0, fontSize: 15 }}>See the latest posts from @{name} on {network}.</p>
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-block', marginTop: 16, padding: '10px 18px', borderRadius: 999, background: '#17458F', color: '#F7F7F4', fontWeight: 600, textDecoration: 'none' }}>
        Open {network}
      </a>
    </div>
  )
}

export default function Social() {
  const extras = useWebsiteExtras()
  const [consent, choose] = useConsent()

  let body
  if (extras === undefined) body = <Skeleton label="Loading" rows={3} />
  else if (!extras || !hasFeeds(extras)) {
    body = <EmptyState title="No social feeds yet" message="The club has not linked its social media accounts yet." />
  } else {
    const fb = facebookEmbedSrc(extras.facebookPageUrl)
    const ig = instagramProfileUrl(extras.instagramUsername)
    const x = xTimelineHref(extras.xUsername)
    const links = [
      fb && ['Facebook', extras.facebookPageUrl],
      ig && ['Instagram', ig],
      x && ['X', 'https://x.com/' + extras.xUsername],
    ].filter(Boolean)
    body = consent === 'all' ? (
      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
        {fb && <section aria-label="Facebook"><h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700 }}>Facebook</h2><FrameFeed title="Facebook page" src={fb} /></section>}
        {ig && <section aria-label="Instagram"><h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700 }}>Instagram</h2><ProfileLink network="Instagram" url={ig} name={extras.instagramUsername} /></section>}
        {x && <section aria-label="X"><h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700 }}>X</h2><XFeed href={x} name={extras.xUsername} /></section>}
      </div>
    ) : (
      <div style={{ ...BOX, padding: 24, fontSize: 15 }}>
        <p style={{ margin: 0 }}>These feeds come from Facebook, Instagram and X, which set their own cookies. They load once you allow them.</p>
        <button type="button" onClick={() => choose('all')}
          style={{ marginTop: 16, padding: '10px 18px', borderRadius: 999, border: '1px solid #17458F', background: '#17458F', color: '#F7F7F4', fontWeight: 600 }}>
          Show the feeds
        </button>
        <ul style={{ margin: '16px 0 0', padding: 0, listStyle: 'none', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {links.map(([label, url]) => (
            <li key={label}><a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>{label}</a></li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <>
      <Breadcrumb eyebrow="" title="Social media" crumbLabel="Social media" />
      <section className="bg-canvas py-12">
        <div className="container-x">{body}</div>
      </section>
    </>
  )
}
