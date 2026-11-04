'use client'
// The club website themes' components, chosen by key. Kept in a client module on purpose: Next.js splits
// dynamic() imports into per-theme chunks only when they are made from client code, so a visitor downloads the
// theme the club uses and nothing else. The server (site/SitePage.tsx) passes only keys and data.
import dynamic from 'next/dynamic'

const THEMES = {
  "classic-blue": {
    Layout: dynamic(() => import("@/themes/classic-blue/Layout.jsx")),
    Home: dynamic(() => import("@/themes/classic-blue/Home.jsx")),
    pages: {},
  },
  "warm-modern": {
    Layout: dynamic(() => import("@/themes/warm-modern/Layout.jsx")),
    Home: dynamic(() => import("@/themes/warm-modern/Home.jsx")),
    pages: {},
  },
  "civic-bold": {
    Layout: dynamic(() => import("@/themes/civic-bold/Layout.jsx")),
    Home: dynamic(() => import("@/themes/civic-bold/Home.jsx")),
    pages: {},
  },
  "verdigris-ledger": {
    Layout: dynamic(() => import("@/themes/verdigris-ledger/Layout.jsx")),
    Home: dynamic(() => import("@/themes/verdigris-ledger/Home.jsx")),
    pages: {},
  },
  // Gold designs every inner page itself.
  gold: {
    Layout: dynamic(() => import("@/themes/gold/Layout.jsx")),
    Home: dynamic(() => import("@/themes/gold/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/gold/pages/AboutGold.jsx")),
      Projects: dynamic(() => import("@/themes/gold/pages/ProjectsGold.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/gold/pages/ProjectDetailGold.jsx")),
      Directory: dynamic(() => import("@/themes/gold/pages/DirectoryGold.jsx")),
      Directors: dynamic(() => import("@/themes/gold/pages/DirectorsGold.jsx")),
      PastPresidents: dynamic(() => import("@/themes/gold/pages/PastPresidentsGold.jsx")),
      Newsletters: dynamic(() => import("@/themes/gold/pages/NewslettersGold.jsx")),
      Gallery: dynamic(() => import("@/themes/gold/pages/GalleryGold.jsx")),
      Events: dynamic(() => import("@/themes/gold/pages/EventsGold.jsx")),
      EventDetail: dynamic(() => import("@/themes/gold/pages/EventDetailGold.jsx")),
      Calendar: dynamic(() => import("@/themes/gold/pages/CalendarGold.jsx")),
      Dignitary: dynamic(() => import("@/themes/gold/pages/DignitaryGold.jsx")),
      SisterClubs: dynamic(() => import("@/themes/gold/pages/SisterClubsGold.jsx")),
      YouthPartners: dynamic(() => import("@/themes/gold/pages/YouthPartnersGold.jsx")),
    },
  },
  // Theme 8 family: each designs its own inner pages; the rest use the shared ones.
  "cinematic": {
    Layout: dynamic(() => import("@/themes/cinematic/Site.jsx")),
    Home: dynamic(() => import("@/themes/cinematic/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/cinematic/pages/About.jsx")),
      Projects: dynamic(() => import("@/themes/cinematic/pages/Projects.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/cinematic/pages/ProjectDetail.jsx")),
      Directory: dynamic(() => import("@/themes/cinematic/pages/Directory.jsx")),
      Directors: dynamic(() => import("@/themes/cinematic/pages/Directors.jsx")),
      PastPresidents: dynamic(() => import("@/themes/cinematic/pages/PastPresidents.jsx")),
      Newsletters: dynamic(() => import("@/themes/cinematic/pages/Newsletters.jsx")),
      Gallery: dynamic(() => import("@/themes/cinematic/pages/Gallery.jsx")),
      Events: dynamic(() => import("@/themes/cinematic/pages/Events.jsx")),
      EventDetail: dynamic(() => import("@/themes/cinematic/pages/EventDetail.jsx")),
      Calendar: dynamic(() => import("@/themes/cinematic/pages/Calendar.jsx")),
      Dignitary: dynamic(() => import("@/themes/cinematic/pages/Dignitary.jsx")),
    },
  },
  "split-story": {
    Layout: dynamic(() => import("@/themes/split-story/Site.jsx")),
    Home: dynamic(() => import("@/themes/split-story/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/split-story/pages/About.jsx")),
      Projects: dynamic(() => import("@/themes/split-story/pages/Projects.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/split-story/pages/ProjectDetail.jsx")),
      Directory: dynamic(() => import("@/themes/split-story/pages/Directory.jsx")),
      Directors: dynamic(() => import("@/themes/split-story/pages/Directors.jsx")),
      PastPresidents: dynamic(() => import("@/themes/split-story/pages/PastPresidents.jsx")),
      Newsletters: dynamic(() => import("@/themes/split-story/pages/Newsletters.jsx")),
      Gallery: dynamic(() => import("@/themes/split-story/pages/Gallery.jsx")),
      Events: dynamic(() => import("@/themes/split-story/pages/Events.jsx")),
      EventDetail: dynamic(() => import("@/themes/split-story/pages/EventDetail.jsx")),
      Calendar: dynamic(() => import("@/themes/split-story/pages/Calendar.jsx")),
      Dignitary: dynamic(() => import("@/themes/split-story/pages/Dignitary.jsx")),
    },
  },
  "liquid-motion": {
    Layout: dynamic(() => import("@/themes/liquid-motion/Site.jsx")),
    Home: dynamic(() => import("@/themes/liquid-motion/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/liquid-motion/pages/About.jsx")),
      Projects: dynamic(() => import("@/themes/liquid-motion/pages/Projects.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/liquid-motion/pages/ProjectDetail.jsx")),
      Directory: dynamic(() => import("@/themes/liquid-motion/pages/Directory.jsx")),
      Directors: dynamic(() => import("@/themes/liquid-motion/pages/Directors.jsx")),
      PastPresidents: dynamic(() => import("@/themes/liquid-motion/pages/PastPresidents.jsx")),
      Newsletters: dynamic(() => import("@/themes/liquid-motion/pages/Newsletters.jsx")),
      Gallery: dynamic(() => import("@/themes/liquid-motion/pages/Gallery.jsx")),
      Events: dynamic(() => import("@/themes/liquid-motion/pages/Events.jsx")),
      EventDetail: dynamic(() => import("@/themes/liquid-motion/pages/EventDetail.jsx")),
      Calendar: dynamic(() => import("@/themes/liquid-motion/pages/Calendar.jsx")),
      Dignitary: dynamic(() => import("@/themes/liquid-motion/pages/Dignitary.jsx")),
    },
  },
  "horizontal-journey": {
    Layout: dynamic(() => import("@/themes/horizontal-journey/Site.jsx")),
    Home: dynamic(() => import("@/themes/horizontal-journey/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/horizontal-journey/pages/About.jsx")),
      Projects: dynamic(() => import("@/themes/horizontal-journey/pages/Projects.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/horizontal-journey/pages/ProjectDetail.jsx")),
      Directory: dynamic(() => import("@/themes/horizontal-journey/pages/Directory.jsx")),
      Directors: dynamic(() => import("@/themes/horizontal-journey/pages/Directors.jsx")),
      PastPresidents: dynamic(() => import("@/themes/horizontal-journey/pages/PastPresidents.jsx")),
      Newsletters: dynamic(() => import("@/themes/horizontal-journey/pages/Newsletters.jsx")),
      Gallery: dynamic(() => import("@/themes/horizontal-journey/pages/Gallery.jsx")),
      Events: dynamic(() => import("@/themes/horizontal-journey/pages/Events.jsx")),
      EventDetail: dynamic(() => import("@/themes/horizontal-journey/pages/EventDetail.jsx")),
      Calendar: dynamic(() => import("@/themes/horizontal-journey/pages/Calendar.jsx")),
      Dignitary: dynamic(() => import("@/themes/horizontal-journey/pages/Dignitary.jsx")),
    },
  },
  "photo-collage": {
    Layout: dynamic(() => import("@/themes/photo-collage/Site.jsx")),
    Home: dynamic(() => import("@/themes/photo-collage/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/photo-collage/pages/About.jsx")),
      Projects: dynamic(() => import("@/themes/photo-collage/pages/Projects.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/photo-collage/pages/ProjectDetail.jsx")),
      Directory: dynamic(() => import("@/themes/photo-collage/pages/Directory.jsx")),
      Directors: dynamic(() => import("@/themes/photo-collage/pages/Directors.jsx")),
      PastPresidents: dynamic(() => import("@/themes/photo-collage/pages/PastPresidents.jsx")),
      Newsletters: dynamic(() => import("@/themes/photo-collage/pages/Newsletters.jsx")),
      Gallery: dynamic(() => import("@/themes/photo-collage/pages/Gallery.jsx")),
      Events: dynamic(() => import("@/themes/photo-collage/pages/Events.jsx")),
      EventDetail: dynamic(() => import("@/themes/photo-collage/pages/EventDetail.jsx")),
      Calendar: dynamic(() => import("@/themes/photo-collage/pages/Calendar.jsx")),
      Dignitary: dynamic(() => import("@/themes/photo-collage/pages/Dignitary.jsx")),
    },
  },
  "sunrise": {
    Layout: dynamic(() => import("@/themes/sunrise/Site.jsx")),
    Home: dynamic(() => import("@/themes/sunrise/Home.jsx")),
    pages: {
      About: dynamic(() => import("@/themes/sunrise/pages/About.jsx")),
      Projects: dynamic(() => import("@/themes/sunrise/pages/Projects.jsx")),
      ProjectDetail: dynamic(() => import("@/themes/sunrise/pages/ProjectDetail.jsx")),
      Directory: dynamic(() => import("@/themes/sunrise/pages/Directory.jsx")),
      Directors: dynamic(() => import("@/themes/sunrise/pages/Directors.jsx")),
      PastPresidents: dynamic(() => import("@/themes/sunrise/pages/PastPresidents.jsx")),
      Newsletters: dynamic(() => import("@/themes/sunrise/pages/Newsletters.jsx")),
      Gallery: dynamic(() => import("@/themes/sunrise/pages/Gallery.jsx")),
      Events: dynamic(() => import("@/themes/sunrise/pages/Events.jsx")),
      EventDetail: dynamic(() => import("@/themes/sunrise/pages/EventDetail.jsx")),
      Calendar: dynamic(() => import("@/themes/sunrise/pages/Calendar.jsx")),
      Dignitary: dynamic(() => import("@/themes/sunrise/pages/Dignitary.jsx")),
    },
  },
};

