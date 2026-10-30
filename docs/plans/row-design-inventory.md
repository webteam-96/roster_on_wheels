# ROW design overhaul: screen inventory

Generated 29 Oct 2026 (Phase 0 of `docs/plans/row-design-overhaul.md`). Status column: todo / done / retired.

## Admin (`row/admin`): 473 pages

How "Linked in code" was found: a script collected every literal path string in `row/admin/src` and matched it to
the page routes. **NO means no literal link was found**; a page can still be reached through a path built at run
time (for example a settings hub that joins segments). Each NO page is confirmed in the browser before anything is
retired, and nothing is retired without the user's OK.

Summary: 399 linked, 74 with no literal link. 102 `/v2` pages; 78 have an older twin. Of those 78 pairs: both
versions linked 55, only `/v2` linked 5, only the old one linked 16, neither 2.

Open point for the user (at the live review): for the 55 pairs where both versions are linked, keep one version
per pair. Default proposal: keep the version the role dashboards (club / district shells) open, redirect the other.

| Route | Area | Linked in code | v2 pair | Status |
|---|---|---|---|---|
| `/` | root | yes |  | todo |
| `/about-us` | about-us | yes |  | todo |
| `/admin` | admin | yes |  | todo |
| `/admin/about-us` | admin | NO |  | todo |
| `/admin/club-modules` | admin | yes |  | todo |
| `/admin/contact-us` | admin | NO |  | todo |
| `/admin/district-modules` | admin | yes |  | todo |
| `/admin/login-logs` | admin | yes |  | todo |
| `/admin/module-categories` | admin | yes |  | todo |
| `/admin/modules` | admin | yes |  | todo |
| `/admin/modules/edit/[id]` | admin | yes |  | todo |
| `/admin/modules/new` | admin | yes |  | todo |
| `/admin/tutorial` | admin | NO |  | todo |
| `/ag-dashboard` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/clubs` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/clubs/[clubId]` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/district` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/excellence` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/membership` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/projects` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/reports` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/targets` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/trf` | ag-dashboard | yes |  | todo |
| `/ag-dashboard/youth` | ag-dashboard | yes |  | todo |
| `/ag-reports` | ag-reports | yes |  | todo |
| `/club-admin-dashboard` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/avenue` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/chat-moderation` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/club-dues` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/comms-settings` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/communication` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/communication/mass-email/[emailId]` | club-admin-dashboard | NO |  | todo |
| `/club-admin-dashboard/communication/mass-email/compose` | club-admin-dashboard | NO |  | todo |
| `/club-admin-dashboard/contacts` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/dashboard` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/dashboard/board-of-directors` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/dashboard/directory` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/dashboard/overview` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/dashboard/past-presidents` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/dashboard/rotary-network` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/e-governance` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/egovernance` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/email-log` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/engagement` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/foundation` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/foundation-designations` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/goal-setting` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/grants` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/grants/[applicationId]` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/membership` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/membership-dues` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/my-club-website` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/overview` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/payment-accounts` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/payment-links` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/payments` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/service-projects-and-public-image` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/speakers` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/targets` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/volunteers` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/volunteers/[sheetId]` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/wallet` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/website` | club-admin-dashboard | yes |  | todo |
| `/club-admin-dashboard/website-purchase` | club-admin-dashboard | yes |  | todo |
| `/club-dues-approval/[token]` | club-dues-approval | NO |  | todo |
| `/clubs` | clubs | yes |  | todo |
| `/clubs/[id]/announcements` | clubs | yes | `/clubs/[id]/announcements/v2` | todo |
| `/clubs/[id]/announcements/[announcementId]` | clubs | yes |  | todo |
| `/clubs/[id]/announcements/[announcementId]/edit` | clubs | yes | `/clubs/[id]/announcements/v2/[announcementId]/edit` | todo |
| `/clubs/[id]/announcements/add` | clubs | yes | `/clubs/[id]/announcements/v2/add` | todo |
| `/clubs/[id]/announcements/v2` | clubs | yes | `/clubs/[id]/announcements` | todo |
| `/clubs/[id]/announcements/v2/[announcementId]/edit` | clubs | yes | `/clubs/[id]/announcements/[announcementId]/edit` | todo |
| `/clubs/[id]/announcements/v2/add` | clubs | yes | `/clubs/[id]/announcements/add` | todo |
| `/clubs/[id]/attendance` | clubs | yes | `/clubs/[id]/attendance/v2` | todo |
| `/clubs/[id]/attendance/[attendanceId]` | clubs | yes |  | todo |
| `/clubs/[id]/attendance/[attendanceId]/edit` | clubs | yes | `/clubs/[id]/attendance/v2/[attendanceId]/edit` | todo |
| `/clubs/[id]/attendance/add` | clubs | yes | `/clubs/[id]/attendance/v2/add` | todo |
| `/clubs/[id]/attendance/v2` | clubs | yes | `/clubs/[id]/attendance` | todo |
| `/clubs/[id]/attendance/v2/[attendanceId]/edit` | clubs | yes | `/clubs/[id]/attendance/[attendanceId]/edit` | todo |
| `/clubs/[id]/attendance/v2/add` | clubs | yes | `/clubs/[id]/attendance/add` | todo |
| `/clubs/[id]/board-of-directors` | clubs | yes | `/clubs/[id]/board-of-directors/v2` | todo |
| `/clubs/[id]/board-of-directors/v2` | clubs | yes | `/clubs/[id]/board-of-directors` | todo |
| `/clubs/[id]/board-of-directors/v2/[directorId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/board-of-directors/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/citation` | clubs | yes | `/clubs/[id]/citation/v2` | todo |
| `/clubs/[id]/citation/v2` | clubs | NO | `/clubs/[id]/citation` | todo |
| `/clubs/[id]/club-monthly-report` | clubs | yes | `/clubs/[id]/club-monthly-report/v2` | todo |
| `/clubs/[id]/club-monthly-report/[yearId]/[month]` | clubs | yes | `/clubs/[id]/club-monthly-report/v2/[yearId]/[month]` | todo |
| `/clubs/[id]/club-monthly-report/[yearId]/[month]/preview` | clubs | yes | `/clubs/[id]/club-monthly-report/v2/[yearId]/[month]/preview` | todo |
| `/clubs/[id]/club-monthly-report/v2` | clubs | yes | `/clubs/[id]/club-monthly-report` | todo |
| `/clubs/[id]/club-monthly-report/v2/[yearId]/[month]` | clubs | yes | `/clubs/[id]/club-monthly-report/[yearId]/[month]` | todo |
| `/clubs/[id]/club-monthly-report/v2/[yearId]/[month]/preview` | clubs | NO | `/clubs/[id]/club-monthly-report/[yearId]/[month]/preview` | todo |
| `/clubs/[id]/club-report` | clubs | NO | `/clubs/[id]/club-report/v2` | todo |
| `/clubs/[id]/club-report/v2` | clubs | yes | `/clubs/[id]/club-report` | todo |
| `/clubs/[id]/club-service` | clubs | yes | `/clubs/[id]/club-service/v2` | todo |
| `/clubs/[id]/club-service/[projectId]` | clubs | yes |  | todo |
| `/clubs/[id]/club-service/[projectId]/edit` | clubs | yes | `/clubs/[id]/club-service/v2/[projectId]/edit` | todo |
| `/clubs/[id]/club-service/add` | clubs | yes | `/clubs/[id]/club-service/v2/add` | todo |
| `/clubs/[id]/club-service/v2` | clubs | yes | `/clubs/[id]/club-service` | todo |
| `/clubs/[id]/club-service/v2/[projectId]/edit` | clubs | yes | `/clubs/[id]/club-service/[projectId]/edit` | todo |
| `/clubs/[id]/club-service/v2/add` | clubs | yes | `/clubs/[id]/club-service/add` | todo |
| `/clubs/[id]/community-service/v2` | clubs | yes |  | todo |
| `/clubs/[id]/community-service/v2/[projectId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/community-service/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/dashboard` | clubs | yes |  | todo |
| `/clubs/[id]/documents` | clubs | yes | `/clubs/[id]/documents/v2` | todo |
| `/clubs/[id]/documents/[documentId]` | clubs | yes |  | todo |
| `/clubs/[id]/documents/[documentId]/edit` | clubs | yes | `/clubs/[id]/documents/v2/[documentId]/edit` | todo |
| `/clubs/[id]/documents/add` | clubs | yes | `/clubs/[id]/documents/v2/add` | todo |
| `/clubs/[id]/documents/v2` | clubs | yes | `/clubs/[id]/documents` | todo |
| `/clubs/[id]/documents/v2/[documentId]/edit` | clubs | yes | `/clubs/[id]/documents/[documentId]/edit` | todo |
| `/clubs/[id]/documents/v2/add` | clubs | yes | `/clubs/[id]/documents/add` | todo |
| `/clubs/[id]/event-payment-links` | clubs | yes | `/clubs/[id]/event-payment-links/v2` | todo |
| `/clubs/[id]/event-payment-links/[linkId]/members` | clubs | yes | `/clubs/[id]/event-payment-links/v2/[linkId]/members` | todo |
| `/clubs/[id]/event-payment-links/[linkId]/members/[memberId]/offline-payment` | clubs | yes |  | todo |
| `/clubs/[id]/event-payment-links/edit` | clubs | yes | `/clubs/[id]/event-payment-links/v2/edit` | todo |
| `/clubs/[id]/event-payment-links/v2` | clubs | yes | `/clubs/[id]/event-payment-links` | todo |
| `/clubs/[id]/event-payment-links/v2/[linkId]/members` | clubs | yes | `/clubs/[id]/event-payment-links/[linkId]/members` | todo |
| `/clubs/[id]/event-payment-links/v2/edit` | clubs | yes | `/clubs/[id]/event-payment-links/edit` | todo |
| `/clubs/[id]/greetings` | clubs | yes |  | todo |
| `/clubs/[id]/international-service` | clubs | yes | `/clubs/[id]/international-service/v2` | todo |
| `/clubs/[id]/international-service/[projectId]` | clubs | yes |  | todo |
| `/clubs/[id]/international-service/[projectId]/edit` | clubs | yes | `/clubs/[id]/international-service/v2/[projectId]/edit` | todo |
| `/clubs/[id]/international-service/add` | clubs | yes | `/clubs/[id]/international-service/v2/add` | todo |
| `/clubs/[id]/international-service/v2` | clubs | yes | `/clubs/[id]/international-service` | todo |
| `/clubs/[id]/international-service/v2/[projectId]/edit` | clubs | yes | `/clubs/[id]/international-service/[projectId]/edit` | todo |
| `/clubs/[id]/international-service/v2/add` | clubs | yes | `/clubs/[id]/international-service/add` | todo |
| `/clubs/[id]/mass-emails` | clubs | yes |  | todo |
| `/clubs/[id]/mass-emails/[emailId]` | clubs | yes |  | todo |
| `/clubs/[id]/mass-emails/compose` | clubs | yes |  | todo |
| `/clubs/[id]/members` | clubs | yes |  | todo |
| `/clubs/[id]/membership-dues` | clubs | yes | `/clubs/[id]/membership-dues/v2` | todo |
| `/clubs/[id]/membership-dues/[duesId]/members` | clubs | yes | `/clubs/[id]/membership-dues/v2/[duesId]/members` | todo |
| `/clubs/[id]/membership-dues/edit/[duesId]` | clubs | yes | `/clubs/[id]/membership-dues/v2/edit/[duesId]` | todo |
| `/clubs/[id]/membership-dues/v2` | clubs | yes | `/clubs/[id]/membership-dues` | todo |
| `/clubs/[id]/membership-dues/v2/[duesId]/members` | clubs | yes | `/clubs/[id]/membership-dues/[duesId]/members` | todo |
| `/clubs/[id]/membership-dues/v2/edit/[duesId]` | clubs | yes | `/clubs/[id]/membership-dues/edit/[duesId]` | todo |
| `/clubs/[id]/new-generation-service` | clubs | yes | `/clubs/[id]/new-generation-service/v2` | todo |
| `/clubs/[id]/new-generation-service/[projectId]` | clubs | yes |  | todo |
| `/clubs/[id]/new-generation-service/[projectId]/edit` | clubs | yes | `/clubs/[id]/new-generation-service/v2/[projectId]/edit` | todo |
| `/clubs/[id]/new-generation-service/add` | clubs | yes | `/clubs/[id]/new-generation-service/v2/add` | todo |
| `/clubs/[id]/new-generation-service/v2` | clubs | yes | `/clubs/[id]/new-generation-service` | todo |
| `/clubs/[id]/new-generation-service/v2/[projectId]/edit` | clubs | yes | `/clubs/[id]/new-generation-service/[projectId]/edit` | todo |
| `/clubs/[id]/new-generation-service/v2/add` | clubs | yes | `/clubs/[id]/new-generation-service/add` | todo |
| `/clubs/[id]/newsletters` | clubs | yes | `/clubs/[id]/newsletters/v2` | todo |
| `/clubs/[id]/newsletters/[newsletterId]` | clubs | yes |  | todo |
| `/clubs/[id]/newsletters/[newsletterId]/edit` | clubs | NO | `/clubs/[id]/newsletters/v2/[newsletterId]/edit` | todo |
| `/clubs/[id]/newsletters/add` | clubs | NO | `/clubs/[id]/newsletters/v2/add` | todo |
| `/clubs/[id]/newsletters/v2` | clubs | yes | `/clubs/[id]/newsletters` | todo |
| `/clubs/[id]/newsletters/v2/[newsletterId]/edit` | clubs | yes | `/clubs/[id]/newsletters/[newsletterId]/edit` | todo |
| `/clubs/[id]/newsletters/v2/add` | clubs | yes | `/clubs/[id]/newsletters/add` | todo |
| `/clubs/[id]/ocv-gov` | clubs | yes | `/clubs/[id]/ocv-gov/v2` | todo |
| `/clubs/[id]/ocv-gov/[categoryCode]` | clubs | yes | `/clubs/[id]/ocv-gov/v2/[categoryCode]` | todo |
| `/clubs/[id]/ocv-gov/live-documents` | clubs | yes | `/clubs/[id]/ocv-gov/v2/live-documents` | todo |
| `/clubs/[id]/ocv-gov/report` | clubs | yes | `/clubs/[id]/ocv-gov/v2/report` | todo |
| `/clubs/[id]/ocv-gov/v2` | clubs | yes | `/clubs/[id]/ocv-gov` | todo |
| `/clubs/[id]/ocv-gov/v2/[categoryCode]` | clubs | yes | `/clubs/[id]/ocv-gov/[categoryCode]` | todo |
| `/clubs/[id]/ocv-gov/v2/live-documents` | clubs | yes | `/clubs/[id]/ocv-gov/live-documents` | todo |
| `/clubs/[id]/ocv-gov/v2/report` | clubs | yes | `/clubs/[id]/ocv-gov/report` | todo |
| `/clubs/[id]/past-presidents` | clubs | yes | `/clubs/[id]/past-presidents/v2` | todo |
| `/clubs/[id]/past-presidents/v2` | clubs | yes | `/clubs/[id]/past-presidents` | todo |
| `/clubs/[id]/past-presidents/v2/[presidentId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/past-presidents/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/projects` | clubs | yes |  | todo |
| `/clubs/[id]/projects/[projectId]` | clubs | yes |  | todo |
| `/clubs/[id]/projects/[projectId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/projects/add` | clubs | yes |  | todo |
| `/clubs/[id]/public-image-initiative` | clubs | yes | `/clubs/[id]/public-image-initiative/v2` | todo |
| `/clubs/[id]/public-image-initiative/[projectId]` | clubs | yes |  | todo |
| `/clubs/[id]/public-image-initiative/[projectId]/edit` | clubs | yes | `/clubs/[id]/public-image-initiative/v2/[projectId]/edit` | todo |
| `/clubs/[id]/public-image-initiative/add` | clubs | yes | `/clubs/[id]/public-image-initiative/v2/add` | todo |
| `/clubs/[id]/public-image-initiative/v2` | clubs | yes | `/clubs/[id]/public-image-initiative` | todo |
| `/clubs/[id]/public-image-initiative/v2/[projectId]/edit` | clubs | yes | `/clubs/[id]/public-image-initiative/[projectId]/edit` | todo |
| `/clubs/[id]/public-image-initiative/v2/add` | clubs | yes | `/clubs/[id]/public-image-initiative/add` | todo |
| `/clubs/[id]/rotary-network` | clubs | yes |  | todo |
| `/clubs/[id]/rotary-network/potential-members` | clubs | yes | `/clubs/[id]/rotary-network/potential-members/v2` | todo |
| `/clubs/[id]/rotary-network/potential-members/v2` | clubs | yes | `/clubs/[id]/rotary-network/potential-members` | todo |
| `/clubs/[id]/rotary-network/potential-members/v2/[potentialId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/rotary-network/potential-members/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/rotary-network/terminated-members` | clubs | yes | `/clubs/[id]/rotary-network/terminated-members/v2` | todo |
| `/clubs/[id]/rotary-network/terminated-members/v2` | clubs | yes | `/clubs/[id]/rotary-network/terminated-members` | todo |
| `/clubs/[id]/rotary-network/terminated-members/v2/[terminationId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/rotary-network/terminated-members/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/sub-groups` | clubs | yes |  | todo |
| `/clubs/[id]/trf` | clubs | yes | `/clubs/[id]/trf/v2` | todo |
| `/clubs/[id]/trf/v2` | clubs | yes | `/clubs/[id]/trf` | todo |
| `/clubs/[id]/trf/v2/[trfId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/trf/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/upcoming-events` | clubs | yes | `/clubs/[id]/upcoming-events/v2` | todo |
| `/clubs/[id]/upcoming-events/[eventId]` | clubs | yes |  | todo |
| `/clubs/[id]/upcoming-events/[eventId]/edit` | clubs | yes | `/clubs/[id]/upcoming-events/v2/[eventId]/edit` | todo |
| `/clubs/[id]/upcoming-events/add` | clubs | yes | `/clubs/[id]/upcoming-events/v2/add` | todo |
| `/clubs/[id]/upcoming-events/v2` | clubs | yes | `/clubs/[id]/upcoming-events` | todo |
| `/clubs/[id]/upcoming-events/v2/[eventId]/edit` | clubs | yes | `/clubs/[id]/upcoming-events/[eventId]/edit` | todo |
| `/clubs/[id]/upcoming-events/v2/add` | clubs | yes | `/clubs/[id]/upcoming-events/add` | todo |
| `/clubs/[id]/vocational-service` | clubs | yes | `/clubs/[id]/vocational-service/v2` | todo |
| `/clubs/[id]/vocational-service/[projectId]` | clubs | yes |  | todo |
| `/clubs/[id]/vocational-service/[projectId]/edit` | clubs | yes | `/clubs/[id]/vocational-service/v2/[projectId]/edit` | todo |
| `/clubs/[id]/vocational-service/add` | clubs | yes | `/clubs/[id]/vocational-service/v2/add` | todo |
| `/clubs/[id]/vocational-service/v2` | clubs | yes | `/clubs/[id]/vocational-service` | todo |
| `/clubs/[id]/vocational-service/v2/[projectId]/edit` | clubs | yes | `/clubs/[id]/vocational-service/[projectId]/edit` | todo |
| `/clubs/[id]/vocational-service/v2/add` | clubs | yes | `/clubs/[id]/vocational-service/add` | todo |
| `/clubs/[id]/weblinks` | clubs | yes |  | todo |
| `/clubs/[id]/website-data` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/about` | clubs | yes | `/clubs/[id]/website-data/about/v2` | todo |
| `/clubs/[id]/website-data/about/v2` | clubs | NO | `/clubs/[id]/website-data/about` | todo |
| `/clubs/[id]/website-data/advertisements` | clubs | yes | `/clubs/[id]/website-data/advertisements/v2` | todo |
| `/clubs/[id]/website-data/advertisements/v2` | clubs | yes | `/clubs/[id]/website-data/advertisements` | todo |
| `/clubs/[id]/website-data/advertisements/v2/[adId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/advertisements/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/banners` | clubs | yes | `/clubs/[id]/website-data/banners/v2` | todo |
| `/clubs/[id]/website-data/banners/v2` | clubs | yes | `/clubs/[id]/website-data/banners` | todo |
| `/clubs/[id]/website-data/banners/v2/[bannerId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/banners/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/contact_details` | clubs | NO | `/clubs/[id]/website-data/contact_details/v2` | todo |
| `/clubs/[id]/website-data/contact_details/v2` | clubs | NO | `/clubs/[id]/website-data/contact_details` | todo |
| `/clubs/[id]/website-data/languages` | clubs | NO |  | todo |
| `/clubs/[id]/website-data/logos` | clubs | NO |  | todo |
| `/clubs/[id]/website-data/menu_list` | clubs | NO | `/clubs/[id]/website-data/menu_list/v2` | todo |
| `/clubs/[id]/website-data/menu_list/v2` | clubs | yes | `/clubs/[id]/website-data/menu_list` | todo |
| `/clubs/[id]/website-data/menu_list/v2/[menuId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/menu_list/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/social_media_links` | clubs | NO | `/clubs/[id]/website-data/social_media_links/v2` | todo |
| `/clubs/[id]/website-data/social_media_links/v2` | clubs | yes | `/clubs/[id]/website-data/social_media_links` | todo |
| `/clubs/[id]/website-data/social_media_links/v2/[linkId]/edit` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/social_media_links/v2/add` | clubs | yes |  | todo |
| `/clubs/[id]/website-data/theme` | clubs | yes | `/clubs/[id]/website-data/theme/v2` | todo |
| `/clubs/[id]/website-data/theme/v2` | clubs | NO | `/clubs/[id]/website-data/theme` | todo |
| `/clubs/edit/[id]` | clubs | yes |  | todo |
| `/clubs/new` | clubs | yes |  | todo |
| `/committee` | committee | yes |  | todo |
| `/contact-us` | contact-us | yes |  | todo |
| `/cookies` | cookies | yes |  | todo |
| `/data-processing-agreement` | data-processing-agreement | yes |  | todo |
| `/district-admin-dashboard` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/ag` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/chat-moderation` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/club-dues` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/clubs` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/clubs/[clubId]` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/comms-settings` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/communication` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/contacts` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/district-committee` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/district-committee/committee` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/district-committee/groups` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/district-committee/groups/[groupId]` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/district-committee/groups/[groupId]/sub-groups/[subGroupId]` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/district-committee/groups/[groupId]/sub-groups/add` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/district-committee/groups/add` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/egovernance` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/email-log` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/engagement` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/escalation` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/foundation` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/foundation-designations` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/goal-setting` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/goal-setting/clubs` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/goal-setting/clubs/[clubId]` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/grants` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/grants/[applicationId]` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/meeting-compliance` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/membership` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/my-district-website` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/my-district-website/about` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/my-district-website/advertisements` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/my-district-website/banners` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/my-district-website/contact-details` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/my-district-website/languages` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/my-district-website/menu-list` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/my-district-website/social-media-links` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/overview` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/payment-accounts` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/privacy` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links/mass-email` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links/mass-email/[emailId]` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/quick-links/mass-email/compose` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/quick-links/sub-groups` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links/sub-groups/[id]/edit` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links/sub-groups/add` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links/web-links` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/quick-links/web-links/[id]/edit` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/quick-links/web-links/add` | district-admin-dashboard | NO |  | todo |
| `/district-admin-dashboard/rotary-network` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/targets` | district-admin-dashboard | yes |  | todo |
| `/district-admin-dashboard/wallet` | district-admin-dashboard | yes |  | todo |
| `/district-governors` | district-governors | yes |  | todo |
| `/districts` | districts | yes |  | todo |
| `/districts/[id]/ag` | districts | yes | `/districts/[id]/ag/v2` | todo |
| `/districts/[id]/ag/v2` | districts | NO | `/districts/[id]/ag` | todo |
| `/districts/[id]/announcements` | districts | yes |  | todo |
| `/districts/[id]/announcements/[announcementId]/edit` | districts | yes | `/districts/[id]/announcements/v2/[announcementId]/edit` | todo |
| `/districts/[id]/announcements/add` | districts | yes | `/districts/[id]/announcements/v2/add` | todo |
| `/districts/[id]/announcements/v2/[announcementId]/edit` | districts | NO | `/districts/[id]/announcements/[announcementId]/edit` | todo |
| `/districts/[id]/announcements/v2/add` | districts | NO | `/districts/[id]/announcements/add` | todo |
| `/districts/[id]/citation` | districts | yes | `/districts/[id]/citation/v2` | todo |
| `/districts/[id]/citation/v2` | districts | NO | `/districts/[id]/citation` | todo |
| `/districts/[id]/club-monthly-report` | districts | yes |  | todo |
| `/districts/[id]/club-monthly-report/[yearId]/[month]` | districts | yes |  | todo |
| `/districts/[id]/clubs` | districts | yes | `/districts/[id]/clubs/v2` | todo |
| `/districts/[id]/clubs/[clubId]` | districts | yes | `/districts/[id]/clubs/v2/[clubId]` | todo |
| `/districts/[id]/clubs/v2` | districts | yes | `/districts/[id]/clubs` | todo |
| `/districts/[id]/clubs/v2/[clubId]` | districts | yes | `/districts/[id]/clubs/[clubId]` | todo |
| `/districts/[id]/dashboard` | districts | yes |  | todo |
| `/districts/[id]/district-committee` | districts | yes | `/districts/[id]/district-committee/v2` | todo |
| `/districts/[id]/district-committee/committee` | districts | NO | `/districts/[id]/district-committee/v2/committee` | todo |
| `/districts/[id]/district-committee/groups` | districts | yes | `/districts/[id]/district-committee/v2/groups` | todo |
| `/districts/[id]/district-committee/groups/[groupId]` | districts | yes |  | todo |
| `/districts/[id]/district-committee/groups/[groupId]/sub-groups/[subGroupId]` | districts | yes |  | todo |
| `/districts/[id]/district-committee/v2` | districts | NO | `/districts/[id]/district-committee` | todo |
| `/districts/[id]/district-committee/v2/committee` | districts | NO | `/districts/[id]/district-committee/committee` | todo |
| `/districts/[id]/district-committee/v2/groups` | districts | NO | `/districts/[id]/district-committee/groups` | todo |
| `/districts/[id]/district-events` | districts | yes | `/districts/[id]/district-events/v2` | todo |
| `/districts/[id]/district-events/[eventId]/edit` | districts | yes | `/districts/[id]/district-events/v2/[eventId]/edit` | todo |
| `/districts/[id]/district-events/add` | districts | yes | `/districts/[id]/district-events/v2/add` | todo |
| `/districts/[id]/district-events/v2` | districts | yes | `/districts/[id]/district-events` | todo |
| `/districts/[id]/district-events/v2/[eventId]/edit` | districts | yes | `/districts/[id]/district-events/[eventId]/edit` | todo |
| `/districts/[id]/district-events/v2/add` | districts | yes | `/districts/[id]/district-events/add` | todo |
| `/districts/[id]/district-report` | districts | yes |  | todo |
| `/districts/[id]/documents` | districts | yes |  | todo |
| `/districts/[id]/documents/[documentId]/edit` | districts | yes | `/districts/[id]/documents/v2/[documentId]/edit` | todo |
| `/districts/[id]/documents/add` | districts | yes | `/districts/[id]/documents/v2/add` | todo |
| `/districts/[id]/documents/v2/[documentId]/edit` | districts | NO | `/districts/[id]/documents/[documentId]/edit` | todo |
| `/districts/[id]/documents/v2/add` | districts | NO | `/districts/[id]/documents/add` | todo |
| `/districts/[id]/egovernance/v2/[clubId]` | districts | yes |  | todo |
| `/districts/[id]/event-payment-links` | districts | yes |  | todo |
| `/districts/[id]/event-payment-links/[linkId]/members` | districts | yes |  | todo |
| `/districts/[id]/event-payment-links/[linkId]/members/[memberId]/offline-payment` | districts | yes |  | todo |
| `/districts/[id]/event-payment-links/edit` | districts | yes |  | todo |
| `/districts/[id]/foundation-goal/v2/edit` | districts | NO |  | todo |
| `/districts/[id]/greetings` | districts | yes |  | todo |
| `/districts/[id]/mass-emails` | districts | yes |  | todo |
| `/districts/[id]/mass-emails/[emailId]` | districts | yes |  | todo |
| `/districts/[id]/mass-emails/compose` | districts | yes |  | todo |
| `/districts/[id]/members` | districts | yes |  | todo |
| `/districts/[id]/membership-goal/v2/edit` | districts | NO |  | todo |
| `/districts/[id]/newsletters` | districts | yes |  | todo |
| `/districts/[id]/newsletters/[newsletterId]/edit` | districts | yes | `/districts/[id]/newsletters/v2/[newsletterId]/edit` | todo |
| `/districts/[id]/newsletters/add` | districts | yes | `/districts/[id]/newsletters/v2/add` | todo |
| `/districts/[id]/newsletters/v2/[newsletterId]/edit` | districts | NO | `/districts/[id]/newsletters/[newsletterId]/edit` | todo |
| `/districts/[id]/newsletters/v2/add` | districts | NO | `/districts/[id]/newsletters/add` | todo |
| `/districts/[id]/projects` | districts | yes | `/districts/[id]/projects/v2` | todo |
| `/districts/[id]/projects/[projectId]/edit` | districts | yes | `/districts/[id]/projects/v2/[projectId]/edit` | todo |
| `/districts/[id]/projects/add` | districts | yes | `/districts/[id]/projects/v2/add` | todo |
| `/districts/[id]/projects/v2` | districts | yes | `/districts/[id]/projects` | todo |
| `/districts/[id]/projects/v2/[projectId]/edit` | districts | yes | `/districts/[id]/projects/[projectId]/edit` | todo |
| `/districts/[id]/projects/v2/add` | districts | yes | `/districts/[id]/projects/add` | todo |
| `/districts/[id]/sub-groups` | districts | yes |  | todo |
| `/districts/[id]/upcoming-events` | districts | yes |  | todo |
| `/districts/[id]/upcoming-events/[eventId]/edit` | districts | yes | `/districts/[id]/upcoming-events/v2/[eventId]/edit` | todo |
| `/districts/[id]/upcoming-events/add` | districts | yes | `/districts/[id]/upcoming-events/v2/add` | todo |
| `/districts/[id]/upcoming-events/v2/[eventId]/edit` | districts | NO | `/districts/[id]/upcoming-events/[eventId]/edit` | todo |
| `/districts/[id]/upcoming-events/v2/add` | districts | NO | `/districts/[id]/upcoming-events/add` | todo |
| `/districts/[id]/weblinks` | districts | yes |  | todo |
| `/districts/[id]/website-data` | districts | yes |  | todo |
| `/districts/[id]/website-data/about` | districts | yes |  | todo |
| `/districts/[id]/website-data/advertisements` | districts | yes |  | todo |
| `/districts/[id]/website-data/banners` | districts | yes |  | todo |
| `/districts/[id]/website-data/contact_details` | districts | NO |  | todo |
| `/districts/[id]/website-data/district_logo` | districts | NO |  | todo |
| `/districts/[id]/website-data/languages` | districts | NO |  | todo |
| `/districts/[id]/website-data/menu_list` | districts | NO |  | todo |
| `/districts/[id]/website-data/social_media_links` | districts | NO |  | todo |
| `/districts/edit/[id]` | districts | yes |  | todo |
| `/districts/new` | districts | yes |  | todo |
| `/download` | download | yes |  | todo |
| `/dues-approval/[token]` | dues-approval | NO |  | todo |
| `/events` | events | yes |  | todo |
| `/forgot-password` | forgot-password | yes |  | todo |
| `/goal-overviews` | goal-overviews | yes |  | todo |
| `/international-national` | international-national | yes |  | todo |
| `/invite/[token]` | invite | NO |  | todo |
| `/login` | login | yes |  | todo |
| `/members/edit-v2/[id]` | members | yes |  | todo |
| `/members/edit/[id]` | members | yes |  | todo |
| `/members/new` | members | yes |  | todo |
| `/members/new-v2` | members | NO |  | todo |
| `/ocv-live-documents/[clubId]/[moduleKey]` | ocv-live-documents | NO |  | todo |
| `/our-leaders` | our-leaders | yes |  | todo |
| `/past-events` | past-events | yes |  | todo |
| `/past-events/[slug]` | past-events | yes |  | todo |
| `/pay/[linkId]` | pay | yes |  | todo |
| `/pay/[linkId]/thank-you` | pay | NO |  | todo |
| `/pay/club-dues/[duesId]` | pay | NO |  | todo |
| `/pay/club-dues/[duesId]/thank-you` | pay | yes |  | todo |
| `/pay/club-website/[token]` | pay | yes |  | todo |
| `/pay/dues/[duesId]` | pay | yes |  | todo |
| `/pay/dues/[duesId]/thank-you` | pay | NO |  | todo |
| `/pay/w/[token]` | pay | NO |  | todo |
| `/planning` | planning | yes |  | todo |
| `/planning/accept/[token]` | planning | NO |  | todo |
| `/privacy-policy` | privacy-policy | yes |  | todo |
| `/projects` | projects | yes |  | todo |
| `/projects/[id]` | projects | yes |  | todo |
| `/prospective-member` | prospective-member | yes |  | todo |
| `/public/booth` | public | yes |  | todo |
| `/public/project/[projectId]` | public | NO |  | todo |
| `/public/volunteer/[token]` | public | NO |  | todo |
| `/refunds-and-cancellations` | refunds-and-cancellations | yes |  | todo |
| `/regional-leaders` | regional-leaders | yes |  | todo |
| `/report/[linkId]` | report | yes |  | todo |
| `/report/club-dues/[duesId]` | report | yes |  | todo |
| `/report/dues/[duesId]` | report | NO |  | todo |
| `/reset-password` | reset-password | yes |  | todo |
| `/settings` | settings | yes |  | todo |
| `/settings/app-maintenance` | settings | yes |  | todo |
| `/settings/area-of-focus` | settings | yes |  | todo |
| `/settings/audit-log` | settings | yes |  | todo |
| `/settings/booth-signups` | settings | yes |  | todo |
| `/settings/cashfree-kyc` | settings | NO |  | todo |
| `/settings/club-dues` | settings | yes |  | todo |
| `/settings/club-dues/[duesId]/clubs` | settings | yes |  | todo |
| `/settings/club-dues/create` | settings | yes |  | todo |
| `/settings/club-leadership` | settings | yes |  | todo |
| `/settings/club-websites` | settings | yes |  | todo |
| `/settings/credit-management` | settings | yes |  | todo |
| `/settings/currency` | settings | yes |  | todo |
| `/settings/daily-stats-report` | settings | yes |  | todo |
| `/settings/designations` | settings | yes |  | todo |
| `/settings/district-governor` | settings | yes |  | todo |
| `/settings/district-performance-report` | settings | yes |  | todo |
| `/settings/district-websites` | settings | yes |  | todo |
| `/settings/editions` | settings | yes |  | todo |
| `/settings/email-credits` | settings | yes |  | todo |
| `/settings/email-log` | settings | yes |  | todo |
| `/settings/event-masters` | settings | yes |  | todo |
| `/settings/event-payment-links` | settings | yes |  | todo |
| `/settings/event-payment-links/[linkId]/members` | settings | yes |  | todo |
| `/settings/event-payment-links/[linkId]/members/[memberId]/offline-payment` | settings | NO |  | todo |
| `/settings/event-payment-links/[linkId]/offline-payment` | settings | yes |  | todo |
| `/settings/event-payment-links/create` | settings | yes |  | todo |
| `/settings/features` | settings | yes |  | todo |
| `/settings/funding` | settings | yes |  | todo |
| `/settings/global-member-search` | settings | yes |  | todo |
| `/settings/global-search` | settings | yes |  | todo |
| `/settings/goal-imports` | settings | yes |  | todo |
| `/settings/international-president` | settings | yes |  | todo |
| `/settings/login-announcement` | settings | yes |  | todo |
| `/settings/membership-dues` | settings | yes |  | todo |
| `/settings/membership-dues/[duesId]/members` | settings | NO |  | todo |
| `/settings/membership-dues/create` | settings | yes |  | todo |
| `/settings/mobile-login-check` | settings | yes |  | todo |
| `/settings/mobile-version` | settings | yes |  | todo |
| `/settings/module-master` | settings | yes |  | todo |
| `/settings/payments-and-dues` | settings | yes |  | todo |
| `/settings/project-categorization` | settings | yes |  | todo |
| `/settings/project-sync` | settings | yes |  | todo |
| `/settings/push-logs` | settings | yes |  | todo |
| `/settings/razorpay-route-accounts` | settings | yes |  | todo |
| `/settings/reports` | settings | yes |  | todo |
| `/settings/ri-codes` | settings | yes |  | todo |
| `/settings/rotary-org` | settings | yes |  | todo |
| `/settings/rotary-org/clubs` | settings | yes |  | todo |
| `/settings/rotary-org/duplicates` | settings | yes |  | todo |
| `/settings/rotary-org/member-match` | settings | NO |  | todo |
| `/settings/rotary-org/members` | settings | yes |  | todo |
| `/settings/rotary-years` | settings | yes |  | todo |
| `/settings/super-admin-role-config` | settings | yes |  | todo |
| `/settings/tenants` | settings | yes |  | todo |
| `/settings/themes` | settings | yes |  | todo |
| `/settings/translations` | settings | yes |  | todo |
| `/settings/wallet` | settings | yes |  | todo |
| `/settings/website-data-modules` | settings | yes |  | todo |
| `/sso` | sso | NO |  | todo |
| `/terms-and-conditions` | terms-and-conditions | yes |  | todo |
| `/tutorial` | tutorial | yes |  | todo |
| `/unsubscribe/[token]` | unsubscribe | NO |  | todo |
| `/websites` | websites | yes |  | todo |
| `/zones/[id]/clubs` | zones | yes |  | todo |
| `/zones/[id]/districts` | zones | yes |  | todo |
| `/zones/edit/[id]` | zones | yes |  | todo |
| `/zones/new` | zones | yes |  | todo |


## The /v2 duplicates: what RIZones says (checked 29 Oct 2026, read only)

Source: `reference/RotaryIndia_Admin_API_Claude/.planning/v1-deletion-list.md` (RIZones, June 2026, "Frontend
Overhaul Cycle"). ROW's admin is a copy of the RIZones admin, so the same holds in ROW.

- **Club pages (`/clubs/[id]/...`) and website-data pages:** RIZones *replaced* the old (v1) pages with the v2 pages
  on 4 to 6 June 2026. The list names 37 v1 page files "pending deletion"; the owner was to delete them by hand at
  the end of the cycle and never did. The club admin menus and dashboard tabs open the v2 pages.
- **v1 pages that are still used** (named in the same file):
  - the service-avenue edit pages and the TRF page, when opened from the Club Monthly Report (CMR) flow, which
    sends a locked month (`frozenMonth`, `?from=cmr`) that v2 does not support;
  - the Event Payment Links offline-payment sub-page (payments, on hold in ROW);
  - the project detail views (`[projectId]/page.tsx`), reachable only from v1 lists: "can be deleted unless an
    external link references them";
  - `/members/new` stays; `/members/new-v2` was added for future dashboard links.
- **District pages (`/districts/[id]/...`):** not in the deletion list. The District Admin dashboard opens the v2
  list pages (announcements, documents, newsletters, upcoming events, district events, projects); the old district
  pages are still linked from other old pages. Whether anyone still reaches them is NOT VERIFIED: to be checked in
  the browser per role before anything is retired.
- A link-walk script over the code could not settle reachability on its own: many links are built at run time.

**Proposal:** redesign the v2 page of every club pair; keep the named v1 exceptions until the CMR flow and
payments are moved to v2; check the district pairs in the browser at the live review; retire nothing without the
user's OK.

## Mobile app (`row/mobile/lib/presentation/screens`): screen files

| Screen file | Area | Status |
|---|---|---|
| `admin/login_logs_screen.dart` | admin | todo |
| `ag/ag_club_detail_screen.dart` | ag | todo |
| `ag/ag_overview_screen.dart` | ag | todo |
| `ag/ag_project_detail_screen.dart` | ag | todo |
| `ag/widgets/ag_async.dart` | ag | todo |
| `ag/widgets/ag_clubs_tab.dart` | ag | todo |
| `ag/widgets/ag_district_view_tab.dart` | ag | todo |
| `ag/widgets/ag_format.dart` | ag | todo |
| `ag/widgets/ag_goals_tab.dart` | ag | todo |
| `ag/widgets/ag_membership_tab.dart` | ag | todo |
| `ag/widgets/ag_service_projects_tab.dart` | ag | todo |
| `ag/widgets/ag_trf_tab.dart` | ag | todo |
| `ag/widgets/ag_youth_services_tab.dart` | ag | todo |
| `ag_reports/ag_report_configs.dart` | ag_reports | todo |
| `ag_reports/ag_report_xlsx.dart` | ag_reports | todo |
| `ag_reports/ag_reports_screen.dart` | ag_reports | todo |
| `calendar/calendar_detail_screens.dart` | calendar | todo |
| `calendar/calendar_widgets.dart` | calendar | todo |
| `calendar/club_calendar_screen.dart` | calendar | todo |
| `calendar/district_calendar_screen.dart` | calendar | todo |
| `calendar/my_calendars_screen.dart` | calendar | todo |
| `chat/chat_screens.dart` | chat | todo |
| `club_dues_pay/club_dues_my_clubs_screen.dart` | club_dues_pay | todo |
| `club_dues_pay/club_dues_offline_screen.dart` | club_dues_pay | todo |
| `club_dues_pay/club_dues_pay_screen.dart` | club_dues_pay | todo |
| `club_finder/club_finder_detail_screen.dart` | club_finder | todo |
| `club_finder/club_finder_project_detail_screen.dart` | club_finder | todo |
| `club_finder/club_finder_results_screen.dart` | club_finder | todo |
| `club_finder/club_finder_search_screen.dart` | club_finder | todo |
| `clubs/club_dashboard_screen.dart` | clubs | todo |
| `clubs/club_form_screen.dart` | clubs | todo |
| `clubs/club_info_screen.dart` | clubs | todo |
| `clubs/clubs_list_screen.dart` | clubs | todo |
| `clubs/modules/announcements/announcements_screen.dart` | clubs | todo |
| `clubs/modules/attendance/attendance_screen.dart` | clubs | todo |
| `clubs/modules/board_of_directors/board_of_directors_screen.dart` | clubs | todo |
| `clubs/modules/board_of_directors/bod_member_detail_screen.dart` | clubs | todo |
| `clubs/modules/citation/club_citation_screen.dart` | clubs | todo |
| `clubs/modules/club_monthly_report/club_monthly_report_screen.dart` | clubs | todo |
| `clubs/modules/documents/documents_screen.dart` | clubs | todo |
| `clubs/modules/event_payment_links/event_payment_links_screen.dart` | clubs | todo |
| `clubs/modules/grants/club_grants_screen.dart` | clubs | todo |
| `clubs/modules/grants/grant_application_screen.dart` | clubs | todo |
| `clubs/modules/greetings/greetings_screen.dart` | clubs | todo |
| `clubs/modules/mass_emails/mass_emails_screen.dart` | clubs | todo |
| `clubs/modules/members/club_members_screen.dart` | clubs | todo |
| `clubs/modules/members/cog_member_search_screen.dart` | clubs | todo |
| `clubs/modules/membership_dues/membership_dues_screen.dart` | clubs | todo |
| `clubs/modules/newsletters/newsletters_screen.dart` | clubs | todo |
| `clubs/modules/ocv_gov/live_documents_screen.dart` | clubs | todo |
| `clubs/modules/ocv_gov/ocv_gov_screen.dart` | clubs | todo |
| `clubs/modules/past_presidents/past_presidents_screen.dart` | clubs | todo |
| `clubs/modules/projects/projects_screen.dart` | clubs | todo |
| `clubs/modules/rotary_network/potential_members_screen.dart` | clubs | todo |
| `clubs/modules/rotary_network/rotary_network_screen.dart` | clubs | todo |
| `clubs/modules/rotary_network/terminated_members_screen.dart` | clubs | todo |
| `clubs/modules/speakers/club_speakers_screen.dart` | clubs | todo |
| `clubs/modules/sub_groups/sub_groups_screen.dart` | clubs | todo |
| `clubs/modules/trf/trf_screen.dart` | clubs | todo |
| `clubs/modules/upcoming_events/upcoming_events_screen.dart` | clubs | todo |
| `clubs/modules/weblinks/weblinks_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_about_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_advertisement_form_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_advertisements_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_banner_form_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_banners_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_contact_details_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_contact_form_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_data_hub_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_data_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_logos_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_menu_form_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_menu_list_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_social_link_form_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_social_links_screen.dart` | clubs | todo |
| `clubs/modules/website_data/club_website_theme_screen.dart` | clubs | todo |
| `clubs/modules/website_data/website_data_modules.dart` | clubs | todo |
| `clubs/modules/website_purchase/website_purchase_screen.dart` | clubs | todo |
| `clubs/modules/website_training/website_training_screen.dart` | clubs | todo |
| `clubs/overview/club_overview_screen.dart` | clubs | todo |
| `clubs/overview/widgets/club_avenue_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_communication_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_dashboard_async.dart` | clubs | todo |
| `clubs/overview/widgets/club_dues_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_egovernance_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_foundation_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_membership_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_overview_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_payment_links_tab.dart` | clubs | todo |
| `clubs/overview/widgets/club_website_tab.dart` | clubs | todo |
| `clubs/overview/widgets/cmr_month_report_subtab.dart` | clubs | todo |
| `clubs/overview/widgets/dashboard/dashboard_bod_subtab.dart` | clubs | todo |
| `clubs/overview/widgets/dashboard/dashboard_directory_subtab.dart` | clubs | todo |
| `clubs/overview/widgets/dashboard/dashboard_rotary_network_subtab.dart` | clubs | todo |
| `clubs/overview/widgets/dues_management_view.dart` | clubs | todo |
| `clubs/overview/widgets/membership_summary_card.dart` | clubs | todo |
| `districts/district_dashboard_screen.dart` | districts | todo |
| `districts/district_form_screen.dart` | districts | todo |
| `districts/districts_list_screen.dart` | districts | todo |
| `districts/modules/assign_clubs_form_screen.dart` | districts | todo |
| `districts/modules/committee/committee_member_form_screen.dart` | districts | todo |
| `districts/modules/committee/district_committee_group_detail_screen.dart` | districts | todo |
| `districts/modules/committee/district_committee_group_form_screen.dart` | districts | todo |
| `districts/modules/committee/district_committee_member_detail_screen.dart` | districts | todo |
| `districts/modules/committee/district_committee_screen.dart` | districts | todo |
| `districts/modules/committee/district_committee_sub_group_form_screen.dart` | districts | todo |
| `districts/modules/committee/district_committee_sub_group_screen.dart` | districts | todo |
| `districts/modules/directory_member_detail_screen.dart` | districts | todo |
| `districts/modules/district_ag_screen.dart` | districts | todo |
| `districts/modules/district_announcements_screen.dart` | districts | todo |
| `districts/modules/district_citation_category_form_screen.dart` | districts | todo |
| `districts/modules/district_citation_manual_form_screen.dart` | districts | todo |
| `districts/modules/district_citation_question_form_screen.dart` | districts | todo |
| `districts/modules/district_citation_screen.dart` | districts | todo |
| `districts/modules/district_club_dues_screen.dart` | districts | todo |
| `districts/modules/district_clubs_screen.dart` | districts | todo |
| `districts/modules/district_cmr_month_detail_screen.dart` | districts | todo |
| `districts/modules/district_cmr_screen.dart` | districts | todo |
| `districts/modules/district_documents_screen.dart` | districts | todo |
| `districts/modules/district_event_payment_link_members_screen.dart` | districts | todo |
| `districts/modules/district_events_screen.dart` | districts | todo |
| `districts/modules/district_greetings_screen.dart` | districts | todo |
| `districts/modules/district_mass_emails_screen.dart` | districts | todo |
| `districts/modules/district_members_screen.dart` | districts | todo |
| `districts/modules/district_newsletters_screen.dart` | districts | todo |
| `districts/modules/district_online_event_link_screen.dart` | districts | todo |
| `districts/modules/district_projects_screen.dart` | districts | todo |
| `districts/modules/district_reports_screen.dart` | districts | todo |
| `districts/modules/district_sub_group_form_screen.dart` | districts | todo |
| `districts/modules/district_sub_groups_screen.dart` | districts | todo |
| `districts/modules/district_upcoming_events_screen.dart` | districts | todo |
| `districts/modules/district_weblinks_screen.dart` | districts | todo |
| `districts/modules/district_website_data_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_about_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_advertisement_form_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_advertisements_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_banner_form_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_banners_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_contact_details_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_contact_form_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_menu_form_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_menu_list_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_social_link_form_screen.dart` | districts | todo |
| `districts/modules/website_data/district_website_social_links_screen.dart` | districts | todo |
| `districts/overview/district_overview_screen.dart` | districts | todo |
| `districts/overview/foundation_goal_edit_screen.dart` | districts | todo |
| `districts/overview/membership_goal_edit_screen.dart` | districts | todo |
| `districts/overview/widgets/analytical_card_shell.dart` | districts | todo |
| `districts/overview/widgets/analytical_cards.dart` | districts | todo |
| `districts/overview/widgets/club_bar_chart.dart` | districts | todo |
| `districts/overview/widgets/communication_tab.dart` | districts | todo |
| `districts/overview/widgets/district_dashboard_async.dart` | districts | todo |
| `districts/overview/widgets/donut_chart.dart` | districts | todo |
| `districts/overview/widgets/egovernance_tab.dart` | districts | todo |
| `districts/overview/widgets/foundation_tab.dart` | districts | todo |
| `districts/overview/widgets/leaderboard_card.dart` | districts | todo |
| `districts/overview/widgets/membership_tab.dart` | districts | todo |
| `districts/overview/widgets/quick_links_tab.dart` | districts | todo |
| `districts/overview/widgets/rotary_network_tab.dart` | districts | todo |
| `districts/overview/widgets/stat_card.dart` | districts | todo |
| `find_rotarian/find_rotarian_detail_screen.dart` | find_rotarian | todo |
| `find_rotarian/find_rotarian_results_screen.dart` | find_rotarian | todo |
| `find_rotarian/find_rotarian_search_screen.dart` | find_rotarian | todo |
| `goal_setting/district_goal_messages_screen.dart` | goal_setting | todo |
| `goal_setting/goal_setting_entry_screen.dart` | goal_setting | todo |
| `goal_setting/widgets/goal_form_fields.dart` | goal_setting | todo |
| `home/helpline_screen.dart` | home | todo |
| `home/home_screen.dart` | home | todo |
| `home/my_club_websites_screen.dart` | home | todo |
| `home/my_district_websites_screen.dart` | home | todo |
| `login/forgot_password_screen.dart` | login | todo |
| `login/login_screen.dart` | login | todo |
| `login/reset_password_screen.dart` | login | todo |
| `login/terms_screen.dart` | login | todo |
| `login/welcome_screen.dart` | login | todo |
| `maintenance/maintenance_screen.dart` | maintenance | todo |
| `members/member_form_screen.dart` | members | todo |
| `members/members_list_screen.dart` | members | todo |
| `my_clubs/my_clubs_list_screen.dart` | my_clubs | todo |
| `my_dues/dues_receipt_screen.dart` | my_dues | todo |
| `my_dues/my_membership_dues_screen.dart` | my_dues | todo |
| `notifications/notifications_screen.dart` | notifications | todo |
| `planning/next_year_screen.dart` | planning | todo |
| `preferences/text_size_screen.dart` | preferences | todo |
| `privacy/my_data_screen.dart` | privacy | todo |
| `profile/my_designations_screen.dart` | profile | todo |
| `profile/profile_edit_screen.dart` | profile | todo |
| `profile/profile_screen.dart` | profile | todo |
| `reports/club_report_screen.dart` | reports | todo |
| `security/app_lock_screen.dart` | security | todo |
| `security/security_settings_screen.dart` | security | todo |
| `settings/area_of_focus_screen.dart` | settings | todo |
| `settings/comms_preferences_screen.dart` | settings | todo |
| `settings/designations_screen.dart` | settings | todo |
| `settings/language_screen.dart` | settings | todo |
| `settings/member_settings_screen.dart` | settings | todo |
| `settings/rotary_years_screen.dart` | settings | todo |
| `settings/settings_screen.dart` | settings | todo |
| `share_contact/share_contact_sheet.dart` | share_contact | todo |
| `splash/splash_screen.dart` | splash | todo |
| `targets/target_proposals_section.dart` | targets | todo |
| `targets/targets_screen.dart` | targets | todo |
| `unified_dashboard/scoped_module_screen.dart` | unified_dashboard | todo |
| `unified_dashboard/unified_module_detail_screen.dart` | unified_dashboard | todo |
| `unified_dashboard/unified_modules_screen.dart` | unified_dashboard | todo |
| `volunteers/invite_guest_screen.dart` | volunteers | todo |
| `volunteers/volunteers_screen.dart` | volunteers | todo |
| `wallet/wallet_topup_screen.dart` | wallet | todo |
| `web_view/web_view_screen.dart` | web_view | todo |
| `zones/zone_districts_screen.dart` | zones | todo |
| `zones/zone_form_screen.dart` | zones | todo |
| `zones/zones_list_screen.dart` | zones | todo |
