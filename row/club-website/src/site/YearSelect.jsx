'use client'
// Rotary-year picker used by every theme shell. The choice is kept in the rotary-year cookie (read by
// site/shell.ts on the server), so links stay clean and every page follows the picked year.
import { useRouter } from 'next/navigation'
import { useClub } from './ClubContext.jsx'
import { formatYear } from './menus.js'

export const YEAR_COOKIE = 'rotary-year'

export default function YearSelect({ className, 'aria-label': ariaLabel = 'Select Rotary year' }) {
  const { years, selectedYearId } = useClub()
  const router = useRouter()

  const onChange = (e) => {
    const id = e.target.value
    if (!/^\d+$/.test(id)) return
    document.cookie = YEAR_COOKIE + '=' + id + '; path=/; max-age=31536000; samesite=lax'
    router.refresh()
  }

  return (
    <select
      data-year-select
      aria-label={ariaLabel}
      className={className}
      value={selectedYearId == null ? '' : String(selectedYearId)}
      onChange={onChange}
    >
      {!years || years.length === 0
        ? <option value="" disabled>Select Year</option>
        : years.map((y) => <option key={y.id} value={y.id}>{formatYear(y.yearLabel)}</option>)}
    </select>
  )
}
