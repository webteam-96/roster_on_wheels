// Presentation for the footer visitor counter — the card the client supplied as
// the reference: rocket badge, TODAY'S / TOTAL columns split by a rule. Kept in
// its own file so visitorCount.jsx stays about the counting, not the drawing.
//
// The reference's "We are glad you're here!" line was dropped by request
// (2026-08-18) — with it went the card's second row, which is most of why it is
// now a single-row band rather than a block.
//
// Every colour is a custom property, and EVERY theme now overrides them so the
// card is grounded in the backdrop it actually sits on (measured 2026-08-18):
//
//   classic-blue     rgb(45 51 131)    indigo band
//   warm-modern      rgb(96 31 14)     espresso band
//   civic-bold       rgb(6 22 52)      navy-deep band  (also narrowed)
//   verdigris        rgb(42 10 44)     plum band
//   gold             rgb(9 25 47)      navy band
//   handloom         #12332A           green-deep band (0 radius, no shadow)
//   madras-legacy    rgb(255 255 255)  WHITE — so this one inverts to a light
//                                      card with a dark badge disc, otherwise
//                                      the white-bodied rocket disappears
//
// The pattern is always the same: --rv-bg2 IS the backdrop so the card melts
// into it at the bottom-right, --rv-bg1 is a lift of it, and the edge/accent
// come from that theme's own accent token. Add a theme the same way; never fork
// the markup or the base rules.
//
// Sizing is handled by CONTAINER queries on .rv-vc-wrap, so the card fits
// whatever column a theme gives it without per-theme width overrides.
//
// ⚠ .rv-vc must stay BLOCK-level. It was `inline-grid`, and civic-bold's footer
// logo plate is `inline-flex`, so the two flowed as inline boxes on one line and
// the counter sat ON the logo instead of under it.
//
// ⚠ No data-count anywhere: rotary-anim.js animates any [data-count] element to
// parseFloat(value)||0 and would hijack the figures.
export const CSS = `
.rv-vc-wrap{container-type:inline-size;width:100%}

.rv-vc{
  --rv-bg1:#232C50; --rv-bg2:#141A31; --rv-edge:rgba(255,255,255,.14);
  --rv-label:#C7CFEE; --rv-today:#7B6CF6; --rv-total:#FFFFFF;
  --rv-rule:rgba(255,255,255,.16); --rv-badge:rgba(255,255,255,.06);
  --rv-pad-y:13px; --rv-pad-x:26px; --rv-badge-size:62px;
  --rv-num:27px; --rv-lab:10.5px; --rv-radius:40px;
  display:grid;grid-template-columns:auto 1fr;align-items:center;
  gap:0 18px;box-sizing:border-box;width:100%;max-width:340px;
  margin:0;padding:var(--rv-pad-y) var(--rv-pad-x);text-align:left;
  border:1px solid var(--rv-edge);border-radius:var(--rv-radius);
  background:radial-gradient(120% 140% at 12% 8%, var(--rv-bg1) 0%, var(--rv-bg2) 68%);
  box-shadow:0 14px 32px rgba(8,12,28,.26);
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
  color:var(--rv-total)}

.rv-vc__badge{display:block;width:var(--rv-badge-size);height:var(--rv-badge-size);flex:none}

.rv-vc__stats{display:grid;grid-template-columns:1fr 1px 1fr;align-items:start;gap:0 18px}
.rv-vc__rule{align-self:stretch;background:var(--rv-rule)}
.rv-vc__cell{display:flex;flex-direction:column;align-items:center;gap:3px;
  text-align:center;min-width:0}

.rv-vc__l{font-size:var(--rv-lab);font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:var(--rv-label);white-space:nowrap}
.rv-vc__n{font-size:var(--rv-num);font-weight:700;line-height:1;letter-spacing:-.015em;
  font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.rv-vc__n--today{color:var(--rv-today)}
.rv-vc__n--total{color:var(--rv-total)}
.rv-vc__ico{width:13px;height:13px;display:block;opacity:.9}
.rv-vc__ico--today{color:var(--rv-today)}

/* ── Per-theme grounding ─────────────────────────────────────────────────────
   --rv-bg2 is each theme's own footer colour, so the card reads as part of the
   band rather than a foreign panel dropped on top of it. */

html[data-theme="classic-blue"] .rv-vc{
  --rv-bg1:rgb(58 65 152); --rv-bg2:rgb(45 51 131);
  --rv-edge:rgba(255,204,0,.30); --rv-today:#FFCC00;
  --rv-rule:rgba(255,255,255,.20); --rv-label:#C9CEEC}

html[data-theme="warm-modern"] .rv-vc{
  --rv-bg1:rgb(124 45 22); --rv-bg2:rgb(96 31 14);
  --rv-edge:rgba(243,199,123,.32); --rv-today:#F3C77B;
  --rv-rule:rgba(255,255,255,.20); --rv-label:#EBD3C4}

/* civic-bold's accent moves off the reference's violet because a violet figure
   beside civic's gold read as a different site. (Its old max-width:340px cap is
   gone — that is the base width for every theme now.) */
html[data-theme="civic-bold"] .rv-vc{
  --rv-bg1:rgb(17 41 88); --rv-bg2:rgb(var(--c-navy-deep, 6 22 52));
  --rv-edge:rgba(var(--c-gold, 212 164 41), .32);
  --rv-today:rgb(var(--c-gold-light, 240 206 114));
  --rv-rule:rgba(var(--c-gold, 212 164 41), .26);
  --rv-label:#BFCBE4;
  box-shadow:0 12px 28px rgba(2,8,22,.34)}

html[data-theme="verdigris-ledger"] .rv-vc{
  --rv-bg1:rgb(62 17 64); --rv-bg2:rgb(42 10 44);
  --rv-edge:rgba(144,31,147,.50); --rv-today:#D177D4;
  --rv-rule:rgba(255,255,255,.18); --rv-label:#D9C6DB}

html[data-theme="gold"] .rv-vc{
  --rv-bg1:rgb(17 39 69); --rv-bg2:var(--g-navy, rgb(9 25 47));
  --rv-edge:var(--g-hairline, rgba(201,162,39,.22));
  --rv-today:var(--g-gold, #D4AF37);
  --rv-rule:rgba(201,162,39,.28); --rv-label:#C3CEE2}

/* handloom's footer is the inked green band, so --rv-bg2 IS that ground and the
   card melts into it. The two shape laws apply here as everywhere: 0 radius and
   no shadow — depth comes from the greige hairline edge alone. */
html[data-theme="handloom"] .rv-vc{
  --rv-bg1:#1A4535; --rv-bg2:var(--hl-green-deep, #12332A);
  --rv-edge:rgba(184,172,147,.30); --rv-today:#E4C77A; --rv-total:#EDE8DB;
  --rv-rule:rgba(184,172,147,.28); --rv-label:#B8AC93; --rv-radius:0;
  box-shadow:none}
/* Handloom's brand tokens can be re-pointed per club (handloomThemeColor.jsx),
   so the ground reads the token above and the lift is mixed from the same two
   tokens — 45% deep + 55% green lands on the signed-off #1A4535 for the default
   green and follows any other colour. Older engines keep the literal. */
@supports (color: color-mix(in srgb, red, blue)){
  html[data-theme="handloom"] .rv-vc{
    --rv-bg1:color-mix(in srgb, var(--hl-green-deep, #12332A) 45%, var(--hl-green, #1F5138))}
}

/* madras sits on the footer's WHITE strip, so it inverts: light card, navy ink,
   and a dark badge disc to keep the white-bodied rocket visible. */
html[data-theme="madras-legacy"] .rv-vc{
  --rv-bg1:#FFFFFF; --rv-bg2:#F1F4FB;
  --rv-edge:rgba(45,51,131,.18); --rv-today:#2D3383; --rv-total:#1A2044;
  --rv-rule:rgba(45,51,131,.20); --rv-label:#5C6480; --rv-badge:#2D3383;
  box-shadow:0 10px 26px rgba(45,51,131,.14)}

/* CONTAINER queries, not viewport ones. The card lands in columns of very
   different widths — classic gives it ~452px, gold and verdigris only ~300px at
   the SAME viewport — so a @media rule cannot tell the two apart and the two
   labels collided in the narrow themes. These scale off the card's OWN width. */
@container (max-width:430px){
  .rv-vc{--rv-pad-y:11px;--rv-pad-x:18px;--rv-badge-size:52px;--rv-num:23px;
    --rv-lab:9.5px;--rv-radius:32px;gap:0 13px}
  .rv-vc__stats{gap:0 12px}
  .rv-vc__ico{width:12px;height:12px}
}
@container (max-width:344px){
  .rv-vc{--rv-pad-x:14px;--rv-badge-size:44px;--rv-num:20px;--rv-lab:8.5px;
    --rv-radius:26px;gap:0 10px}
  .rv-vc__stats{gap:0 8px}
  .rv-vc__l{letter-spacing:.03em}
}
/* Narrower than any real column: drop the badge before crushing the figures. */
@container (max-width:262px){
  .rv-vc{grid-template-columns:1fr;--rv-num:21px;--rv-lab:9px}
  .rv-vc__badge{display:none}
}

/* ── Motion ──────────────────────────────────────────────────────────────────
   Every moving part lives inside the reduced-motion guard, and the count-up in
   visitorCount.jsx checks the same query, so a visitor who asks for stillness
   gets a completely static card showing the final figures. */
@media (prefers-reduced-motion:no-preference){
  /* Entrance: the card rises once, the first time it scrolls into view. */
  .rv-vc{opacity:0}
  .rv-vc.is-in{animation:rvIn .55s cubic-bezier(.22,1,.36,1) both}

  /* Idle: the rocket keeps station with a slow bob and a flickering flame. */
  .rv-vc__badge{animation:rvBob 3.6s ease-in-out infinite}
  .rv-vc__flame{transform-box:fill-box;transform-origin:50% 8%;
    animation:rvFlame 1.15s ease-in-out infinite}
  .rv-vc__flame--in{animation-duration:.8s}

  /* Hover: the card lifts and the rocket launches. The bob is REPLACED, not
     paused — a paused animation keeps applying its frozen transform and would
     beat any transform set on hover. */
  .rv-vc{transition:transform .32s cubic-bezier(.22,1,.36,1),
                    box-shadow .32s ease, border-color .32s ease}
  .rv-vc__n{transition:transform .32s cubic-bezier(.22,1,.36,1)}
  .rv-vc:hover{transform:translateY(-3px)}
  .rv-vc:hover .rv-vc__badge{animation:rvLaunch .5s cubic-bezier(.22,1,.36,1) forwards}
  .rv-vc:hover .rv-vc__flame{animation-duration:.34s}
  .rv-vc:hover .rv-vc__n{transform:translateY(-1px)}

  @keyframes rvIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  @keyframes rvBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3.5px)}}
  @keyframes rvLaunch{to{transform:translate(5px,-6px) scale(1.06)}}
  @keyframes rvFlame{0%,100%{transform:scaleY(1) scaleX(1);opacity:1}
                     50%{transform:scaleY(1.26) scaleX(.92);opacity:.86}}
}
`

