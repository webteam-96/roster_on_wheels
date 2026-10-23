# N1 Membership fields: designations, duplicate check, sub-committees (2026-10-23, lane a)

Spec: build spec v4.1 section 3.12 and build list #9 (designations if not present, duplicate check on RI ID and
email, sub-committees and per-committee documents if not present). RI member types, reason codes and the six RI
officer titles wait for ROW's own Rotary.org access (blocked, not in this module).

## Goal

1. Rotary Foundation designations per member with dates (Paul Harris Fellow and PHF+1 to +8, Major Donor levels 1
   to 4, Bequest Society), entered by club and district admins until RI feeds them; history per member on the admin
   member profile; a "members with designation X" report for clubs and districts; a read endpoint the app's member
   self-view can use later.
2. Duplicate check on RI ID and email at member add, edit and Rotary.org import: the API refuses (existing pattern,
   409) and names the matching member; the admin forms already show the API message.
3. Sub-committees and per-committee documents where missing.

## What exists (checked 2026-10-23)

- "Designation" in this codebase means an officer post (`designation_master`, `board_of_directors`). Foundation
  recognition only has a free-text `member_master_profile.DonorRecognition` (0 of 2,057 members filled in) and a
  registry entry for a `rotary_org_member_recognition` table that does not exist. Nothing holds dated history.
- Duplicates: `MemberService.CheckDuplicatesAsync` refuses a mobile, email or Rotary ID that an active member holds
  (add and edit) but does not say who holds it; `MembersController.Update` names the holder for mobile and email
  only. `RotaryOrgManualSyncController.AddMemberFromOrgAsync` (the Rotary.org import) has no live-duplicate check:
  a Rotary ID or email held by a member of another club ends in a MySQL unique-key error (HTTP 500). The DB has
  UNIQUE keys on EmailId and RotaryId. `MemberDuplicateController` is the SuperAdmin after-the-fact merge tool.
  The add forms already search first ("check if member already exists").
- Committees: districts have committees (`district_committee_group`) and sub-committees
  (`district_committee_sub_group`) with members and admin pages. No committee has documents. Clubs have no
  committee structure (officer posts and communication sub groups only).

## Tables

- `member_foundation_designations`: member, type (PHF, MAJOR_DONOR, BEQUEST_SOCIETY), level, awarded_date, notes,
  source (manual until RI feeds them), audit columns, soft delete. Registered in PersonalDataRegistry (export, erase
  deletes rows).
- `district_committee_documents`: district, committee (group), optional sub-committee, title, file, soft delete.

## Endpoints (all behind feature flag `membership_fields`)

