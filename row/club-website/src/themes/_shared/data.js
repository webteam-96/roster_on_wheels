// ─────────────────────────────────────────────────────────────────────────────
// Theme 8 family — ONE import surface for everything a theme needs from the
// port's data layer.
//
// Theme 8 themes are new designs, not new rules. What the content IS (which
// projects count, what a Rotary year bounds, how a bio becomes safe HTML, the
// per-project metric back-fill, the calendar events workaround) is already
// implemented once — in the shared pages, and assembled for bespoke designs by
// src/pages/gold/goldData.js ("owns no rules of its own"). This file only gives
// those hooks neutral names. Never re-implement a rule in a theme: import it
// from here, and if something is missing, add it HERE by re-exporting.
// ─────────────────────────────────────────────────────────────────────────────

// ── club context, routing, menus ─────────────────────────────────────────────
export { useClub, currentRotaryYearLabel, currentRotaryYearStart } from '@/site/ClubContext.jsx'
export { useTheme } from '@/site/theme.js'
export { useMenus, titleCase, menuHref, menuExternal, socialLabel, formatYear, LOGO_PLACEHOLDER } from '@/site/menus.js'
export { routeKey, toRoute } from '@/site/routes.js'
export { default as YearSelect } from '@/site/YearSelect.jsx'
export { default as VisitorCount } from '@/themes/shared/visitorCount.jsx'
export { useThemeShell, useLoader, useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

// ── helpers (formatting, media, titles) ──────────────────────────────────────
export {
  media, withYear, externalUrl, wrappableHtml, initials, avenueLabel, avenueColor, avenueCode,
  usePageTitle, wheelFallback, WHEEL_SRC,
} from '@/themes/shared/rotaryPage.js'
export { formatMoney, groupInt, groupIntBlankZero, moneySymbol, DEFAULT_CURRENCY } from '@/themes/shared/money.js'
export { formatDate, formatTime, buildProjectStatTiles, mediaCandidates, slideLink, adAnchorProps } from '@/themes/shared/homeData.js'

/**
 * Admin HTML -> plain text with EVERY entity decoded (&rsquo; &ndash; &#8217;...).
 * homeData's plainText only knows a handful, and goldData's parses into a live
 * detached <div>, where an <img onerror> still runs. A DOMParser document is
 * inert: nothing in it loads or executes.
 */
export function plainText(html) {
  if (!html || !String(html).trim()) return ''
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}
export { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'

// ── home page ────────────────────────────────────────────────────────────────
// Banners, ads, about excerpt, meeting, BOD, featured projects, impact numbers,
// newsletters, events, dignitaries — everything the released homes render.
export { useHomeData, getImpactNumbersForYear } from '@/themes/shared/homeData.js'

// ── inner pages (one hook per page; read goldData.js for each return shape) ──
export {
  useAboutGold as useAboutData,
  useProjectsGold as useProjectsData,          // (isMeetings) - ?pr=CE is the club-service feed
  useProjectFacets,                            // (d, { avenue, area, sub, sc, type }) - the faceted dropdowns
  useAllYearsTotals,                           // (d, matched) - all-years figures for the filtered set
  useProjectGold as useProjectData,            // (pid, demoChild) -> { p, notFound }
  useDirectoryGold as useDirectoryData,        // -> members | null while loading
  useDirectorsGold as useDirectorsData,
  usePastPresidentsGold as usePastPresidentsData,
  useNewslettersGold as useNewslettersData,
  useGalleryGold as useGalleryData,            // (page) - GALLERY_PAGE_SIZE per page
  useEventsGold as useEventsData,
  useEventGold as useEventData,                // (id)
  useCalendarGold as useCalendarData,          // (year, month)
  useDignitaryGold as useDignitaryData,        // (type) - ?type= from the URL
  GALLERY_PAGE_SIZE, monthName, dayLabelOf, fullDayLabelOf,
} from '@/themes/gold/pages/goldData.js'

// ── shared interactive pieces ────────────────────────────────────────────────
export { useProjectShare, shareChannels, sharePopup, SHARE_ICONS, shareUrlFor } from '@/themes/shared/projectShare.jsx'
export { default as PhotoLightbox, LightboxStyles } from '@/themes/shared/PhotoLightbox.jsx'
