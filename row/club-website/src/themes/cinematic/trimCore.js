// The pure half of bannerTrim.js: find a photo inside a flat border. No DOM, no
// React - `node trimCore.check.mjs` exercises it.
const TOL = 42      // summed RGB distance still counted as "the border colour"
const FILL = 0.97   // share of a column/row that must be border for it to be border

export { findContent }

/** The photo's box inside its flat border, as fractions of the image, or null when there is no border to cut. */
function findContent(data, w, h) {
  const at = (x, y) => { const k = (y * w + x) * 4; return [data[k], data[k + 1], data[k + 2]] }
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= TOL
  const colIs = (x, ref) => { let n = 0; for (let y = 0; y < h; y++) if (near(at(x, y), ref)) n++; return n / h >= FILL }
  const rowIs = (y, ref, x0, x1) => { let n = 0; for (let x = x0; x <= x1; x++) if (near(at(x, y), ref)) n++; return n / (x1 - x0 + 1) >= FILL }

  let l = 0, r = w - 1
  const refL = at(0, h >> 1), refR = at(w - 1, h >> 1)
  while (l < w * 0.45 && colIs(l, refL)) l++
  while (r > w * 0.55 && colIs(r, refR)) r--
  let t = 0, b = h - 1
  const refT = at((l + r) >> 1, 0), refB = at((l + r) >> 1, h - 1)
  while (t < h * 0.45 && rowIs(t, refT, l, r)) t++
  while (b > h * 0.55 && rowIs(b, refB, l, r)) b--

  // one sample column/row further in, so no anti-aliased edge of the border survives
  if (l > 0) l++
  if (r < w - 1) r--
  if (t > 0) t++
  if (b < h - 1) b--
  const cut = { x: l / w, y: t / h, w: (r - l + 1) / w, h: (b - t + 1) / h }
  if (cut.w > 0.97 && cut.h > 0.97) return null            // no real border
  if (cut.w < 0.3 || cut.h < 0.3) return null              // mostly flat: a designed graphic, leave it whole
  return cut
}

