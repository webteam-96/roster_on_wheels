import { useEffect, useRef } from 'react'

// React Bits-style "Squares" — a light, slowly drifting grid of squares with a
// gold highlight that follows the cursor and a soft vignette so the edges fade
// into the page. Pure canvas (no deps). Respects reduced-motion.
export default function Squares({
  className = '',
  size = 46,
  speed = 0.35,
  line = 'rgba(10, 36, 114, 0.07)',
  hover = 'rgba(247, 166, 0, 0.22)',
  fade = '248, 249, 251', // canvas colour the edges fade to
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let off = 0
    let raf = 0
    const mouse = { x: -1, y: -1 }

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const render = (animate) => {
      if (animate) off = (off + speed) % size
      ctx.clearRect(0, 0, w, h)
      const start = -off
      for (let x = start; x < w; x += size) {
        for (let y = start; y < h; y += size) {
          if (mouse.x >= x && mouse.x < x + size && mouse.y >= y && mouse.y < y + size) {
            ctx.fillStyle = hover
            ctx.fillRect(x, y, size, size)
          }
          ctx.strokeStyle = line
          ctx.lineWidth = 1
          ctx.strokeRect(x, y, size, size)
        }
      }
      // vignette: transparent centre → canvas colour at the edges
      const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) / 1.15)
      g.addColorStop(0, `rgba(${fade}, 0)`)
      g.addColorStop(0.6, `rgba(${fade}, 0.25)`)
      g.addColorStop(1, `rgba(${fade}, 0.92)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    const loop = () => {
      render(true)
      raf = requestAnimationFrame(loop)
    }

    resize()
    if (reduce) render(false)
    else raf = requestAnimationFrame(loop)

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect()
      mouse.x = e.clientX - r.left
      mouse.y = e.clientY - r.top
    }
    const onLeave = () => {
      mouse.x = -1
      mouse.y = -1
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeave)
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      window.removeEventListener('resize', resize)
    }
  }, [size, speed, line, hover, fade])

  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none ${className}`} />
}
