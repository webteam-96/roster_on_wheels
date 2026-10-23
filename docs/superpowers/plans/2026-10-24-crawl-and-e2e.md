# H2 + H3: admin error-crawl fixes and the old e2e scripts (2026-10-23, lane e)

Tasks: `row/TRACKER.md` section 4 (P4 crawl findings F1-F6, P6 e2e scripts on env accounts).
Database: `row_lane_e` (local copy of production). API on 127.0.0.1:5105, admin dev server on 3405.

## H2: crawl findings, root causes and fixes

| # | Finding | Root cause | Fix |
|---|---|---|---|
| F1 | Club admin dashboard tabs call `api/club-foundation-goals/list` (404, module off) | `ClubAdminDashboardCacheContext` prefetched Foundation goals on every tab; nothing read the cached value (the goals card is hidden and loads its own data) | Prefetch removed (8 endpoints now) |
| F2 | Club Monthly Report API called while off (`clubs/[id]/club-monthly-report`, TRF pages, club e-governance) | `FeatureGate` rendered the page before the switches loaded, so an off module's page mounted and called its API, then got redirected. TRF pages took their year list from the monthly-report API | `FeatureGate` holds signed-in pages (house skeleton) until the switches are known; the sign-in page stays mounted (`holdPage`, unit-tested). TRF pages use `getTrfYears`: monthly-report years when that module is on, every rotary year when off. E-governance "Dues" tab follows OCV (it is the OCV dues category) |
| F3 | SuperAdmin on the club admin dashboard: `api/clubs/1/rotary-org-credentials` 403 | Club 1 is the SuperAdmin's own membership club (the login default, legitimate). The Rotary.org setup card showed to any SuperAdmin/Admin, but the credentials API allows only the club's own admins (and a District Admin with all-clubs access), SuperAdmin excluded by design | Card shows only to the club's admins (scoped roles / district all-clubs access) |
| F4 | AG pages for a non-AG answer 404/403 | `/ag-dashboard/excellence`, `/youth`, `/targets` are flagged modules (fixed with F2/F6); `/ag-reports` fetched the AG-only filters before checking `isAG` | `/ag-reports` loads its filters only for an AG (others see Access Denied, no call) |
| F5 | `rotary-org-terminated-members` 400 (`clubs/[id]/club-report/v2`) | No Rotary.org API login on this server: the client threw `InvalidOperationException`, mapped to 400. The endpoint also trusted a `clubId` query value from any Admin (IDOR, contact details included) | Unconfigured server answers 200 with a warning (like an unlinked club); a `clubId` must pass `ScopeWriteGuardMiddleware.AllowedAsync` (checked in `scope_read_guard_e2e`). Club report v2 falls back to the local list when a warning comes back |
| F6 | Session "drops" to `/login` (AG dashboard, club monthly report) | `FeatureGate`, `DashboardGuard` and `ProtectedRoute` sent signed-in users to `/`, now the public site; with `site.public` off it redirects to `/login` | All three send to `/admin`, the role home (SuperAdmin zones list, others resolved to their dashboard) |

Further findings from the crawls (not in F1-F6):

- `clubs/[id]/members` (and the terminated-members add page) 500 and `district-admin-dashboard/rotary-network` 500:
  `Illegal mix of collations`. A `CAST(... AS CHAR)` takes the connection collation (MySQL 8 default
  `utf8mb4_0900_ai_ci`) and clashes with the columns (`utf8mb4_unicode_ci`). Both now compare numbers
  (`ClubService` COG year filter, `DistrictAdminDashboardService` terminated-cache join). Production only escapes it
  when its server default collation matches the tables.
- Mass email compose pages (club admin, `clubs/[id]`, district quick links, `districts/[id]`) called
  `sub-groups/available-years` (sub groups off). The Subgroup recipient option and its calls now need `sub_groups` on.
  "Select Members" reads `…/sub-groups/club-members`, the club member list mass email picks from: the API gate now
  leaves that one route open (`feature_gate_e2e` checks both).
