# Plan: audit fixes (frontend, backend, security) + doable app tasks (2026-11-18)

Source: the /frontend, /backend, /security audits of 18 Nov and the mobile task list (OMS, 13 Nov).
Run mode SOLO. Done = each item's check passes; nothing committed until the owner says so.

## Do now (in order)

| # | Item | Check |
|---|---|---|
| S1 | club-website: `npm audit fix` (DOMPurify XSS, axios, follow-redirects), rebuild deploy folder | `npm audit --omit=dev` 0 high; build OK; sanitiser attack strings still stripped |
| S3 | admin: `npm audit fix` (build-tool chain) | audit high = 0 or only no-fix; `tsc`, lint, tests pass |
| F1 | club-website gate pages (Expired, Not configured): Inter -> Figtree / Bricolage Grotesque | grep Inter = 0 in src |
| F2 | website contact email template: Inter -> Figtree | grep |
| F3 | admin: Sparkles icon (rule 13) -> neutral icons | grep Sparkles in admin/src = 0; tsc |
| F5 | club-website: Terms + Privacy links in every theme footer (ROW website pages) | 13 themes render the links (audit script) |
| A1 | app: Language screen wording + ui_strings regen | analyze + test |
| A2 | app: release builds https only (cleartext only in debug) | manifest merge per build type |
| A3 | app: Back-to-sign-in bug and sign-in screen not translating: find cause in router / LiveTranslator, fix if clear | flutter test; reasoning in report |
| A4 | app: version line cleaned (ROW 1.0.0, build number kept above old uploads) | pubspec |
| S4 | API uploads: check image file signature, not only extension, in the shared validator | api tests |
| B2 | backup: nightly `mysqldump` script + scheduled-task install notes for the server | script dry run against local copy |
| B5 | review the 34 interpolated SQL strings for user input | list in report |

## Needs the owner (on hold)

- S2 change demo-account passwords on production (testers / mobile dev may use them: which accounts?).
- Admin restyle (68 `bg-white`, 184 shadow files) and club-website skeleton loaders (123 files, 13 themes): large design passes.
- Admin token in localStorage -> httpOnly cookie: auth change across admin + API.
- Versioned migrations table, JSON logging, uptime monitor, email retry queue.
- App: device testing, store listings, TestFlight (needs a Mac and store accounts).
