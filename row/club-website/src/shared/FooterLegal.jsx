import { appSettings } from '../config.js'

/**
 * Terms of Service + Privacy Policy links, shown in every theme's footer under the visitor counter.
 * They point at the ROW platform pages (VITE_TermsUrl / VITE_PrivacyUrl); a blank URL hides its link.
 * Colour and font come from the surrounding footer, so each theme keeps its own look.
 */
export default function FooterLegal() {
  const links = [
    ['Terms of Service', appSettings.TermsUrl],
    ['Privacy Policy', appSettings.PrivacyUrl],
  ].filter(([, url]) => url)
  if (!links.length) return null
  return (
    <nav aria-label="Legal" style={{ marginTop: 10, fontSize: 12, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'inherit' }}>
      {links.map(([label, url]) => (
        <a key={label} href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: 'inherit', opacity: 0.8, textDecoration: 'underline', textUnderlineOffset: 3 }}>
          {label}
        </a>
      ))}
    </nav>
  )
}
