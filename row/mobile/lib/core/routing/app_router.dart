import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'route_names.dart';
import '../maintenance/maintenance_controller.dart';
import '../features/feature_controller.dart';
import '../maintenance/maintenance_dev_bypass.dart';
import '../../presentation/providers/auth_provider.dart';
import '../../presentation/screens/maintenance/maintenance_screen.dart';
import '../../presentation/screens/splash/splash_screen.dart';
import '../../presentation/screens/login/terms_screen.dart';
import '../../presentation/screens/login/welcome_screen.dart';
import '../../presentation/screens/login/login_screen.dart';
import '../../presentation/screens/login/forgot_password_screen.dart';
import '../../presentation/screens/login/reset_password_screen.dart';
import '../../presentation/screens/zones/zones_list_screen.dart';
import '../../presentation/screens/zones/zone_form_screen.dart';
import '../../presentation/screens/districts/districts_list_screen.dart';
import '../../presentation/screens/districts/district_form_screen.dart';
import '../../presentation/screens/districts/district_dashboard_screen.dart';
import '../../presentation/screens/districts/overview/district_overview_screen.dart';
import '../../presentation/screens/clubs/clubs_list_screen.dart';
import '../../presentation/screens/clubs/club_form_screen.dart';
import '../../presentation/screens/ag/ag_club_detail_screen.dart';
import '../../presentation/screens/ag/ag_overview_screen.dart';
import '../../presentation/screens/clubs/club_dashboard_screen.dart';
import '../../presentation/screens/clubs/overview/club_overview_screen.dart';
import '../../presentation/screens/members/members_list_screen.dart';
import '../../presentation/screens/members/member_form_screen.dart';
import '../../presentation/screens/clubs/modules/members/club_members_screen.dart';
import '../../presentation/screens/clubs/modules/announcements/announcements_screen.dart';
import '../../presentation/screens/clubs/modules/newsletters/newsletters_screen.dart';
import '../../presentation/screens/clubs/modules/upcoming_events/upcoming_events_screen.dart';
import '../../presentation/screens/clubs/modules/documents/documents_screen.dart';
import '../../presentation/screens/clubs/modules/attendance/attendance_screen.dart';
import '../../presentation/screens/clubs/modules/club_monthly_report/club_monthly_report_screen.dart';
import '../../presentation/screens/clubs/modules/projects/projects_screen.dart';
import '../../presentation/screens/clubs/modules/board_of_directors/board_of_directors_screen.dart';
import '../../presentation/screens/clubs/modules/past_presidents/past_presidents_screen.dart';
import '../../presentation/screens/clubs/modules/greetings/greetings_screen.dart';
import '../../presentation/screens/clubs/modules/sub_groups/sub_groups_screen.dart';
import '../../presentation/screens/clubs/modules/mass_emails/mass_emails_screen.dart';
import '../../presentation/screens/clubs/modules/membership_dues/membership_dues_screen.dart';
import '../../presentation/screens/clubs/modules/event_payment_links/event_payment_links_screen.dart';
import '../../presentation/screens/clubs/modules/trf/trf_screen.dart';
import '../../presentation/screens/clubs/modules/ocv_gov/live_documents_screen.dart';
import '../../presentation/screens/clubs/modules/ocv_gov/ocv_gov_screen.dart';
import '../../presentation/screens/clubs/modules/weblinks/weblinks_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_data_hub_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_theme_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_banners_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_advertisements_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_social_links_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_contact_details_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_menu_list_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_about_screen.dart';
import '../../presentation/screens/clubs/modules/website_data/club_website_logos_screen.dart';
import '../../presentation/screens/districts/modules/district_announcements_screen.dart';
import '../../presentation/screens/districts/modules/district_newsletters_screen.dart';
import '../../presentation/screens/districts/modules/district_upcoming_events_screen.dart';
import '../../presentation/screens/districts/modules/district_documents_screen.dart';
import '../../presentation/screens/districts/modules/district_projects_screen.dart';
import '../../presentation/screens/districts/modules/district_mass_emails_screen.dart';
import '../../presentation/screens/districts/modules/district_clubs_screen.dart';
import '../../presentation/screens/districts/modules/district_members_screen.dart';
import '../../presentation/screens/districts/modules/directory_member_detail_screen.dart';
import '../../presentation/screens/districts/modules/district_weblinks_screen.dart';
import '../../presentation/screens/districts/modules/district_website_data_screen.dart';
import '../../presentation/screens/districts/modules/website_data/district_website_contact_details_screen.dart';
import '../../presentation/screens/districts/modules/website_data/district_website_social_links_screen.dart';
import '../../presentation/screens/districts/modules/website_data/district_website_about_screen.dart';
import '../../presentation/screens/districts/modules/website_data/district_website_banners_screen.dart';
import '../../presentation/screens/districts/modules/website_data/district_website_advertisements_screen.dart';
import '../../presentation/screens/districts/modules/website_data/district_website_menu_list_screen.dart';
import '../../presentation/screens/districts/modules/district_sub_groups_screen.dart';
import '../../presentation/screens/districts/modules/district_greetings_screen.dart';
import '../../presentation/screens/districts/modules/district_cmr_screen.dart';
import '../../presentation/screens/districts/modules/committee/district_committee_group_detail_screen.dart';
import '../../presentation/screens/districts/modules/committee/district_committee_screen.dart';
import '../../presentation/screens/districts/modules/committee/district_committee_sub_group_screen.dart';
import '../../presentation/screens/districts/modules/district_events_screen.dart';
import '../../presentation/screens/districts/modules/district_citation_screen.dart';
import '../../presentation/screens/districts/modules/district_reports_screen.dart';
import '../../presentation/screens/districts/modules/district_online_event_link_screen.dart';
import '../../presentation/screens/districts/modules/district_event_payment_link_members_screen.dart';
import '../../presentation/screens/districts/modules/district_club_dues_screen.dart';
import '../../presentation/screens/districts/modules/district_ag_screen.dart';
import '../../presentation/screens/districts/modules/district_cmr_month_detail_screen.dart';
import '../../presentation/screens/settings/settings_screen.dart';
import '../../presentation/screens/settings/member_settings_screen.dart';
import '../../presentation/screens/settings/rotary_years_screen.dart';
import '../../presentation/screens/settings/designations_screen.dart';
import '../../presentation/screens/settings/area_of_focus_screen.dart';
import '../../presentation/screens/admin/login_logs_screen.dart';
import '../../presentation/screens/goal_setting/goal_setting_entry_screen.dart';
import '../../presentation/screens/home/my_club_websites_screen.dart';
import '../../presentation/screens/home/my_district_websites_screen.dart';
import '../../presentation/screens/ag_reports/ag_reports_screen.dart';
import '../../presentation/screens/home/home_screen.dart';
import '../../presentation/screens/home/helpline_screen.dart';
import '../../presentation/screens/zones/zone_districts_screen.dart';
import '../../presentation/screens/web_view/web_view_screen.dart';
import '../../presentation/screens/clubs/modules/rotary_network/rotary_network_screen.dart';
import '../../presentation/screens/clubs/modules/citation/club_citation_screen.dart';
import '../../presentation/screens/reports/club_report_screen.dart';
import '../../presentation/screens/clubs/modules/rotary_network/potential_members_screen.dart';
import '../../presentation/screens/clubs/modules/rotary_network/terminated_members_screen.dart';
import '../../presentation/screens/unified_dashboard/unified_modules_screen.dart';
import '../../presentation/screens/unified_dashboard/scoped_module_screen.dart';
import '../../presentation/screens/unified_dashboard/unified_module_detail_screen.dart';
import '../../presentation/screens/profile/profile_screen.dart';
import '../../presentation/screens/profile/profile_edit_screen.dart';
import '../../presentation/screens/notifications/notifications_screen.dart';
import '../../presentation/screens/preferences/text_size_screen.dart';
import '../../presentation/screens/security/app_lock_screen.dart';
import '../../presentation/screens/security/security_settings_screen.dart';
import '../../presentation/screens/club_finder/club_finder_search_screen.dart';
import '../../presentation/screens/club_finder/club_finder_detail_screen.dart';
import '../../presentation/screens/club_finder/club_finder_project_detail_screen.dart';
import '../../presentation/screens/find_rotarian/find_rotarian_search_screen.dart';
import '../../presentation/screens/find_rotarian/find_rotarian_detail_screen.dart';
import '../../presentation/screens/calendar/club_calendar_screen.dart';
import '../../presentation/screens/calendar/district_calendar_screen.dart';
import '../../presentation/screens/calendar/my_calendars_screen.dart';
import '../../presentation/screens/wallet/wallet_topup_screen.dart';
import '../../presentation/screens/my_dues/my_membership_dues_screen.dart';
import '../../data/models/wallet_models.dart';
import '../../presentation/screens/clubs/modules/website_purchase/website_purchase_screen.dart';
import '../../presentation/screens/privacy/my_data_screen.dart';
import '../../presentation/screens/chat/chat_screens.dart';
import '../../presentation/screens/clubs/modules/grants/club_grants_screen.dart';
import '../../presentation/screens/clubs/modules/speakers/club_speakers_screen.dart';
import '../../presentation/screens/goal_setting/district_goal_messages_screen.dart';
import '../../presentation/screens/planning/next_year_screen.dart';
import '../../presentation/screens/settings/comms_preferences_screen.dart';
import '../../presentation/screens/settings/language_screen.dart';
import '../../presentation/screens/targets/targets_screen.dart';
import '../../presentation/screens/profile/my_designations_screen.dart';
import '../../presentation/screens/volunteers/invite_guest_screen.dart';
import '../../presentation/screens/volunteers/volunteers_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The live [GoRouter], exposed so non-widget code — specifically the push
/// notification tap handlers in [DeepLinkService] — can navigate without a
/// BuildContext. Assigned in [AppRouter.createRouter]; reassigned if the
/// router is ever rebuilt (always points at the current instance).
GoRouter? appRouter;

