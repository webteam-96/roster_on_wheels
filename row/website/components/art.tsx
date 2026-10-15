// Small SVG pieces for the text-free card pictures, in the home page's style (app/page.tsx AUDIENCES): white cards
// with a soft drop, skeleton lines, round avatars, ticks and the Rotary club badge. Coordinates are SVG units.
import type { ReactNode } from "react";

export const C = {
  ink: "#1B2C42", azure: "#17458F", mint: "#0067C8", marigold: "#F7A81B", coral: "#FFC65C",
  lilac: "#A9C6EA", sky: "#CFE2F6", cream2: "#EDF4FB", white: "#fff",
};

type At = { x: number; y: number };

/** A white card with its soft drop, its children drawn from the card's top left */
export function Card({ x, y, w, h, r = 13, children }: At & { w: number; h: number; r?: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect y="4" width={w} height={h} rx={r} fill={C.ink} opacity=".1" />
      <rect width={w} height={h} rx={r} fill={C.white} />
      {children}
    </g>
  );
}

/** The one phone outline every drawn phone uses: 200 x 400 units, shown at 240 x 480px (the same as .phone). The
    screen starts at x + 7.5, y + 7.5 and is 185 x 385. */
export function PhoneFrame({ x, y, screen = "#F7F9FC" }: At & { screen?: string }) {
  return (
    <>
      <rect x={x} y={y} width="200" height="400" rx="33" fill={C.ink} />
      <rect x={x + 7.5} y={y + 7.5} width="185" height="385" rx="25.5" fill={screen} />
      <rect x={x + 73} y={y + 13.5} width="54" height="14" rx="7" fill={C.ink} />
    </>
  );
}

/** Two lines of sample text (a name and a detail under it); without `t` it draws grey bars instead */
export function Lines({ x, y, w, w2 = Math.round(w * 0.65), dark = C.ink, t, t2, size = 9 }: At & { w: number; w2?: number; dark?: string; t?: string; t2?: string; size?: number }) {
  if (t !== undefined) {
    return (
      <>
        <text x={x} y={y + 7} fill={dark} fontSize={size} fontWeight="700" fontFamily="var(--font-display)">{t}</text>
        {t2 ? <text x={x} y={y + 7 + size * 1.25} fill={dark} fillOpacity=".6" fontSize={size * 0.82} fontWeight="500" fontFamily="var(--font-body)">{t2}</text> : null}
      </>
    );
  }
  return (
    <>
      <rect x={x} y={y} width={w} height="7" rx="3.5" fill={dark} opacity=".75" />
      {w2 > 0 ? <rect x={x} y={y + 12} width={w2} height="5" rx="2.5" fill={dark} opacity=".2" /> : null}
    </>
  );
}

/** One word or short line of sample text in a picture */
export function Txt({ x, y, t, size = 9, fill = C.ink, weight = 700, anchor, op }: At & { t: string; size?: number; fill?: string; weight?: number; anchor?: "middle" | "end"; op?: number }) {
  return <text x={x} y={y} fill={fill} fillOpacity={op} fontSize={size} fontWeight={weight} fontFamily="var(--font-display)" textAnchor={anchor}>{t}</text>;
}

/** A round avatar with a person in it */
export function Avatar({ x, y, r = 12, fill = C.marigold, glyph = C.white, ring }: At & { r?: number; fill?: string; glyph?: string; ring?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${r / 19})`}>
      <circle r="19" fill={fill} stroke={ring} strokeWidth={ring ? 5 : undefined} />
      <circle cy="-6" r="6.5" fill={glyph} />
      <path d="M-11.5 11c2.2-6 6.6-8.6 11.5-8.6s9.3 2.6 11.5 8.6Z" fill={glyph} />
    </g>
  );
}

/** A filled circle with a tick */
export function Tick({ x, y, r = 10, fill = C.azure }: At & { r?: number; fill?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${r / 10})`}>
      <circle r="10" fill={fill} />
      <path d="M-4.6.2l3.2 3.2 6-6.4" fill="none" stroke={C.white} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** A Rotary club: the blue disc with the gold ring */
export function Club({ x, y, r = 11 }: At & { r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={C.azure} />
      <circle r={r * 0.44} fill="none" stroke={C.marigold} strokeWidth={r * 0.24} />
    </g>
  );
}

/** A rounded colour tile with a 24-unit line icon in it, scaled to `size` */
export function IconTile({ x, y, size = 28, fill, stroke = C.white, children }: At & { size?: number; fill: string; stroke?: string; children: ReactNode }) {
  const k = size / 24;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={size} height={size} rx={size * 0.3} fill={fill} />
      <g transform={`translate(${size * 0.2} ${size * 0.2}) scale(${k * 0.6})`} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </g>
  );
}

/** Line icons on a 24-unit grid, shared by the pictures and the icon cards */
export const ICON = {
  people: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15.5 6.4a3 3 0 0 1 0 5.6M17.6 14.6c1.6.6 2.6 2.1 2.9 4.4" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M17 9.5a3.5 3.5 0 0 1 0 5" /></>,
  gift: <><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9c2 0 5.5.5 5.5-1.5S13.5 5.5 12 9" /></>,
  receipt: <><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" /><path d="M9 8.5h6M9 12h6" /></>,
  heart: <path d="M12 19.5s-7.5-4.4-7.5-10A4 4 0 0 1 12 7.2a4 4 0 0 1 7.5 2.3c0 5.6-7.5 10-7.5 10z" />,
  drop: <path d="M12 3.5s6 6.6 6 10.6a6 6 0 0 1-12 0c0-4 6-10.6 6-10.6z" />,
  tree: <><path d="M12 3.5 6.5 11h3L6 16h12l-3.5-5h3z" /><path d="M12 16v4.5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  pin: <><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  chat: <path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />,
  pencil: <path d="M5 19l1-4L15.5 5.5a2 2 0 0 1 3 3L9 18z" />,
  star: <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chart: <path d="M5 19.5V11M10 19.5V5M15 19.5V9M20 19.5v-6M3.5 19.5h18" />,
  screen: <><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M8 20.5h8M12 16.5v4M10.5 8.3v4.4l3.8-2.2z" /></>,
  browser: <><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" /></>,
  card: <><rect x="3.5" y="6.5" width="17" height="12.5" rx="2.5" /><path d="M3.5 10.5h17M7 15h3" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16" rx="2.5" /><path d="M9 4.5v-1h6v1M8.5 11l2 2 4-4M8.5 16.5h7" /></>,
  sync: <path d="M19.5 8.5A8 8 0 0 0 5.2 7M4.5 15.5A8 8 0 0 0 18.8 17M19.5 4v4.5H15M4.5 20v-4.5H9" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5M12 3.5C9.5 6.1 8.4 8.9 8.4 12s1.1 5.9 3.6 8.5" /></>,
  headset: <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2M4.5 14h3v5H6a1.5 1.5 0 0 1-1.5-1.5zM19.5 14h-3v5H18a1.5 1.5 0 0 0 1.5-1.5zM16.5 19c0 1.4-1.1 2-2.5 2h-1.5" />,
  download: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M12 7v6.5M9.2 10.8 12 13.6l2.8-2.8" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7.5l8 6 8-6" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7.5 14h9" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l1.5 1.5" /></>,
  cycle: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v4h-4" /></>,
  badge: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 19.5c.7-3.4 3.3-5.3 6.5-5.3 1.3 0 2.5.3 3.5.9M15 17.5l2 2 4-4.5" /></>,
};
