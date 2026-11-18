// HORIZONTAL JOURNEY · GALLERY — this theme has no gallery page (client, 2026-09-29):
// an old /gallery link or bookmark lands on the home page instead.
import { Navigate } from 'react-router-dom'

export default function Gallery() {
  return <Navigate to="/" replace />
}