/** Rocket badge, drawn rather than shipped as an image so it stays crisp and
 *  adds no request. Built upright, then turned 45° so it climbs to the right. */
export const ROCKET = (
  <svg className="rv-vc__badge" viewBox="0 0 88 88" fill="none" aria-hidden="true" focusable="false">
    <circle cx="44" cy="44" r="42" fill="var(--rv-badge)" />
    {/* sparkles */}
    <g fill="#FFFFFF" opacity=".85">
      <path d="M15 26l1.5 3.6 3.6 1.5-3.6 1.5L15 36l-1.5-3.4-3.6-1.5 3.6-1.5z" />
      <path d="M71 20l1.1 2.6 2.6 1.1-2.6 1.1L71 27.4l-1.1-2.6-2.6-1.1 2.6-1.1z" opacity=".7" />
      <path d="M69 60l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" opacity=".55" />
      <circle cx="24" cy="62" r="1.6" opacity=".6" />
    </g>
    <g transform="rotate(45 44 44) translate(12 12)">
      {/* flame */}
      <path className="rv-vc__flame" d="M32 47c3.6 3.2 5.2 6.6 5.2 9.6 0 3.2-2.3 5.8-5.2 5.8s-5.2-2.6-5.2-5.8c0-3 1.6-6.4 5.2-9.6Z" fill="#FFB020" />
      <path className="rv-vc__flame rv-vc__flame--in" d="M32 51.4c1.9 2 2.7 4 2.7 5.7 0 1.9-1.2 3.3-2.7 3.3s-2.7-1.4-2.7-3.3c0-1.7.8-3.7 2.7-5.7Z" fill="#FF6A00" />
      {/* fins */}
      <path d="M21.4 33.5 11.6 45.2v7.4l9.8-6.4z" fill="#E34A4E" />
      <path d="M42.6 33.5l9.8 11.7v7.4l-9.8-6.4z" fill="#E34A4E" />
      {/* body */}
      <path d="M32 2.6c7.2 8.2 11.2 18.4 11.2 28.4v15.6H20.8V31c0-10 4-20.2 11.2-28.4Z" fill="#F3F6FF" />
      {/* nose */}
      <path d="M32 2.6c4.7 5.4 8.1 11.7 9.9 18.1H22.1c1.8-6.4 5.2-12.7 9.9-18.1Z" fill="#E34A4E" />
      {/* window */}
      <circle cx="32" cy="27.5" r="6.6" fill="#12224A" />
      <circle cx="32" cy="27.5" r="4.5" fill="#54C7F5" />
      {/* skirt */}
      <path d="M20.8 41.4h22.4v5.2H20.8z" fill="#D6DCF0" />
    </g>
  </svg>
)

export const ICO_TODAY = (
  <svg className="rv-vc__ico rv-vc__ico--today" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.5-8 5.6V22h16v-2.4c0-3.1-3.6-5.6-8-5.6Z" />
  </svg>
)

export const ICO_TOTAL = (
  <svg className="rv-vc__ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 5C6.9 5 2.7 8.1 1 12c1.7 3.9 5.9 7 11 7s9.3-3.1 11-7c-1.7-3.9-5.9-7-11-7Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-2.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z" />
  </svg>
)
