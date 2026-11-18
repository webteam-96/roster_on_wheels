// node src/themes/cinematic/trimCore.check.mjs  - throws if the border finder breaks
import assert from 'node:assert/strict'
import { findContent } from './trimCore.js'

// w x h RGBA image: `fill` everywhere, `photo(x, y)` inside [x0,x1) x [y0,y1)
function img(w, h, fill, box, photo) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = box && x >= box[0] && x < box[1] && y >= box[2] && y < box[3]
    const c = inside ? photo(x, y) : fill
    d.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
  }
  return d
}
const noisy = (x, y) => [(x * 37 + y * 11) % 200 + 20, (x * 13 + y * 29) % 200 + 20, (x * 7 + y * 17) % 200 + 20]

// a photo pasted in the middle of a white 16:5 canvas -> its box, less one sample of margin
let c = findContent(img(240, 75, [255, 255, 255], [40, 200, 0, 75], noisy), 240, 75)
assert.ok(c, 'white letterbox found')
assert.ok(Math.abs(c.x - 41 / 240) < 0.01 && Math.abs(c.w - 158 / 240) < 0.01, 'sides cut to the photo: ' + JSON.stringify(c))
assert.equal(c.y, 0); assert.equal(c.h, 1)

// a full-bleed photo -> nothing to cut
assert.equal(findContent(img(240, 75, [0, 0, 0], [0, 240, 0, 75], noisy), 240, 75), null)

// black bars top and bottom are cut too
c = findContent(img(240, 120, [0, 0, 0], [0, 240, 20, 100], noisy), 240, 120)
assert.ok(c && c.y > 0.16 && c.h < 0.68, 'black bars cut: ' + JSON.stringify(c))

// a mostly flat designed graphic (tiny content) is left whole
assert.equal(findContent(img(240, 75, [255, 255, 255], [110, 130, 30, 45], noisy), 240, 75), null)

console.log('trimCore: all checks pass')
