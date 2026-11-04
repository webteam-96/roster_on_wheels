// HORIZONTAL JOURNEY · GALLERY — this theme has no gallery page (client, 2026-09-29):
// an old /gallery link or bookmark lands on the home page instead.
import { Navigate } from '@/site/router.js'

export default function Gallery({ data }) {
  return <Navigate to="/" replace />
}
