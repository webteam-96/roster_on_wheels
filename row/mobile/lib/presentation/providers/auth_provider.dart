import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/constants/api_constants.dart';
import '../../core/constants/app_constants.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exceptions.dart';
import '../../core/notifications/deep_link_service.dart';
import '../../core/notifications/push_service.dart';
import '../../data/models/mobile_auth_model.dart';

class AuthProvider extends ChangeNotifier {
  final ApiClient _api = ApiClient();
  // resetOnError: FALSE (intentional). When the Android keystore can't decrypt
  // an entry — common transiently right after an app/OS update or a
  // backup-restore — we want the read to THROW so we can tell a real failure
  // apart from a genuinely-absent key. `resetOnError: true` silently DELETES the
  // entry and returns null, which turned a recoverable hiccup into a permanent
  // logout (the token was wiped, so the next launch had nothing to restore).
  // The startup read is now retried and, if it keeps failing, the session is
  // left intact rather than cleared — see [_readKeyResilient] / [checkAuthStatus].
  // Stall protection (the old reason this existed) is handled by per-read
  // timeouts, not by wiping.
  // iOS accessibility: first_unlock (kSecAttrAccessibleAfterFirstUnlock). The
  // library default (WhenUnlocked) makes the token unreadable while the phone
  // is locked, so a locked-state read returns null and the session is dropped —
  // the "random iPhone logout" bug, reproduced on-device 2026-09-07 (Keychain
  // Lock Test). first_unlock stays readable when the phone locks after the first
  // post-reboot unlock. Existing WhenUnlocked tokens upgrade on their next write.
  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: false),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  bool _isLoggedIn = false;
  bool _isLoading = false;
  bool _isCheckingAuth = true;
  String? _error;

  int _memberId = 0;
  String _memberName = '';
  String? _profilePhotoPath;
  String _memberType = 'member'; // 'member' | 'family'
  List<String> _roles = [];
  List<_RoleAssignment> _roleAssignments = [];
  DateTime? _sessionExpiry;
  Timer? _sessionTimer;

  List<int> _assignedDistrictIds = [];
  List<int> _assignedClubIds = [];
  List<int> _accessibleZoneIds = [];

  // For welcome screen
  String _welcomeClubName = '';
  String _welcomeClubNumber = '';
  List<({String name, String districtNumber})> _welcomeClubs = [];

  // ── Getters ──────────────────────────────────────────────────────────────

  bool get isLoggedIn => _isLoggedIn;
  bool get isLoading => _isLoading;
  bool get isCheckingAuth => _isCheckingAuth;
  String? get error => _error;
  int get memberId => _memberId;
  String get memberName => _memberName;
  String? get profilePhotoPath => _profilePhotoPath;
  String get memberType => _memberType;

  Future<void> refreshProfilePhoto() async {
    if (_memberId <= 0) return;
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/members/$_memberId');
      final path = res.data?['profilePhotoPath']?.toString();
      if (path != _profilePhotoPath) {
        _profilePhotoPath = (path != null && path.isNotEmpty) ? path : null;
        notifyListeners();
      }
    } catch (_) {}
  }
  List<String> get roles => List.unmodifiable(_roles);
  DateTime? get sessionExpiry => _sessionExpiry;
  List<int> get assignedDistrictIds => List.unmodifiable(_assignedDistrictIds);
  List<int> get assignedClubIds => List.unmodifiable(_assignedClubIds);
  List<int> get accessibleZoneIds => List.unmodifiable(_accessibleZoneIds);
  String get welcomeClubName => _welcomeClubName;
  String get welcomeClubNumber => _welcomeClubNumber;
  List<({String name, String districtNumber})> get welcomeClubs =>
      List.unmodifiable(_welcomeClubs);

  // ── Role checks ──────────────────────────────────────────────────────────

  bool _hasRole(String target) => _roles.any(
        (r) => r.toLowerCase().replaceAll(' ', '') ==
            target.toLowerCase().replaceAll(' ', ''),
      );

  // SuperAdmin still exists in data model but grants no elevated privileges in Flutter.
  bool get isSuperAdmin => false;

  /// True when the member's context carries a SuperAdmin role. Unlike
  /// [isSuperAdmin] — which is deliberately always false so SuperAdmin never
  /// unlocks any in-app feature — this reports the raw role purely to offer the
  /// "jump to the web SuperAdmin portal" hand-off card. Never gate app
  /// behaviour on it.
  bool get hasSuperAdminRole =>
      _roleAssignments.any((a) =>
          a.roleName.trim().toLowerCase().replaceAll(' ', '') ==
          'superadmin') ||
      _hasRole('SuperAdmin');
  // Derive from role-assignment objects (scope-aware) so legacy `{roleName:"Admin",scope:"district"}`
  // and new `{roleName:"District Admin"}` both work.
  bool get isDistrictAdmin =>
      _roleAssignments.any((a) => a.isDistrictAdmin) ||
      _hasRole(AppConstants.roleDistrictAdmin);
  bool get isClubAdmin =>
      _roleAssignments.any((a) => a.isClubAdmin) ||
      _hasRole(AppConstants.roleClubAdmin);
  bool get isDistrictMember => _hasRole(AppConstants.roleDistrictMember);
  bool get isClubMember =>
      _hasRole(AppConstants.roleClubMember) ||
      _hasRole(AppConstants.roleMember) ||
      _hasRole(AppConstants.roleFamilyMember);
  bool get isZonalCoordinator => _hasRole(AppConstants.roleZonalCoordinator);
  bool get isClubModerator => _hasRole(AppConstants.roleClubModerator);
  bool get isAG => _hasRole(AppConstants.roleAG);
  bool get isRIDirector => _hasRole(AppConstants.roleRIDirector);
  bool get isAdmin => isDistrictAdmin || isClubAdmin;
  bool get canAdd => isAdmin;
  bool get canEdit => isAdmin;
  bool get canDelete => isAdmin;
  // SuperAdmin removed. Admin roles (Club/District Admin) can CRUD within
  // their scope; members cannot.
  bool get canManageZones => false;
  bool get canManageDistricts => isDistrictAdmin;
  bool get canManageClubs => isDistrictAdmin || isClubAdmin;
  bool get canManageMembers => isAdmin;
  bool get canAccessSettings => false;
  bool get canAccessLoginLogs => false;
  bool get canAccessRoleManagement => false;

  // ── Per-scope admin checks ───────────────────────────────────────────────

  bool isClubAdminOf(int clubId) => _roleAssignments
      .any((a) => a.isClubAdmin && a.clubId == clubId);

  bool isDistrictAdminOf(int districtId) => _roleAssignments
      .any((a) => a.isDistrictAdmin && a.districtId == districtId);

  /// District-admin check by district NUMBER (the display id, e.g. "3142")
  /// rather than the numeric FK. Used where only the number is available — e.g.
  /// a member's club row carries `districtNumber`, not `districtId`.
  bool isDistrictAdminOfNumber(String districtNumber) {
    final dn = districtNumber.trim();
    if (dn.isEmpty) return false;
    return _roleAssignments
        .any((a) => a.isDistrictAdmin && (a.districtNumber ?? '').trim() == dn);
  }

  /// Formatted, deduped role labels for drawer badges.
  /// e.g. "District Admin · D2222", "Club Admin · C2", "Member".
  /// Collapses multiple `Member` roles into one badge.
  List<String> get roleBadges {
    final out = <String>[];
    bool memberAdded = false;
    for (final a in _roleAssignments) {
      String label;
      if (a.isClubAdmin) {
        final cn = (a.clubName ?? '').trim();
        label = cn.isEmpty ? 'Club Admin' : 'Club Admin · $cn';
      } else if (a.isDistrictAdmin) {
        final dn = (a.districtNumber ?? a.districtId?.toString() ?? '').trim();
        label = dn.isEmpty ? 'District Admin' : 'District Admin · D$dn';
      } else {
        final n = a.roleName.trim();
        if (n.isEmpty) continue;
        final lower = n.toLowerCase().replaceAll(' ', '');
        if (lower == 'member' || lower == 'clubmember' || lower == 'familymember') {
          if (memberAdded) continue;
          memberAdded = true;
          label = 'Member';
        } else {
          label = n;
        }
      }
      if (!out.contains(label)) out.add(label);
    }
    // Fallback to the flat role list if assignments are empty (offline/legacy auth).
    if (out.isEmpty && _roles.isNotEmpty) {
      for (final r in _roles) {
        final lower = r.toLowerCase().replaceAll(' ', '');
        if (lower == 'member' || lower == 'clubmember' || lower == 'familymember') {
          if (memberAdded) continue;
          memberAdded = true;
          if (!out.contains('Member')) out.add('Member');
        } else if (!out.contains(r)) {
          out.add(r);
        }
      }
    }
    return out;
  }

  List<int> get clubAdminClubIds => _roleAssignments
      .where((a) => a.isClubAdmin && a.clubId != null)
      .map((a) => a.clubId!)
      .toList();

  /// Best-effort club name for [clubId] from the user's role assignments.
  /// Returns null if the name isn't known (e.g. no assignment carries it).
  String? clubNameOf(int clubId) {
    for (final a in _roleAssignments) {
      if (a.clubId == clubId) {
        final n = (a.clubName ?? '').trim();
        if (n.isNotEmpty) return n;
      }
    }
    return null;
  }

  List<int> get districtAdminDistrictIds => _roleAssignments
      .where((a) => a.isDistrictAdmin && a.districtId != null)
      .map((a) => a.districtId!)
      .toList();

  /// Clubs where the user holds a direct membership (Member-scope role).
  /// Narrower than [assignedClubIds], which is a superset that also
  /// includes clubs accessible through district-admin visibility. Used by
  /// the unified modules flow so the "Club" selector lists only the
  /// user's own clubs — mirroring the "My Club" tile in the normal flow.
  List<int> get memberClubIds => _roleAssignments
      .where((a) {
        if (a.clubId == null) return false;
        if (a.scope.toLowerCase() != 'club') return false;
        final n = a.roleName.toLowerCase().replaceAll(' ', '');
        return n == 'member' || n == 'clubmember' || n == 'familymember';
      })
      .map((a) => a.clubId!)
      .toSet()
      .toList();

  /// The user's own clubs (Member-scope), taken straight from the my-context
  /// role assignments — id + display name + district. This is authoritative
  /// and immune to club-listing pagination, so the unified modules flow can
  /// build the "Club" selector without downloading the whole zone.
  List<({int id, String name, int? districtId, int? districtNumber})>
      get memberClubBriefs {
    final seen = <int>{};
    final out = <({int id, String name, int? districtId, int? districtNumber})>[];
    for (final a in _roleAssignments) {
      if (a.clubId == null) continue;
      if (a.scope.toLowerCase() != 'club') continue;
      final n = a.roleName.toLowerCase().replaceAll(' ', '');
      if (!(n == 'member' || n == 'clubmember' || n == 'familymember')) continue;
      if (!seen.add(a.clubId!)) continue;
      final name = (a.clubName ?? '').trim();
      out.add((
        id: a.clubId!,
        name: name.isNotEmpty ? name : 'Club ${a.clubId}',
        districtId: a.districtId,
        districtNumber: int.tryParse(a.districtNumber ?? ''),
      ));
    }
    return out;
  }

  // ── COG (special club) ───────────────────────────────────────────────────
  // COG is a regular club row in my-context, identified purely by its name
  // ("COG"). Detected by name so it survives club-id changes.

  /// clubId of the user's COG club, or null if they aren't a COG member.
  int? get cogClubId {
    for (final a in _roleAssignments) {
      if ((a.clubName ?? '').trim().toLowerCase() == 'cog' && a.clubId != null) {
        return a.clubId;
      }
    }
    return null;
  }

  bool get isCogMember => cogClubId != null;

  /// districtId of the COG club (its district is hidden from My Connections).
  int? get cogDistrictId {
    for (final a in _roleAssignments) {
      if ((a.clubName ?? '').trim().toLowerCase() == 'cog') return a.districtId;
    }
    return null;
  }

  /// Distinct club ids the user belongs to, EXCLUDING the COG club. Empty for
  /// a COG-only member/admin; non-empty means they're in other clubs too.
  List<int> get nonCogClubIds {
    final cog = cogClubId;
    return _roleAssignments
        .where((a) =>
            a.scope.toLowerCase() == 'club' &&
            a.clubId != null &&
            a.clubId != cog)
        .map((a) => a.clubId!)
        .toSet()
        .toList();
  }

  /// True if the user belongs to an IFRM club. Matched by name CONTAINING
  /// "ifrm" (the club is named e.g. "IFRM 3142 Main"), mirroring the calendar
  /// screen — unlike COG which is an exact name match.
  bool get isIfrmMember => _roleAssignments.any((a) =>
      a.clubId != null &&
      (a.clubName ?? '').trim().toLowerCase().contains('ifrm'));

  /// Distinct club ids the user belongs to that are NEITHER COG NOR IFRM —
  /// i.e. their "real" clubs. Empty means every club they hold is a special
  /// one (COG/IFRM) with nothing to unify on the home screen.
  List<int> get nonSpecialClubIds {
    final cog = cogClubId;
    return _roleAssignments
        .where((a) {
          if (a.scope.toLowerCase() != 'club') return false;
          if (a.clubId == null) return false;
          if (a.clubId == cog) return false;
          if ((a.clubName ?? '').trim().toLowerCase().contains('ifrm')) {
            return false;
          }
          return true;
        })
        .map((a) => a.clubId!)
        .toSet()
        .toList();
  }

  String get sessionRemainingText {
    if (_sessionExpiry == null) return '';
    final remaining = _sessionExpiry!.difference(DateTime.now());
    if (remaining.isNegative) return '0:00';
    final minutes = remaining.inMinutes;
    final seconds = remaining.inSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  AuthProvider() {
    _api.onUnauthorized = _handleUnauthorized;
    _api.onTokenRefreshed = _onTokenRefreshed;
    // When the FCM token rotates mid-session, re-register it with the backend
    // right away so push delivery never goes stale (see syncDeviceToken).
    PushService.instance.onTokenChanged = (token) => syncDeviceToken(token: token);
    checkAuthStatus();
  }

  /// The server rotated the JWT (sliding window, last 7 days of token life).
  /// Adopt the fresh expiry so the idle clock follows the real token and an
  /// actively-using member is never logged out while their token is valid.
  /// Never shrinks — only moves the expiry later.
  void _onTokenRefreshed(DateTime expiresAt) {
    if (!_isLoggedIn) return;
    if (_sessionExpiry == null || expiresAt.isAfter(_sessionExpiry!)) {
      _sessionExpiry = expiresAt;
      _startSessionTimer();
    }
  }

  // ── Auth lifecycle ────────────────────────────────────────────────────────

  Future<void> checkAuthStatus() async {
    _isCheckingAuth = true;
    notifyListeners();
    try {
      // Read the token + expiry with retry. A keystore read can fail transiently
      // right after an app/OS update or a backup-restore; retrying rides over
      // that instead of treating the very first hiccup as "logged out".
      final tokenRead = await _readKeyResilient(AppConstants.tokenKey);
      final expiryRead = await _readKeyResilient(AppConstants.sessionExpiryKey);

      // Transient storage failure (keystore not ready / slow after an update):
      // do NOT wipe the session. Leaving the stored token untouched lets a later
      // launch recover it once the keystore is readable again. We simply route
      // to login for now instead of destroying a still-valid session.
      if (tokenRead.failed || expiryRead.failed) {
        _isLoggedIn = false;
        return;
      }

      final token = tokenRead.value;
      final expiryStr = expiryRead.value;

      if (token != null && expiryStr != null) {
        final expiry = DateTime.tryParse(expiryStr);
        if (expiry != null && expiry.isAfter(DateTime.now())) {
          // One-time iOS accessibility migration. A token written by any build
          // BEFORE the first_unlock fix is stored WhenUnlocked — unreadable
          // while the phone is locked, which is the random-logout bug. Installing
          // the fixed build only READS that old token; it stays WhenUnlocked
          // until it is written again. Startup runs while the phone is unlocked
          // (we just read the token successfully), so rewrite it now with the
          // current store to upgrade its accessibility to first_unlock straight
          // away — instead of waiting for the next login or the daily
          // X-Refreshed-Token rotation. Best-effort: on failure the existing
          // item is left intact and the next launch retries.
          try {
            await _storage.write(key: AppConstants.tokenKey, value: token);
            await _storage.write(
                key: AppConstants.sessionExpiryKey, value: expiryStr);
          } catch (_) {/* keep the existing item; retry next launch */}
          // Token valid — refresh user context from server
          final ok = await _loadMyContext();
          if (ok) {
            _sessionExpiry = expiry;
            _startSessionTimer();
            _isCheckingAuth = false;
            notifyListeners();
            // Re-register the current FCM token on every authenticated launch.
            // With a 10-year JWT users rarely re-login, so this is the main
            // chance to heal a token that rotated while the app was closed
            // (reinstall / OS restore / idle) and left the backend holding a
            // dead token. Fire-and-forget — never blocks the splash.
            // ignore: unawaited_futures
            syncDeviceToken();
            return;
          }
        }
      }
      // Token/expiry read cleanly but is genuinely absent or expired (or the
      // server rejected it in _loadMyContext) — a real logged-out state.
      await _clearSession();
    } catch (_) {
      // Unexpected failure — mirror the transient path and do NOT wipe: better
      // to route to login with the session intact than to destroy a token we
      // may still be able to use next launch.
      _isLoggedIn = false;
    } finally {
      _isCheckingAuth = false;
      notifyListeners();
    }
  }

  /// Reads a secure-storage key, retrying transient failures instead of
  /// collapsing them into "no value". A keystore decrypt error or a slow read
  /// (seen right after an app/OS update or a backup-restore) throws or times
  /// out; we retry a few times with a short backoff. Returns a [_StorageRead]:
  ///   • `.value` set (possibly null) — the read SUCCEEDED; null means the key
  ///     is genuinely absent (trustworthy now that resetOnError is false).
  ///   • `.failed == true` — every attempt threw/timed out; the caller must NOT
  ///     treat this as "logged out" or wipe anything.
  Future<_StorageRead> _readKeyResilient(String key) async {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final v = await _storage
            .read(key: key)
            .timeout(const Duration(seconds: 5));
        return _StorageRead.value(v);
      } catch (_) {
        if (attempt < 2) {
          await Future.delayed(Duration(milliseconds: 200 * (attempt + 1)));
        }
      }
    }
    return _StorageRead.failed();
  }

  /// Silently re-fetch role assignments / context from the server WITHOUT
  /// toggling [isCheckingAuth] (so it never triggers the auth splash). Call on
  /// dashboard load so a role granted or revoked server-side mid-session is
  /// reflected promptly. Without this, the cached login-time assignments can
  /// keep showing an admin button for a club whose access the backend now
  /// rejects with 403 — the user would otherwise have to fully re-login to
  /// recover. No-op when logged out. Failures fall back to stored values.
  Future<void> refreshContext() async {
    if (!_isLoggedIn || _memberId <= 0) return;
    try {
      await _loadMyContext();
    } catch (_) {}
  }

  /// Re-register this device's FCM token with the backend so push notifications
  /// keep working after the token rotates (reinstall / clear-storage / OS
  /// restore / ~270-day idle). Historically the token was sent ONLY inside the
  /// verify-otp body, so a rotation left the backend holding a dead token and
  /// the device silently stopped receiving pushes — worse now that the JWT
  /// lasts 10 years and users almost never re-login.
  ///
  /// Called (a) on every authenticated launch (checkAuthStatus) and (b) from
  /// PushService.onTokenChanged the moment FCM rotates the token mid-session.
  /// No-op when logged out or memberId is unknown. A blank token is never sent
  /// (the backend would ignore it anyway via its COALESCE guard). Best-effort:
  /// all failures are swallowed so it can never break a flow.
  ///
  /// GETs the token currently stored for the member first and only POSTs when it
  /// differs (or the DB has none) — so we skip the redundant write when the
  /// backend already holds the right token. If the GET fails we POST anyway
  /// (registering is safer than staying silent). A token-refresh call passes the
  /// new token in and skips the GET (it already knows the stored one is stale).
  Future<void> syncDeviceToken({String? token}) async {
    if (!_isLoggedIn || _memberId <= 0) return;
    try {
      final fcm = token ?? PushService.instance.token ?? await PushService.instance.ensureToken();
      if (fcm == null || fcm.trim().isEmpty) return;

      // onTokenRefresh already tells us the token changed — no need to GET.
      if (token == null) {
        try {
          final current = await _api.get<Map<String, dynamic>>(
            ApiConstants.memberDeviceToken(_memberId),
            fromJson: (json) => json as Map<String, dynamic>,
          );
          if (current.isSuccess && current.data != null) {
            final stored = current.data!['deviceToken']?.toString().trim() ?? '';
            if (stored == fcm.trim()) return; // backend already has the right token
          }
        } catch (_) {
          // GET failed — fall through and POST so the device still registers.
        }
      }

      await _api.post<Map<String, dynamic>>(
        ApiConstants.memberDeviceToken(_memberId),
        body: {'deviceToken': fcm},
        fromJson: (json) => json as Map<String, dynamic>,
      );
    } catch (_) {
      // Best-effort — a failed token sync must never surface to the user.
    }
  }

  // ── Mobile OTP Auth ───────────────────────────────────────────────────────

  /// Step 1: Request OTP. Returns otpExpiresInSeconds on success, null on failure.
  Future<void> _saveSession(MobileVerifyOtpResult result) async {
    final districtIds = result.accessibleDistricts.map((d) => d.id).toList();
    final clubIds = result.accessibleClubs.map((c) => c.id).toList();
    final zoneIds = result.accessibleZones.map((z) => z.id).toList();

    final firstClub = result.accessibleClubs.isNotEmpty ? result.accessibleClubs.first : null;
    final firstDistrict =
        result.accessibleDistricts.isNotEmpty ? result.accessibleDistricts.first : null;

    await _storage.write(key: AppConstants.tokenKey, value: result.token);
    await _storage.write(
        key: AppConstants.sessionExpiryKey, value: result.expiresAt.toIso8601String());
    await _storage.write(key: AppConstants.userIdKey, value: result.memberId.toString());
    await _storage.write(key: AppConstants.userNameKey, value: result.memberName);
    await _storage.write(key: AppConstants.userRolesKey, value: result.roleNames.join(','));
    await _storage.write(
        key: AppConstants.assignedDistrictIdsKey, value: districtIds.join(','));
    await _storage.write(key: AppConstants.assignedClubIdsKey, value: clubIds.join(','));
    await _storage.write(
        key: AppConstants.accessibleZoneIdsKey, value: zoneIds.join(','));
    await _storage.write(key: AppConstants.memberTypeKey, value: result.memberType);
    await _storage.write(
        key: AppConstants.welcomeClubNameKey, value: firstClub?.name ?? '');
    await _storage.write(
        key: AppConstants.welcomeClubNumberKey, value: firstDistrict?.number ?? '');

    _isLoggedIn = true;
    _memberId = result.memberId;
    _memberName = result.memberName;
    _memberType = result.memberType;
    _roles = result.roleNames;
    _roleAssignments = [];
    _assignedDistrictIds = districtIds;
    _assignedClubIds = clubIds;
    _accessibleZoneIds = zoneIds;
    _welcomeClubName = firstClub?.name ?? '';
    _welcomeClubNumber = firstDistrict?.number ?? '';
    final districtNumByIdSave = {
      for (final d in result.accessibleDistricts) d.id: d.number,
    };
    _welcomeClubs = result.accessibleClubs
        .map((c) => (
              name: c.name,
              districtNumber: districtNumByIdSave[c.districtId ?? -1] ?? '',
            ))
        .toList();
    // Hydrate role-assignments (scope/clubId/districtId) immediately from the
    // richer /api/auth/my-context payload so per-scope admin checks
    // (isClubAdminOf / isDistrictAdminOf) are correct as soon as sign-in
    // completes — before the router navigates away from login. Silent on
    // failure; the session timer will retry via checkAuthStatus later.
    try {
      await _loadMyContext();
    } catch (_) {}
    _sessionExpiry = result.expiresAt;
    _startSessionTimer();
  }

  Future<bool> _loadMyContext() async {
    try {
      final response = await _api.get<Map<String, dynamic>>(
        ApiConstants.myContext,
        fromJson: (json) => json as Map<String, dynamic>,
      );
      if (response.isSuccess && response.data != null) {
        final j = response.data!;
        _memberId = j['memberId'] as int? ?? 0;
        _memberName = j['memberName']?.toString() ?? '';
        _memberType = j['memberType']?.toString() ?? 'member';
        // Parse full role-assignment objects from j['roles'].
        final rolesRaw = j['roles'] as List<dynamic>? ?? const [];
        _roleAssignments = rolesRaw
            .whereType<Map<String, dynamic>>()
            .map(_RoleAssignment.fromJson)
            .toList();
        _roles = (j['roleNames'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList();
        // Fall back to role names from role-assignment objects if roleNames absent.
        if (_roles.isEmpty) {
          _roles = _roleAssignments
              .map((a) => a.roleName)
              .where((r) => r.isNotEmpty)
              .toList();
        }
        // Persist role assignments for offline/cold-start restoration.
        await _storage.write(
          key: AppConstants.roleAssignmentsKey,
          value: jsonEncode(_roleAssignments.map((a) => a.toJson()).toList()),
        );
        final rawDistricts = (j['accessibleDistricts'] as List<dynamic>? ?? [])
            .whereType<Map<String, dynamic>>()
            .toList();
        final rawClubs = (j['accessibleClubs'] as List<dynamic>? ?? [])
            .whereType<Map<String, dynamic>>()
            .toList();
        _assignedDistrictIds = rawDistricts
            .map((d) => d['id'] as int? ?? 0)
            .where((id) => id > 0)
            .toList();
        _assignedClubIds = rawClubs
            .map((c) => c['id'] as int? ?? 0)
            .where((id) => id > 0)
            .toList();
        final districtNumById = {
          for (final d in rawDistricts)
            (d['id'] as int? ?? 0): (d['number']?.toString() ?? ''),
        };
        _welcomeClubs = rawClubs
            .map((c) => (
                  name: c['name']?.toString() ?? '',
                  districtNumber:
                      districtNumById[c['districtId'] as int? ?? -1] ?? '',
                ))
            .toList();
        _accessibleZoneIds = (j['accessibleZones'] as List<dynamic>? ?? [])
            .map((z) => (z as Map<String, dynamic>)['id'] as int? ?? 0)
            .where((id) => id > 0)
            .toList();

        // Restore welcome info from storage (set during sign-in)
        _welcomeClubName =
            await _storage.read(key: AppConstants.welcomeClubNameKey) ?? '';
        _welcomeClubNumber =
            await _storage.read(key: AppConstants.welcomeClubNumberKey) ?? '';

        _isLoggedIn = true;
        await _recomputeStaleRoleToken();
        notifyListeners();
        return true;
      }
      return false;
    } on UnauthorizedException {
      // The server rejected the token (expired, or a force-relogin: an admin
      // changed this member's mobile, or they no longer have a live club
      // membership). This is NOT a transport failure, so restoring the stored
      // session would resurrect a dead login: api_client has already fired
      // onUnauthorized -> _handleUnauthorized -> _clearSession(), and racing it
      // with storage reads could leave _isLoggedIn true with no token, stranding
      // the user on Home with every call 401ing. Report failure and let the
      // caller clear + route to login.
      return false;
    } catch (_) {
      // If my-context fails (network error), fall back to stored values
      return _restoreFromStorage();
    }
  }

  Future<bool> _restoreFromStorage() async {
    try {
      final memberIdStr = await _storage.read(key: AppConstants.userIdKey);
      final memberName = await _storage.read(key: AppConstants.userNameKey);
      final rolesStr = await _storage.read(key: AppConstants.userRolesKey);
      final districtIdsStr = await _storage.read(key: AppConstants.assignedDistrictIdsKey);
      final clubIdsStr = await _storage.read(key: AppConstants.assignedClubIdsKey);
      final zoneIdsStr = await _storage.read(key: AppConstants.accessibleZoneIdsKey);

      if (memberName == null) return false;

      _memberId = int.tryParse(memberIdStr ?? '0') ?? 0;
      _memberName = memberName;
      _memberType = await _storage.read(key: AppConstants.memberTypeKey) ?? 'member';
      _roles = rolesStr?.split(',').where((r) => r.isNotEmpty).toList() ?? [];
      final roleAssignmentsStr =
          await _storage.read(key: AppConstants.roleAssignmentsKey);
      if (roleAssignmentsStr != null && roleAssignmentsStr.isNotEmpty) {
        try {
          final decoded = jsonDecode(roleAssignmentsStr) as List<dynamic>;
          _roleAssignments = decoded
              .whereType<Map<String, dynamic>>()
              .map(_RoleAssignment.fromJson)
              .toList();
        } catch (_) {
          _roleAssignments = [];
        }
      } else {
        _roleAssignments = [];
      }
      _assignedDistrictIds = _parseIds(districtIdsStr);
      _assignedClubIds = _parseIds(clubIdsStr);
      _accessibleZoneIds = _parseIds(zoneIdsStr);
      _welcomeClubName = await _storage.read(key: AppConstants.welcomeClubNameKey) ?? '';
      _welcomeClubNumber = await _storage.read(key: AppConstants.welcomeClubNumberKey) ?? '';
      _isLoggedIn = true;
      notifyListeners();
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── Logout ──────────────────────────────────────────────────────────────── 31 38712

  Future<void> logout() async {
    try {
      final deviceId = await _storage.read(key: AppConstants.deviceIdKey);
      await _api.post(
        ApiConstants.mobileLogout,
        body: {'imei': deviceId},
      );
    } catch (_) {}
    await _clearSession();
  }

  // ── Email + password sign-in (every member) ─────────────────────────────

  /// Signs in with email + password and stores the same mobile session the OTP
  /// flow used (device session, scopes, 90-day mobile JWT).
  Future<bool> login({required String email, required String password}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final deviceId = await _getOrCreateDeviceId();
      final fcmToken = await PushService.instance.ensureToken();
      final response = await _api.post<Map<String, dynamic>>(
        ApiConstants.mobileLogin,
        body: {
          'email': email,
          'password': password,
          'imei': deviceId,
          'deviceName': Platform.isIOS ? 'iOS' : 'Android',
          'deviceToken': fcmToken ?? '',
          'appVersion': '1.0.0',
        },
        fromJson: (json) => json as Map<String, dynamic>,
        requiresAuth: false,
      );
      if (response.isSuccess && response.data != null) {
        await _saveSession(MobileVerifyOtpResult.fromJson(response.data!));
        _isLoading = false;
        notifyListeners();
        return true;
      }
      _error = response.error ?? 'Invalid email or password.';
      _isLoading = false;
      notifyListeners();
      return false;
    } on ApiException catch (e) {
      _error = e.message;
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> forgotPassword({
    String? email,
    String? mobileNumber,
    String? countryCode,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final body = <String, dynamic>{};
      if (email != null && email.isNotEmpty) {
        body['email'] = email;
      } else {
        body['mobileNumber'] = mobileNumber;
        if (countryCode != null) body['countryCode'] = countryCode;
      }
      final response = await _api.post(
        ApiConstants.forgotPassword,
        body: body,
        requiresAuth: false,
      );
      _isLoading = false;
      notifyListeners();
      return response.isSuccess;
    } on ApiException catch (e) {
      _error = e.message;
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> resetPassword({
    required String token,
    required String newPassword,
    required String confirmPassword,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final response = await _api.post(
        ApiConstants.resetPassword,
        body: {
          'token': token,
          'newPassword': newPassword,
          'confirmPassword': confirmPassword,
        },
        requiresAuth: false,
      );
      _isLoading = false;
      notifyListeners();
      return response.isSuccess;
    } on ApiException catch (e) {
      _error = e.message;
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
    required String confirmPassword,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final response = await _api.post(
        ApiConstants.changePassword,
        body: {
          'currentPassword': currentPassword,
          'newPassword': newPassword,
          'confirmPassword': confirmPassword,
        },
      );
      _isLoading = false;
      notifyListeners();
      return response.isSuccess;
    } on ApiException catch (e) {
      _error = e.message;
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  void extendSession() {
    if (_sessionExpiry != null && _isLoggedIn) {
      // Roll a sliding idle window forward on activity, but NEVER shrink the
      // session. The mobile token is valid ~30 days (backend MobileJwtDays),
      // and `_sessionExpiry` is seeded from that token's `expiresAt`. Keep the
      // LATER of the current (token-derived) expiry and now+window.
      //
      // Previously this HARD-SET the expiry to now+8h, collapsing the 30-day
      // token into an 8-hour idle logout — the user got logged out after ~8h of
      // inactivity despite holding a valid 30-day token. (isAfter compares
      // absolute instants, so the UTC token expiry vs local `now` is correct.)
      final candidate = DateTime.now()
          .add(const Duration(minutes: AppConstants.defaultSessionMinutes));
      if (candidate.isAfter(_sessionExpiry!)) {
        _sessionExpiry = candidate;
        _storage.write(
            key: AppConstants.sessionExpiryKey,
            value: _sessionExpiry!.toIso8601String());
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  List<int> _parseIds(String? raw) {
    if (raw == null || raw.isEmpty) return [];
    return raw
        .split(',')
        .map((s) => int.tryParse(s.trim()))
        .whereType<int>()
        .where((id) => id > 0)
        .toList();
  }

  Future<String> _getOrCreateDeviceId() async {
    var id = await _storage.read(key: AppConstants.deviceIdKey);
    if (id == null) {
      final random = Random.secure();
      final bytes = List<int>.generate(16, (_) => random.nextInt(256));
      id = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      await _storage.write(key: AppConstants.deviceIdKey, value: id);
    }
    return id;
  }

  void _startSessionTimer() {
    _sessionTimer?.cancel();
    _sessionTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_sessionExpiry != null && _sessionExpiry!.isBefore(DateTime.now())) {
        _handleSessionExpired();
      } else {
        notifyListeners();
      }
    });
  }

  void _handleSessionExpired() {
    _sessionTimer?.cancel();
    _clearSession();
  }

  // One-shot message explaining why the session ended (e.g. a force-relogin
  // after an admin changed the member's mobile). The login screen reads it once
  // via [consumeSessionEndedReason] and shows it, then it's cleared.
  String? _sessionEndedReason;

  /// Returns the pending session-ended reason (if any) and clears it so it's
  /// shown only once.
  String? consumeSessionEndedReason() {
    final r = _sessionEndedReason;
    _sessionEndedReason = null;
    return r;
  }

  // ── Stale-token (roles changed after login) detection ────────────────────
  //
  // Role-gated endpoints (Admin, AG, Zonal Coordinator, Moderator, RI Director)
  // authorise off the `roles` claim baked into the JWT at login, NOT the live
  // DB. my-context reflects the live DB, so the two disagree the moment
  // someone's roles change server-side. We compare the two ROLE SETS so the UI
  // can prompt a re-login instead of waiting for a 403 (role GRANTED) or
  // leaving a withdrawn role usable until the 90-day token expires (REVOKED).
  bool _staleAdminToken = false;

  /// True when the live my-context role set differs from the JWT's `roles`
  /// claim — a role was granted or revoked after this token was issued.
  bool get staleAdminToken => _staleAdminToken;

  /// Roles whose LOSS forces a re-login. Plain membership roles are absent by
  /// design — see the revoke note in [_recomputeStaleRoleToken].
  static const Set<String> _elevatedRoleKeys = {
    'admin', 'superadmin', 'clubadmin', 'districtadmin',
    'ag', 'zonalcoordinator', 'clubmoderator', 'ridirector',
  };

  /// Case- and space-insensitive role key, matching [_hasRole]'s normalisation
  /// so "Club Admin" and "ClubAdmin" compare as one role.
  static String _roleKey(String r) =>
      r.trim().toLowerCase().replaceAll(' ', '');

  /// Set signature used only by the loop-breaker below.
  static String _roleSignature(Set<String> tokenRoles, Set<String> ctxRoles) {
    final t = tokenRoles.toList()..sort();
    final c = ctxRoles.toList()..sort();
    return '${t.join(",")}|${c.join(",")}';
  }

  /// Signature of the mismatch currently being reported, persisted by
  /// [forceReloginForRoleChange] once the user actually re-logs in.
  String? _pendingRoleSignature;

  Future<void> _recomputeStaleRoleToken() async {
    try {
      final token = await _storage.read(key: AppConstants.tokenKey);
      final claim = _jwtRolesClaim(token);
      // No decodable claim — nothing to compare. Never risk a false prompt.
      if (claim.isEmpty) {
        _staleAdminToken = false;
        return;
      }
      // SuperAdmin is a permanent, by-design mismatch on mobile and must be
      // dropped from BOTH sides before comparing. The mobile JWT is minted with
      // excludeSuperAdmin:true (SA is web-only — no mobile endpoint honours it),
      // so the `roles` claim NEVER carries SuperAdmin; but my-context is built
      // with excludeSuperAdmin:false (since 2026-08-14, so the app can offer the
      // "open web" SuperAdmin card), so its roleNames ALWAYS carry it. Left in,
      // an SA member's context set shows a "granted" SuperAdmin the token lacks
      // and gets force-logged-out on every single login. It can never be a real
      // stale-role signal here, so strip it on both sides.
      final tokenRoles = claim
          .split(',')
          .map(_roleKey)
          .where((r) => r.isNotEmpty && r != 'superadmin')
          .toSet();
      final ctxRoles = _roles
          .map(_roleKey)
          .where((r) => r.isNotEmpty && r != 'superadmin')
          .toSet();
      // Empty context set = my-context hasn't populated yet, not "no roles".
      if (ctxRoles.isEmpty) {
        _staleAdminToken = false;
        return;
      }

      // GRANT — any live role the token doesn't carry. That role's endpoints
      // will 403 until re-login. Set-based, so this covers every role (AG,
      // Zonal Coordinator, Club/District Admin, Moderator, RI Director) with no
      // per-role list to maintain, and it catches a SECOND role granted to
      // someone who already holds one (the old `claim.contains('Admin')` test
      // could not — a club admin made a district admin looked unchanged).
      final granted = ctxRoles.difference(tokenRoles);

      // REVOKE — elevated roles only. Verify-OTP injects a synthetic "Member"
      // into the token for family logins (MobileAuthService.cs:466-467) that is
      // NOT part of scopes.Roles and therefore can NEVER appear in my-context.
      // Counting plain membership roles here would mark every family login
      // stale on every launch, force a re-login, and reproduce the exact same
      // mismatch — an inescapable loop with no way into the app. Losing an
      // elevated role is also the only revoke with security weight.
      final revoked = tokenRoles
          .difference(ctxRoles)
          .where(_elevatedRoleKeys.contains)
          .toSet();

      if (granted.isEmpty && revoked.isEmpty) {
        _staleAdminToken = false;
        // Token and context agree, so any earlier suppression is spent. Clear
        // it, otherwise a future genuine change that happened to produce the
        // same signature would be silently ignored.
        _pendingRoleSignature = null;
        await _storage.delete(key: AppConstants.lastForcedReloginRoleSigKey);
        return;
      }

      // LOOP-BREAKER. If we already forced a re-login for this exact mismatch
      // and the freshly-issued token STILL doesn't match, the backend cannot
      // satisfy it (role naming drift, or a role the mobile token strips).
      // Prompting again would trap the user in a login loop, so stay silent and
      // let the 403 surface normally instead.
      final sig = _roleSignature(tokenRoles, ctxRoles);
      final lastSig =
          await _storage.read(key: AppConstants.lastForcedReloginRoleSigKey);
      if (sig == lastSig) {
        _staleAdminToken = false;
        return;
      }
      _pendingRoleSignature = sig;
      _staleAdminToken = true;
    } catch (_) {
      // On any decode/storage failure, don't risk a false logout prompt.
      _staleAdminToken = false;
    }
  }

  /// Returns the raw `roles` claim string from a JWT payload (e.g. "Admin,Member"),
  /// or '' if the token is missing/malformed.
  String _jwtRolesClaim(String? token) {
    if (token == null || token.isEmpty) return '';
    final parts = token.split('.');
    if (parts.length != 3) return '';
    try {
      final payload =
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
      final map = jsonDecode(payload);
      if (map is Map<String, dynamic>) return map['roles']?.toString() ?? '';
    } catch (_) {}
    return '';
  }

  /// Forces a re-login after a role change the current token can't honour.
  ///
  /// The backend bakes the user's roles into the JWT at login and only ever
  /// re-mints that claim on a fresh login (the daily refresh middleware just
  /// re-stamps the expiry, keeping the old claims). So when a member is
  /// promoted to admin AFTER logging in, `my-context` (a live DB read) shows
  /// the new admin role — but the admin endpoints, which gate on the frozen
  /// `roles` JWT claim, keep returning 403. The only cure is a new token, i.e.
  /// signing in again. Sets a one-shot reason the login screen surfaces, then
  /// clears the session so the router lands on login.
  Future<void> forceReloginForRoleChange() async {
    _sessionEndedReason =
        'Your roles were recently updated. Please log in again to continue.';
    final sig = _pendingRoleSignature;
    await logout();
    // Written AFTER logout on purpose: _clearSession wipes storage, so a write
    // beforehand would be erased. This is the loop-breaker — if the next login
    // reproduces the identical mismatch, _recomputeStaleRoleToken stays quiet
    // instead of prompting again forever.
    if (sig != null) {
      await _storage.write(
          key: AppConstants.lastForcedReloginRoleSigKey, value: sig);
    }
  }

  void _handleUnauthorized({String? reason}) {
    _sessionEndedReason = reason;
    _clearSession();
  }

  Future<void>? _clearSessionInFlight;

  /// Clears the session, collapsing overlapping calls onto one run.
  ///
  /// A single 401 can trigger two clears: `_handleUnauthorized` fires one
  /// fire-and-forget from the api_client hook, and `checkAuthStatus` then awaits
  /// its own once `_loadMyContext` reports failure. Running two concurrently can
  /// permanently lose the preserved `deviceId` — the second run reads it as null
  /// after the first run's `deleteAll()`, so it never restores it, and its own
  /// `deleteAll()` then wipes the value the first run had written back. Sharing
  /// the in-flight future also makes an awaited clear actually wait for one
  /// already started by the hook.
  Future<void> _clearSession() {
    return _clearSessionInFlight ??=
        _doClearSession().whenComplete(() => _clearSessionInFlight = null);
  }

  Future<void> _doClearSession() async {
    _sessionTimer?.cancel();
    // Drop any queued push-notification deep-link so it can't fire against the
    // next account that signs in on this device.
    DeepLinkService.instance.clearPending();
    // Keep device ID and terms accepted — only clear auth data.
    // Every secure-storage call here is timeout- + try/catch-guarded so a
    // wedged keystore can't hang this method (which runs from checkAuthStatus
    // on the startup path). Each guard is a no-op when storage is healthy.
    String? deviceId;
    String? termsAccepted;
    try {
      deviceId = await _storage
          .read(key: AppConstants.deviceIdKey)
          .timeout(const Duration(seconds: 5), onTimeout: () => null);
    } catch (_) {}
    try {
      termsAccepted = await _storage
          .read(key: AppConstants.termsAcceptedKey)
          .timeout(const Duration(seconds: 5), onTimeout: () => null);
    } catch (_) {}
    try {
      await _storage
          .deleteAll()
          .timeout(const Duration(seconds: 5), onTimeout: () {});
    } catch (_) {}
    if (deviceId != null) {
      try {
        await _storage.write(key: AppConstants.deviceIdKey, value: deviceId);
      } catch (_) {}
    }
    if (termsAccepted != null) {
      try {
        await _storage.write(
            key: AppConstants.termsAcceptedKey, value: termsAccepted);
      } catch (_) {}
    }
    _isLoggedIn = false;
    _staleAdminToken = false;
    _memberId = 0;
    _memberName = '';
    _profilePhotoPath = null;
    _memberType = 'member';
    _roles = [];
    _roleAssignments = [];
    _assignedDistrictIds = [];
    _assignedClubIds = [];
    _accessibleZoneIds = [];
    _welcomeClubName = '';
    _welcomeClubNumber = '';
    _welcomeClubs = [];
    _sessionExpiry = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _sessionTimer?.cancel();
    super.dispose();
  }
}

/// Outcome of a resilient secure-storage read. Distinguishes a successful read
/// (value may be null = genuinely absent) from a read that failed on every
/// attempt (keystore not readable), so callers never mistake a transient
/// failure for "no value" and wipe a still-valid session. See
/// [AuthProvider._readKeyResilient].
class _StorageRead {
  final String? value;
  final bool failed;
  const _StorageRead._(this.value, this.failed);
  factory _StorageRead.value(String? v) => _StorageRead._(v, false);
  factory _StorageRead.failed() => const _StorageRead._(null, true);
}

class _RoleAssignment {
  final String roleName;
  final String scope; // 'global' | 'zone' | 'district' | 'club'
  final int? zoneId;
  final String? zoneName;
  final int? districtId;
  final String? districtNumber;
  final int? clubId;
  final String? clubName;

  const _RoleAssignment({
    required this.roleName,
    required this.scope,
    this.zoneId,
    this.zoneName,
    this.districtId,
    this.districtNumber,
    this.clubId,
    this.clubName,
  });

  factory _RoleAssignment.fromJson(Map<String, dynamic> j) => _RoleAssignment(
        roleName: j['roleName']?.toString() ?? '',
        scope: j['scope']?.toString() ?? '',
        zoneId: j['zoneId'] as int?,
        zoneName: j['zoneName']?.toString(),
        districtId: j['districtId'] as int?,
        districtNumber: j['districtNumber']?.toString(),
        clubId: j['clubId'] as int?,
        clubName: j['clubName']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'roleName': roleName,
        'scope': scope,
        'zoneId': zoneId,
        'zoneName': zoneName,
        'districtId': districtId,
        'districtNumber': districtNumber,
        'clubId': clubId,
        'clubName': clubName,
      };

  // Accept both the new explicit role names ("Club Admin" / "District Admin")
  // and the legacy "Admin" role disambiguated by scope.
  String get _normName => roleName.toLowerCase().replaceAll(' ', '');
  String get _normScope => scope.toLowerCase().trim();

  bool get isClubAdmin {
    final n = _normName;
    if (n == 'clubadmin') return true;
    if (n == 'admin' && _normScope == 'club') return true;
    return false;
  }

  bool get isDistrictAdmin {
    final n = _normName;
    if (n == 'districtadmin') return true;
    if (n == 'admin' && _normScope == 'district') return true;
    return false;
  }
}

