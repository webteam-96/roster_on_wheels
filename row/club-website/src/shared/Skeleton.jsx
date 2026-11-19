/**
 * Skeleton placeholder shown while a page's data loads (frontend rule 25: no blank screens or lone spinners).
 * Drawn in the surrounding text colour at low opacity, so it fits every theme's palette without its own colours.
 * The label is announced once to screen readers; the shimmer stops under prefers-reduced-motion.
 */
const CSS = `
.rw-skel{display:grid;gap:14px;padding:8px 0;color:inherit}
.rw-skel__row{display:grid;grid-template-columns:72px 1fr;gap:14px;align-items:center}
.rw-skel__b{display:block;border-radius:4px;background:currentColor;opacity:.09;animation:rw-skel 1.4s ease-in-out infinite}
.rw-skel__img{height:72px}
.rw-skel__lines{display:grid;gap:8px}
.rw-skel__l1{height:14px;width:60%}
.rw-skel__l2{height:12px;width:85%}
.rw-skel__l3{height:12px;width:40%}
@keyframes rw-skel{50%{opacity:.17}}
@media (prefers-reduced-motion:reduce){.rw-skel__b{animation:none}}
.rw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

export default function Skeleton({ label = 'Loading', rows = 3, className = '' }) {
  return (
    <div className={`rw-skel ${className}`} role="status" aria-busy="true">
      <style>{CSS}</style>
      {Array.from({ length: rows }, (_, i) => (
        <div className="rw-skel__row" key={i} aria-hidden="true">
          <span className="rw-skel__b rw-skel__img" />
          <span className="rw-skel__lines">
            <span className="rw-skel__b rw-skel__l1" />
            <span className="rw-skel__b rw-skel__l2" />
            <span className="rw-skel__b rw-skel__l3" />
          </span>
        </div>
      ))}
      <span className="rw-sr">{label}…</span>
    </div>
  )
}
