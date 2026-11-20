// Router + the two things RotaryPage.cs does for every page:
//   OnPreInit — swap the master to the resolved theme's shell
//   OnInit    — the subscription/config gate (unmapped host -> SiteNotConfigured,
//               expired/trial_expired -> ExpiredWebsite), applied on EVERY page so
//               deep links can't bypass it. A page opts out via bypassGate.
import { Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom'
import { useClub } from './context/ClubProvider.jsx'
import { useTheme } from './theme/ThemeProvider.jsx'
import { useDefaultPageTitle } from './shared/rotaryPage.js'
import RotaryLoader from './components/RotaryLoader/RotaryLoader.jsx'
import { ALL_ROUTES } from './routes.js'

import SiteRotary from './layouts/SiteRotary.jsx'
import SiteWarmModern from './layouts/SiteWarmModern.jsx'
import SiteCivicBold from './layouts/SiteCivicBold.jsx'
import SiteVerdigrisLedger from './layouts/SiteVerdigrisLedger.jsx'
import SiteGold from './layouts/SiteGold.jsx'
import SiteHandloom from './layouts/SiteHandloom.jsx'

import Home from './pages/Home.jsx'
import HomeWarmModern from './pages/HomeWarmModern.jsx'
import HomeCivicBold from './pages/HomeCivicBold.jsx'
import HomeVerdigrisLedger from './pages/HomeVerdigrisLedger.jsx'
import HomeGold from './pages/HomeGold.jsx'
import HomeHandloom from './pages/HomeHandloom.jsx'

import AboutUs from './pages/AboutUs.jsx'
import AllProjects from './pages/AllProjects.jsx'
import AllSpecialDates from './pages/AllSpecialDates.jsx'
import Diginitary from './pages/diginitary.jsx'
import Directors from './pages/Directors.jsx'
import Directory from './pages/Directory.jsx'
import Donate from './pages/Donate.jsx'
import EventDetail from './pages/EventDetail.jsx'
import ExpiredWebsite from './pages/ExpiredWebsite.jsx'
import Gallery from './pages/Gallery.jsx'
import Newsletter from './pages/Newsletter.jsx'
import Stories from './pages/Stories.jsx'
import BulletinSignup from './pages/BulletinSignup.jsx'
import PastPresidents from './pages/PastPresidents.jsx'
import ProjectDetail from './pages/ProjectDetail.jsx'
import SiteNotConfigured from './pages/SiteNotConfigured.jsx'
import UnderMaintenance from './pages/under_maintenance.jsx'
import UpcomingEvent from './pages/UpcomingEvent.jsx'
import BusinessDirectory from './pages/BusinessDirectory.jsx' // Member map + business directory (gap agent)
// Website builder (gap agent): custom pages at /p/<slug> and the published home layout.
import CustomPage from './pages/CustomPage.jsx'
import PageSections from './shared/PageSections.jsx'
import Skeleton from './shared/Skeleton.jsx'
import { useWebsitePage, isCustomPagePath } from './shared/websitePages.js'
import Search from './pages/Search.jsx'
import Social from './pages/Social.jsx'
import SiteThirdParty from './shared/ThirdParty.jsx'

// Gold ships its own design for every inner page — see src/pages/gold.
import * as Gold from './pages/gold/index.js'
// Theme 8 family: each theme's shell, home and pages, found by file name.
import { THEME8 } from './themes/registry.js'

const LAYOUTS = {
  'classic-blue': SiteRotary,
  'warm-modern': SiteWarmModern,
  'civic-bold': SiteCivicBold,
  'verdigris-ledger': SiteVerdigrisLedger,
  gold: SiteGold,
  handloom: SiteHandloom,
}

/** RotaryPage.OnPreInit — every content page renders inside the theme's shell. */
function Themed({ children }) {
  const { theme } = useTheme()
  const t8 = THEME8[theme]
  const Layout = (t8 && t8.Layout) || LAYOUTS[theme] || SiteRotary
  // Theme 8 shells are lazy chunks (preloaded before the boot loader lifts).
  return t8 ? <Suspense fallback={null}><Layout>{children}</Layout></Suspense> : <Layout>{children}</Layout>
}

/**
 * RotaryPage.OnInit — the subscription/config gate. Runs before any page content
 * so a deep link into an expired club's Directory redirects too.
 */
function Gate({ children, bypass = false }) {
  const club = useClub()
  if (bypass || club.loading) return children
  if (!club.isConfigured) return <Navigate to="/not-configured" replace />
  const status = String(club.status || '').toLowerCase()
  if (status === 'expired' || status === 'trial_expired') {
    return <Navigate to="/expired" replace />
  }
  return children
}

/** A gated page inside the resolved theme's shell — the common case. */
function Page({ element }) {
  return <Gate><Themed>{element}</Themed></Gate>
}

/**
 * Gold is the one theme whose inner pages are not the shared design system: it
 * has a bespoke composition per page (src/pages/gold). Every other theme keeps
 * the shared page, so this is the only place that has to know.
 *
 * Both elements are constructed on every render, which costs nothing — a React
 * element is a plain object until something renders it.
 */
function Swap({ shared, gold, page }) {
  const { theme, isGold } = useTheme()
  // Theme 8: the theme's own page when it has one (src/themes/<key>/pages/<page>.jsx),
  // else the shared page inside the theme's shell.
  const T8Page = THEME8[theme] && page ? THEME8[theme].pages[page] : null
  if (T8Page) return <Suspense fallback={null}><T8Page /></Suspense>
  return isGold ? gold : shared
}

/**
 * /projects/<id> -> /project?pid=<id>.
 *
 * The pretty path is what the API's share endpoint puts in every share link, so
 * it has to resolve here. A redirect rather than a second mount of the detail
 * page: one canonical URL for the project keeps the "Back" origin (?pr=CE) and
 * the ?yearId= carry-over working, and there is only one place to change if the
 * detail route ever moves. Query and hash ride along; a non-numeric id falls
 * through to the catch-all.
 */
function ProjectPermalink() {
  const { pid } = useParams()
  const location = useLocation()
  if (!/^\d+$/.test(String(pid || ''))) return <Navigate to="/" replace />
  const extra = location.search.replace(/^\?/, '')
  return <Navigate replace to={'/project?pid=' + pid + (extra ? '&' + extra : '') + location.hash} />
}

/**
 * Home.aspx Server.Transfers to the theme's own Home in the ASP.NET build
 * (Home.aspx.cs). Same switch here.
 */
function HomeSwitch() {
  const { theme } = useTheme()
  const { clubId } = useClub()
  // Website builder: a published home layout replaces the theme's home content; the theme shell stays.
  const [layout] = useWebsitePage(clubId, 'home')
  if (layout === undefined) return <section className="py-12"><div className="container-x"><Skeleton label="Loading" /></div></section>
  if (layout.status === 'ok') return <PageSections page={layout.page} />
  const t8 = THEME8[theme]
  if (t8 && t8.Home) return <Suspense fallback={null}><t8.Home /></Suspense>
  if (theme === 'warm-modern') return <HomeWarmModern />
  if (theme === 'civic-bold') return <HomeCivicBold />
  if (theme === 'verdigris-ledger') return <HomeVerdigrisLedger />
  if (theme === 'gold') return <HomeGold />
  if (theme === 'handloom') return <HomeHandloom />
  return <Home />
}

/**
 * The site's markup is full of plain <a href="/about"> links (many produced by
 * string-built HTML rather than JSX), so instead of rewriting every one as
 * <Link>, intercept internal clicks and route them. Keeps the rendered DOM
 * identical to the Web Forms output.
 */
function useAnchorInterceptor() {
  const navigate = useNavigate()
  useEffect(() => {
    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target.closest && e.target.closest('a[href]')
      if (!a) return
      if (a.target && a.target !== '' && a.target !== '_self') return
      if (a.hasAttribute('download')) return

      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return

      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Only same-origin links to a route this app serves. Uploaded PDFs and
      // images live under the same origin too and must keep their normal
      // browser behaviour.
      const routePath = url.pathname.replace(/\/+$/, '') || '/'
      if (!ALL_ROUTES.has(routePath) && !isCustomPagePath(routePath)) return

      // Carry the visitor's chosen Rotary year across the navigation. Without
      // this, picking 2025-26 on Projects and clicking Directors silently
      // snapped back to the current year — the year picker looked broken. Only
      // when the CURRENT url carries one (i.e. a year was actually picked) and
      // the target link doesn't already name its own.
      const here = new URLSearchParams(window.location.search).get('yearId')
      if (here && !url.searchParams.has('yearId')) url.searchParams.set('yearId', here)

      e.preventDefault()
      navigate(url.pathname + url.search + url.hash)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [navigate])
}

/** Web Forms serves a fresh document per navigation, so every page starts at the top. */
function useScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
}

export default function App() {
  const club = useClub()
  const { stylesReady } = useTheme()
  // one-shot: once the loader has flown out it must not come back on a later
  // theme change (stylesReady dips false whenever the theme switches).
  const [bootDone, setBootDone] = useState(false)
  useAnchorInterceptor()
  useScrollToTop()
  // RotaryMasterBase.OnLoad defaults the title to the club name; only pages that
  // never call usePageTitle/Breadcrumb fall through to it.
  useDefaultPageTitle(club.clubDisplayName)

  // Don't mount a themed shell until the theme is actually known and its
  // stylesheet has loaded — otherwise a non-classic club gets ~300-450ms of the
  // classic-blue shell first and every entrance animation plays twice, against
  // two different themes.
  //
  // The cover is the reference app's "Glide & Tunnel" RotaryLoader: the wheel
  // glides in from the left, spins while we wait, then tunnel-dives out to
  // reveal the page. The Web Forms port could only manage a static spinning
  // wheel, which is why that animation went missing.
  const booting = club.loading || !stylesReady

  return (
    <>
      {!bootDone && (
        <RotaryLoader
          active={booting}
          label={club.clubName || undefined}
          onFinished={() => setBootDone(true)}
        />
      )}
      {booting ? null : <><AppRoutes /><SiteThirdParty /></>}
    </>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Page element={<HomeSwitch />} />} />

      {/* The theme Homes are also reachable directly, each pinned to its own shell. */}
      <Route path="/home-warm-modern" element={<Gate><SiteWarmModern><HomeWarmModern /></SiteWarmModern></Gate>} />
      <Route path="/home-civic-bold" element={<Gate><SiteCivicBold><HomeCivicBold /></SiteCivicBold></Gate>} />
      <Route path="/home-verdigris-ledger" element={<Gate><SiteVerdigrisLedger><HomeVerdigrisLedger /></SiteVerdigrisLedger></Gate>} />
      <Route path="/home-gold" element={<Gate><SiteGold><HomeGold /></SiteGold></Gate>} />
      <Route path="/home-handloom" element={<Gate><SiteHandloom><HomeHandloom /></SiteHandloom></Gate>} />

      <Route path="/about" element={<Page element={<Swap shared={<AboutUs />} gold={<Gold.AboutGold />} page="About" />} />} />
      <Route path="/projects" element={<Page element={<Swap shared={<AllProjects />} gold={<Gold.ProjectsGold />} page="Projects" />} />} />
      <Route path="/calendar" element={<Page element={<Swap shared={<AllSpecialDates />} gold={<Gold.CalendarGold />} page="Calendar" />} />} />
      <Route path="/dignitary" element={<Page element={<Swap shared={<Diginitary />} gold={<Gold.DignitaryGold />} page="Dignitary" />} />} />
      <Route path="/directors" element={<Page element={<Swap shared={<Directors />} gold={<Gold.DirectorsGold />} page="Directors" />} />} />
      <Route path="/donate" element={<Page element={<Donate />} />} />
      <Route path="/directory" element={<Page element={<Swap shared={<Directory />} gold={<Gold.DirectoryGold />} page="Directory" />} />} />
      <Route path="/event" element={<Page element={<Swap shared={<EventDetail />} gold={<Gold.EventDetailGold />} page="EventDetail" />} />} />
      <Route path="/gallery" element={<Page element={<Swap shared={<Gallery />} gold={<Gold.GalleryGold />} page="Gallery" />} />} />
      <Route path="/newsletters" element={<Page element={<Swap shared={<Newsletter />} gold={<Gold.NewslettersGold />} page="Newsletters" />} />} />
      {/* ROW gap #6: approved member stories and the bulletin sign-up; one shared page for every theme. */}
      <Route path="/stories" element={<Page element={<Stories />} />} />
      <Route path="/bulletin" element={<Page element={<BulletinSignup />} />} />
      <Route path="/past-presidents" element={<Page element={<Swap shared={<PastPresidents />} gold={<Gold.PastPresidentsGold />} page="PastPresidents" />} />} />
      <Route path="/project" element={<Page element={<Swap shared={<ProjectDetail />} gold={<Gold.ProjectDetailGold />} page="ProjectDetail" />} />} />
      {/* The API's project SHARE endpoint builds every link as
          https://<club domain>/projects/<id> — that is the URL already going out
          through the dashboard's and the mobile app's WhatsApp shares. Without
          this it matched no route and the catch-all sent visitors to the home
          page, so every shared project link landed nowhere. */}
      <Route path="/projects/:pid" element={<ProjectPermalink />} />
      <Route path="/under-maintenance" element={<Page element={<UnderMaintenance />} />} />
      <Route path="/business-directory" element={<Page element={<BusinessDirectory />} />} />
      <Route path="/events" element={<Page element={<Swap shared={<UpcomingEvent />} gold={<Gold.EventsGold />} page="Events" />} />} />
      {/* Website builder custom pages (admin: Website Data, Pages and Layout). Same shell for every theme. */}
      <Route path="/p/:slug" element={<Page element={<CustomPage />} />} />
      {/* Website extras: site search and the social feeds, the shared page in every theme's shell. */}
      <Route path="/search" element={<Page element={<Search />} />} />
      <Route path="/social" element={<Page element={<Social />} />} />

      {/* Standalone pages: no master in the ASP.NET build, and both opt out of
          the gate (ExpiredWebsite via BypassExpiryGate). */}
      <Route path="/expired" element={<ExpiredWebsite />} />
      <Route path="/not-configured" element={<SiteNotConfigured />} />

      {/* IIS served Home.aspx for an unknown path only via a 404; keep parity by
          sending anything unrecognised to Home. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
