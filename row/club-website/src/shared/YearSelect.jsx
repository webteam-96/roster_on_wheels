// The Rotary-year <select> every layout's header carries.
//
// Replaces rotary-anim.js's initYearSelect(), which is deliberately NOT loaded
// in the SPA: it navigated with window.location.href (a full reload) and rewrote
// the address bar with history.replaceState behind the router's back. Behaviour
// is otherwise identical — picking a year re-renders the page for that year, and
// ClubProvider strips the param again afterwards on non-detail pages.
//
// Rendered UNCONTROLLED on purpose: civic-bold's initYearPicker() hides this
// <select>, builds a button + listbox next to it and dispatches a native
// `change` on it. A React-controlled value would fight that, and React's
// synthetic onChange can miss a programmatic dispatch — so the listener is
// attached natively via a ref.
import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import { formatYear } from './menus.js'

export default function YearSelect({ className, 'aria-label': ariaLabel = 'Select Rotary year' }) {
  const { years, selectedYearId } = useClub()
  const navigate = useNavigate()
  const location = useLocation()
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => {
      const params = new URLSearchParams(location.search)
      params.set('yearId', el.value)
      navigate(location.pathname + '?' + params.toString() + location.hash)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [navigate, location.pathname, location.search, location.hash])

  // Keep the DOM value in step when the year changes from elsewhere (a
  // WithYear() link, a ?yearId= deep link) without re-rendering the subtree.
  useEffect(() => {
    if (ref.current && selectedYearId != null) ref.current.value = String(selectedYearId)
  }, [selectedYearId, years])

  const options = useMemo(() => {
    if (!years || years.length === 0) {
      return <option value="" disabled>Select Year</option>
    }
    return years.map((y) => (
      <option key={y.id} value={y.id}>{formatYear(y.yearLabel)}</option>
    ))
  }, [years])

  return (
    <select
      ref={ref}
      data-year-select
      aria-label={ariaLabel}
      className={className}
      defaultValue={selectedYearId == null ? '' : String(selectedYearId)}
    >
      {options}
    </select>
  )
}
