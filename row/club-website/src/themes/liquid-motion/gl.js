// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION — the one WebGL canvas (ogl). Loaded on demand by motion.js's
// withGL(), so only wide mouse screens with motion allowed ever fetch it.
//
// One fixed, pointer-transparent canvas paints planes exactly over their DOM
// boxes (read every frame): project photos (liquid reveal edge, chromatic split
// on scroll velocity, hover ripple). The home banners are plain DOM (no hover
// effect, client 2026-09-28).
// The DOM <img> stays underneath and is only hidden (via onGL(true)) after its
// plane has actually drawn - so a texture that never arrives, a CORS refusal or
// a lost context always leaves the plain image, never a black box.
//
// Shared + ref-counted: acquireGL()/releaseGL(). The canvas and context are
// disposed when the last user releases (route change, unmount).
// ─────────────────────────────────────────────────────────────────────────────
import { Renderer, Camera, Transform, Plane, Program, Mesh, Texture, Vec2 } from 'ogl'
import { onScrollVelocity } from './motion.js'

// A fresh URL so a cached non-CORS copy of the same picture is never reused for the texture read.
const texUrl = (u) => u + (u.indexOf('?') < 0 ? '?' : '&') + 'tex=1'
function loadCors(url) {
  return new Promise((res, rej) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.decoding = 'async'
    im.onload = () => (im.naturalWidth ? res(im) : rej(new Error('empty')))
    im.onerror = rej
    im.src = texUrl(url)
  })
}
const GLSL_COMMON = `
precision highp float;
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
vec2 cover(vec2 uv, vec2 plane, vec2 img, float zoom) {
  float pr = plane.x / plane.y;
  float ir = img.x / img.y;
  vec2 s = pr > ir ? vec2(1.0, ir / pr) : vec2(pr / ir, 1.0);
  return (uv - 0.5) * s / zoom + 0.5;
}
`

const CARD_V = `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uVelo;
uniform float uTime;
uniform float uHover;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = modelMatrix * vec4(position, 1.0);
  float bx = sin(uv.x * 3.14159265);
  p.y -= bx * uVelo * min(uSize.y, 640.0) * 0.14;
  p.z += (sin(uv.y * 5.0 + uTime * 2.0) * 0.5 + 0.5) * abs(uVelo) * 80.0;
  p.z += bx * sin(uv.y * 3.14159265) * uHover * 40.0;
  gl_Position = projectionMatrix * viewMatrix * p;
}
`

const CARD_F = GLSL_COMMON + `
uniform sampler2D tMap;
uniform vec2 uImg;
uniform vec2 uSize;
uniform vec2 uMouse;
uniform float uReveal;
uniform float uVelo;
uniform float uTime;
uniform float uHover;
uniform float uPar;
varying vec2 vUv;
void main() {
  float n = snoise(vUv * vec2(2.6, 2.0) + vec2(0.0, uTime * 0.12)) * 0.5 + 0.5;
  float w = 0.22;
  float m = 1.0 - smoothstep(uReveal * (1.0 + w) - w, uReveal * (1.0 + w), vUv.y * 0.72 + n * 0.28);
  float edge = 4.0 * m * (1.0 - m);
  vec2 uv = vUv;
  uv.y -= edge * 0.07 * (n - 0.2);
  vec2 dm = vUv - uMouse;
  dm.x *= uSize.x / uSize.y;
  float dist = length(dm);
  uv += dm / (dist + 0.0001) * sin(dist * 26.0 - uTime * 5.0) * 0.007 * uHover * (1.0 - smoothstep(0.0, 0.55, dist));
  vec2 c = cover(uv, uSize, uImg, 1.1 + 0.18 * (1.0 - uReveal) + 0.06 * uHover);
  c.y += uPar * 0.04;
  float s = uVelo * 0.016;
  vec3 col = vec3(texture2D(tMap, c + vec2(0.0, s)).r, texture2D(tMap, c).g, texture2D(tMap, c - vec2(0.0, s)).b);
  col = mix(col, vec3(0.0, 0.404, 0.784), smoothstep(0.2, 1.0, edge) * 0.7);
  col += vec3(0.969, 0.659, 0.106) * smoothstep(0.93, 1.0, edge) * 0.4;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * m, m);
}
`

let mgr = null
let users = 0

/** The shared manager, or null when this machine has no WebGL. Pair every successful call with releaseGL(). */
export function acquireGL() {
  if (!mgr) mgr = createManager()
  if (mgr) users++
  return mgr
}
export function releaseGL() {
  if (!mgr) return
  users -= 1
  if (users <= 0) { users = 0; mgr.destroy(); mgr = null }
}

