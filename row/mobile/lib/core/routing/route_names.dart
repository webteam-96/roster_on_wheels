class RouteNames {
  static const String splash = '/splash';
  static const String appLock = '/app-lock';
  static const String securitySettings = '/settings/security';
  static const String terms = '/terms';
  static const String mobileLogin = '/login';
  static const String welcome = '/welcome';
  // Legacy alias kept so old references compile
  static const String login = mobileLogin;
  static const String forgotPassword = '/forgot-password';
  static const String myData = '/settings/my-data';
  static const String resetPassword = '/reset-password';
  static const String home = '/home';

  // Zones
  static const String zones = '/zones';
  static const String zoneNew = '/zones/new';
  static String zoneEdit(int id) => '/zones/$id/edit';
  static String zoneDistricts(int id, String name) => '/zones/$id/districts?name=${Uri.encodeComponent(name)}';

  // Districts
  static const String districts = '/districts';
  static const String districtNew = '/districts/new';
  static String districtEdit(int id) => '/districts/$id/edit';
  static String districtDashboard(int id) => '/districts/$id/dashboard';
  static String districtOverview(int id) => '/districts/$id/overview';
  static String districtMembers(int id) => '/districts/$id/members';
  // `fromDirectory: true` tags the navigation so the detail page knows it was
  // opened from the Directory members list — the only entry point allowed to
  // show the "Edit Member" button.
  // `clubId` / `clubName` identify the club whose Directory the member was opened
  // from — the detail page shows THAT club from the member's (possibly multi-club)
  // array instead of defaulting to the first. Club directory passes `clubId`
  // (exact); the district directory has only the club NAME (its members endpoint
  // returns no clubId, and the row's clubName is the club within that district),
  // so it passes `clubName`. Both omitted from other entry points.
  static String directoryMemberDetail(int memberId,
      {bool fromDirectory = false,
      int? clubId,
      String? clubName,
      bool? hasAdminRole}) {
    final qs = <String>[
      if (fromDirectory) 'from=directory',
      if (clubId != null) 'clubId=$clubId',
      if (clubName != null && clubName.trim().isNotEmpty)
        'clubName=${Uri.encodeQueryComponent(clubName.trim())}',
      // The MEMBER's current Club-Admin status, only threaded from the CLUB
      // directory list (which knows it). Drives the "Make Admin"/"Remove Admin"
      // app-bar button label on the detail page.
      if (hasAdminRole != null) 'isAdmin=${hasAdminRole ? 1 : 0}',
    ].join('&');
    return qs.isEmpty ? '/directory/$memberId' : '/directory/$memberId?$qs';
  }
  static String districtAnnouncements(int id) => '/districts/$id/announcements';
  static String districtNewsletters(int id) => '/districts/$id/newsletters';
  static String districtDocuments(int id) => '/districts/$id/documents';
  static String districtUpcomingEvents(int id) => '/districts/$id/upcoming-events';
  static String districtProjects(int id) => '/districts/$id/projects';
  static String districtMassEmails(int id) => '/districts/$id/mass-emails';
  static String districtClubs(int id) => '/districts/$id/clubs';
  static String districtGreetings(int id) => '/districts/$id/greetings';
  static String districtSubGroups(int id) => '/districts/$id/sub-groups';
  static String districtWebsiteData(int id) => '/districts/$id/website-data';
  static String districtWeblinks(int id) => '/districts/$id/weblinks';
  static String districtCmr(int id) => '/districts/$id/club-monthly-report';
  static String districtCommittee(int id) => '/districts/$id/district-committee';
  static String districtEvents(int id) => '/districts/$id/district-events';
  static String districtCitation(int id) => '/districts/$id/district-citation';
  static String districtReports(int id) => '/districts/$id/reports';
  static String districtOnlineEventLink(int id) => '/districts/$id/online-event-link';
  static String districtClubDues(int id) => '/districts/$id/club-dues';
  static String districtAg(int id) => '/districts/$id/ag';

  // AG (Assistant Governor) dashboard — entry point for AG admin role
  static const String agDashboard = '/agdashboard';
  static String agClubDetail(int clubId) => '/agdashboard/clubs/$clubId';

  // Clubs
  static const String clubs = '/clubs';
  static const String clubNew = '/clubs/new';
  static String clubEdit(int id) => '/clubs/$id/edit';
  static String clubDashboard(int id) => '/clubs/$id/dashboard';
  static String clubOverview(int id) => '/clubs/$id/overview';
  static String clubMembers(int id) => '/clubs/$id/members';
  static String clubAnnouncements(int id) => '/clubs/$id/announcements';
  static String clubNewsletters(int id) => '/clubs/$id/newsletters';
  static String clubDocuments(int id) => '/clubs/$id/documents';
  static String clubUpcomingEvents(int id) => '/clubs/$id/upcoming-events';
  static String clubAttendance(int id) => '/clubs/$id/attendance';
  static String clubMonthlyReport(int id) => '/clubs/$id/club-monthly-report';
  static String clubProjects(int id) => '/clubs/$id/projects';
  static String clubService(int id) => '/clubs/$id/club-service';
  static String vocationalService(int id) => '/clubs/$id/vocational-service';
  static String internationalService(int id) => '/clubs/$id/international-service';
  static String publicImageInitiative(int id) => '/clubs/$id/public-image-initiative';
  static String newGenerationService(int id) => '/clubs/$id/new-generation-service';
  static String boardOfDirectors(int id) => '/clubs/$id/board-of-directors';
  static String pastPresidents(int id) => '/clubs/$id/past-presidents';
  static String clubGreetings(int id) => '/clubs/$id/greetings';
  static String clubSubGroups(int id) => '/clubs/$id/sub-groups';
  static String massEmails(int id) => '/clubs/$id/mass-emails';
  static String membershipDues(int id) => '/clubs/$id/membership-dues';
  static String eventPaymentLinks(int id) => '/clubs/$id/event-payment-links';
  static String trf(int id) => '/clubs/$id/trf';
  static String ocvGov(int id) => '/clubs/$id/ocv-gov';
  static String clubWeblinks(int id) => '/clubs/$id/weblinks';
  static String clubWebsiteData(int id) => '/clubs/$id/website-data';
  static String rotaryNetwork(int id) => '/clubs/$id/rotary-network';
  static String potentialMembers(int id) => '/clubs/$id/rotary-network/potential-members';
  static String terminatedMembers(int id) => '/clubs/$id/rotary-network/terminated-members';
  static String clubCitation(int id) => '/clubs/$id/citation';
  static String clubReports(int id) => '/clubs/$id/reports';

  // Members
  static const String members = '/members';
  static const String memberNew = '/members/new';
  // Pass [clubId] when editing from a club context so the form prefills THAT
  // club's join date (members can belong to several clubs).
  static String memberEdit(int id, {int? clubId}) =>
      clubId != null ? '/members/$id/edit?clubId=$clubId' : '/members/$id/edit';

  // Support
  static const String helpline = '/helpline';

  // Settings
  static const String settings = '/settings';
  static const String memberSettings = '/settings/privacy-notifications';
  static const String textSize = '/settings/text-size';
  static const String rotaryYears = '/settings/rotary-years';
  static const String designations = '/settings/designations';
  static const String areaOfFocus = '/settings/area-of-focus';
  static const String themes = '/settings/themes';
  static const String eventMasters = '/settings/event-masters';
  static const String cashfreeKyc = '/settings/cashfree-kyc';
  static const String creditManagement = '/settings/credit-management';
  static const String websiteDataModules = '/settings/website-data-modules';

  // Profile
  static const String profile = '/profile';
  static const String profileEdit = '/profile/edit';

  // Notifications
  static const String notifications = '/notifications';

  // Admin
  static const String loginLogs = '/admin/login-logs';

  // Dashboards and websites
  static const String myClubWebsites = '/my-club-websites';
  static const String myDistrictWebsites = '/my-district-websites';
  static const String agReports = '/ag-reports';

  // Goal Setting
  // Club / District goal ENTRY (admins set their own targets by category).
  static String clubGoalSetting(int clubId) => '/clubs/$clubId/goal-setting';
  static String districtGoalSetting(int districtId) => '/districts/$districtId/goal-setting';

  // Unified Dashboard
  static String unifiedModules({required int districtId, int? clubId}) {
    final base = '/unified/$districtId';
    return clubId != null ? '$base?clubId=$clubId' : base;
  }
  static String scopedModule(String moduleKey, int districtId, int clubId) =>
      '/unified/$districtId/module/$moduleKey?clubId=$clubId';

  // Unified Module Detail (replaces scoped for per-module navigation)
  static String unifiedModuleDetail({required String moduleKey, required String moduleName}) =>
      '/module-detail/$moduleKey?name=${Uri.encodeComponent(moduleName)}';

  // WebView
  static String webView(String title, String url) =>
      '/webview?title=${Uri.encodeComponent(title)}&url=${Uri.encodeComponent(url)}';

  // Club Finder (public mobile)
  static const String clubFinder = '/club-finder';

  /// Club detail route. The club's name + Rotary ID are threaded so the Member
  /// tab can pass them to the member detail hero (a member may be in several
  /// clubs; this pins the hero to THIS club).
  static String clubFinderDetail(int clubId,
      {String? clubName, String? clubRotaryId}) {
    final params = <String>[];
    if ((clubName ?? '').trim().isNotEmpty) {
      params.add('clubName=${Uri.encodeQueryComponent(clubName!.trim())}');
    }
    if ((clubRotaryId ?? '').trim().isNotEmpty) {
      params.add(
          'clubRotaryId=${Uri.encodeQueryComponent(clubRotaryId!.trim())}');
    }
    final qs = params.isEmpty ? '' : '?${params.join('&')}';
    return '/club-finder/$clubId$qs';
  }
  static String clubFinderProjectDetail(int projectId, {int? yearId}) =>
      yearId != null
          ? '/club-finder/project/$projectId?yearId=$yearId'
          : '/club-finder/project/$projectId';

  // Find a Rotarian (public mobile)
  static const String findRotarian = '/find-rotarian';

  /// Detail route. A member can belong to several clubs (the find-rotarian
  /// SEARCH returns one row per club), so the tapped row's club is threaded
  /// through so the detail hero shows THAT club, not whichever the API lists
  /// first. Matched by [clubRotaryId] (unique) first, then [clubName].
  static String findRotarianDetail(int memberId,
      {String? clubName, String? clubRotaryId}) {
    final params = <String>[];
    if ((clubName ?? '').trim().isNotEmpty) {
      params.add('clubName=${Uri.encodeQueryComponent(clubName!.trim())}');
    }
    if ((clubRotaryId ?? '').trim().isNotEmpty) {
      params.add(
          'clubRotaryId=${Uri.encodeQueryComponent(clubRotaryId!.trim())}');
    }
    final qs = params.isEmpty ? '' : '?${params.join('&')}';
    return '/find-rotarian/$memberId$qs';
  }

  // Calendar
  /// Every calendar the user has — their clubs AND their districts, in one
  /// list. This is what the home Quick Access "Calendar" tile opens, and where
  /// a celebrations notification lands: `clubCalendar` on its own would only
  /// ever list clubs.
  static const String myCalendars = '/calendar';
  static const String clubCalendar = '/club-calendar';
  static const String districtCalendar = '/district-calendar';
  // Scoped variants — open the calendar locked to a single club/district
  // (used by the "Club Calendar" / "District Calendar" dashboard modules).
  static String clubCalendarFor(int clubId) => '$clubCalendar?clubId=$clubId';
  static String districtCalendarFor(int districtId) =>
      '$districtCalendar?districtId=$districtId';

  // Wallet & Credits — full-screen (embedded=false) variants opened from the
  // dynamic "Wallet" dashboard module (moduleKey 'wallet'). Scoped to a single
  // club/district; the club variant carries clubName for the Razorpay sheet.
  static const String walletClub = '/wallet-club';
  static const String walletDistrict = '/wallet-district';
  // creditType ('Email') opens the wallet in single-type mode used
  // by the split email tiles; omit it for the combined Wallet tile.
  static String walletClubFor(int clubId, {String? clubName, String? creditType}) {
    final c = clubName == null || clubName.trim().isEmpty
        ? ''
        : '&clubName=${Uri.encodeComponent(clubName.trim())}';
    final ct = creditType == null || creditType.isEmpty
        ? ''
        : '&credit=$creditType&single=1';
    return '$walletClub?clubId=$clubId$c$ct';
  }
  static String walletDistrictFor(int districtId, {String? creditType}) {
    final ct = creditType == null || creditType.isEmpty
        ? ''
        : '&credit=$creditType&single=1';
    return '$walletDistrict?districtId=$districtId$ct';
  }

  // Club Website — opens ClubWebsiteTab for a single club directly (the "My
  // Club Website" management page), skipping the my-club-websites picker.
  // Used by the Payments > "Website" dashboard tile.
  static const String clubWebsiteManage = '/club-website-manage';
  static String clubWebsiteManageFor(int clubId, {String? clubName}) {
    final c = clubName == null || clubName.trim().isEmpty
        ? ''
        : '&clubName=${Uri.encodeComponent(clubName.trim())}';
    return '$clubWebsiteManage?clubId=$clubId$c';
  }

  // My Membership Dues (mobile)
  static const String myDues = '/my-dues';

  /// Club-scoped "My Dues": the member view is keyed by member (returns every
  /// club's dues), so dashboards pass their clubId to filter to that club and
  /// show a "not set up for {club}" empty state instead of leaking other clubs.
  static String myDuesFor(int clubId, {String? clubName}) {
    final c = clubName == null || clubName.trim().isEmpty
        ? ''
        : '&clubName=${Uri.encodeComponent(clubName.trim())}';
    return '$myDues?clubId=$clubId$c';
  }

  // Route Maintenance Mode — full-screen gate target (route-level blocking).
  static const String maintenance = '/maintenance';
  static const String featureOff = '/not-available';
  static String maintenanceWithKey(String routeKey) =>
      '/maintenance?key=${Uri.encodeComponent(routeKey)}';
}
