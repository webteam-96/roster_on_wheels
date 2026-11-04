# Club Website — Test Plan

Manual smoke test covering all 10 phases of the build. Run through this end-to-end before each production deploy.

## 0. Prerequisites

- **RotaryApi** running on `http://localhost:5000`
- **rotary-frontend** running on `http://localhost:3000`
- **club-website** running on `http://localhost:3001` (`cd club-website && npm run dev`)
- Database is the production schema (let `DatabaseInitializer` run on startup so the new indexes + theme seeds + content_html column are applied)

### Pick a test club

Pick any one club that has a `club_websites` row. If none exist:

1. Log into rotary-frontend as SuperAdmin.
2. Settings → Club Websites → Add. Pick a club, set Subdomain (e.g. `test-club`), Start/End date (set EndDate ~30 days out for "paid" or leave AmountPaid blank for "trial"), pick any theme.
3. Note the `pk_club_id` and `pk_id` (website id).

### Add hosts entry for local subdomain test

```text
# C:\Windows\System32\drivers\etc\hosts  (run editor as Administrator)
127.0.0.1   test-club.localhost
127.0.0.1   another-club.localhost
```

Then visit `http://test-club.localhost:3001` — the tenant resolver should pick it up.

---

## 1. Tenant resolution

| Action | Expected |
|---|---|
| Hit `http://test-club.localhost:3001/` | Resolves to club; renders Home in the club's theme |
| Hit `http://does-not-exist.localhost:3001/` | "Site not found" page |
| Inspect Network tab | First request to `/api/public/club-website/by-host/test-club.localhost` returns `{ clubId, themeKey, status, ... }`; subsequent requests within 5 min should not re-hit the API for this host (in-memory LRU) |
| Visit a club website whose club is `IsActive=0` or whose district / zone is inactive | "Site not found" — kill-switch chain blocks publicly |
| Pre-flight an admin assigns a `ClientDomain` (e.g., `rcmumbai.org`) | Add to hosts, hit it → resolves the same way |

## 2. Status states — all 4 transitions

For each, change the `club_websites` row in the DB and reload `http://test-club.localhost:3001`.

| Edit | Expected on public site |
|---|---|
| `Status='Active'`, `AmountPaid>0`, `EndDate >= today` | **Active paid** — no banner, full site visible |
| Set `AmountPaid=NULL`, `TransactionId=NULL`, `EndDate = today + 10` | **Trial** — top banner "Trial · 10 days remaining" (green) |
| Set `EndDate = today + 4` | Banner shifts to amber: "Trial · 4 days remaining" |
| Set `EndDate = today + 1` | Banner shifts to rose: "Trial ends tomorrow" |
| Set `EndDate = today - 1`, `AmountPaid=NULL` | **Trial expired** — full-screen modal "Your trial period has ended" (Sparkles icon) |
| Set `AmountPaid=5000`, `EndDate = today - 1` | **Paid expired** — full-screen modal "This website has expired" (Clock icon) |

The modal CTA should open `mailto:` prefilled with subject + club name. Set `NEXT_PUBLIC_PURCHASE_URL` in `.env.production` to override with a real purchase page.

## 3. All 8 default menus

In the resolved club site, navigate to each menu in the header and confirm:

| Route | Renders | Year filter affects? |
|---|---|---|
| `/` | Banner carousel + advertisement grid + About teaser | Banners + ads filter by year |
| `/about` | Rich-HTML about content + contacts + socials | Year picker filters about/contacts/socials |
| `/directors` | BOD grid with photos + designations | Yes |
| `/directory` | All active club members, sorted alphabetically | No (directory is current-membership) |
| `/calendar` | Today's birthdays + anniversaries + events. Date picker shifts to other days. | Date param overrides; year unused |
| `/projects` | All non-Club-Service modules, grouped by avenue | Yes |
| `/meetings` | Club Service projects only | Yes |
| `/past-presidents` | Year-by-year timeline | No (shows all years) |

For each, verify:
- Loading state (briefly) on cold cache
- Empty state if no data (e.g. "No directors for this year")
- Images render through `/uploads/...` URL via API origin

## 4. Year filter

- Header shows year dropdown only when ≥ 2 distinct years have data
- Switching year reloads via `?year=N` on the URL
- The default year is the current Rotary year if it has data, else the most recent

## 5. All 5 themes

Switch theme from **Admin** (rotary-frontend → `/clubs/{id}/website-data/theme`):

| Theme | Verify |
|---|---|
| Classic Blue | Sticky navy header + gold accents + serif headings |
| Modern Minimal | Slim 14px off-white header + teal accent + ultra-light Inter |
| Bold Color | Tall rose→orange gradient masthead + Archivo Black display + diagonal-accent BOD portraits |
| Editorial | Cream paper bg + newspaper masthead + Playfair serif + B&W BOD portraits (color on hover) + drop-cap on Home |
| Compact Card | Slim 12px header + tile-style nav + dense 4-col ad grid |

After clicking a card → confirmation modal "Switch theme?" → confirm → success message mentions "5 minute cache". Wait 5 min or kill the dev server to refresh the in-memory cache, then hit the public site → new theme is live.