function createManager() {
  // Ask for the context ourselves first (same attributes ogl uses), so a machine without WebGL just keeps the DOM images.
  const canvas = document.createElement('canvas')
  const attrs = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }
  let renderer
  try {
    if (!(canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs))) return null
    renderer = new Renderer({ canvas, dpr: Math.min(window.devicePixelRatio || 1, 1.5), ...attrs })
  } catch (e) { return null }
  const gl = renderer.gl
  if (!gl) return null
  gl.clearColor(0, 0, 0, 0)
  canvas.className = 'liq-gl'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)

  const camera = new Camera(gl, { fov: 30, near: 1, far: 20000 })
  const scene = new Transform()
  const geo = new Plane(gl, { widthSegments: 24, heightSegments: 24 })
  const mips = !!renderer.isWebgl2
  const makeTex = (img) => new Texture(gl, { image: img, generateMipmaps: mips, minFilter: mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR })
  const dropTex = (t) => { try { if (t && t.texture) gl.deleteTexture(t.texture) } catch (e) { /* context gone */ } }
  const makeProg = (vertex, fragment, uniforms) => {
    try {
      const p = new Program(gl, { vertex, fragment, uniforms, transparent: true, depthTest: false, depthWrite: false, cullFace: false })
      return gl.getProgramParameter(p.program, gl.LINK_STATUS) ? p : null
    } catch (e) { return null }
  }

  let vw = 1, vh = 1, alive = true, drew = false
  const resize = () => {
    vw = document.documentElement.clientWidth || window.innerWidth
    vh = window.innerHeight
    renderer.setSize(vw, vh)
    camera.perspective({ aspect: vw / vh })
    camera.position.z = (vh / 2) / Math.tan(camera.fov * Math.PI / 360)
    items.forEach((it) => it.resize && it.resize())
  }
  const items = new Set()
  resize()
  window.addEventListener('resize', resize)
  const place = (mesh, r) => {
    mesh.scale.set(r.width, r.height, 1)
    mesh.position.set(r.left + r.width / 2 - vw / 2, vh / 2 - r.top - r.height / 2, 0)
  }

  // one frame per GSAP tick (the shared velocity ticker); idles when nothing is on screen
  const off = onScrollVelocity(({ v, time }) => {
    if (!alive || document.hidden) return
    let any = false
    items.forEach((it) => {
      if (!it.mesh) return
      const r = it.el.getBoundingClientRect()
      const vis = r.bottom > -60 && r.top < vh + 60 && r.width > 0 && r.height > 0
      it.mesh.visible = vis
      if (!vis) return
      any = true
      place(it.mesh, r)
      it.update(it.mesh.program.uniforms, r, v, time)
    })
    if (any || drew) renderer.render({ scene, camera }) // one last empty render clears the canvas
    drew = any
    // hide a DOM image only after its plane has been drawn once
    items.forEach((it) => { if (it.pending && it.mesh && it.mesh.visible) { it.pending = false; it.onGL(true) } })
  })

  const mount = (it, prog) => {
    it.mesh = new Mesh(gl, { geometry: geo, program: prog, frustumCulled: false })
    it.mesh.setParent(scene)
    it.pending = true
  }
  const unmount = (it) => {
    items.delete(it)
    if (it.mesh) { it.mesh.setParent(null); it.textures.forEach(dropTex); it.mesh = null }
    it.onGL(false)
  }

  /** A project photo. `s` = { r (reveal 0..1), hover, mx, my, tx, ty } driven by liquidMedia. */
  function addCard({ el, img, s, onGL }) {
    const it = { el, mesh: null, pending: false, onGL, textures: [], update: null }
    let dead = false
    const go = () => loadCors(img.currentSrc || img.src).then((im) => {
      if (dead || !alive) return
      const tex = makeTex(im)
      it.textures.push(tex)
      const U = {
        tMap: { value: tex }, uImg: { value: new Vec2(im.naturalWidth, im.naturalHeight) },
        uSize: { value: new Vec2(1, 1) }, uMouse: { value: new Vec2(0.5, 0.5) },
        uReveal: { value: 0 }, uVelo: { value: 0 }, uTime: { value: 0 }, uHover: { value: 0 }, uPar: { value: 0 },
      }
      const prog = makeProg(CARD_V, CARD_F, U)
      if (!prog) return
      it.update = (u, r, v, time) => {
        s.mx += (s.tx - s.mx) * 0.12
        s.my += (s.ty - s.my) * 0.12
        u.uSize.value.set(r.width, r.height)
        u.uReveal.value = s.r
        u.uHover.value = s.hover
        u.uMouse.value.set(s.mx, s.my)
        u.uVelo.value = v
        u.uTime.value = time
        u.uPar.value = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh))
      }
      mount(it, prog)
    }).catch(() => { /* CORS refused or failed: the DOM image stays */ })
    if (img.complete && img.naturalWidth) go()
    else img.addEventListener('load', go, { once: true })
    items.add(it)
    return () => { dead = true; img.removeEventListener('load', go); unmount(it) }
  }

  function destroy() {
    if (!alive) return
    alive = false
    off()
    window.removeEventListener('resize', resize)
    ;[...items].forEach(unmount)
    canvas.remove()
    const lose = gl.getExtension('WEBGL_lose_context')
    if (lose) lose.loseContext()
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    destroy()
    if (mgr && mgr.destroy === destroy) { mgr = null; users = 0 }
  })

  return { addCard, destroy }
}
