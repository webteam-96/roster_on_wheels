import { appSettings } from '../config.js'

/**
 * Club stories + bulletin sign-up links, then Terms of Service + Privacy Policy links, shown in every theme's footer under the visitor counter.
 * They point at the ROW platform pages (VITE_TermsUrl / VITE_PrivacyUrl); a blank URL hides its link.
 * Colour and font come from the surrounding footer, so each theme keeps its own look.
 */
export default function FooterLegal() {
  const links = [
    ['Terms of Service', appSettings.TermsUrl],
    ['Privacy Policy', appSettings.PrivacyUrl],
  ].filter(([, url]) => url)
  const style = { color: 'inherit', opacity: 0.8, textDecoration: 'underline', textUnderlineOffset: 3 }
  return (
    <nav aria-label="Legal" style={{ marginTop: 10, fontSize: 12, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'inherit' }}>
      {/* ROW gap #6: in every theme's footer, so each site links its stories and bulletin sign-up. */}
      <a href="/stories" style={style}>Club stories</a>
      <a href="/bulletin" style={style}>Get the club bulletin</a>
      {links.map(([label, url]) => (
        <a key={label} href={url} target="_blank" rel="noopener noreferrer" style={style}>
          {label}
        </a>
      ))}
    </nav>
  )
}
