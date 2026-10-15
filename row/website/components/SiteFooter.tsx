import Link from "next/link";
import Logo from "./Logo";
import { NAV, SOCIAL, KAIZEN_HREF, PHONES, EMAIL, LEGAL } from "@/lib/site";

const ICONS: Record<string, React.ReactNode> = {
  Facebook: <path d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2.3L14.2 2.3C11 2.3 10.3 4.7 10.3 6.2v2.3H8.4V12h1.9v9.7H14V12h2.6l.4-3.5H14z" />,
  "X (Twitter)": <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" />,
  Pinterest: <path d="M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.3-5.4s-.3-.7-.3-1.6c0-1.5.9-2.6 2-2.6.9 0 1.4.7 1.4 1.5 0 .9-.6 2.3-.9 3.6-.3 1.1.5 2 1.6 2 1.9 0 3.4-2 3.4-4.9 0-2.6-1.9-4.4-4.5-4.4-3.1 0-4.9 2.3-4.9 4.7 0 .9.4 1.9.8 2.5.1.1.1.2.1.3l-.3 1.2c0 .2-.2.2-.4.1-1.4-.6-2.2-2.6-2.2-4.2 0-3.4 2.5-6.6 7.2-6.6 3.8 0 6.7 2.7 6.7 6.3 0 3.8-2.4 6.8-5.7 6.8-1.1 0-2.2-.6-2.5-1.3l-.7 2.6c-.2 1-.9 2.2-1.4 2.9A10 10 0 1 0 12 2z" />,
  YouTube: <path d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.7 4.7 12 4.7 12 4.7s-6.7 0-8.5.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 4.8 2.8 2.8 0 0 0 2 2c1.8.5 8.5.5 8.5.5s6.7 0 8.5-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-4.8zM9.8 15.1V8.9l5.6 3.1-5.6 3.1z" />,
};

export default function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <p className="footer__logo"><Logo /></p>
          <ul className="social" aria-label="Roster On Wheels on social media">
            {SOCIAL.map((s) => (
              <li key={s.label}>
                <a className="social__link" href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`${s.label} (opens in a new tab)`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[s.label]}</svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <nav className="footer__nav" aria-label="Footer">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link className="link" href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* Contact Us page details (V2 doc) */}
        <ul className="footer__contact">
          <li>
            <span className="footer__ico" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="3" /><path d="M10.5 18h3" /></svg>
            </span>
            <span className="footer__lines">
              <span className="footer__label">Phone</span>
              {PHONES.map((p) => (
                <a key={p} className="link" href={`tel:${p.replace(/\s/g, "")}`}>{p}</a>
              ))}
            </span>
          </li>
          <li>
            <span className="footer__ico" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7.5l8 6 8-6" /></svg>
            </span>
            <span className="footer__lines">
              <span className="footer__label">Email</span>
              {/* a narrow column breaks the address after the @, never inside a word */}
              <a className="link" href={`mailto:${EMAIL}`}>{EMAIL.split("@")[0]}@<wbr />{EMAIL.split("@")[1]}</a>
            </span>
          </li>
        </ul>
      </div>
      <div className="container footer__base">
        <p>© Copyright {new Date().getFullYear()}. All Rights Reserved.</p>
        <nav className="footer__legal" aria-label="Policies">
          {LEGAL.map((l) => (
            <Link key={l.href} className="link" href={l.href}>{l.label}</Link>
          ))}
        </nav>
        <p>
          Developed by{" "}
          <a className="link" href={KAIZEN_HREF} target="_blank" rel="noopener noreferrer">Kaizen Infotech Solutions Pvt. Ltd</a>
        </p>
      </div>
    </footer>
  );
}
