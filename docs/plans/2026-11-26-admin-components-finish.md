# Admin: finish the component work (26 Nov 2026)

The owner says "continue" and this starts. Multi-agent is approved by the owner for this plan only (25 Nov 2026).
Rules for every part: `row/website/design.md` 8.9. What was done on 25 Nov: `row/ROW-CHANGES.md`, search "fixed layout".

## Done when

- No hand-written `<table>` or `<button>` outside the shared components, except the short list in `designParts.test.ts`, which is lowered to match.
- Goal Setting and RCC Goals use the shared parts.
- No page file over 1,000 lines (22 today, pay pages left out).
- Every add / edit form saves on the local copy, and every page that opens one record loads.
- Production build passes and a new upload package is in `_local/deploy-2026-11-26/`.
- `tsc`, `vitest`, the 373-page crawl and the phone-width crawl are clean.

## Where it stands (measured 25 Nov, evening)

| Area | `<button>` | `<table>` |
|---|---|---|
| `app/clubs` | 227 | 47 |
| `components` | 114 | 60 |
| `app/settings` | 83 | 27 |
| `app/districts` | 55 | 3 |
| `app/club-admin-dashboard` | 32 | 26 |
| `app/district-admin-dashboard` | 24 | 15 |
| `app/ag-dashboard`, other | 33 | 11 |

Pages that open one record: 119. Add / edit / create forms: 115. Files over 700 lines: 71, over 1,000: 22.

## How the agents share the work

Nothing is committed (owner's choice), so worktrees would start without today's work:

- All agents work in this checkout, each only in the folders it owns. No git commands that change
  files (no stash, checkout, reset). The lead alone edits shared files: `components/ui`, `components/row`, `components/form`,
  `components/dashboard/*Frame*, TopBar*, Sidebar`, `globals.css`, `tailwind.config.ts`, `designParts.test.ts`, docs.
  An agent that needs a shared change asks the lead. `tsc` counts only for the agent's own files until the wave ends.

Each wave ends with the lead running `tsc`, `vitest`, the crawl, and a backup copy of `admin/src`. The next wave starts only when clean.

## Wave 0: lead, alone (about 45 min)

1. Back up `admin/src` to `_local/backups/admin-src-2026-11-26/`, dump `row_prod_copy` to `_local/backups/`.
2. Start MySQL (3317), API on 5002 (`_local/qa/admin-tools/api5002.sh`, fresh build of `row/api`), `next dev` on 3300.
3. Add the missing shared parts, each with a test where it has logic:
   - `LinkButton` (text button, 92 uses), `ToggleButton` / `FilterChips` (pressed state, replaces class templates), `ClearButton` (x in a search field),
     `RemoveBadgeButton` (x on an image), `MenuItemButton` (full-width row in a list).
   - `DataTable` (card, scroll, head, rows, empty row, loading rows, optional sort) on top of `ui/table`; `MatrixTable` for the goal and CMR grids (dense cells, sticky column).
4. Convert one page of each kind as the example the agents copy.

## Wave 1: six agents, folders do not overlap (about 2 h)

| Agent | Owns | Work |
|---|---|---|
| A | `app/clubs/[id]` A to E | buttons, tables |
| B | `app/clubs/[id]` F to Z | buttons, tables |
| C | `app/settings`, `app/admin`, `app/members`, `app/account`, `app/zones` | buttons, tables |
| D | `app/districts`, `app/district-admin-dashboard`, `app/ag-dashboard`, `app/ag-reports` | buttons, tables |
| E | `app/club-admin-dashboard`, `components` except F's | buttons, tables |
| F | Goal panels: `components/*Goal*`, `components/dashboard/Goal*`, `components/goal-rotary`, `goal-messages`, the goal and RCC pages | shared parts and `MatrixTable`; saved values, locks and RAG rules must not change |

Sheets that become PDFs (CMR preview, citation, certificates) keep their own look.

## Wave 2: five agents, check behaviour (about 2 h)

Local copy only, email off, payments simulated on 5656 only. A fault is fixed by the agent that owns the folder.

| Agent | Checks |
|---|---|
| G | Club forms, A to M: required message, save, edit, delete, value back in the list |
| H | Club forms, N to Z, member forms |
| I | District and settings forms |
| J | The 119 pages that open one record, all roles, 1440 and 375 |
| K | Keyboard and screen reader basics: focus ring, labels on icon buttons, dialogs, contrast |

The lead restores `row_prod_copy` from the dump afterwards.

## Wave 3: four agents, split the long pages (about 3 h)

Only after waves 1 and 2 are clean: this moves the most code and go-live is 30 Nov. Move code, change nothing. Data and state go to a `use...` hook,
each section to its own file beside the page, dialogs to their own files. Same API calls before and after (compare the recorded requests).

| Agent | Files |
|---|---|
| L | settings: `membership-dues/create` (2,653), its members page, `club-dues/create`, `event-payment-links/create`, `club-websites` |
| M | clubs: `club-report/v2/view`, `membership-dues` members (V1 and V2), `menu_list`, `club-monthly-report/v2` month page, `event-payment-links/v2/edit` |
| N | forms that are the same code three times: community, public image, new generation, vocational, international, projects, add and edit on one shared project form |
| O | `DistrictReportContent`, `DistrictAwardsModule`, both communication `sections`, service projects page, `members/new-v2` and `edit-v2`, `GoalSettingPanelRotary`, district `menu-list` |

If time runs short, N is the one worth doing (it removes the most copies) and the rest waits until after 30 Nov.

## Wave 4: lead, alone (about 1 h)

1. Lower the counts in `designParts.test.ts`; `tsc`, `vitest`, `check-design`, `dotnet test`, both crawls.
2. Stop `next dev`, clean, `next build`, API publish, package to `_local/deploy-2026-11-26/` with README and SQL; start the package and open 20 pages.
3. A reviewer that did not write the code reads the diff (`/code-review`) and the payment, dues and goal pages by hand.
4. Update `ROW-CHANGES.md`, `HANDOFF.md`, `design.md`, `bash kb/rebuild.sh`.

## Tools

`E:\websites\row\_local\qa\admin-tools\` (not in git): `crawl.py` (pages, errors, title and button audit), `audit.py`, `lay.py` (screens per role),
`flow.py` (save one form), the parser scripts (`cls`, `comp`, `fld`, `tpl`, `hdr`, `hoist`). Test roles: three rows in local `member_roles` with
`created_by=9999` (member 2193 club 1, 2194 district 1, 2195 AG); delete them at the end. Screens before and after: `_local/qa/admin-layout-2026-11-25/`.

## Needs the owner

- Decided 25 Nov: no commit before starting. Commit and push once, at the end, when everything is complete (ask before the push).
- `2026-11-25-member-modules.sql`, the website USD prices and the training link are still open and do not block this plan.
