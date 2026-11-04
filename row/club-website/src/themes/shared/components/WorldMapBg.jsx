
// Decorative dotted-world-map background. The SVG (CC0, public domain) is used
// as a CSS mask so the dots can be tinted any colour via `color`, kept subtle
// with `opacity`. Purely decorative — pointer-events-none, aria-hidden.
// The mask URL goes through asset() so it resolves under the deploy base
// (e.g. /club_website/) on Vercel as well as locally.
const MAP_URL = '/images/bg/world-dotted.svg'
const MASK = {
  WebkitMaskImage: `url(${MAP_URL})`,
  maskImage: `url(${MAP_URL})`,
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
}

export default function WorldMapBg({
  className = '',
  color = '#ffffff',
  opacity = 0.12,
  size = 'cover', // 'cover' fills the band, 'contain' shows the whole map
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        ...MASK,
        WebkitMaskSize: size,
        maskSize: size,
        backgroundColor: color,
        opacity,
      }}
    />
  )
}
