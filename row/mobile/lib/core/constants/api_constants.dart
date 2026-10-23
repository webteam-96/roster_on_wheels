class ApiConstants {
  /// The ROW API (NestJS) root, without a trailing slash. Set per build:
  /// `flutter run --dart-define=API_BASE_URL=https://api.example.org`.
  /// The default is a local API (an Android emulator reaches the host as 10.0.2.2).
  static const String baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:5000');

  // Auth
  static const String login = '/api/auth/login';
  // Mobile sign-in is email + password for every member (ROW, 2026-10-19).
  static const String mobileLogin = '/api/mobile/auth/login';
  static const String forgotPassword = '/api/mobile/auth/forgot-password';
  static const String resetPassword = '/api/auth/reset-password';
  static const String changePassword = '/api/auth/change-password';
  static const String logout = '/api/auth/logout';
  static const String myContext = '/api/auth/my-context';

  // Mobile Auth (OTP)
  static const String mobileRequestOtp = '/api/mobile/auth/request-otp';
  static const String mobileVerifyOtp = '/api/mobile/auth/verify-otp';
  static const String mobileLogout = '/api/mobile/auth/logout';

  // Mobile → Web hand-off: POST mints a one-time link that opens the web portal
  // already signed in (no password re-entry). Used by the SuperAdmin card.
  static const String webSsoToken = '/api/mobile/auth/web-sso-token';

  // Mobile Notifications — single merged, paginated feed across all of the
  // member's clubs/districts. Types: greeting, project, announcement, event,
  // newsletter, document. The member is resolved from the JWT (no id in URL).
  // Query: page (1), pageSize (max 100), days (max 365), types (csv, omit=all).
  static const String mobileNotifications = '/api/mobile/notifications';

  // Members
  static const String members = '/api/members';
  // FCM push device token. POST body {"deviceToken":"<fcm>"} re-registers the
  // device so pushes keep working after the token rotates (reinstall / restore /
  // idle). Blank never wipes an existing token (backend COALESCE guard).
  static String memberDeviceToken(int id) => '/api/members/$id/device-token';

  // Zones
  static const String zones = '/api/zones';
  static String zoneById(int id) => '/api/zones/$id';

  // Districts
  static const String districts = '/api/districts';
  static String districtById(int id) => '/api/districts/$id';

  // Dashboard (module lists with icons)
  static String clubDashboardModules(int id) => '/api/clubs/$id/dashboard';
  static String districtDashboardModules(int id) => '/api/districts/$id/dashboard';

  // Modules — Coming Soon flags (SuperAdmin sets these on the web admin)
  static const String modulesComingSoon = '/api/modules/coming-soon';

  // Route Maintenance Mode — active blocked routes/tabs (SuperAdmin-controlled).
  static const String appRouteMaintenance = '/api/app/route-maintenance';
  static const String features = '/api/features';

  static String get mediaBaseUrl => baseUrl;

  /// Converts a relative API media path to a full URL.
  /// Already-absolute URLs (http/https) are returned unchanged.
  static String mediaUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    final p = path.startsWith('/') ? path : '/$path';
    return '$baseUrl$p';
  }

  // Clubs
  static const String clubs = '/api/clubs';
  static String clubById(int id) => '/api/clubs/$id';

  // Projects (club)

  // District Projects

  // Announcements

  // Newsletters

  // Upcoming Events

  // Documents

  // Attendance

  // Monthly Reports

  // Board of Directors

  // Past Presidents

  // Sub-groups

  // Greetings

  // Mass Emails

  // Event Payment Links

  // Membership Dues
  // Lightweight dashboard nudge: one row per dues record with >=1 offline
  // payment still in OfflineStatus='Pending' for the club.
  static String clubPendingOfflineApprovals(int clubId) =>
      '/api/clubs/$clubId/membership-dues/pending-offline-approvals';

  // TRF

  // OCV/GOV

  // Weblinks

  // Website Data (Club)

  // Website Data (District)

  // Website Training appointments (Calendly-style Zoom booking). NOTE: these are
  // plain `/api/training-appointments/*` routes, NOT `/api/mobile/*`.
  static const String trainingAvailability =
      '/api/training-appointments/availability';
  static const String trainingBook = '/api/training-appointments/book';
  static const String trainingMine = '/api/training-appointments/mine';
  static String trainingReschedule(int id) =>
      '/api/training-appointments/$id/reschedule';

  // Wallet credit top-up (club/district admins buy email credits via
  // Razorpay). Plain `/api/wallet/*` routes.
  static const String walletQuote = '/api/wallet/quote';
  static const String walletCreateOrder = '/api/wallet/create-order';
  static const String walletVerify = '/api/wallet/verify';
  static String creditBalanceClub(int clubId) =>
      '/api/credit-management/club/$clubId/balance';
  static String creditBalanceDistrict(int districtId) =>
      '/api/credit-management/district/$districtId/balance';

  // Club website self-service purchase/renewal (Razorpay). `/api/website-billing/*`.
  static const String websiteBillingQuote = '/api/website-billing/quote';
  static const String websiteBillingCheckSubdomain =
      '/api/website-billing/check-subdomain';
  static const String websiteBillingCreateOrder =
      '/api/website-billing/create-order';
  static const String websiteBillingVerify = '/api/website-billing/verify';
  static const String websiteBillingLatestOrder =
      '/api/website-billing/latest-order';
  static String websiteBillingOrderStatus(int orderId) =>
      '/api/website-billing/order-status/$orderId';

  // Settings
  static const String designations = '/api/designations';
  static const String funding = '/api/funding';
  static const String modules = '/api/modules';
  static const String themes = '/api/themes';
  static const String countries = '/api/countries';

  // Admin
  static const String adminAssignRole = '/api/admin/assign-role';
  static const String adminRemoveRole = '/api/admin/remove-role';

  // Credit Management

  // District Committee

  // District Events

  // District-specific modules

  // ── Goal Setting (club / district goal entry) ───────────────────────────────
  // Reuses the same backend service as web via the mobile twin controller.
  static const String goalSettingBase = '/api/mobile/goal-setting';
  static const String goalCategories = '$goalSettingBase/categories';

  // ── Goal ENTRY (club / district admins set their own targets) ──────────────
  // yearId omitted → server default (current year); clubId/districtId omitted →
  // server resolves the caller's own single assignment.
  static String _q(Map<String, int?> params) {
    final parts = <String>[
      for (final e in params.entries)
        if (e.value != null) '${e.key}=${e.value}',
    ];
    return parts.isEmpty ? '' : '?${parts.join('&')}';
  }

  static String goalClubForm(int categoryId, {int? yearId, int? clubId}) =>
      '$goalSettingBase/clubs/$categoryId${_q({'yearId': yearId, 'clubId': clubId})}';
  static String goalClubSave(int categoryId, {int? clubId}) =>
      '$goalSettingBase/clubs/$categoryId${_q({'clubId': clubId})}';

  static String goalDistrictForm(int categoryId, {int? yearId, int? districtId}) =>
      '$goalSettingBase/districts/$categoryId${_q({'yearId': yearId, 'districtId': districtId})}';
  static String goalDistrictSave(int categoryId, {int? districtId}) =>
      '$goalSettingBase/districts/$categoryId${_q({'districtId': districtId})}';
}
