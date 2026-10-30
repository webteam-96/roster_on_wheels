# District website templates (plan, 2026-10-29)

Status: waiting for the user's approval. Nothing is built yet.

## The ask

About 10 templates for the **district website** (`row/district-website`). Each one has its own design and its own
GSAP scroll animations and transitions. The look is mature and professional, with plain professional fonts. The
audience is people aged 35+ in other countries. The sites must be easy and smooth to use. The user sees the templates
first, then they are merged into the main code. The section editor comes later, once the templates are final (see
`docs/superpowers/plans/2026-10-26-website-themes.md`). Club website themes stay separate and are not part of this
plan.

## Acceptance criteria

1. 10 district templates. Each has its own home page, header, footer, navigation style, palette, type pair and
   motion signature. No two share a layout idea or a motion signature.
2. Each one shows real district data from the local copy (`row_prod_copy`) through the existing public API. No mock
   content in the shipped code.
3. Previewable without changing any district's live site: `?preview-theme=<key>` (already in `src/middleware.ts`),
   plus a gallery page that lists all 10 with screenshots and links.
4. Each one meets the audience rules below and passes them on desktop, phone and reduced motion.
5. The current design stays the default. No live district sees a change until the merge step.

## What exists (checked 2026-10-29)

- `src/motion/engine.ts`: GSAP + ScrollTrigger + SplitText, Lenis smooth scroll, a reduced-motion path where nothing
  moves. `gsap` ^3.13 and `lenis` ^1.3 are already in `package.json`, so **no new dependency**.
- `src/middleware.ts`: `?preview-theme=<key>` sets the `x-preview-theme` header and a session cookie.
- `src/components/wall/`: one prototype theme, "Wall of clubs" (`DESIGN.md`), reachable at `?preview-theme=wall`.
- No theme registry yet: `src/app/page.tsx` checks for `"wall"` by name.
- Pages: Home, About, District Committee, Club Finder + club page, Projects + project page, Newsletters, Join,
  custom menu pages (`m/[slug]`).
- Current fonts in `layout.tsx`: Figtree, Bricolage Grotesque, Archivo, Schibsted Grotesk.

## Research: what this audience prefers (short pass)

- Older users finish fewer tasks and take longer: NN/g testing found 55% task success for seniors against 75% for
  younger users. Clear, predictable navigation matters more than visual surprise.
- Text size, organisation of information, and colour contrast were the strongest predictors of accessibility in a 2020
  study of 100 sites for older adults. Contrast was the strongest of the three.
- Visited links should look different from unvisited ones. Links should not be packed close together.
- Well-regarded nonprofit sites in 2026 roundups lead with impact (numbers, stories, finances) and surface the most
  important actions early.
- Motion: respect `prefers-reduced-motion` through `gsap.matchMedia()`. Replace large movement, spinning and
  viewport-crossing scroll motion with fades for those users. Auto-moving content needs a pause control (WCAG 2.2.2).

Caveat: several findings come from secondary write-ups. The NN/g figures are from their 2013 study, which NN/g now
marks as dated. Sources are listed at the end.

## Audience rules (every template)

- Body text 18px minimum, line height 1.6, line length 60-75 characters.
- Body text contrast 7:1 (WCAG AAA), never below 4.5:1 anywhere.
- Visible text navigation on desktop (no hamburger above 1024px). The current page is marked. Visited links differ.
- Click targets 44px minimum, with space between links.
- Primary actions are always in the header: Find a club, Join, Contact.
- Motion supports reading and never blocks it. Content is readable before an animation ends. Durations 0.4-0.9s. No
  scroll-jacking, no long pinned sections on phones, no autoplay without a pause button.
- Reduced motion: no movement; everything is visible; hover and focus still give feedback.
- Fonts: professional text faces only. Not Inter, Geist or Space Grotesk (project rule). No script or decorative faces.
- Project anti-slop rules apply (no gradients, glass, glow orbs, emoji, em dashes in copy, 3-card rows, coloured
  left strips).
- Skeleton loaders for every async area.

## The 10 templates (concepts for your review)

Updated 2026-10-29: "Wall of clubs" is not one of the 10 (user). `split` replaces it.

