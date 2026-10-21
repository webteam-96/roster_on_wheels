# Public sites redesign: club website themes + district website

Date: 2026-10-21. Skills: awwwards (direction, motion, QA loop), jury (baseline and final score), GSAP + Lenis.
Scope: `row/club-website` (5 selectable themes) and `row/district-website` (one design). `row/website` is not
touched. Data, routes and the public API stay as they are; only the presentation layer changes.

## Brief

- Subject: a Rotary club (any of hundreds, one codebase) and a Rotary district (45 sites, one codebase).
- Audience: people deciding whether to join or attend, local partners, members checking the next meeting.
- Job: make the club look alive and reachable (when and where it meets, what it did lately, who leads it).
- Constraint: every theme must look good with thin data (no banner, no photos, 0 projects) and with rich data.
  So type and color carry the design; photos enrich it when present. No placeholder photos on a real site.
- Brand: Rotary royal blue `#17458F` and gold `#F7A81B` are the clubs' own colors and may anchor every theme.
  The Rotary wheel emblem is a trademark: no reproduction or near-copy; geometry may only echo it loosely.
- Theatre, scaled to the brief: no loader, no WebGL. Lenis smooth scroll, GSAP + ScrollTrigger + SplitText,
  one signature moment per theme, page transitions, idle motion from the concept, full reduced-motion path.

## Shared engine (both sites)

`src/motion/` from awwwards `references/engine.md` + `nextjs.md` adapter: one GSAP ticker, Lenis, data-attribute
reveals (`data-reveal`, `data-split`, `data-parallax`), `usePage()` cleanup per route, page-transition curtain,
reduced-motion switch. Same code in both apps (copied, they are separate deployables). Fonts via `next/font`.

## District website concept: "The Rotary year"

| | |
|---|---|
| Idea | The district's site is a dial of the Rotary year, July to June: everything the district does sits on it |
| Anchor | Districts run on the Rotary year (governor's year, July 1 to June 30); events and projects are dated |
| Signature | A large year dial (12 month ticks) in the hero rotates with scroll and lands on the current month; the "What's happening" list is the dial's current month, scrolling the list turns the dial |
| Motion verb | turn and click into place, like a dial detent |
| Emotion | orientation: "we are here in the year, this is what is on" |
| Screenshot | the dial at October with the month's events fanned beside it |
| Palette | ground `#F4F5F9` (cool paper), ink `#0E1B33`, muted `#55607A`, line `#D9DDE7`, accent royal `#17458F`, gold `#F7A81B` for the "now" marker only |
| Type | Bricolage Grotesque display (tight, -0.04em), Figtree text |
| Idle | the dial's "now" hand breathes (slow ±1° sway), paused off screen and under reduced motion |
| 404 | a month that doesn't exist on the dial |

## Club website: five themes (keys kept for the database)

Each theme = tokens + Layout + Home composition + motion verb + signature. Inner pages shared, styled by tokens.

| Key | Concept (anchor) | Signature | Motion verb | Palette (ground / ink / accent) | Type |
|---|---|---|---|---|---|
| `classic-blue` | **The weekly meeting**: the club is its meeting (day, time, place from club data) | hero states the next meeting with a live countdown; the meeting card pins while the week's events scroll past | settle, like taking a seat | `#F3F5FA` / `#0F1E3A` / royal `#17458F` + gold | Bricolage + Figtree |
| `modern-minimal` | **The Four-Way Test**: four questions structure the page | each question pins and its section answers it (truth: about; fair: projects; goodwill: events; beneficial: impact numbers) | line reveals, one line at a time | `#F7F7F5` / `#111` / gold `#F7A81B` | one neo-grotesk (Switzer), weight-only hierarchy |
| `bold-color` | **Avenues of service**: each avenue is a field of color | full-bleed chapters, background tweens to the avenue's color as you scroll (club, community, vocational, international, youth) | wipe, block over block | Rotary secondary colors: cranberry `#D41367`, turquoise `#00ADBB`, azure `#0067C8`, violet `#901F93`, orange `#FF7600` on royal (hex to be checked against the Rotary brand center before build) | wide heavy grotesk (Clash Grotesk) |
| `editorial` | **The club bulletin**: the site is this week's bulletin | masthead with issue number and date; articles settle in like set type; newsletter archive as back issues | settle like paper, masks | white `#FCFCFA` / ink `#14171F` / royal blue (no cream, no terracotta) | serif display (Gambetta) + Figtree |
| `compact-card` | **The membership card**: one tight, phone-first page | a member card that flips to show meeting details; sections stack like cards in a wallet and slide out | snap, like a card into a sleeve | `#0F1E3A` dark / `#F2F4F8` / gold | Figtree only |

Rules for all: no rainbow cards, no emoji, no shadows as separation, no pure white ground except editorial paper
(`#FCFCFA`), no Inter / Lucide, AA contrast, skip link, visible focus, 24 px targets, no em dashes in copy.

## Phases

1. Baseline: jury on current club and district production builds (running).
2. Engine + district site (concept above), QA loop two passes, jury re-score.
3. Club `classic-blue` (the default theme every club gets) + shared inner pages, QA, jury.
4. The other four club themes, one per pass, each QA'd and shot.
5. Docs (ROW-CHANGES, HANDOFF), design gate, commit when asked.

Verification per phase: `next build`, `tsc`, awwwards `shoot.mjs --crawl` + `audit.mjs` (0 FAIL, 0 serious axe,
no overflow, mobile LCP < 2.5 s, CLS < 0.05, reduced motion complete), jury self-score (no subagents per user rule,
marked not independent).

shortcut: no WebGL, no loader; add only if a later brief earns them.
