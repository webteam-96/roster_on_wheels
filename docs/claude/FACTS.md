# Facts from the user

Dated facts, preferences and corrections from the user about ROW. Older facts also live in the Claude memory
index (`~/.claude/projects/E--websites-row/memory/MEMORY.md`) and in `row/HANDOFF.md`.

- 2026-10-29: Accepted the /flow product-workflow setup: WORKFLOW marker, this project memory, a CI workflow
  (build, lint, type check, tests; no deploy) and the csharp, typescript, react, web and dart ECC rule packs.
- 2026-10-29: Club website template brief: about 10 templates, each with its own layout and its own GSAP scroll
  animations and transitions. Mature, professional look; plain professional fonts, nothing fancy. Audience: people
  aged 35+ in other countries; easy and smooth to use. Do a short research pass on what that audience likes first.
- 2026-10-29: Club website design gate is OPEN: plan and build the new templates now. The owner wants to see the
  templates before they are wired into club-website. Research audience: US, UK, Europe, Australia (35+).
- 2026-10-29: Before deciding whether the new templates replace, join or rework the 8 existing themes, the owner
  wants to see the 8 run in Chrome.
- 2026-10-29: Asked to update the OMS pages with the work done (done the same day; pages 1-4, 6-10, 17).
- 2026-10-29: Asked to plan the new ROW design for the whole web application (admin) and mobile app, every screen,
  then start designing once the plan is done properly.
- 2026-10-29: The ~10 new templates are for the **district website** (club and district sites get separate themes).
  Gate opened: plan and build them now. The user wants to see the templates and designs first, then merge them into
  the main code. Scope now = templates only; once templates are final, add an editor so districts make changes
  themselves without depending on Kaizen.
- 2026-10-29: New template previews use the club's real website data; where a club has none, use dummy data.
- 2026-10-29: Order: finalize the themes/templates first. After that, the site editor (clubs edit their own website
  without depending on Kaizen) is the next piece of work.
