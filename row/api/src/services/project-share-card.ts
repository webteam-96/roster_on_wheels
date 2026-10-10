import sharp from "sharp";

/**
 * Port of ProjectShareCardBuilder.cs: the 1200×630 social-preview card for a project share link.
 * RIZones drew it with QuestPDF; ROW draws an SVG and composites the photo with sharp (fonts come from the
 * server's font stack, so line breaks are estimated from character counts).
 */
export interface ProjectShareCardData { title: string; clubDisplayName: string; districtNumber: string; areaOfFocus: string | null; summary: string; footerHost: string; photoBytes: Buffer | null }

const NAVY = "#0B2C5E", NAVY_DEEP = "#08203F", GOLD = "#C8A64B", INK = "#1A1A1A", MUTED = "#5A6472";
const W = 1200, H = 630, PHOTO_W = 470, FOOT = 12, TEXT_X = PHOTO_W + 52, TEXT_W = W - PHOTO_W - 104;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const titleFontSize = (title: string) => (title.length <= 38 ? 46 : title.length <= 60 ? 40 : title.length <= 84 ? 34 : 29);

/** Greedy word wrap by an average glyph width (~0.52 em). */
export function wrap(text: string, fontSize: number, width = TEXT_W): string[] {
  const max = Math.max(8, Math.floor(width / (fontSize * 0.52)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= max) line += " " + word;
    else { lines.push(line); line = word; }
    while (line.length > max) { lines.push(line.slice(0, max)); line = line.slice(max); }
  }
  if (line) lines.push(line);
  return lines;
}

export function looksLikeImage(b: Buffer | null | undefined): boolean {
  if (!b || b.length < 12) return false;
  return (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    || (b[0] === 0x42 && b[1] === 0x4d) || (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP");
}

export async function renderShareCard(d: ProjectShareCardData): Promise<Buffer> {
  const parts: string[] = [];
  const blocks: { lines: string[]; size: number; color: string; weight: number; gapBefore: number; lineHeight: number; spacing?: number }[] = [];
  if (d.areaOfFocus && d.areaOfFocus.trim()) blocks.push({ lines: wrap(d.areaOfFocus.toUpperCase(), 15), size: 15, color: GOLD, weight: 600, gapBefore: 0, lineHeight: 1.3, spacing: 3 });
  const ts = titleFontSize(d.title);
  blocks.push({ lines: wrap(d.title, ts), size: ts, color: NAVY, weight: 700, gapBefore: blocks.length ? 14 : 0, lineHeight: 1.14 });
  const ruleIndex = blocks.length;
  blocks.push({ lines: wrap(d.clubDisplayName, 22), size: 22, color: INK, weight: 600, gapBefore: 45, lineHeight: 1.3 });
  if (d.districtNumber && d.districtNumber.trim()) blocks.push({ lines: [`Rotary International District ${d.districtNumber}`], size: 17, color: MUTED, weight: 400, gapBefore: 5, lineHeight: 1.3 });
  if (d.summary && d.summary.trim()) blocks.push({ lines: wrap(d.summary, 16.5), size: 16.5, color: MUTED, weight: 400, gapBefore: 20, lineHeight: 1.42 });
  if (d.footerHost && d.footerHost.trim()) blocks.push({ lines: [d.footerHost], size: 14, color: NAVY, weight: 600, gapBefore: 22, lineHeight: 1.3, spacing: 1 });
  // Vertically centre the text column against the photo panel.
  const height = blocks.reduce((h, b) => h + b.gapBefore + b.lines.length * b.size * b.lineHeight, 0);
  let y = Math.max(44, (H - FOOT - height) / 2);
  blocks.forEach((b, i) => {
    y += b.gapBefore;
    if (i === ruleIndex) parts.push(`<rect x="${TEXT_X}" y="${y - 25}" width="96" height="5" fill="${GOLD}"/>`);
    for (const line of b.lines) {
      y += b.size * b.lineHeight;
      parts.push(`<text x="${TEXT_X}" y="${y - b.size * (b.lineHeight - 1) / 2}" font-family="Lato, Helvetica, Arial, sans-serif" font-size="${b.size}" font-weight="${b.weight}" fill="${b.color}"${b.spacing ? ` letter-spacing="${b.spacing}"` : ""}>${esc(line)}</text>`);
    }
  });
  const photo = looksLikeImage(d.photoBytes) ? d.photoBytes : null;
  const placeholder = photo ? "" : `<rect width="${PHOTO_W}" height="${H - FOOT}" fill="${NAVY_DEEP}"/>
    <text x="${PHOTO_W / 2}" y="${(H - FOOT) / 2 - 10}" text-anchor="middle" font-family="Lato, Helvetica, Arial, sans-serif" font-size="58" font-weight="700" fill="#FFFFFF" letter-spacing="10">ROTARY</text>
    <rect x="${PHOTO_W / 2 - 75}" y="${(H - FOOT) / 2 + 8}" width="150" height="4" fill="${GOLD}"/>
    <text x="${PHOTO_W / 2}" y="${(H - FOOT) / 2 + 44}" text-anchor="middle" font-family="Lato, Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="${GOLD}" letter-spacing="4">SERVICE PROJECT</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#FFFFFF"/><rect width="${PHOTO_W}" height="${H - FOOT}" fill="${NAVY}"/>${placeholder}${parts.join("")}<rect y="${H - FOOT}" width="${W}" height="${FOOT}" fill="${GOLD}"/></svg>`;
  const layers: sharp.OverlayOptions[] = [];
  if (photo) {
    try {
      // Letterboxed onto the navy panel, never distorted.
      const fitted = await sharp(photo).rotate().resize(PHOTO_W, H - FOOT, { fit: "contain", background: NAVY }).png().toBuffer();
      layers.push({ input: fitted, left: 0, top: 0 });
    } catch {
      // unreadable photo: the navy panel stays empty
    }
  }
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}
