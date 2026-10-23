import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../../data/models/goal_setting_models.dart';

/// Mobile Goal Setting: the club/district goal ENTRY form used by Club and
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
}