- `GET /api/members/{memberId}/foundation-designations`: history (self, SuperAdmin, a manager of one of the
  member's clubs or of its district). The app's self-view uses this with its own member id.
- `POST /api/members/{memberId}/foundation-designations`, `DELETE .../{id}`: SuperAdmin and managers.
- `GET /api/clubs/{clubId}/foundation-designations?type=&minLevel=`: members with designation X (club managers).
- `GET /api/districts/{districtId}/foundation-designations?type=&minLevel=`: same for a district (district managers).
- `GET /api/districts/{districtId}/committee/documents?groupId=|subGroupId=`, `POST .../committee/documents`
  (multipart), `DELETE .../committee/documents/{id}`.
- Duplicate check: existing `POST /api/members`, `PUT /api/members/{id}`, `POST /api/admin/rotary-org-manual-sync/members`
  and `.../clubs` now name the matching member (not flag-gated: it refines an existing refusal).

## Admin pages

- Member profile (`/members/edit/[id]`, `/members/edit-v2/[id]`): Foundation designations card (history, add, remove).
- `/club-admin-dashboard/foundation-designations` and `/district-admin-dashboard/foundation-designations`: report
  with type and minimum level filter; nav entries hidden by the flag.
- District committee and sub-committee pages (district admin dashboard and SuperAdmin drill): documents card.
- Rotary.org clubs page: lists members skipped as duplicates after "add club".

## e2e

`kb/tools/membership_fields_e2e.py <api_base> <mysql_port> <database>`: flag off gives 404; designations add, list,
duplicate refusal, validation, cross-club refusal, report, self read, delete; committee document upload, list,
cross-district refusal, delete; duplicate check names the member on add and edit. Cleans up its rows.

## Left for the app

Member self-view of own Foundation recognition: `GET /api/members/{selfId}/foundation-designations`.

## Shortcuts

- No edit of a designation row: remove and add again.
- Reports return at most 5,000 rows, no paging.

## Done (2026-10-23)

### Files

Added:
- `row/api/Controllers/FoundationDesignationsController.cs`: history, add, remove, club and district reports.
- `row/api/Controllers/DistrictCommitteeDocumentsController.cs`: list, upload, remove per committee or sub-committee.
- `row/admin/src/components/membership/FoundationDesignationsCard.tsx` (member profile card),
  `FoundationDesignationsReport.tsx` (report), `CommitteeDocumentsCard.tsx` (committee documents).
- `row/admin/src/app/club-admin-dashboard/foundation-designations/page.tsx`,
  `row/admin/src/app/district-admin-dashboard/foundation-designations/page.tsx`.
- `row/admin/src/lib/foundationDesignations.ts` + `.test.ts` (options and labels).
- `kb/tools/membership_fields_e2e.py`.

Changed:
- `row/api/Services/MemberService.cs`: `CheckDuplicatesAsync` names the matching member and one of their clubs,
  is shared (internal static) and throws `DuplicateMemberException` (an InvalidOperationException, so existing 409
  handlers keep working).
- `row/api/Controllers/RotaryOrgManualSyncController.cs`: the Rotary.org import runs the same check before insert or
  re-activation; single add answers 409 with the name, add-club lists skipped members in `memberDuplicates` (not
  logged, the text names a member).
- `row/api/Services/FeatureGate.cs` (flag `membership_fields`), `DatabaseInitializer.cs` (2 tables),
  `Privacy/PersonalDataRegistry.cs` (designations: export, erase deletes), `AuditMiddleware.cs` (entity name),
  `row/database/schema.sql` (2 tables).
- Admin: `services/api.ts`, both dashboard `nav.ts`, `members/edit/[id]` and `members/edit-v2/[id]` (card), the 4
  district committee and sub-committee pages (documents card), `settings/rotary-org/clubs` (duplicates note).

### Tables

`member_foundation_designations`, `district_committee_documents` (CREATE TABLE IF NOT EXISTS, additive).

### Endpoints

- `GET|POST /api/members/{memberId}/foundation-designations`, `DELETE .../{id}`
- `GET /api/clubs/{clubId}/foundation-designations?type=PHF|MAJOR_DONOR|BEQUEST_SOCIETY&minLevel=n`
- `GET /api/districts/{districtId}/foundation-designations?type=...&minLevel=n`
- `GET /api/districts/{districtId}/committee/documents?groupId=|subGroupId=`, `POST .../committee/documents`
  (multipart groupId or subGroupId, title, file), `DELETE .../committee/documents/{id}`
- Changed responses: `POST /api/members`, `PUT /api/members/{id}`, `POST /api/admin/rotary-org-manual-sync/members`
  (409 naming the member), `POST /api/admin/rotary-org-manual-sync/clubs` (+ `memberDuplicates`).

### Verification

- `dotnet build`: 0 errors; no warnings in the changed files (187 existing warnings elsewhere).
- `python -I kb/tools/membership_fields_e2e.py http://127.0.0.1:5101 3317 row_lane_a`: 40 PASS, 0 FAIL, clean-up
  check passes (audit_log keeps its rows, it is append-only).
- `kb/tools/scope_read_guard_e2e.py` on the same API: 7 PASS (no regression).
- Admin: `tsc --noEmit` 0 errors; `vitest run src/lib/foundationDesignations.test.ts src/components/FeatureGate.test.ts`
  4 passed; `node scripts/check-design.mjs` all zero.

### Open issues

- Clubs have no committee structure in ROW (officer posts and communication sub groups only). The spec counts
  committees as done, so club committees and sub-committees were not built; needs a decision.
- The Rotary.org sync worker (`row/workers/RotaryOrgSyncWorker`) keeps its own collision handling (parks a clashing
  email or mobile in the secondary slot; the SuperAdmin duplicates page lists the pairs). Not changed.
- The duplicate check matches exact values like the UNIQUE keys; a secondary email of another member is not checked.
- Existing gap seen, not changed: `POST /api/districts/{id}/documents/upload` has no file-type allow-list.
- The free-text `member_master_profile.DonorRecognition` stays as it is (empty in the data); it is not derived from
  the new table.
- Uploaded files are served from `wwwroot/Documents` by URL like the other documents (no auth on the file itself).
