import { useEffect, useRef, useState } from 'react'
import styles from './RotaryLoader.module.css'
// The reference app imports this from src/assets; here it is served from public/.
const wheelUrl = '/images/logo/wheel.png'

const EXIT_MS = 700 // must match the .diving / tunnel duration in the CSS module
const EXIT_REDUCED_MS = 300

/**
 * Full-screen "Glide & Tunnel" Rotary loader.
 *
 * Lifecycle: glide in (once) → spin continuously while waiting →
 * tunnel-dive out (once) → unmount → reveal the page beneath.
 *
 * @param {object}   props
 * @param {boolean} [props.active=true]      True while loading; flip to false to trigger the exit.
 * @param {number}  [props.duration=1200]    Glide-in duration (ms).
 * @param {number}  [props.minDuration=1400] Minimum on-screen time (ms) so it never just flashes.
 * @param {number}  [props.spinSpeed=0.9]    Seconds per wheel rotation.
 * @param {boolean} [props.loop=false]       Demo mode: loop glide+tunnel instead of glide→spin→exit.
 * @param {string}  [props.background]       Override the overlay background.
 * @param {string}  [props.label]            Optional text shown under the wheel.
 * @param {() => void} [props.onFinished]    Fires after the exit animation completes and it unmounts.
 */
export default function RotaryLoader({
  active = true,
  duration = 1200,
  minDuration = 1400,
  spinSpeed = 0.9,
  loop = false,
  background,
  label,
  onFinished,
}) {
  const [rendered, setRendered] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const mountedAt = useRef(Date.now())
  const onFinishedRef = useRef(onFinished)
  const reduced = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  // keep the latest callback without re-running the exit effect
  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  // re-show fresh whenever `active` flips back to true (e.g. a new page opens)
  useEffect(() => {
    if (!active) return
    mountedAt.current = Date.now()
    setLeaving(false)
    setRendered(true)
  }, [active])

  // lock body scroll while the overlay is visible; restore on unmount
  useEffect(() => {
    if (!rendered) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [rendered])

  // drive the exit when `active` flips to false, honouring minDuration
  useEffect(() => {
    if (loop || active || !rendered) return undefined
    let exitTimer
    const elapsed = Date.now() - mountedAt.current
    const wait = Math.max(0, minDuration - elapsed)
    const startTimer = setTimeout(() => {
      setLeaving(true)
      exitTimer = setTimeout(() => {
        setRendered(false)
        onFinishedRef.current?.()
      }, reduced.current ? EXIT_REDUCED_MS : EXIT_MS)
    }, wait)
    return () => {
      clearTimeout(startTimer)
      if (exitTimer) clearTimeout(exitTimer)
    }
  }, [active, loop, minDuration, rendered])

  if (!rendered) return null

  const style = {
    '--glide': `${duration}ms`,
    '--spin': `${spinSpeed}s`,
    ...(background ? { background } : null),
  }

  return (
    <div
      className={`${styles.overlay} ${leaving ? styles.leaving : ''}`}
      style={style}
      role="status"
      aria-live="polite"
      aria-busy={active}
    >
      <div
        className={`${styles.outer} ${leaving ? styles.diving : ''} ${loop ? styles.loop : ''}`}
      >
        <span aria-hidden="true" className={styles.ring} />
        <div className={styles.inner}>
          <img src={wheelUrl} alt="" className={styles.wheel} draggable="false" />
        </div>
      </div>
      {label && <p className={styles.label}>{label}</p>}
      <span className="sr-only">Loading…</span>
    </div>
  )
}