## 6. Menu cap (8 default + 1 custom)

In rotary-frontend → `/clubs/{id}/website-data/menu_list`:

- 8 default menus auto-created with "Default" badge — verify Edit / Deactivate / Delete dropdown items are hidden
- Badge row shows `8 Default` + `0/1 Custom`
- Click "Add Custom Menu" → dialog opens
- Try Link Type = "Rich-Text Page" → Quill editor appears; save with sample HTML
- Refresh → custom menu in list with Edit/Delete enabled; `1/1 Custom` badge
- "Add Custom Menu" button is now **disabled** with tooltip
- Public site: the new custom menu appears in the nav. Click it →
  - If linkType=html → renders at `/m/{slug}` with the Quill content inside the active theme
  - If linkType=external (URL) → browser redirects to that URL
  - If linkType=document → downloads / opens the uploaded file
- Delete the custom menu in admin → public-site nav loses it within 5 min cache

## 7. Privacy (PII)

- Edit any directory member in admin → set `IsPersonalDetailsVisible = 0`
- Refresh public `/directory` → that member's email + mobile are blank; profession, designation, photo, name still show

## 8. Reminder emails (dry run)

Modify a test club's `EndDate` so that `EndDate - today` equals one of {30, 15, 7, 1} for a paid site, or {3, 1} for a trial. Wait up to 6h for the background service, or restart the API (2-min startup delay then runs).

- Check the club's BOD has a "Club President" and "Club Secretary" with non-empty `EmailId` for the current year
- Look in `club_website_logs`: a row with `Action = 'ReminderSent'` and `Details LIKE 'Milestone:P-30%'` (or `T-3` etc.)
- Confirm the recipient inbox receives the email
- Re-run → no duplicate (logs already have the marker)
- Set `EndDate` to past → next cycle marks `Status='Expired'` and stops emailing

## 9. Cache + ISR

- Static (about / banners / ads / past-presidents / menus / years) revalidates every **5 min**
- Editable (BOD / directory / projects / meetings) revalidates every **1 min**
- Calendar revalidates every **1 min**
- Edit a banner via admin → public Home shows new banner within 5 min

## 10. Performance — DB indexes

After first deploy, run in MySQL:

```sql
SHOW INDEX FROM club_websites WHERE Key_name LIKE 'idx_cw_%';
SHOW INDEX FROM club_website_banner WHERE Key_name LIKE 'idx_banner_%';
SHOW INDEX FROM club_website_menu WHERE Key_name LIKE 'idx_menu_%';
-- ...etc
```

Expect to see the indexes added in Phase 9 (`idx_cw_client_domain`, `idx_banner_club_year`, etc.).

`EXPLAIN` should show index usage on the public-data queries:

```sql
EXPLAIN SELECT * FROM club_website_banner
WHERE fk_club_id = 1 AND fk_year_id = 1 AND isdeleted = 0 AND is_active = 1
ORDER BY sort_order;
-- key = idx_banner_club_year
```

---

## Known gaps (track separately, not blocking launch)

- **Theme switch latency**: the in-memory tenant cache is 5 min. A switched theme appears on the public site after the cache TTL expires. Could add an explicit "invalidate" hook later (e.g., bump a `theme_version` integer the resolver checks).
- **Year-filter on About**: About is year-scoped in the data model. If a club only edits the current year's About, switching to a past year shows blank. Acceptable for v1.
- **`www.` host normalization**: `club.example.org` won't resolve. Add to Plesk as a Plesk-level alias instead, or strip `www.` in the resolver.
- **AmountPaid=0 free clubs**: a club marked free (AmountPaid=0, no TransactionId) is currently treated as trial. Add an explicit `IsComplimentary` flag if needed.
- **Custom menu sub-menus**: a custom menu can have unlimited sub-menus, but their link type is restricted to `page` / `external` / `document` (the Quill editor only appears for top-level html menus). If you want HTML sub-pages, add the same Quill flow to sub-menu dialog.

## Sample seed for fresh dev DB

If you want a working club-website for testing without any real data, run this in MySQL (replace `@ClubId` with an existing club's `pk_club_id`):

```sql
SET @ClubId = (SELECT pk_club_id FROM club_master WHERE isdeleted = 0 ORDER BY pk_club_id LIMIT 1);
SET @YearId = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1);
SET @ThemeId = (SELECT pk_theme_id FROM theme_master WHERE theme_name = 'Classic Blue' LIMIT 1);

INSERT INTO club_websites (fk_club_id, Subdomain, fk_theme_id, StartDate, EndDate, Status, AmountPaid, TransactionId, created_date)
VALUES (@ClubId, 'test-club', @ThemeId, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 365 DAY), 'Active', 5000, 'TEST-TXN', NOW());

INSERT INTO club_website_about (fk_club_id, fk_year_id, content, is_active)
VALUES (@ClubId, @YearId, '<p>Welcome to our test club website. This is a sample about page used for local testing.</p>', 1);
```

Then hit `http://test-club.localhost:3001/` to see the rendered site.
