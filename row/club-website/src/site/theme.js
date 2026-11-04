'use client'
// The active theme as the ported pages ask for it (the RIZones club site's ThemeProvider value).
import { useClub } from './ClubContext.jsx'

const THEME8_KEYS = ['cinematic', 'split-story', 'liquid-motion', 'horizontal-journey', 'photo-collage', 'sunrise']

export function useTheme() {
  const theme = useClub().themeKey
  return {
    theme,
    stylesReady: true,
    isClassic: theme === 'classic-blue',
    isWarm: theme === 'warm-modern',
    isMadras: false,
    isCivic: theme === 'civic-bold',
    isVerdigris: theme === 'verdigris-ledger',
    isGold: theme === 'gold',
    isHandloom: false,
    isTheme8: THEME8_KEYS.includes(theme),
  }
}