/// Maps the wallet route's `?credit=` query value to a [WalletCreditType]
/// constant. Case-insensitive; anything unrecognised → null (combined view).
String? _walletCreditParam(String? raw) {
  switch (raw?.toLowerCase()) {
    case 'email':
      return WalletCreditType.email;
    default:
      return null;
  }
}

class AppRouter {
  static GoRouter createRouter(
      AuthProvider authProvider, MaintenanceController maintenance, FeatureController features) {
    // Routes that don't require auth
    const _publicPaths = [
      '/splash', '/terms', '/login', '/otp-verify', '/welcome',
      '/forgot-password', '/reset-password',
    ];

    final router = GoRouter(
      // Re-evaluate redirect when auth OR the maintenance snapshot changes.
      refreshListenable: Listenable.merge([authProvider, maintenance, features]),
      initialLocation: RouteNames.splash,
      redirect: (context, state) {
        if (authProvider.isCheckingAuth) return null;
        final isLoggedIn = authProvider.isLoggedIn;
        final loc = state.uri.path;

        final isPublic = _publicPaths.any((p) => loc.startsWith(p));

        if (!isLoggedIn && !isPublic) {
          return RouteNames.mobileLogin;
        }
        // Redirect logged-in users away from auth screens (but NOT from /welcome)
        if (isLoggedIn && isPublic && loc != '/welcome' && loc != '/splash') {
          return RouteNames.home;
        }

        // ── Module switches (FeatureController): skipped or switched-off modules ──
        if (isLoggedIn && !isPublic && loc != RouteNames.featureOff && features.isPathOff(loc)) {
          return RouteNames.featureOff;
        }

        // ── Route Maintenance gate ──────────────────────────────────────────
        // Runs for logged-in users navigating into a protected route. Never
        // gates public/auth routes or the maintenance screen itself, so a member
        // can't be locked out and there's no redirect loop.
        if (isLoggedIn && !isPublic && loc != RouteNames.maintenance) {
          // Keep the snapshot fresh during active use (throttled, fire-and-
          // forget). Path-de-duped: this redirect re-runs every second because
          // AuthProvider's session-countdown timer notifies the merged
          // refreshListenable — `refreshForPath` ignores those same-path ticks so
          // an idle screen makes ZERO calls; only a real navigation fetches. When
          // a fetch lands it notifies → this redirect re-runs for the current
          // location → a just-toggled route is caught without an app restart.
          maintenance.refreshForPath(loc);
          final reg = maintenance.registry;
          // Whole-app maintenance (`*`) takes precedence.
          if (reg.globalActive) {
            return RouteNames.maintenanceWithKey('*');
          }
          // Exact route-template match first (e.g. `/clubs/:id/overview`), then a
          // param-agnostic regex match on the concrete path as a fallback.
          final template = state.fullPath;
          String? blockedKey;
          if (template != null && reg.isKeyBlocked(template)) {
            blockedKey = template;
          } else {
            blockedKey = reg.matchPath(loc);
          }
          // Dev-only: skip the redirect for locally-bypassed routes so we can
          // work on a flagged section while live users still see the panel
          // (no-op in release — see maintenance_dev_bypass.dart).
          if (blockedKey != null && !isMaintenanceDevBypassed(blockedKey)) {
            return RouteNames.maintenanceWithKey(blockedKey);
          }
        }
        return null;
      },
      routes: [
        GoRoute(path: RouteNames.splash, builder: (_, __) => const SplashScreen()),
        GoRoute(path: RouteNames.appLock, builder: (_, __) => const AppLockScreen()),
        GoRoute(path: RouteNames.securitySettings, builder: (_, __) => const SecuritySettingsScreen()),
        GoRoute(path: RouteNames.terms, builder: (_, __) => const TermsScreen()),
        GoRoute(path: RouteNames.welcome, builder: (_, __) => const WelcomeScreen()),

        // Mobile OTP login (primary flow)
        GoRoute(path: RouteNames.mobileLogin, builder: (_, __) => const LoginScreen()),

        // Legacy admin password login (kept as fallback)
        GoRoute(path: RouteNames.forgotPassword, builder: (_, __) => const ForgotPasswordScreen()),
        GoRoute(path: RouteNames.myData, builder: (_, __) => const MyDataScreen()),
        GoRoute(path: RouteNames.volunteers, builder: (_, __) => const VolunteersScreen()),
        GoRoute(path: RouteNames.myDuties, builder: (_, __) => const MyDutiesScreen()),
        GoRoute(path: RouteNames.inviteGuest, builder: (_, __) => const InviteGuestScreen()),
        GoRoute(path: RouteNames.chat, builder: (_, __) => const ChatListScreen()),
        GoRoute(path: RouteNames.nextYear, builder: (_, __) => const NextYearScreen()),
        GoRoute(path: RouteNames.commsPreferences, builder: (_, __) => const CommsPreferencesScreen()),
        GoRoute(path: RouteNames.language, builder: (_, __) => const LanguageScreen()),
        GoRoute(path: '/clubs/:id/targets', builder: (_, state) => TargetsScreen(isDistrict: false, id: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/targets', builder: (_, state) => TargetsScreen(isDistrict: true, id: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/goal-messages', builder: (_, state) => DistrictGoalMessagesScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/speakers', builder: (_, state) => ClubSpeakersScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/grants', builder: (_, state) => ClubGrantsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: RouteNames.myDesignations, builder: (_, __) => const MyDesignationsScreen()),
        GoRoute(
          path: '/reset-password',
          builder: (_, state) => ResetPasswordScreen(token: state.uri.queryParameters['token']),
        ),

        GoRoute(path: RouteNames.home, builder: (_, __) => const HomeScreen()),

        // Profile
        GoRoute(path: RouteNames.profile, builder: (_, __) => const ProfileScreen()),
        GoRoute(path: RouteNames.profileEdit, builder: (_, __) => const ProfileEditScreen()),

        // Notifications
        GoRoute(path: RouteNames.notifications, builder: (_, __) => const NotificationsScreen()),

        // Support
        GoRoute(path: RouteNames.helpline, builder: (_, __) => const HelplineScreen()),

        // Zones
        GoRoute(path: RouteNames.zones, builder: (_, __) => const ZonesListScreen()),
        GoRoute(path: RouteNames.zoneNew, builder: (_, __) => const ZoneFormScreen()),
        GoRoute(path: '/zones/:id/edit', builder: (_, state) => ZoneFormScreen(zoneId: int.tryParse(state.pathParameters['id'] ?? ''))),
        GoRoute(
          path: '/zones/:id/districts',
          builder: (_, state) => ZoneDistrictsScreen(
            zoneId: int.parse(state.pathParameters['id']!),
            zoneName: state.uri.queryParameters['name'] ?? 'Zone',
          ),
        ),

        // Districts
        GoRoute(path: RouteNames.districts, builder: (_, __) => const DistrictsListScreen()),
        GoRoute(path: RouteNames.districtNew, builder: (_, __) => const DistrictFormScreen()),
        GoRoute(path: '/districts/:id/edit', builder: (_, state) => DistrictFormScreen(districtId: int.tryParse(state.pathParameters['id'] ?? ''))),
        GoRoute(path: '/districts/:id/dashboard', builder: (_, state) => DistrictDashboardScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/overview', builder: (_, state) => DistrictOverviewScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/members', builder: (_, state) => DistrictMembersScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/directory/:memberId', builder: (_, state) => DirectoryMemberDetailScreen(memberId: int.parse(state.pathParameters['memberId']!), fromDirectory: state.uri.queryParameters['from'] == 'directory', clubId: int.tryParse(state.uri.queryParameters['clubId'] ?? ''), clubName: state.uri.queryParameters['clubName'], initialHasAdminRole: state.uri.queryParameters.containsKey('isAdmin') ? state.uri.queryParameters['isAdmin'] == '1' : null)),
        GoRoute(path: '/districts/:id/announcements', builder: (_, state) => DistrictAnnouncementsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/newsletters', builder: (_, state) => DistrictNewslettersScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/documents', builder: (_, state) => DistrictDocumentsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/upcoming-events', builder: (_, state) => DistrictUpcomingEventsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/projects', builder: (_, state) => DistrictProjectsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/mass-emails', builder: (_, state) => DistrictMassEmailsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/clubs', builder: (_, state) => DistrictClubsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/greetings', builder: (_, state) => DistrictGreetingsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/sub-groups', builder: (_, state) => DistrictSubGroupsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/website-data', builder: (_, state) => DistrictWebsiteDataScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(
          path: '/districts/:id/website-data/contact-details',
          builder: (_, state) => DistrictWebsiteContactDetailsScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/website-data/social-media-links',
          builder: (_, state) => DistrictWebsiteSocialLinksScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/website-data/about',
          builder: (_, state) => DistrictWebsiteAboutScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/website-data/banners',
          builder: (_, state) => DistrictWebsiteBannersScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/website-data/advertisements',
          builder: (_, state) => DistrictWebsiteAdvertisementsScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/website-data/menu-list',
          builder: (_, state) => DistrictWebsiteMenuListScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(path: '/districts/:id/weblinks', builder: (_, state) => DistrictWeblinksScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/club-monthly-report', builder: (_, state) => DistrictCmrScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(
          path: '/districts/:id/district-committee',
          builder: (_, state) => DistrictCommitteeScreen(
            districtId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/district-committee/groups/:groupId',
          builder: (_, state) => DistrictCommitteeGroupDetailScreen(
            districtId: int.parse(state.pathParameters['id']!),
            groupId: int.parse(state.pathParameters['groupId']!),
            groupName: state.uri.queryParameters['name'] ?? 'Group',
          ),
        ),
        GoRoute(
          path: '/districts/:id/district-committee/groups/:groupId/sub-groups',
          builder: (_, state) => CommitteeSubGroupsListScreen(
            districtId: int.parse(state.pathParameters['id']!),
            groupId: int.parse(state.pathParameters['groupId']!),
            groupName: state.uri.queryParameters['name'] ?? 'Group',
          ),
        ),
        GoRoute(
          path: '/districts/:id/district-committee/groups/:groupId/sub-groups/:subGroupId',
          builder: (_, state) => CommitteeSubGroupDetailScreen(
            districtId: int.parse(state.pathParameters['id']!),
            groupId: int.parse(state.pathParameters['groupId']!),
            subGroupId: int.parse(state.pathParameters['subGroupId']!),
            subGroupName: state.uri.queryParameters['name'] ?? 'Sub-Group',
          ),
        ),
        GoRoute(path: '/districts/:id/district-events', builder: (_, state) => DistrictEventsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/district-citation', builder: (_, state) => DistrictCitationScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/reports', builder: (_, state) => DistrictReportsScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/online-event-link', builder: (_, state) => DistrictOnlineEventLinkScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(
          path: '/districts/:id/event-payment-links/:linkId/members',
          builder: (_, state) => DistrictEventPaymentLinkMembersScreen(
            districtId: int.parse(state.pathParameters['id']!),
            linkId: int.parse(state.pathParameters['linkId']!),
            linkTitle: state.uri.queryParameters['title'] ?? 'Event Members',
          ),
        ),
        GoRoute(path: '/districts/:id/club-dues', builder: (_, state) => DistrictClubDuesScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/districts/:id/ag', builder: (_, state) => DistrictAgScreen(districtId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: RouteNames.agDashboard, builder: (_, __) => const AgOverviewScreen()),
        GoRoute(path: '/agdashboard/clubs/:id', builder: (_, state) => AgClubDetailScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(
          path: '/districts/:id/club-monthly-report/:yearId/:month',
          builder: (_, state) => DistrictCmrMonthDetailScreen(
            districtId: int.parse(state.pathParameters['id']!),
            yearId: int.parse(state.pathParameters['yearId']!),
            month: int.parse(state.pathParameters['month']!),
            monthName: state.uri.queryParameters['name'] ?? 'Monthly Report',
          ),
        ),

        // Clubs
        GoRoute(path: RouteNames.clubs, builder: (_, __) => const ClubsListScreen()),
        GoRoute(path: RouteNames.clubNew, builder: (_, __) => const ClubFormScreen()),
        GoRoute(path: '/clubs/:id/edit', builder: (_, state) => ClubFormScreen(clubId: int.tryParse(state.pathParameters['id'] ?? ''))),
        GoRoute(path: '/clubs/:id/dashboard', builder: (_, state) => ClubDashboardScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/overview', builder: (_, state) => ClubOverviewScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/members', builder: (_, state) => ClubMembersScreen(clubId: int.parse(state.pathParameters['id']!))),
        // `openId` (optional) auto-opens that item's detail on load — used by
        // push-notification deep-links (see DeepLinkService).
        GoRoute(path: '/clubs/:id/announcements', builder: (_, state) => AnnouncementsScreen(clubId: int.parse(state.pathParameters['id']!), autoOpenDetailId: int.tryParse(state.uri.queryParameters['openId'] ?? ''))),
        GoRoute(path: '/clubs/:id/newsletters', builder: (_, state) => NewslettersScreen(clubId: int.parse(state.pathParameters['id']!), autoOpenDetailId: int.tryParse(state.uri.queryParameters['openId'] ?? ''))),
        GoRoute(path: '/clubs/:id/documents', builder: (_, state) => DocumentsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/upcoming-events', builder: (_, state) => UpcomingEventsScreen(clubId: int.parse(state.pathParameters['id']!), autoOpenDetailId: int.tryParse(state.uri.queryParameters['openId'] ?? ''))),
        GoRoute(path: '/clubs/:id/attendance', builder: (_, state) => AttendanceScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/club-monthly-report', builder: (_, state) => ClubMonthlyReportScreen(clubId: int.parse(state.pathParameters['id']!))),
        // `openProjectId` + `openYearId` (optional) auto-open that project's
        // detail on load — used by push-notification deep-links.
        GoRoute(
          path: '/clubs/:id/projects',
          builder: (_, state) => ProjectsScreen(
            clubId: int.parse(state.pathParameters['id']!),
            moduleType: state.uri.queryParameters['module'] ?? 'community_service',
            autoOpenDetailProjectId: int.tryParse(state.uri.queryParameters['openProjectId'] ?? ''),
            autoOpenDetailYearId: int.tryParse(state.uri.queryParameters['openYearId'] ?? ''),
          ),
        ),
        GoRoute(path: '/clubs/:id/club-service', builder: (_, state) => ProjectsScreen(clubId: int.parse(state.pathParameters['id']!), moduleType: 'club_service', autoOpenDetailProjectId: int.tryParse(state.uri.queryParameters['openProjectId'] ?? ''), autoOpenDetailYearId: int.tryParse(state.uri.queryParameters['openYearId'] ?? ''))),
        GoRoute(path: '/clubs/:id/vocational-service', builder: (_, state) => ProjectsScreen(clubId: int.parse(state.pathParameters['id']!), moduleType: 'vocational_service', autoOpenDetailProjectId: int.tryParse(state.uri.queryParameters['openProjectId'] ?? ''), autoOpenDetailYearId: int.tryParse(state.uri.queryParameters['openYearId'] ?? ''))),
        GoRoute(path: '/clubs/:id/international-service', builder: (_, state) => ProjectsScreen(clubId: int.parse(state.pathParameters['id']!), moduleType: 'international_service', autoOpenDetailProjectId: int.tryParse(state.uri.queryParameters['openProjectId'] ?? ''), autoOpenDetailYearId: int.tryParse(state.uri.queryParameters['openYearId'] ?? ''))),
        GoRoute(path: '/clubs/:id/public-image-initiative', builder: (_, state) => ProjectsScreen(clubId: int.parse(state.pathParameters['id']!), moduleType: 'public_image_initiative', autoOpenDetailProjectId: int.tryParse(state.uri.queryParameters['openProjectId'] ?? ''), autoOpenDetailYearId: int.tryParse(state.uri.queryParameters['openYearId'] ?? ''))),
        GoRoute(path: '/clubs/:id/new-generation-service', builder: (_, state) => ProjectsScreen(clubId: int.parse(state.pathParameters['id']!), moduleType: 'new_generation_service', autoOpenDetailProjectId: int.tryParse(state.uri.queryParameters['openProjectId'] ?? ''), autoOpenDetailYearId: int.tryParse(state.uri.queryParameters['openYearId'] ?? ''))),
        GoRoute(path: '/clubs/:id/board-of-directors', builder: (_, state) => BoardOfDirectorsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/past-presidents', builder: (_, state) => PastPresidentsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/greetings', builder: (_, state) => GreetingsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/sub-groups', builder: (_, state) => SubGroupsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/mass-emails', builder: (_, state) => MassEmailsScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/membership-dues', builder: (_, state) => MembershipDuesScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/event-payment-links', builder: (_, state) => EventPaymentLinksScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/trf', builder: (_, state) => TrfScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/ocv-gov', builder: (_, state) => OcvGovScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(
          path: '/clubs/:id/ocv-gov/live-documents',
          builder: (_, state) {
            final yid = state.uri.queryParameters['yearId'];
            return LiveDocumentsScreen(
              clubId: int.parse(state.pathParameters['id']!),
              initialYearId: yid == null ? null : int.tryParse(yid),
            );
          },
        ),
        GoRoute(path: '/clubs/:id/weblinks', builder: (_, state) => WeblinksScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/website-data', builder: (_, state) => ClubWebsiteDataHubScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(
          path: '/clubs/:id/website-data/theme',
          builder: (_, state) => ClubWebsiteThemeScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/banners',
          builder: (_, state) => ClubWebsiteBannersScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/advertisements',
          builder: (_, state) => ClubWebsiteAdvertisementsScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/social-media-links',
          builder: (_, state) => ClubWebsiteSocialLinksScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/contact-details',
          builder: (_, state) => ClubWebsiteContactDetailsScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/menu-list',
          builder: (_, state) => ClubWebsiteMenuListScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/about',
          builder: (_, state) => ClubWebsiteAboutScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/clubs/:id/website-data/logos',
          builder: (_, state) => ClubWebsiteLogosScreen(
            clubId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(path: '/clubs/:id/rotary-network', builder: (_, state) => RotaryNetworkScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/rotary-network/potential-members', builder: (_, state) => PotentialMembersScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/rotary-network/terminated-members', builder: (_, state) => TerminatedMembersScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/citation', builder: (_, state) => ClubCitationScreen(clubId: int.parse(state.pathParameters['id']!))),
        GoRoute(path: '/clubs/:id/reports', builder: (_, state) => ClubReportScreen(clubId: int.parse(state.pathParameters['id']!))),

        // Members
        GoRoute(path: RouteNames.members, builder: (_, __) => const MembersListScreen()),
        GoRoute(path: RouteNames.memberNew, builder: (_, __) => const MemberFormScreen()),
        GoRoute(
          path: '/members/:id/edit',
          builder: (_, state) => MemberFormScreen(
            memberId: int.tryParse(state.pathParameters['id'] ?? ''),
            clubId: int.tryParse(state.uri.queryParameters['clubId'] ?? ''),
          ),
        ),

        // Settings
        GoRoute(path: RouteNames.settings, builder: (_, __) => const SettingsScreen()),
        GoRoute(path: RouteNames.memberSettings, builder: (_, __) => const MemberSettingsScreen()),
        GoRoute(path: RouteNames.textSize, builder: (_, __) => const TextSizeScreen()),
        GoRoute(path: RouteNames.rotaryYears, builder: (_, __) => const RotaryYearsScreen()),
        GoRoute(path: RouteNames.designations, builder: (_, __) => const DesignationsScreen()),
        GoRoute(path: RouteNames.areaOfFocus, builder: (_, __) => const AreaOfFocusScreen()),

        // Admin
        GoRoute(path: RouteNames.loginLogs, builder: (_, __) => const LoginLogsScreen()),

        // Dashboards and websites
        GoRoute(path: RouteNames.myClubWebsites, builder: (_, __) => const MyClubWebsitesScreen()),
        GoRoute(path: RouteNames.myDistrictWebsites, builder: (_, __) => const MyDistrictWebsitesScreen()),
        GoRoute(path: RouteNames.agReports, builder: (_, __) => const AgReportsScreen()),
        GoRoute(
          path: '/clubs/:id/goal-setting',
          builder: (_, state) => GoalSettingEntryScreen(
            entityType: GoalEntityType.club,
            entityId: int.parse(state.pathParameters['id']!),
          ),
        ),
        GoRoute(
          path: '/districts/:id/goal-setting',
          builder: (_, state) => GoalSettingEntryScreen(
            entityType: GoalEntityType.district,
            entityId: int.parse(state.pathParameters['id']!),
          ),
        ),

        // Unified Dashboard
        GoRoute(
          path: '/unified/:districtId',
          builder: (_, state) => UnifiedModulesScreen(
            districtId: int.parse(state.pathParameters['districtId']!),
            clubId: int.tryParse(state.uri.queryParameters['clubId'] ?? ''),
          ),
        ),
        GoRoute(
          path: '/unified/:districtId/module/:moduleKey',
          builder: (_, state) => ScopedModuleScreen(
            moduleKey: state.pathParameters['moduleKey']!,
            districtId: int.parse(state.pathParameters['districtId']!),
            clubId: int.parse(state.uri.queryParameters['clubId']!),
          ),
        ),

        // Unified Module Detail
        GoRoute(
          path: '/module-detail/:moduleKey',
          builder: (_, state) => UnifiedModuleDetailScreen(
            moduleKey: state.pathParameters['moduleKey']!,
            moduleName: state.uri.queryParameters['name'] ?? state.pathParameters['moduleKey']!,
          ),
        ),

        // WebView
        GoRoute(
          path: '/webview',
          builder: (_, state) => WebViewScreen(
            title: state.uri.queryParameters['title'] ?? '',
            url: state.uri.queryParameters['url'] ?? '',
          ),
        ),

        // Club Finder
        GoRoute(path: RouteNames.clubFinder, builder: (_, __) => const ClubFinderSearchScreen()),
        GoRoute(
          path: '/club-finder/project/:projectId',
          builder: (_, state) => ClubFinderProjectDetailScreen(
            projectId: int.parse(state.pathParameters['projectId']!),
            yearId: int.tryParse(state.uri.queryParameters['yearId'] ?? ''),
            fallback: state.extra as Map<String, dynamic>?,
          ),
        ),
        GoRoute(
          path: '/club-finder/:clubId',
          builder: (_, state) => ClubFinderDetailScreen(
            clubId: int.parse(state.pathParameters['clubId']!),
            clubName: state.uri.queryParameters['clubName'],
            clubRotaryId: state.uri.queryParameters['clubRotaryId'],
          ),
        ),

        // Find a Rotarian
        GoRoute(path: RouteNames.findRotarian, builder: (_, __) => const FindRotarianSearchScreen()),
        GoRoute(
          path: '/find-rotarian/:memberId',
          builder: (_, state) => FindRotarianDetailScreen(
            memberId: int.parse(state.pathParameters['memberId']!),
            clubName: state.uri.queryParameters['clubName'],
            clubRotaryId: state.uri.queryParameters['clubRotaryId'],
          ),
        ),

        // Calendar
        GoRoute(
          path: RouteNames.myCalendars,
          builder: (_, __) => const MyCalendarsScreen(),
        ),
        GoRoute(
          path: RouteNames.clubCalendar,
          builder: (_, state) => ClubCalendarScreen(
            onlyClubId: int.tryParse(state.uri.queryParameters['clubId'] ?? ''),
          ),
        ),
        GoRoute(
          path: RouteNames.districtCalendar,
          builder: (_, state) => DistrictCalendarScreen(
            onlyDistrictId:
                int.tryParse(state.uri.queryParameters['districtId'] ?? ''),
          ),
        ),

        // Wallet & Credits — full-screen, opened from the dynamic 'wallet'
        // dashboard module. Scoped to the club/district that launched it.
        GoRoute(
          path: RouteNames.walletClub,
          builder: (_, state) => WalletTopupScreen(
            scope: 'club',
            clubId: int.tryParse(state.uri.queryParameters['clubId'] ?? '') ?? 0,
            clubName: state.uri.queryParameters['clubName'],
            initialCreditType: _walletCreditParam(state.uri.queryParameters['credit']),
            lockType: state.uri.queryParameters['single'] == '1',
          ),
        ),
        GoRoute(
          path: RouteNames.walletDistrict,
          builder: (_, state) => WalletTopupScreen(
            scope: 'district',
            districtId:
                int.tryParse(state.uri.queryParameters['districtId'] ?? '') ?? 0,
            initialCreditType: _walletCreditParam(state.uri.queryParameters['credit']),
            lockType: state.uri.queryParameters['single'] == '1',
          ),
        ),
        // Club Website purchase page (Payments > "Website" tile) — opens the
        // self-service Buy / Renew (Razorpay) flow directly. WebsitePurchaseScreen
        // brings its own Scaffold + app bar.
        GoRoute(
          path: RouteNames.clubWebsiteManage,
          builder: (_, state) => WebsitePurchaseScreen(
            clubId:
                int.tryParse(state.uri.queryParameters['clubId'] ?? '') ?? 0,
            clubName: state.uri.queryParameters['clubName'],
          ),
        ),

        // My Membership Dues — optional ?clubId=&clubName= scopes the view to a
        // single club (the member endpoint returns every club's dues).
        GoRoute(
          path: RouteNames.myDues,
          builder: (_, state) {
            final clubId = int.tryParse(state.uri.queryParameters['clubId'] ?? '');
            final clubName = state.uri.queryParameters['clubName'];
            return MyMembershipDuesScreen(clubId: clubId, clubName: clubName);
          },
        ),

        // Route Maintenance — full-screen gate target (route-level blocking).
        GoRoute(
          path: RouteNames.featureOff,
          builder: (_, __) => const _FeatureOffScreen(),
        ),
        GoRoute(
          path: RouteNames.maintenance,
          builder: (_, state) =>
              MaintenanceScreen(routeKey: state.uri.queryParameters['key']),
        ),
      ],
      errorBuilder: (_, state) => Scaffold(
        body: Center(child: Text('Page not found: ${state.error}')),
      ),
    );
    // Expose the live instance for context-free navigation from push handlers.
    appRouter = router;
    return router;
  }
}

/// Shown for a module that is not part of ROW or is switched off (see FeatureController).
class _FeatureOffScreen extends StatelessWidget {
  const _FeatureOffScreen();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text('Not available', style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('This module is not part of ROW, or it is switched off.',
                textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
          ]),
        ),
      ),
    );
  }
}
