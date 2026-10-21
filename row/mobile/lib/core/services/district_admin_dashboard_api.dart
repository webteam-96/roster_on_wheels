import '../network/api_client.dart';
import '../../data/models/district_admin_dashboard_models.dart';

/// Thin client for the mobile District Admin Dashboard endpoints
/// (`api/mobile/district-admin-dashboard/*`).
///
/// The acting District Admin is taken from the JWT; `districtId` is passed so a
/// multi-district admin gets the dashboard for the district they opened (the
/// server validates an active DA assignment, else 403/404). `yearId` is
/// optional — the server defaults to the current rotary year. These endpoints
/// are Admin/SuperAdmin-gated.
class DistrictAdminDashboardApi {
  DistrictAdminDashboardApi();

  final ApiClient _api = ApiClient();
  static const String _base = '/api/mobile/district-admin-dashboard';

  Map<String, dynamic> _qp(int districtId, int? yearId) => {
        if (districtId > 0) 'districtId': districtId,
        if (yearId != null && yearId > 0) 'yearId': yearId,
      };

  Future<Map<String, dynamic>> _get(
    String path,
    int districtId,
    int? yearId,
  ) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/$path',
      queryParams: _qp(districtId, yearId),
    );
    return res.data ?? const <String, dynamic>{};
  }

  Future<DistrictAdminOverview> getOverview(int districtId,
          {int? yearId}) async =>
      DistrictAdminOverview.fromJson(await _get('overview', districtId, yearId));

  Future<DistrictAdminMembership> getMembership(int districtId,
          {int? yearId}) async =>
      DistrictAdminMembership.fromJson(
          await _get('membership', districtId, yearId));

  Future<DistrictAdminFoundation> getFoundation(int districtId,
          {int? yearId}) async =>
      DistrictAdminFoundation.fromJson(
          await _get('foundation', districtId, yearId));

  Future<DistrictAdminCommunication> getCommunication(int districtId,
          {int? yearId}) async =>
      DistrictAdminCommunication.fromJson(
          await _get('communication', districtId, yearId));

  // ── Membership goal editor (GET/POST /membership-goal) + rotary years ──

  /// All rotary years (`/api/rotary-years`) — for the goal editor's year picker.
  Future<List<RotaryYearLite>> getRotaryYears() async {
    final res = await _api.get<dynamic>('/api/rotary-years', fromJson: (j) => j);
    final list = res.data;
    if (list is! List) return const <RotaryYearLite>[];
    return list
        .whereType<Map>()
        .map((e) => RotaryYearLite.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// Existing membership goal for (district, year) — null when no row is set.
  Future<DistrictMembershipGoal?> getMembershipGoal(int districtId,
      {int? yearId}) async {
    final res = await _api.get<dynamic>(
      '$_base/membership-goal',
      queryParams: _qp(districtId, yearId),
      fromJson: (j) => j,
    );
    final d = res.data;
    return d is Map
        ? DistrictMembershipGoal.fromJson(d.cast<String, dynamic>())
        : null;
  }

  /// Upsert the membership goal (POST /membership-goal). Throws on 400/403.
  Future<DistrictMembershipGoal> upsertMembershipGoal(
      DistrictMembershipGoal goal) async {
    final res = await _api.post<dynamic>(
      '$_base/membership-goal',
      body: goal.toJson(),
      fromJson: (j) => j,
    );
    final d = res.data;
    return d is Map
        ? DistrictMembershipGoal.fromJson(d.cast<String, dynamic>())
        : goal;
  }

  /// Existing foundation goal for (district, year) — null when no row is set.
  Future<DistrictFoundationGoal?> getFoundationGoal(int districtId,
      {int? yearId}) async {
    final res = await _api.get<dynamic>(
      '$_base/foundation-goal',
      queryParams: _qp(districtId, yearId),
      fromJson: (j) => j,
    );
    final d = res.data;
    return d is Map
        ? DistrictFoundationGoal.fromJson(d.cast<String, dynamic>())
        : null;
  }

  /// Upsert the foundation goal (POST /foundation-goal). Targets are USD.
  /// Throws on 400/403.
  Future<DistrictFoundationGoal> upsertFoundationGoal(
      DistrictFoundationGoal goal) async {
    final res = await _api.post<dynamic>(
      '$_base/foundation-goal',
      body: goal.toJson(),
      fromJson: (j) => j,
    );
    final d = res.data;
    return d is Map
        ? DistrictFoundationGoal.fromJson(d.cast<String, dynamic>())
        : goal;
  }

  // ── Project targets per avenue (GET data via /overview, save via /project-targets) ──

  /// All `module_master` entries (`/api/modules`) — to resolve each avenue's
  /// `moduleKey` to its module id for saving per-avenue project targets.
  Future<List<ModuleLite>> getModules() async {
    final res = await _api.get<dynamic>('/api/modules', fromJson: (j) => j);
    final list = res.data;
    if (list is! List) return const <ModuleLite>[];
    return list
        .whereType<Map>()
        .map((e) => ModuleLite.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// Bulk-upsert per-avenue project count targets (POST /project-targets).
  /// `targets` is a list of `{fkModuleId, targetCount}`. Throws on 400/403.
  Future<void> saveProjectTargets({
    required int districtId,
    required int yearId,
    required List<Map<String, int>> targets,
  }) async {
    await _api.post<dynamic>(
      '$_base/project-targets',
      body: {
        'districtId': districtId,
        'yearId': yearId,
        'targets': targets,
      },
      fromJson: (j) => j,
    );
  }

  Future<DistrictAdminEGovernance> getEGovernance(int districtId,
          {int? yearId}) async =>
      DistrictAdminEGovernance.fromJson(
          await _get('egovernance', districtId, yearId));

  /// The real 12-month-per-club CMR grid. The main `/egovernance` response ships
  /// this list empty (dead-code); this dedicated endpoint is the populated source.
  Future<DistrictAdminCmrPerClubGrid> getEGovernancePerClub(int districtId,
          {int? yearId}) async =>
      DistrictAdminCmrPerClubGrid.fromJson(
          await _get('egovernance/per-club', districtId, yearId));

  /// Paged + searchable member directory (`/members`). The Membership tab's
  /// directory wires to this even though the web console currently renders it
  /// as "Pending" — the endpoint returns real rows.
  Future<DaDirectoryPage> getMembers(
    int districtId, {
    int? yearId,
    int page = 1,
    int pageSize = 20,
    String? search,
  }) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/members',
      queryParams: {
        if (districtId > 0) 'districtId': districtId,
        if (yearId != null && yearId > 0) 'yearId': yearId,
        'page': page,
        'pageSize': pageSize,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      },
    );
    return DaDirectoryPage.fromJson(res.data ?? const <String, dynamic>{});
  }

  // ── Rotary Network ─────────────────────────────────────────────────────────
  // These endpoints live on the NON-mobile controller (`/api/district-admin-
  // dashboard/rotary-network*`), which the mobile twin doesn't proxy. Same
  // Admin-role JWT auth the app already uses, so calling them directly is fine.
  static const String _webBase = '/api/district-admin-dashboard';

  /// Persisted/cached network (terminated + potential + club options). Pass
  /// [clubId] to scope to one club; omit for the whole district.
  Future<DaRotaryNetwork> getRotaryNetwork(
    int districtId, {
    int? yearId,
    int? clubId,
    String? search,
  }) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_webBase/rotary-network',
      queryParams: {
        if (districtId > 0) 'districtId': districtId,
        if (yearId != null && yearId > 0) 'yearId': yearId,
        if (clubId != null && clubId > 0) 'clubId': clubId,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      },
    );
    return DaRotaryNetwork.fromJson(res.data ?? const <String, dynamic>{});
  }

  /// Live Rotary.org terminated members for ONE club (fast path). Never cached.
  Future<DaLiveTerminated> getLiveTerminated(int districtId, int clubId) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_webBase/rotary-network/live-terminated',
      queryParams: {
        if (districtId > 0) 'districtId': districtId,
        if (clubId > 0) 'clubId': clubId,
      },
    );
    return DaLiveTerminated.fromJson(res.data ?? const <String, dynamic>{});
  }

  /// Start (or report the already-running) district-wide terminated-cache warm.
  /// (post() doesn't take query params, so the districtId is on the path.)
  Future<DaRefreshStatus> startTerminatedRefresh(int districtId) async {
    final q = districtId > 0 ? '?districtId=$districtId' : '';
    final res = await _api.post<Map<String, dynamic>>(
      '$_webBase/rotary-network/refresh-terminated-cache/start$q',
    );
    return DaRefreshStatus.fromJson(res.data ?? const <String, dynamic>{});
  }

  /// Poll the latest terminated-cache refresh job status for the district.
  Future<DaRefreshStatus> getTerminatedRefreshStatus(int districtId) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_webBase/rotary-network/refresh-terminated-cache/status',
      queryParams: {if (districtId > 0) 'districtId': districtId},
    );
    return DaRefreshStatus.fromJson(res.data ?? const <String, dynamic>{});
  }
}
