import 'package:rotary_flutter_app/core/brand/brand.dart';

class AppConstants {
  static String get appName => '${Brand.current.productName} Admin';
  static const String tokenKey = 'auth_token';
  static const String sessionExpiryKey = 'session_expiry';
  static const String sessionDurationKey = 'session_duration_ms';
  static const String lastLoginKey = 'last_login_time';
  static const String userIdKey = 'user_id';
  static const String userNameKey = 'user_name';
  static const String userRolesKey = 'user_roles';

  static const int defaultPageSize = 20;
  static const int requestTimeoutSeconds = 30;
  static const int defaultSessionMinutes = 480;

  static const List<String> bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  static const List<String> genders = ['Male', 'Female', 'Other'];
  static const List<String> weekDays = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
  ];
  static const List<String> addressTypes = ['Residential', 'Business'];
  static const List<String> relationTypes = ['Spouse', 'Son', 'Daughter', 'Parent', 'Sibling', 'Other'];
  static const List<String> months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Roles
  static const String roleSuparAdmin = 'SuperAdmin';
  static const String roleAdmin = 'Admin';           // legacy / Club Admin (API-issued)
  static const String roleZonalCoordinator = 'ZonalCoordinator';
  static const String roleDistrictAdmin = 'District Admin';
  static const String roleClubAdmin = 'Club Admin';
  static const String roleDistrictMember = 'DistrictMember';
  static const String roleClubMember = 'ClubMember';
  static const String roleMember = 'Member';           // API-issued short form of ClubMember
  static const String roleFamilyMember = 'FamilyMember';
  static const String roleClubModerator = 'ClubModerator';
  static const String roleAG = 'AG';
  static const String roleRIDirector = 'RIDirector';

  // Storage keys for scoped-access IDs
  static const String assignedDistrictIdsKey = 'assigned_district_ids';
  static const String assignedClubIdsKey = 'assigned_club_ids';
  static const String accessibleZoneIdsKey = 'accessible_zone_ids';
  static const String memberTypeKey = 'member_type';
  static const String deviceIdKey = 'device_id';
  static const String termsAcceptedKey = 'terms_accepted';
  static const String welcomeClubNameKey = 'welcome_club_name';
  static const String welcomeClubNumberKey = 'welcome_club_number';
  static const String roleAssignmentsKey = 'role_assignments';
  // Signature of the token-vs-context role mismatch that last forced a
  // re-login. Survives logout on purpose — it is the loop-breaker that stops a
  // mismatch the backend can't resolve from prompting forever. See
  // AuthProvider._recomputeStaleRoleToken.
  static const String lastForcedReloginRoleSigKey = 'last_forced_relogin_roles';

  static const String uploadBaseUrl = 'http://localhost:5000';
}