const SHARED_PAGES = {
  About: dynamic(() => import("@/themes/shared/pages/AboutUs.jsx")),
  Projects: dynamic(() => import("@/themes/shared/pages/AllProjects.jsx")),
  ProjectDetail: dynamic(() => import("@/themes/shared/pages/ProjectDetail.jsx")),
  Directory: dynamic(() => import("@/themes/shared/pages/Directory.jsx")),
  Directors: dynamic(() => import("@/themes/shared/pages/Directors.jsx")),
  PastPresidents: dynamic(() => import("@/themes/shared/pages/PastPresidents.jsx")),
  Newsletters: dynamic(() => import("@/themes/shared/pages/Newsletter.jsx")),
  Gallery: dynamic(() => import("@/themes/shared/pages/Gallery.jsx")),
  Events: dynamic(() => import("@/themes/shared/pages/UpcomingEvent.jsx")),
  EventDetail: dynamic(() => import("@/themes/shared/pages/EventDetail.jsx")),
  Calendar: dynamic(() => import("@/themes/shared/pages/AllSpecialDates.jsx")),
  Dignitary: dynamic(() => import("@/themes/shared/pages/diginitary.jsx")),
  SisterClubs: dynamic(() => import("@/themes/shared/pages/SisterClubs.jsx")),
  YouthPartners: dynamic(() => import("@/themes/shared/pages/YouthPartners.jsx")),
  Meetings: dynamic(() => import("@/themes/shared/pages/Meetings.jsx")),
};

/** The theme's shell around any content. */
export function ThemeLayout({ themeKey, children }) {
  const Layout = (THEMES[themeKey] || THEMES['classic-blue']).Layout
  return <Layout>{children}</Layout>
}

/** The theme's home page, the theme's own design of an inner page, or else the shared design of it. */
export function ThemePage({ themeKey, page, data }) {
  const theme = THEMES[themeKey] || THEMES['classic-blue']
  const View = page === 'Home' ? theme.Home : theme.pages[page] || SHARED_PAGES[page]
  return View ? <View data={data} /> : null
}