- 2026-10-29: District templates plan approved. Unique home + header + footer + nav per template; inner pages restyled
  by colours and fonts. "Wall of clubs" is NOT one of the 10 (10 new). Lenis with GSAP allowed where it helps
  (Claude's choice). Claude picks the showcase district. User reviews designs first, then approves or declines each.
- 2026-10-29: Owner rejected all 8 existing club themes (poor design, all the same format, nothing unique). Discard
  them; the new templates replace them completely.
- 2026-10-29 (design plan answers): no Figma or mockups exist for admin or app screens; redesign ALL screens, dates
  are decided later ("do all the screens we think about the dates later"); redesign only the /v2-or-old version the
  menus open, retire the unreachable duplicate after the user's OK; the user approves the sample screens live in the
  browser.
- 2026-10-29: Template answers: each template has its own colour palette (not locked to Rotary blue/gold). Pages
  and their content stay the same; each template designs and displays them its own way. Browser's normal scrolling
  (no Lenis smoothing) with animations that are very smooth, fast and responsive on every screen size. Royalty-free
  stock photos are fine for sample content. Owner judges the concepts by seeing them, not by names.
- 2026-10-29: Owner pointed to https://site.clubrunner.ca/page/live-sites (list of live club websites) as a source for
  the templates. Used for research on structure and content only; no text or photos copied from real clubs.
- 2026-10-29: Preview content for district templates: take it from the public district sites listed at
  https://site.clubrunner.ca/page/district-live-sites (photos from there too, stock photos otherwise).
- 2026-10-29: Sample screens approved ("the design looks good"). Implement the ROW design on every page of the web
  application and the mobile app, including all login pages.
- 2026-10-29: The user wants the design conversion of ALL pages in the web app and the mobile app completed.
- 2026-10-29: User DECLINED the first two district templates (Ledger, Quiet): "what a shitty ai slop designs".
  Do not build templates 3-10 on that direction.
- 2026-10-29: Owner on the new template designs: "what a shitty ai slop designs". Heritage (template 1) as built is
  rejected as generic AI-looking. Next designs must not repeat its patterns (centred crest header, beige paper + navy
  + brass, small uppercase label above every heading, slogan headline, ruled lists everywhere).
- 2026-10-29: The mobile UI is not proper: random placement of buttons and text and other major layout flaws. Work on
  layout and responsive design like a real UI/UX designer (not only restyling). Also: update the OMS pages with all
  work done.
- 2026-10-29: User: the club website themes for ROW must be the same designs and templates as the current RIZones
  club website code at E:\websites\Club-Website-reactjs\Club-Website-reactjs (Vite React; 13 themes: classic-blue,
  warm-modern, civic-bold, verdigris-ledger, madras-legacy, gold, handloom, cinematic, split-story, liquid-motion,
  horizontal-journey, photo-collage, sunrise). Copy-source only, like reference/: designs, not RIZones data.
- 2026-10-29 (club themes answers): port 11 themes: all 13 except madras-legacy and handloom (dropped). ROW
  branding, no RIZones branding. Delete the themes built so far for BOTH club and district websites and start fresh;
  the district themes source comes from the user later. Port all 11 straight through (no pilot review first).
- 2026-10-29: Port method for the RIZones club themes: FULL REWRITE into Next.js routes (server rendering), not a
  client-side mount of the Vite app and not replacing club-website with Vite.
- 2026-10-29: Asked whether ROW can go live for testing on an IIS server (a test deployment, not launch).
- 2026-10-29: Approved adding ogl@1.0.11 to row/club-website (liquid-motion theme's WebGL ripple).
- 2026-10-30: theme_master: add the 11 club themes to the LOCAL copy (row_prod_copy) only; production later, when
  going live. Rotaract theme: "no idea of Rotaract in ROW", leave it for now (Rotaract clubs use classic-blue).
- 2026-10-30: Next club-website work approved: restyle join/profile/m pages, event time zones, visitor counter API,
  side-by-side visual check of every theme x page against RIZones.
- 2026-10-30: Asked to run the club website and see all the themes, with a theme switcher option to change
  between them.
- 2026-10-30: Remove the district website code built so far; the owner will give the district website themes code
  later. Events and QR: the owner will give that code when it is done. Commit and push all other work to main with
  the webteam-96 GitHub account.
- 2026-10-30: Going live for a TEST on a subdomain. Hosting = IIS (for now). The server uses the PRODUCTION
  database (row_production on the server's MySQL), which Claude can reach. Asked to prepare for making it live.
- 2026-10-30 (go-live answers): live in this test = API, admin web app, club websites (not the district site).
  Deploy = Claude builds ready-to-copy folders + IIS guide; the user/server team copies them and sets secrets.
  Production DB: approved to take a full backup, then apply the additive schema update + theme list + visitor
  table to row_production. Host names: the user will give them.
- 2026-10-30: Prod DB: user approved (after the corrected, additive-only facts) "Backup, then run the API startup
  routine once" against row_production, plus the 11-theme list. Layout: ONE host test.rosteronwheels.com for the
  admin, with the API under test.rosteronwheels.com/api (IIS URL Rewrite + ARR); club sites need their own hosts.
- 2026-10-30: Club website addresses for the test: <clubname>.test.rosteronwheels.com (wildcard under test.rosteronwheels.com). Deploy folder layout asked: web (frontend), api, sql (scripts for Workbench).
- 2026-10-30: Server is managed by Plesk (IIS add-ons already installed). Kept one host via proxy; API = Plesk subdomain api.test.rosteronwheels.com. Admin uploaded to test.rosteronwheels.com httpdocs root: login page loads.
- 2026-10-30: User wants the ROW public website (row/website) as the starting page of the test domain, with Login leading to the admin login (admin currently at test.rosteronwheels.com root).
- 2026-10-30: Test layout (user): EVERYTHING on test.rosteronwheels.com: all frontend files at the root, an `api`
  folder for the backend. "/" shows the ROW public website; Login opens the login page, then the admin panel and the
  other logins. Login: set a new password for the user's account AND create test accounts for every account type
  ROW has (as RIZones has different account types), in the production database (approved by the user).
- 2026-10-30: Test accounts: user said 'both' (a new 'ROW Test Club' AND an existing club; existing club not named yet). Admins creating other accounts from the panel is wanted.
- 2026-10-30: User logged in on live (test.rosteronwheels.com/settings/global-search). Asked: start testing the project on live. Testing is READ-ONLY on production data unless the user OKs a write.
- 2026-10-30: Asked to compare ROW's Rotary.org code with RIZones, fix gaps, and fetch Rotary.org data for clubs and
  districts outside India, mainly Monrovia and the clubs and districts related to it.
- 2026-10-30: Rotary.org fetch decisions: use the same Rotary.org Data Integration API login as RIZones (user's
  explicit choice, overriding the "never use reference settings" rule for this login only); target database
  row_production; scope = whole world except India.
- 2026-10-30: Approved: assign the default club modules to all clubs in row_production (option a, via the live
  Settings page https://test.rosteronwheels.com/settings).
- 2026-10-30: Approved: add the 23 missing clubs to row_production with `--world-clubs`.
- 2026-10-30: On test accounts the user said "DO WHATEVER U WANT I WANT TO BE TESTED PROPERLY FOR ALL THE LOGINS":
  choice of club(s) left to Claude; goal = every login type tested properly on test.rosteronwheels.com.
- 2026-10-30: Testing must be done LOCALLY, and issues must be proven, not assumed. The user found 4 UI issues
  (grey table headers, Back to Search covering pagination, scrollbar in a tab bar, grey top tab bar) after Claude said
  the UI was complete; the old crawl only checked page overflow. Do not create live test accounts for this.
- 2026-10-30: Asked: build the project, put the files in the deploy folder, and tidy the folders created under
  E:\websites: delete the ones not needed, move the needed ones into the row folder.
