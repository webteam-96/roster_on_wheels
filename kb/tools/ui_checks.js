// In-page UI checks for design_crawl.py. Returns lists of problems a person would see:
//   lowContrast  - visible text whose colour is too close to the background behind it (WCAG ratio < 3)
//   innerScroll  - a small element (tab bar, toolbar) that shows its own vertical scrollbar
//   covered      - a button/link/input hidden under a fixed element (checked at the top and the bottom of the page)
//   pagination   - which pagination style the page uses ("shared" = components/Pagination text, else "custom")
async () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const rgba = (c) => { const m = c.match(/[\d.]+/g) || [0, 0, 0, 0]; return m.length === 3 ? [...m.map(Number), 1] : m.map(Number); };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => {  // first opaque background up the tree, blended over white
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      if (getComputedStyle(e).backgroundImage !== 'none') return null;  // gradient/image: colour unknown, skip
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.99) break;
    }
    let out = [255, 255, 255];
    for (const c of layers.reverse()) out = out.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
    return out;
  };
  const label = (el) => {
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()} "${t}"`;
  };

  const lowContrast = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (lowContrast.length >= 12) break;
    if (el.closest('[disabled],[aria-disabled="true"],svg,script,style')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own || !visible(el)) continue;
    const fg = rgba(getComputedStyle(el).color);
    if (fg[3] < 0.05) continue;
    const bg = bgOf(el);
    if (!bg) continue;
    const fgBlend = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const r = ratio(fgBlend, bg);
    if (r < 3) {
      const key = label(el);
      if (!seen.has(key)) { seen.add(key); lowContrast.push(`${key} ratio ${r.toFixed(2)}`); }
    }
  }

  const innerScroll = [];
  for (const el of document.querySelectorAll('body *')) {
    if (innerScroll.length >= 8) break;
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY) || !visible(el)) continue;
    if (el.clientHeight > 0 && el.clientHeight < 140 && el.scrollHeight > el.clientHeight + 1) {
      innerScroll.push(`${label(el)} h=${el.clientHeight} content=${el.scrollHeight}`);
    }
  }

  const covered = [];
  const fixedOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
  const checkCovered = () => {
    for (const el of document.querySelectorAll('button, a[href], input, select, [role="tab"], [role="button"]')) {
      if (covered.length >= 8) return;
      if (!visible(el) || fixedOf(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      // centre plus four inset corners: a control half under a floating button still counts
      const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
      for (const [px, py] of pts) {
        const x = Math.min(Math.max(r.left + r.width * px, 0), innerWidth - 1);
        const y = Math.min(Math.max(r.top + r.height * py, 0), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (!hit || el.contains(hit) || hit.contains(el)) continue;
        // only position:fixed counts as covering; content scrolling under a sticky header is normal
        let f = null;
        for (let e = hit; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') { f = e; break; }
        if (f && !f.contains(el)) { covered.push(`${label(el)} under ${label(f)}`); break; }
      }
    }
  };
  window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 150)); checkCovered();
  window.scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => setTimeout(r, 300)); checkCovered();
  window.scrollTo(0, 0);

  const text = document.body.innerText;
  let pagination = null;
  if (/Showing \d+-\d+ out of \d+ records/.test(text)) pagination = 'shared';
  else if (/(Page \d+ of \d+|Showing \d+\s*(to|-|–)\s*\d+ of \d+|\bPrevious\b[\s\S]{0,200}\bNext\b)/i.test(text)) pagination = 'custom';

  return { lowContrast, innerScroll, covered: [...new Set(covered)], pagination };
}
