// Gold's own pages, one per route. App.jsx swaps these in when the resolved
// theme is `gold` and leaves every other theme on the shared pages.
//
// A page that is NOT listed here has no Gold-specific design and falls through
// to the shared one, which picks up the brand through the palette/type overrides
// at the foot of gold-pages.css. That is deliberate for the bespoke single-club
// legacy pages (Boys Town, Rotary Nagar, Selaiyur, the trust pages, the DGN
// profile): they are hand-written static markup for one club each.
export { default as AboutGold } from './AboutGold.jsx'
export { default as ProjectsGold } from './ProjectsGold.jsx'
export { default as ProjectDetailGold } from './ProjectDetailGold.jsx'
export { default as DirectoryGold } from './DirectoryGold.jsx'
export { default as DirectorsGold } from './DirectorsGold.jsx'
export { default as PastPresidentsGold } from './PastPresidentsGold.jsx'
export { default as NewslettersGold } from './NewslettersGold.jsx'
export { default as GalleryGold } from './GalleryGold.jsx'
export { default as EventsGold } from './EventsGold.jsx'
export { default as EventDetailGold } from './EventDetailGold.jsx'
export { default as CalendarGold } from './CalendarGold.jsx'
export { default as DignitaryGold } from './DignitaryGold.jsx'
