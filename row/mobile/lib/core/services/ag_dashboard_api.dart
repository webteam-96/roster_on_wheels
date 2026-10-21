import '../network/api_client.dart';
import '../../data/models/ag_dashboard_models.dart';

/// Thin client for the mobile AG (Assistant Governor) Dashboard endpoints
/// (`api/mobile/ag-dashboard/*`).
///
/// The acting AG is taken from the JWT (the server resolves the AG's assigned
/// clubs); endpoints are AG-gated (a non-AG caller gets 403). `yearId` /
/// `districtId` are optional — the server defaults the year, and `districtId`
/// scopes a multi-district AG to one district.
class AgDashboardApi {
  AgDashboardApi();

  final ApiClient _api = ApiClient();
  static const String _base = '/api/mobile/ag-dashboard';

  Map<String, dynamic> _qp(int? yearId, int? districtId, int? clubId) => {
        if (yearId != null && yearId > 0) 'yearId': yearId,
        if (districtId != null && districtId > 0) 'districtId': districtId,
        if (clubId != null && clubId > 0) 'clubId': clubId,
      };

  Future<Map<String, dynamic>> _get(
    String path, {
    int? yearId,
    int? districtId,
    int? clubId,
  }) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/$path',
      queryParams: _qp(yearId, districtId, clubId),
    );
    return res.data ?? const <String, dynamic>{};
  }

  /// Years the AG holds a `district_ag` assignment for (topbar picker). Never
  /// the whole district's years. `districtId` scopes a multi-district AG.
  Future<AgAvailableYears> getAvailableYears({int? districtId}) async =>
      AgAvailableYears.fromJson(
          await _get('available-years', districtId: districtId));

  Future<AgClubsResponse> getClubs({int? yearId, int? districtId}) async =>
      AgClubsResponse.fromJson(
          await _get('clubs', yearId: yearId, districtId: districtId));

  /// Full detail + photos for one project (projects drill-down). `yearId` picks
  /// the year table — pass the row's own `yearId`. Server 404s (→ throws) when
  /// the project isn't in one of this AG's clubs.
  Future<AgProjectDetail> getProjectDetail(int projectId,
          {int? yearId, int? districtId}) async =>
      AgProjectDetail.fromJson(await _get('projects/$projectId',
          yearId: yearId, districtId: districtId));

  Future<AgClubDetail> getClubDetail(int clubId, {int? yearId}) async =>
      AgClubDetail.fromJson(await _get('clubs/$clubId', yearId: yearId));

  Future<AgMembershipResponse> getMembership(
          {int? yearId, int? districtId}) async =>
      AgMembershipResponse.fromJson(
          await _get('membership', yearId: yearId, districtId: districtId));

  Future<AgTrfResponse> getTrf({int? yearId, int? districtId}) async =>
      AgTrfResponse.fromJson(
          await _get('trf', yearId: yearId, districtId: districtId));

  Future<AgExcellenceResponse> getExcellence(
          {int? yearId, int? districtId}) async =>
      AgExcellenceResponse.fromJson(
          await _get('excellence', yearId: yearId, districtId: districtId));

  Future<AgYouthResponse> getYouth({int? yearId, int? districtId}) async =>
      AgYouthResponse.fromJson(
          await _get('youth', yearId: yearId, districtId: districtId));

  Future<AgProjectsResponse> getProjects({int? yearId, int? districtId}) async =>
      AgProjectsResponse.fromJson(
          await _get('projects', yearId: yearId, districtId: districtId));

  Future<AgDistrictResponse> getDistrict({int? yearId, int? districtId}) async =>
      AgDistrictResponse.fromJson(
          await _get('district', yearId: yearId, districtId: districtId));
}
