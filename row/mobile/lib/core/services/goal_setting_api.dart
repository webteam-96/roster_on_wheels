import 'dart:typed_data';

import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../../data/models/goal_setting_models.dart';

/// Mobile Goal Setting — both the oversight surface (matrix + zone messaging +
/// bulk-lock) for the goal oversight roles (RI Director / Zone Co-ordinator /
/// District Assistant) AND the club/district goal ENTRY form used by Club and
/// District Admins to set their own targets. Reuses the same backend service as
/// the web via the mobile twin controller (`api/mobile/goal-setting`), which
/// gates entry on ordinary admin roles (not SuperAdmin), so a club/district
/// admin's mobile login can load and save these directly.
class GoalSettingApi {
  final ApiClient _api = ApiClient();

  /// All goal categories (Membership / TRF / Youth Service / Public Image …).
  Future<List<GoalCategory>> getCategories() async {
    final res = await _api.get<dynamic>(ApiConstants.goalCategories, fromJson: (j) => j);
    final list = res.data;
    if (list is! List) return const <GoalCategory>[];
    return list
        .whereType<Map>()
        .map((e) => GoalCategory.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// The caller's own oversight assignments. Empty = no oversight access
  /// (the screen shows the "no access" state, mirroring web).
  Future<List<GoalMyAssignment>> getMyAssignments() async {
    final res = await _api.get<dynamic>(ApiConstants.goalMyAssignments, fromJson: (j) => j);
    final list = res.data;
    if (list is! List) return const <GoalMyAssignment>[];
    return list
        .whereType<Map>()
        .map((e) => GoalMyAssignment.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// Districts in the caller's scope for one category + year.
  Future<List<GoalDistrictSummary>> getScopedDistricts(int categoryId, int yearId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.goalScopedDistricts(categoryId, yearId),
      fromJson: (j) => j,
    );
    final list = res.data;
    if (list is! List) return const <GoalDistrictSummary>[];
    return list
        .whereType<Map>()
        .map((e) => GoalDistrictSummary.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// District overview matrix for one zone + year: districts as ROWS with EVERY
  /// category the caller oversees laid out horizontally (baseline · Target ·
  /// Achieved · Percentage per metric), plus a summed TOTAL row.
  ///
  /// Not keyed by category — the server returns the caller's whole overseen set
  /// (RI Director = all four; a ZC/DA = their single category). Scope is
  /// enforced per-member server-side.
  Future<GoalDistrictSummaryMatrix?> getDistrictSummaryMatrix(
      int zoneId, int yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalDistrictSummaryMatrix(zoneId, yearId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalDistrictSummaryMatrix.fromJson(data);
  }

  // ── Oversight DRILL-DOWN (read only): district → clubs → one club ───────
  // The oversight roles browse someone else's goals here. Scope is enforced
  // server-side per member, so a district/club outside the caller's assignment
  // comes back 403 and the screen surfaces the server's message.

  /// One in-scope district's goal form for a category + year (read only).
  Future<GoalCategoryForm?> getScopedDistrictForm(
      int categoryId, int districtId, int yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalScopedDistrictForm(categoryId, districtId, yearId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalCategoryForm.fromJson(data);
  }

  /// Clubs of one in-scope district, for the Club picker.
  Future<List<GoalClubSummary>> getScopedDistrictClubs(
      int categoryId, int yearId, int districtId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.goalScopedDistrictClubs(categoryId, yearId, districtId),
      fromJson: (j) => j,
    );
    final list = res.data;
    if (list is! List) return const <GoalClubSummary>[];
    return list
        .whereType<Map>()
        .map((e) => GoalClubSummary.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// One in-scope club's goal form for a category + year (read only).
  Future<GoalCategoryForm?> getScopedClubForm(
      int categoryId, int yearId, int clubId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalScopedClubForm(categoryId, yearId, clubId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalCategoryForm.fromJson(data);
  }

  // ── Excel goal reports (all categories: YTD + Month-wise sheets) ─────────

  Future<Uint8List> downloadZoneReport(int zoneId, int yearId) =>
      _api.downloadBytes(ApiConstants.goalZoneReport(zoneId),
          queryParams: {'yearId': yearId});

  Future<Uint8List> downloadDistrictReport(int districtId, int yearId) =>
      _api.downloadBytes(ApiConstants.goalDistrictReport(districtId),
          queryParams: {'yearId': yearId});

  Future<Uint8List> downloadClubReport(int clubId, int yearId) =>
      _api.downloadBytes(ApiConstants.goalClubReport(clubId),
          queryParams: {'yearId': yearId});

  /// The per-row download from the oversight matrix: one district's
  /// "District Goal Setting" workbook — the SAME file its own district admin
  /// gets. Deliberately a different endpoint from [downloadDistrictReport].
  Future<Uint8List> downloadDistrictSettingReport(int districtId, int yearId) =>
      _api.downloadBytes(ApiConstants.goalDistrictSettingReport(districtId),
          queryParams: {'yearId': yearId});

  // ── "View clubs": one district's clubs, read-only (oversight-scoped) ──────

  /// Every club of [districtId] for one category: the goal columns plus each
  /// club's RAG band and active-member count.
  Future<GoalClubMatrix?> getScopedClubsMatrix(
      int categoryId, int districtId, int yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalScopedClubsMatrix(categoryId, districtId, yearId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalClubMatrix.fromJson(data);
  }

  /// The same clubs month by month, for one metric at a time.
  Future<GoalClubMonthlyMatrix?> getScopedClubsMonthlyMatrix(
      int categoryId, int districtId, int yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalScopedClubsMonthlyMatrix(categoryId, districtId, yearId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalClubMonthlyMatrix.fromJson(data);
  }

  /// Every club of the district in one workbook. Can be slow on a big
  /// district, hence the long timeout web also uses.
  Future<Uint8List> downloadScopedAllClubsReport(int districtId, int yearId) =>
      _api.downloadBytes(
        ApiConstants.goalScopedAllClubsReport(districtId),
        queryParams: {'districtId': districtId, 'yearId': yearId},
      );

  /// One district's month-wise collection for a category. Returns null when the
  /// server has nothing for it (404) — a category with no monthly data is a
  /// normal state, not an error, so the caller shows a note per category.
  Future<GoalMonthlyForm?> getScopedDistrictMonthly(
      int categoryId, int districtId, int yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalScopedDistrictMonthly(categoryId, districtId, yearId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalMonthlyForm.fromJson(data);
  }

  /// Bulk lock/unlock all the caller's zones × categories for the year.
  Future<GoalBulkLockResult> bulkLock({required int yearId, required bool locked}) async {
    final res = await _api.post<Map<String, dynamic>>(
      ApiConstants.goalScopedBulkLock,
      body: {'yearId': yearId, 'categoryIds': null, 'zoneIds': null, 'locked': locked},
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    if (!res.isSuccess || res.data == null) {
      throw Exception(res.error ?? 'Bulk lock failed.');
    }
    return GoalBulkLockResult.fromJson(res.data!);
  }

  /// Zone thread list for one (category, zone, year). RI Director / SuperAdmin
  /// see a box per ZC/DA; a ZC/DA sees their single own box.
  /// Is there a message in this zone the caller hasn't seen? Drives the red dot.
  /// Any failure reads as "no" — a broken badge must never look like unread mail.
  Future<bool> hasUnreadZoneMessages(int zoneId, int yearId) async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.goalMessagesHasUnread(zoneId, yearId),
        fromJson: (j) => (j as Map).cast<String, dynamic>(),
      );
      return res.data?['hasUnread'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Clears the dot for this (zone, year). Fire-and-forget: failing to mark
  /// seen just means the dot returns, which is the safe direction.
  Future<void> markZoneMessagesSeen(int zoneId, int yearId) async {
    try {
      await _api.post<void>(ApiConstants.goalMessagesMarkSeen(zoneId, yearId));
    } catch (_) {
      // ignored on purpose — see above
    }
  }

  /// Every Zone Co-ordinator / District Assistant of the zone, with how many
  /// messages each has sent. 0 for either filter means "all".
  Future<List<GoalMessageOwner>> getMessageRoster(
    int zoneId,
    int yearId, {
    int categoryId = 0,
    int districtId = 0,
  }) async {
    final res = await _api.get<List<dynamic>>(
      ApiConstants.goalMessageRoster(zoneId, yearId, categoryId, districtId),
      fromJson: (j) => j as List<dynamic>,
    );
    return (res.data ?? const [])
        .whereType<Map>()
        .map((e) => GoalMessageOwner.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// Excel of every message matching the same filters.
  Future<Uint8List> downloadMessagesReport(
    int zoneId,
    int yearId, {
    int categoryId = 0,
    int districtId = 0,
  }) =>
      _api.downloadBytes(ApiConstants.goalMessagesReport, queryParams: {
        'zoneId': zoneId,
        'yearId': yearId,
        'categoryId': categoryId,
        'districtId': districtId,
      });

  Future<GoalThreadList> getZoneThreadList(int categoryId, int zoneId, int yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalZoneThreadList(categoryId, zoneId, yearId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null
        ? const GoalThreadList(viewerRole: 'None', threads: [])
        : GoalThreadList.fromJson(data);
  }

  /// Messages of one owner's thread for (category, year).
  Future<List<GoalComment>> getOwnerThreadMessages(int categoryId, int yearId, int ownerMemberId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.goalOwnerThread(categoryId, ownerMemberId, yearId),
      fromJson: (j) => j,
    );
    final list = res.data;
    if (list is! List) return const <GoalComment>[];
    return list
        .whereType<Map>()
        .map((e) => GoalComment.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// Post a message into one owner's thread.
  Future<GoalComment> postOwnerThreadMessage(
      int categoryId, int yearId, int ownerMemberId, String text) async {
    final res = await _api.post<Map<String, dynamic>>(
      ApiConstants.goalOwnerThread(categoryId, ownerMemberId, yearId),
      body: {'commentText': text},
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    if (!res.isSuccess || res.data == null) {
      throw Exception(res.error ?? 'Failed to send message.');
    }
    return GoalComment.fromJson(res.data!);
  }

  // ── Goal ENTRY: club ────────────────────────────────────────────────────

  /// Load one category's club goal form (metadata + current values). Returns
  /// null when the caller has no club-admin assignment (backend 404).
  Future<GoalCategoryForm?> getClubGoalForm(int categoryId,
      {int? yearId, int? clubId}) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalClubForm(categoryId, yearId: yearId, clubId: clubId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalCategoryForm.fromJson(data);
  }

  /// Save one category's club goals; returns the refreshed form.
  Future<GoalCategoryForm> saveClubGoalForm(
      int categoryId, SaveGoalEntriesRequest body, {int? clubId}) async {
    final res = await _api.post<Map<String, dynamic>>(
      ApiConstants.goalClubSave(categoryId, clubId: clubId),
      body: body.toJson(),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    if (!res.isSuccess || res.data == null) {
      throw Exception(res.error ?? 'Failed to save goals.');
    }
    return GoalCategoryForm.fromJson(res.data!);
  }

  /// Lock/unlock one category's club goals for the year; returns the new status.
  Future<GoalLockStatus> setClubLock(
      int categoryId, int yearId, int clubId, bool locked) async {
    final res = await _api.post<Map<String, dynamic>>(
      ApiConstants.goalClubLock(categoryId, yearId, clubId, locked),
      body: const {},
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    if (!res.isSuccess || res.data == null) {
      throw Exception(res.error ?? 'Failed to update lock.');
    }
    return GoalLockStatus.fromJson(res.data!);
  }

  // ── Goal ENTRY: district ────────────────────────────────────────────────

  /// Load one category's district goal form. Null when no district-admin
  /// assignment (backend 404).
  Future<GoalCategoryForm?> getDistrictGoalForm(int categoryId,
      {int? yearId, int? districtId}) async {
    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.goalDistrictForm(categoryId,
          yearId: yearId, districtId: districtId),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = res.data;
    return data == null ? null : GoalCategoryForm.fromJson(data);
  }

  /// Save one category's district goals; returns the refreshed form.
  Future<GoalCategoryForm> saveDistrictGoalForm(
      int categoryId, SaveGoalEntriesRequest body, {int? districtId}) async {
    final res = await _api.post<Map<String, dynamic>>(
      ApiConstants.goalDistrictSave(categoryId, districtId: districtId),
      body: body.toJson(),
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    if (!res.isSuccess || res.data == null) {
      throw Exception(res.error ?? 'Failed to save goals.');
    }
    return GoalCategoryForm.fromJson(res.data!);
  }

  /// Lock/unlock one category's district goals for the year.
  Future<GoalLockStatus> setDistrictLock(
      int categoryId, int yearId, int districtId, bool locked) async {
    final res = await _api.post<Map<String, dynamic>>(
      ApiConstants.goalDistrictLock(categoryId, yearId, districtId, locked),
      body: const {},
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    if (!res.isSuccess || res.data == null) {
      throw Exception(res.error ?? 'Failed to update lock.');
    }
    return GoalLockStatus.fromJson(res.data!);
  }
}
