'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC — banners without their letterbox.
//
// The dashboard locks banners to 16:5, so a club that uploads an ordinary photo
// gets it pasted onto a flat white (sometimes black) canvas - the "white
// sections" at its sides. This finds that flat border and crops it off in the
// browser, so the hero shows only the photograph and can fill its frame.
//
// Needs a CORS read of the pixels: the media server answers every origin
// (checked 2026-09-25), and anything that fails - no CORS, no canvas, a broken
// file - simply keeps the original image. Results are cached per image for the
// page's life, so the home and every return to it trim once.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { findContent } from './trimCore.js'

const cache = new Map()          // banner -> Promise<{ src }|null>: the cropped photo (object URL) or its CORS copy
const SAMPLE = 240               // columns analysed; plenty to find a border, cheap to scan

// The pixels must come from a CORS response. The media server only adds its
// Access-Control-Allow-Origin header (and Vary: Origin) when asked with an
// Origin, so a copy the browser already cached from a plain <img> has neither -
// and Chrome reuses it for the CORS request, which then fails. A marked URL is
// its own cache entry, always fetched with CORS.
const corsUrl = (src) => src + (src.indexOf('?') >= 0 ? '&' : '?') + 't8trim=1'

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** The cropped photo's object URL, or the CORS copy's URL when there is no border to cut. */
async function trim(src) {
  const url = corsUrl(src)
  const img = await load(url)
  const W = img.naturalWidth, H = img.naturalHeight
  if (!W || !H) return null
  const sw = SAMPLE, sh = Math.max(8, Math.round((H * SAMPLE) / W))
  const probe = document.createElement('canvas')
  probe.width = sw; probe.height = sh
  const pc = probe.getContext('2d', { willReadFrequently: true })
  pc.drawImage(img, 0, 0, sw, sh)
  const cut = findContent(pc.getImageData(0, 0, sw, sh).data, sw, sh)   // throws if the read is not allowed
  if (!cut) return url
  const cx = Math.round(cut.x * W), cy = Math.round(cut.y * H)
  const cw = Math.max(1, Math.round(cut.w * W)), ch = Math.max(1, Math.round(cut.h * H))
  const out = document.createElement('canvas')
  out.width = cw; out.height = ch
  out.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch)
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92))
  return blob ? URL.createObjectURL(blob) : url
}

/** The cropped photo for a banner, trying its fallback URLs in order; null = show it as uploaded. */
export function trimmedBanner(b) {
  const list = [b.src, ...String(b.fallbacks || '').split('|')].filter(Boolean)
  const key = list.join('|')
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      for (const src of list) {
        try { return { src: await trim(src) } } catch { /* next candidate */ }
      }
      return null
    })())
  }
  return cache.get(key)
}

/**
 * The banners with their letterbox cut off. `list` stays empty until every
 * banner is settled (or `wait` ms pass): no plain <img> may request a banner
 * first, and the hero never flashes the uncropped picture.
 */
export function useTrimmedBanners(banners, wait = 2500) {
  const key = banners.map((b) => b.src).join('|')
  const [state, setState] = useState({ key: '', list: [], done: false })
  useEffect(() => {
    if (!banners.length) { setState({ key, list: [], done: false }); return undefined }
    let live = true
    setState({ key, list: banners, done: false })
    const timer = setTimeout(() => { if (live) setState((s) => (s.key === key ? { ...s, done: true } : s)) }, wait)
    Promise.all(banners.map((b) => trimmedBanner(b).catch(() => null))).then((res) => {
      if (!live) return
      clearTimeout(timer)
      setState({ key, done: true, list: banners.map((b, i) => (res[i] && res[i].src ? { ...b, src: res[i].src, fallbacks: b.src + (b.fallbacks ? '|' + b.fallbacks : '') } : b)) })
    })
    return () => { live = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (state.key !== key || !state.done) return { list: [], done: false }
  return state
}
