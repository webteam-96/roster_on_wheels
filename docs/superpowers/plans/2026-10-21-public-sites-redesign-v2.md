# Public sites redesign, pass 2

Pass 1 (five club preview themes plus the district year dial) is not award level. This plan replaces it.

## Why pass 1 falls short

1. **Spread thin.** Five club themes, each about one third done. The awwwards bar is one signature executed perfectly.
2. **No imagery.** The demo data has no photos, so every frame is type on a flat ground. A Rotary site is people doing service. Without photos the Design score caps at about 6.
3. **The design stops at the home page.** About, Board, Projects, Events and project detail pages are still the old classic-blue layout in new colours. Jurors click through.
4. **No continuity.** Pages hard-cut. No transitions between list and detail.
5. **Old chrome breaks every frame.** The trial bar and cookie banner use the old styling.
6. **Some signatures are gimmicks.** The card flip and the countdown could sit on any club site. Only "avenues" (the page takes each avenue's colour) and the district year dial come from Rotary's own world.
7. **Never scored blind.** QA stopped after the first pass. There is no jury card.

## Constraint that shapes everything

These are templates. Each club fills them with its own data, often sparse: 0 to 50 projects, maybe no photos, maybe no events. The design must look intentional with thin content as well as rich content. Every section needs a designed empty state.

## Decision (2026-10-21)

The user chose fresh concepts over the pass 1 ideas below:
- **Club: "The banner exchange".** Rotary clubs swap pennant banners when they visit each other. The site is the club's banner wall. Each project hangs as a pennant on a rail and sways slightly at rest. Clicking one unfurls it into the project page.
- **District: "The wall of clubs".** The home page sets every club name as one large wall of type. Hovering a name lights it and shows that club's latest project. Clicking a name expands it into the club page.
- **Photos:** free-licence Unsplash stock, local demo DB only, credited and flagged for replacement.
- **Scoring:** one blind critic subagent per QA round.

Pass 1 themes are removed from the registry. The "Direction" section below is superseded; tasks 1, 3, 4 and 7 still apply.

## Direction (superseded)

One club theme and one district theme, finished across every page.

- **Club: "Avenues", rebuilt.** The colour system of the six areas of focus drives the whole site, not only the home page. Every project, event and page carries its avenue colour. Scrolling through the home page moves the ground colour chapter by chapter. Opening a project floods the screen in that avenue's colour and the photo grows out of the list (shared element). The driver is one variable: the current avenue.
- **District: "The Rotary year", extended.** The dial becomes the site's spine. The home dial plots this year's events and club projects as marks on the ring. Scroll turns the year month by month; the list beside it shows that month. The Events and Projects pages reuse the same ring as a filter. The driver is one variable: the date.

Other four club themes (meeting, four-way, bulletin, card): removed from the registry, not finished. They can come back later.

## Tasks

1. Demo content with photos in the local DB only (needs the user's choice of photo source). Verify: every page type has at least one project with 3+ photos and one with none.
2. Club "Avenues": home, About, Board, Projects list, Project detail, Events, Gallery, 404, all in the theme. Empty state per section. Verify: crawl every page, no classic-blue layout left.
3. Club page transitions: avenue-colour wipe between pages; list to detail image hand-off. Reduced motion: instant swap. Verify: transition frames in shoot.mjs.
4. Restyle the trial bar and cookie banner per theme. Verify: screenshots.
5. District "year": ring with event and project marks, month scrub, Events and Projects pages using the ring as filter, all inner pages in the theme, 404. Verify: crawl.
6. Remove the four unused club themes and their CSS. Verify: build, type check.
7. QA loop, at least 2 passes: shoot.mjs --crawl plus audit.mjs on production builds. Target: zero audit FAILs, zero serious axe issues, mobile LCP under 2.5 s, CLS under 0.05, no overflow, `noHoverChange` empty. Scores from a self-score marked "not independent" (no subagents, per the no-multi-agent rule), unless the user allows one critic subagent.

## Out of scope

The main ROW marketing site. Any change for visitors: everything stays behind `?preview-theme=` until the user says apply.
