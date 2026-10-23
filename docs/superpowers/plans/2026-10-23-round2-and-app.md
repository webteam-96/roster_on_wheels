# Round 2 + mobile app + hardening (2026-10-23)

Ask (user): build all remaining non-payment work, then the same in the mobile app, without questions. Solo work
(no workflows), minimum tokens. Payments stay on hold (Stripe); blocked items (TRACKER section 6) stay blocked.

## Defaults taken (no questions asked)

- Club committees: not built (spec Appendix A counts committees as done; ROW only lacked per-committee documents).
- Grants "district on ROW" = a district tenant row (as built). Volunteer hours add to project man-hours (as built).
  Transactional emails (grants, volunteers, meetings) stay outside email credits (as built).
- RI default themes: seed ROW's own built-in templates into theme_master so clubs can pick them (ROW content, not
  RIZones data).
- The production cleanup script is NOT run: production writes still need the user's explicit go-ahead.
- Chat in the app: REST with polling while a chat is open (no new SignalR package).

## Order

1. N12 time zones: district IANA zone, UTC-safe display, no IST constant left (build guide package 4).
2. N7 planning mode without RI or payment (spec 3.1): planning/live state, elect roles, DGE team + invites,
   next-year workspace, launchpad, cut-over (RI steps stubbed), edition auto-provisioning, 60-day trial.
3. B.3/B.4: escalation ladder (#32) and target celebration (#35).
4. Theme seed (above).
5. App: screens for N1-N11 modules, N7 next-year workspace and per-tenant branding, N12 zone display.
6. App: missing existing-module screens (TRACKER section 3 "Build app screen").
7. App: language switch through the translation API (N13).
8. Hardening: security gaps found 2026-10-23, crawl findings F1-F6, e2e accounts from env (P6), read review (P7).

Each step: build, e2e or tests, gate review, TRACKER row updated.
