# Club website templates: 10 new designs (plan, 2026-10-29)

Status: approved 2026-10-29 with these answers: own palette per template; same pages and content, each template
designs them its own way; native scrolling (no Lenis), animations smooth and fast on every screen size; stock
photos allowed; the owner judges concepts by seeing them. Building step 1 and templates 1-3.

## What the owner asked for

- About 10 new club website templates. Each has its own layout and its own GSAP scroll animations and transitions,
  different from the others.
- Mature, professional look. Plain professional fonts, nothing fancy.
- Audience: people aged 35+ in the US, UK, Europe and Australia. Easy and smooth to use.
- The 8 existing themes are discarded. The new templates replace them completely.
- The owner sees every template before it goes live. Previews use the club's real website data, with dummy data
  where the club has none.
- Later, not in this plan: the site editor, so clubs edit their own website without Kaizen.

## Research summary (short pass)

1. **Older readers are slower and fail more often on typical sites.** In usability tests reported from the Nielsen
   Norman Group, users over 65 succeeded on 55% of tasks against 75% for younger users, and were 43% slower. Text
   size, how information is organised, and colour contrast best predicted whether senior sites were usable.
   The audience here starts at 35, so these are upper bounds, but they point the same way: large readable text,
   strong contrast, simple predictable navigation.
2. **Navigation stays in the same place on every page.** Government guidance for older users asks for the same
   navigation buttons in the same place on each page. Sites often failed on text size and on having a site map.
3. **Trust comes from proof, not decoration.** Nonprofit roundups agree: impact numbers, real stories, clear About
   and affiliations, partner logos, readable type, alt text, keyboard access. Rotary's own brand centre asks for
   photos of real members at work, short scannable content, and clear calls to join, donate or volunteer.
4. **Motion must be calm and under the reader's control.** Parallax and scroll-triggered motion can make people with
   vestibular conditions unwell. Motion the reader drives by scrolling bothers them less than motion that plays on
   its own. Every animation must honour `prefers-reduced-motion`, and smooth scrolling must switch off with it.

Weak points: no direct research on the 35-55 group was found, and the nonprofit "best of" lists come from agencies.

