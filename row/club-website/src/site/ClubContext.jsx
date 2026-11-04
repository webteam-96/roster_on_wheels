'use client'
// The club context every ported theme component reads through useClub(). The server (site/shell.ts) resolves the
// club, year, about and menus once per request and hands them in, so components render on the server with data.
import { createContext, useContext } from 'react'

const Ctx = createContext(null)

export function ClubProvider({ value, children }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** @returns {import('./SitePage').ClubState} */
export function useClub() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useClub must be used inside <ClubProvider>')
  return v
}

/** Start year of the current Rotary year (1 July to 30 June), e.g. 2026 for 2026-27. */
export function currentRotaryYearStart() {
  const now = new Date()
  const y = now.getUTCFullYear()
  return now.getUTCMonth() + 1 >= 7 ? y : y - 1
}

/** The current Rotary year as "2026-27". */
export function currentRotaryYearLabel() {
  const start = currentRotaryYearStart()
  return start + '-' + String((start + 1) % 100).padStart(2, '0')
}
