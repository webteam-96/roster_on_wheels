'use client'
// The few react-router hooks the ported RIZones pages call, backed by Next.js navigation.
import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation'

export function useLocation() {
  const pathname = usePathname() || '/'
  const query = useNextSearchParams()
  const qs = query ? query.toString() : ''
  const search = qs ? '?' + qs : ''
  return { pathname, search, hash: '', key: pathname + search, state: null }
}

export function useNavigate() {
  const router = useRouter()
  return (to, opts) => (opts && opts.replace ? router.replace(String(to)) : router.push(String(to)))
}

export function useSearchParams() {
  const query = useNextSearchParams()
  const pathname = usePathname() || '/'
  const router = useRouter()
  const params = new URLSearchParams(query ? query.toString() : '')
  const setParams = (next, opts) => {
    const value = typeof next === 'function' ? next(params) : next
    const qs = new URLSearchParams(value).toString()
    const url = pathname + (qs ? '?' + qs : '')
    return opts && opts.replace ? router.replace(url, { scroll: false }) : router.push(url, { scroll: false })
  }
  return [params, setParams]
}

/** <Navigate to="..." replace />: redirect once mounted. */
export function Navigate({ to, replace }) {
  const router = useRouter()
  useEffect(() => {
    if (replace) router.replace(String(to))
    else router.push(String(to))
  }, [router, to, replace])
  return null
}