| # | Key | Idea | Layout | Motion signature | Type (heading / text) |
|---|---|---|---|---|---|
| 1 | `ledger` | The annual report | Newspaper grid, column rules, big serif headlines | Rules draw across, figures count up once | Source Serif 4 / Source Sans 3 |
| 2 | `quiet` | Calm and spacious, for easiest reading | Swiss grid, wide margins, one column of content | Short fade and 12px rise only, the lightest motion of the set | IBM Plex Sans / IBM Plex Sans |
| 3 | `portrait` | People first | Large governor portrait, committee as a gallery of faces | Photos uncover through a clip-path mask | Libre Caslon Text / Libre Franklin |
| 4 | `chronicle` | The Rotary year as a timeline | Month by month: events, projects, newsletters | A progress line fills as you scroll; months settle in | Literata / Public Sans |
| 5 | `avenues` | Service by avenue | Each avenue of service is a chapter with its projects | Chapter titles wipe in; project images slide a short way | Merriweather / Source Sans 3 |
| 6 | `stories` | One project at a time | Sticky image beside steps of text (scrollytelling, desktop only) | Image cross-fades as each step reaches the middle | Lora / Work Sans |
| 7 | `horizon` | Photography led | Full-width photo bands between text bands | Gentle parallax, 10% maximum, off on phones | Crimson Pro / Nunito Sans |
| 8 | `civic` | Institutional and task-led, like a government service site | Strong header, task list (Find a club, Join, Donate, Contact) first | Almost none: underline and focus states, one header transition | Noto Serif / Noto Sans |
| 9 | `gazette` | The newsletter is the home page | Home looks like the current issue's cover, past issues stacked | Past covers fan out once as they enter | PT Serif / PT Sans |
| 10 | `split` | Identity always in view | Fixed left panel (name, governor, main actions); content scrolls on the right; stacks on phones | Content panels slide past the fixed panel; the panel's section index follows the scroll | Libre Baskerville / Karla |

Each template ships a one-page `DESIGN.md` like `wall/DESIGN.md`: idea, signature, palette, type, inner pages,
reduced motion, preview link.

## How the preview works (see first, merge later)

1. **Registry.** `src/themes/index.ts` maps a key to `{ Layout, Home, fonts }`, the same pattern as
   `row/club-website/src/themes`. `page.tsx` and `layout.tsx` read the key from `x-preview-theme` (later from the
   district's saved theme). Unknown key: the current design.
2. **One folder per template.** `src/themes/<key>/`: Layout (header, footer, nav), Home, `theme.css` (CSS variables
   for the inner pages), `motion.ts` (its signature), `DESIGN.md`.
3. **Fonts per template.** `next/font` with `preload: false` except for the active theme, so a visitor downloads only
   one theme's fonts.
4. **Gallery.** `/themes` lists the 10 with a screenshot each and a "Preview" link. Visible only when
   `NEXT_PUBLIC_THEME_GALLERY=1`. Off in production.
5. **Isolation.** `row/district-website/` is git-ignored (`.gitignore:20`), so a git branch does not isolate it. The
   preview header does: the default design stays the current one until "merge" switches the default. Back up the
   folder before step 1 (copy to `row/district-website.bak-2026-10-29`, outside git).

## Build order

| Step | Work | Proof |
|---|---|---|
| 1 | Registry + gallery (`wall` stays a separate prototype, not in the 10) | `tsc`, routes answer 200 |
| 2 | Templates 1 and 2 (`ledger`, `quiet`): the two ends of the range | Screenshots desktop, phone, reduced motion; `jury` skill scores; you review the direction |
| 3 | Templates 3-10, one by one, after your go on step 2 | Same checks for each |
| 4 | You review all 10 in the gallery and pick changes | Your sign-off |
| 5 | Merge into `main` behind the preview only (default design unchanged) | Full build, existing tests, smoke run |
| Later | Saving the theme per district, plan gating, the section editor | Separate plan (parked plan, 2026-10-26) |

Step 2 is a checkpoint: if the direction is wrong, only two templates need rework.

## Questions before I start

1. **Inner pages.** Does "unique design" mean the home page plus header, footer and navigation, with the inner pages
   (About, Committee, Club Finder, Projects, Newsletters) restyled through each theme's colours and type?
   **Recommended**, matching the club site pattern. The alternative, a unique design for every page of every
   template, is about 3 times the work.
2. **Wall of clubs.** Does the existing `wall` prototype count as one of the 10 (so 9 new), or do you want 10 new?
3. **Smooth scroll.** The engine uses Lenis, which smooths the wheel. Some older users find it feels delayed.
   **Recommended:** native scrolling with GSAP ScrollTrigger animations, which keeps the animations and removes the
   delay. Alternatively, keep Lenis for some templates.
4. **Data.** Previews use the local `row_prod_copy`. Which district should be the showcase? It needs banners,
   committee photos, projects and newsletters. I have not checked which district in the copy has enough content
   (NOT VERIFIED).
5. **Concepts.** Approve the 10 in the table, or swap any of them.

## Sources

- NN/g, usability for seniors: https://www.nngroup.com/articles/usability-seniors-improvements/
- Savvy Seniors, content analysis of 100 sites (2020): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7741326/
- Age-centred web design guidelines (DCU, 2006): https://www.dcu.ie/sites/default/files/agefriendly/Age-centered%20research-based%20web%20design%20guidelines_2006.pdf
- Azuro Digital, best nonprofit website designs 2026: https://azurodigital.com/nonprofit-website-examples/
- Neon One, best nonprofit websites: https://neonone.com/resources/blog/best-nonprofit-websites/
- GSAP accessibility (`gsap.matchMedia`, reduced motion): https://www.gsap.com/resources/a11y/
- WCAG 2.3.3 Animation from Interactions: https://dequeuniversity.com/resources/wcag2.1/2.3.3-animations-from-interactions
