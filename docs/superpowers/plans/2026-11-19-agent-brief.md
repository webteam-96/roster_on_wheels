# Shared brief for the competitor-gap agents (2026-11-19)

Goal: ROW (Rotary club and district platform) must beat ClubRunner and DACdb in every module. You build ONE
module (named in your prompt) end to end. Source of the gap list:
`E:\websites\row\docs\superpowers\plans\2026-11-19-competitor-gaps.md`.

## Project
- Repo root `E:\websites\row`. The project is `row/`: `row/api` (.NET 8 Web API, MySQL), `row/admin` (Next.js web
  admin), `row/mobile` (Flutter app), `row/workers`, `row/club-website`, `row/district-website`.
  `reference/` is copy-source only: never run it or use its servers.
- Orient with `E:\websites\row\kb\README.md` and graphify (`~/.local/bin/graphify.exe query "<q>"` from the repo
  root). Do not read whole codebases. Copy the patterns of the nearest existing feature (controller, service,
  DTOs, admin page, app screen) rather than inventing new ones.
- Run recipe: `E:\websites\row\row\HANDOFF.md`, section "Run locally" and "Checks to run after changes".
- MySQL is ALREADY RUNNING on 127.0.0.1:3317 (root, no password), database `row_prod_copy`. Do not start or stop
  mysqld. Do not drop or re-copy the database. It is a copy of production: real people's data.
- Run your API on the port given in your prompt (`dotnet run --urls http://127.0.0.1:<port>`), with
  `Database__SkipInit=false` once so your new tables are created, then `true`. Stop your API when you finish.
- Test logins in the copy: club admin member 1068 (club 341, Colombo West), ordinary member 999. Password comes from
  env `ROW_E2E_PASSWORD`; if unset, read `E:\websites\row\_local\test-accounts.txt`. Never print passwords.

## Hard rules
- Never send real email. Brevo/SMTP must be off or pointed at the fake server described in the header of
  `kb/tools/communication_upgrades_e2e.py`; set `ROW_E2E_EMAIL_SAFE=1`.
- Never touch production (`row_production`, the IIS server, anything in `row/.env` except reading the local
  connection pattern). No git commit, push, rebase of other branches, or worktree removal. Leave changes uncommitted.
- No secrets in any file. No SMS or WhatsApp (product decision). No Lucide icons, no emoji, no em dashes in UI copy,
  no Inter/Geist fonts; follow the existing admin design (run `node scripts/check-design.mjs` in `row/admin`).
- Every endpoint checks authentication AND that the user may access that club/district record (no IDOR).
  Parameterized queries only. Validate input on the server.
- Times stored in UTC. Any new UI text must go through the existing localization pattern (look at how existing admin
  pages and app screens get strings); do NOT edit `row/mobile/lib/core/i18n/ui_strings.g.dart` (the lead regenerates it).

NEVER use `git stash` in any form: the stash list is shared by every worktree (it lost work on 2026-11-19 18:04).

## Rebase procedure (when told your worktree is on the old base 59f5edf)
The current branch is `feat/rizones-pull-2026-11-06` (553bfe7, ~750 files newer, and `row/club-website` is now a
Vite app: `src/App.jsx`, `src/routes.js`, `src/pages/`, `src/themes/`; there is no Next.js `src/app/` any more).
Move your uncommitted work onto it, without stash and without commits:
1. Make a private folder under the scratchpad (e.g. `scratchpad/<yourport>/`). Save `git diff HEAD > mywork.patch`
   there, and copy every untracked file of yours (`git status --short`, `??` lines) there too, keeping paths.
2. `git checkout -- .` (reverts only tracked edits; your untracked files stay; you have the patch).
3. `git merge --ff-only feat/rizones-pull-2026-11-06`. If an untracked file of yours blocks it, move that file into
   your private folder, merge, then copy it back.
4. `git apply --3way mywork.patch`, resolve every conflict by hand, keeping the new upstream code plus your feature.
5. Port anything that targeted removed code (e.g. the old Next.js club-website) to the current code.
6. Rerun EVERY done-condition check (build, tests, tsc, vitest, flutter analyze, your e2e) and report the last lines.

## Shared-file rules (many agents run at once; the lead merges one at a time)
- New tables: your own `row/api/Services/DatabaseInitializer.<Feature>.cs` partial, plus a one-line call in
  `DatabaseInitializer.cs`. Reversible: `CREATE TABLE IF NOT EXISTS` / additive columns only, never drop.
- `Program.cs`: only add your service registrations as one contiguous block marked `// <Feature> (gap agent)`.
- Admin `row/admin/src/services/api.ts`: add your client functions in ONE block at the END of the file, marked
  `// ===== <Feature> (gap agent) =====`.
- Do not edit `row/ROW-CHANGES.md`, `row/HANDOFF.md`, `row/STATUS.md`, `row/TRACKER.md`, anything in `docs/`.
  Put your change notes in your final report instead.
- Feature gating: if the feature belongs to a subscription plan, use the existing `FeatureGate` pattern.

## Done-condition (each must be true, with pasted evidence in your report)
1. API: endpoints + service + tables; `dotnet build row/api` clean; unit tests for new logic in `row/api.Tests`
   (`dotnet test row/api.Tests` passes).
2. Admin web: working pages wired to the API (loading, empty, error, success states; skeleton loaders);
   `npx tsc --noEmit -p tsconfig.json` and `npx vitest run` pass in `row/admin`.
3. Flutter app: the member/officer-facing part of the feature as a screen in the app (follow the nearest existing
   module screen); `flutter analyze` adds no new errors (`C:\src\flutter\bin\flutter`).
4. e2e: `kb/tools/<feature>_e2e.py` taking args `<api> 3317 row_prod_copy`, run against your API, all checks pass.
   Clean up any test rows it creates.
5. No stubs: every button does what it says. If something truly cannot be done (needs Stripe keys, a server, the
   owner), say so plainly and leave it out rather than faking it.

Iteration cap: about 50 tool-use rounds of build/fix. Max 3 attempts on the same failure, then stop and report.

## Final report (your last message; the lead reads only this)
- Module, worktree path, port.
- Files added / changed (paths).
- Evidence: the last lines of build, test, tsc, vitest, flutter analyze and e2e output.
- Change note: 3-6 lines for ROW-CHANGES (what and why).
- What is not done or not verified, and any risk.