Sources: [PMC senior website analysis](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7741326/),
[Ergoweb on older users](https://ergoweb.com/are-web-sites-working-for-older-users/),
[Rotary brand centre: websites](https://brandcenter.rotary.org/en-us/our-brand/promote-rotary/websites),
[oneeach nonprofit ranking](https://blog.oneeach.com/resources/ranking-the-best-websites-for-nonprofit-designs-in-2025),
[cyberoptik nonprofit examples](https://cyberoptik.net/blog/best-nonprofit-websites),
[WCAG animation guide](https://testparty.ai/blog/wcag-animation-interactions-guide),
[WebKit: responsive design for motion](https://webkit.org/blog/7551/responsive-design-for-motion/).

## Rules every template follows

- Body text at least 18px, line length 60-75 characters, contrast at least WCAG AA (AAA for body text where the
  palette allows).
- Full menu visible on desktop (no hamburger above 1024px). Same menu in the same place on every page. Current page
  marked. A plain-text sitemap link in the footer.
- Click targets at least 44px. Links look like links. No text over busy photos without a solid backing.
- Primary actions always one click away: Join us, Visit a meeting, Contact.
- Motion: short (0.4-0.9s), eased, triggered by scrolling. Nothing autoplays (no auto-advancing carousels). No
  scroll-jacking: the page always scrolls at the reader's speed. Everything readable with `prefers-reduced-motion`,
  where all content shows at once and nothing moves.
- Fonts: plain, professional families (for example Source Serif 4, Libre Franklin, Public Sans, IBM Plex Sans,
  Lora, Literata, Source Sans 3). Never Inter, Geist or Space Grotesk (project rule). Self-hosted via next/font.
- The project's Frontend Design Rules apply (no gradients, glassmorphism, glow orbs, emoji, 3-card rows, coloured
  left strips, fake testimonials).
- Skeleton loaders for async areas. Terms and Privacy links in every footer.

## The 10 templates

Each row has a different page structure, navigation pattern and motion signature, so no two read the same.

| # | Name | Structure and navigation | Motion signature |
|---|---|---|---|
| 1 | Heritage | Centred masthead with the club crest, ruled columns, cream paper tone, serif headings | Thin rules draw across as sections enter; text fades up line by line |
| 2 | Civic | Plain, task-first like a public-service site: big "What do you want to do?" links, strong grid, high contrast | Almost none: a short underline slide on focus and hover, numbers count once |
| 3 | Impact Report | Laid out like an annual report: headline figures (members, hours, money raised), charts, short case studies | Figures count up and bars fill as you scroll to them |
| 4 | Portrait | Photo-led: full-width photos of members at work, captions under photos, quiet sans type | Photos reveal through a clip mask; a gentle zoom-out as each image settles |
| 5 | Journal | Magazine feature layout: one lead story, a column of further stories, pull quotes from real members | Headlines reveal by line; the lead image stays pinned while the story column scrolls past |
| 6 | Milestones | Club history first: a vertical timeline from charter year to today, then projects and meetings | A progress line draws down the timeline as you scroll; each year marker fills on arrival |
| 7 | Neighbourhood | Place-led: a map of where the club works, projects grouped by place, meeting venue up front | Map pins appear in sequence; the map stays pinned while project entries scroll beside it |
| 8 | Split | Fixed left panel (club name, menu, Join button), content scrolls on the right | Left panel heading cross-fades to match the section in view |
| 9 | Noticeboard | Member-first: this week's meeting, speaker and events at the top, then the rest | Notice cards settle into place with a small stagger; the date strip slides on load |
| 10 | Quiet | Spacious single column, very large type, few elements per screen, monochrome plus one accent | Slow fade and slight rise per block; page-to-page cross-fade transition |

Page transitions: one calm transition type per template (fade, wipe or slide), off with reduced motion.

## Data: real first, dummy only in preview

- Every template renders the data club-website already loads: about, banners, projects, board of directors,
  directory, calendar, meetings, past presidents, events, newsletters, speakers, advertisements, district governor,
  RI president (`src/lib/publicApi.ts`). No new API work.
- **Preview mode** (`?preview-theme=<key>`): a section with no data is filled from one shared dummy-content file,
  marked "Sample content" on the page. Dummy photos are royalty-free stock with licences recorded.
- **Live mode:** dummy content is never shown. An empty section is hidden, so a club never publishes fake people
  or fake numbers.

## How it is built (inside the existing club-website)

- Each template is a folder under `row/club-website/src/themes/<key>/` with its own Layout, Home and page shells.
  The current registry, `<html data-theme>` switching and the preview path stay.
- New templates are reachable only through `?preview-theme` until the owner approves each one. Live clubs keep the
  current themes until the switch-over.
- Motion reuses `src/motion/engine.ts` (GSAP + ScrollTrigger + SplitText, already installed). One small motion file
  per template for its signature. Page transitions added to the engine once, used by all.
- Each template is checked with the `jury` skill (desktop, throttled phone, reduced motion, axe, keyboard) before it
  goes to the owner.

## Order of work

| Step | Work | Proof |
|---|---|---|
| 1 | Shared base: dummy-content file, preview-only fallback, "Sample content" marker, page-transition support, font set | Unit test: dummy content shows only in preview; live hides empty sections |
| 2 | Templates 1-3 (Heritage, Civic, Impact Report), home + all inner pages | Owner review in Chrome; jury report each |
| 3 | Owner feedback round on 1-3, adjust the shared rules | Owner says go |
| 4 | Templates 4-7 | Owner review; jury |
| 5 | Templates 8-10 | Owner review; jury |
| 6 | Switch-over: map each old theme to a new one, update `theme_master` / `ToThemeKey`, delete the 8 old theme folders | Every live club site renders; old keys resolve to new ones |

Step 3 is a deliberate check: the first three set the quality bar before seven more are built.

## Questions for the owner

1. **Brand colours.** Rotary clubs normally follow Rotary's brand guidelines (royal blue and gold, official
   marks). Should the templates stick to the Rotary palette with small variations, or may each template use its own
   palette?
2. **Inner pages.** Should every inner page (directory, calendar, meetings, past presidents) be unique per template,
   or should those use one shared structure restyled by each template? Shared is faster; unique costs about 2x.
3. **Smooth scrolling.** Today's engine smooths the wheel scroll (Lenis). Some older readers find that this feels
   less direct. Keep it, or use the browser's normal scrolling and keep only the animations?
4. **Dummy photos.** May I use royalty-free stock photos (for example Unsplash) for previews, or do you have Rotary
   photos to use?
5. **The 10 concepts.** Change, drop or swap any of the 10 above before work starts?