- "Invalid or unexpected token", chunk-load, hydration and connection-refused errors: `next dev` restarts itself at
  its memory limit (4 GB heap) several times per crawl. Every such page was probed again and loads clean.
  `admin_crawl.py` now waits for the server and retries once when a navigation is refused, and lets the login page
  hydrate before typing (otherwise the form posts natively).

Crawl setup: the lane's `node_modules` is a junction to E:, and webpack cannot build a project on C: from modules on
E: (`Can't resolve './E:/…/app-next-dev.js'`; with preserved symlinks, a second mini-css-extract-plugin instance).
The dev server ran from a copy of `row/admin` with its own `node_modules` copy in the lane-e scratchpad
(`NEXT_PUBLIC_API_URL=http://127.0.0.1:5105`), synced from the lane before the verification crawl. Crawl ids by
query: club 133 (first club with a club admin), district 2, zone 1, member 2; SuperAdmin login from the local copy.

Results (SuperAdmin, 316 pages): before 104 with problems (36 real, 68 dev-server restarts); after 3, two of them
restart noise (probed clean) and the district rotary-network 500, fixed afterwards and probed clean.

## H3: e2e scripts

All take `<api_base> <mysql_port> <database>`, sign JWTs with `ROW_E2E_JWT_SECRET` for members picked by query, and
clean up what they create. Demo logins (`*.demo`, the old SuperAdmin, `RowTest@2026`) and `row_local` are gone.

| Script | Changes |
|---|---|
| audit_immutable | SuperAdmin by query; the throwaway member's privacy request and change-log rows are removed (the erased member and the audit rows stay by design) |
| district_site | database arg; `LAST_INSERT_ID` read in the same connection (the About test row leaked before); switch-off restores exactly the rows it turned off |
| meeting_mode | SuperAdmin by query; the soft-deleted test record is removed |
| member_scope | club admin by query; the allowed edit sends another member's email, so it stops at the duplicate check (409) after the scope check: nothing is saved |
| mobile_password_login | a plain member without a password by query; reset token written to the DB (no mail to him); credentials, token, device session, profile sign-in counters and change-log rows restored |
| scope_write_guard | club admin, member and SuperAdmin by query; the read check uses the member's own club (other clubs are refused since the read guard) |
| tenant_lifecycle | smallest district with 2+ clubs and a club admin; editions, subscriptions, module switches and club type copied to `e2e_tl_*` and restored (table checksums identical before and after) |
| privacy | throwaway member (fake email, unused 15-digit Rotary id) with family and email-log rows, two temporary District Admin roles; consent checks follow the API's policy version; failure output carries no names |
| i18n_catalogue | SuperAdmin and club admin by query; an existing override for the test key is kept aside and restored |

Also: `volunteers_speakers` waits for the reminder emails' final status instead of reading it while `Pending`;
`feature_gate` has two sub-group checks; `scope_read_guard` checks the terminated-members `clubId` refusal.

Run needs: `volunteers_speakers` wants the API with `VolunteerReminders__Enabled=true`; `communication_upgrades`
wants its fake Brevo and DNS (`Brevo__ApiUrl`, `Brevo__WebhookSecret`, `Comms__DnsServers__0`, `Api__BaseUrl`, see
its docstring); the privacy consent branch with a policy version needs `Brand__Legal__PolicyVersion` (run here
without one, so the "no version set" branch ran).

## Open (not done here)

- `href="/"` back links on some admin pages (`ag-reports`, `clubs`, `districts`, `zones/new`, `not-found`) still lead
  a signed-in user to the public site and on to `/login`; they should point to `/admin`.
- Privacy erasure fails (rolled back, status `failed`) for a member whose Rotary id is not numeric:
  `rotary_org_club_members_cache` / `rotary_org_terminated_cache` keep it as BIGINT and strict mode refuses the
  string compare.
- `rotary-org-terminated-members` still returns the upstream exception message in its 502 reply.
- With the club monthly report off, the TRF year list shows all 48 rotary years (1980-81 to 2027-28).
- Crawl as District Admin, Club Admin and AG (P5) still needs those test logins.
