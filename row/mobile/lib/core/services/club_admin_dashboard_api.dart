import '../network/api_client.dart';
import '../../data/models/club_admin_dashboard_models.dart';

/// Thin client for the mobile Club Admin Dashboard endpoints
/// (`api/mobile/club-admin-dashboard/*`, commit 5c505d3).
///
/// The acting club admin is taken from the JWT; `clubId` is passed as a query
/// param so a multi-club admin gets the dashboard for the club they opened
/// (the server validates they are an active admin of it, else 403). `yearId`
/// is optional — the server defaults to the current rotary year.
class ClubAdminDashboardApi {
  ClubAdminDashboardApi();

  final ApiClient _api = ApiClient();
  static const String _base = '/api/mobile/club-admin-dashboard';

  Map<String, dynamic> _qp(int clubId, int? yearId) => {
        'clubId': clubId,
        if (yearId != null && yearId > 0) 'yearId': yearId,
      };

  Future<Map<String, dynamic>> _get(String path, int clubId, int? yearId) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/$path',
      queryParams: _qp(clubId, yearId),
    );
    return res.data ?? const <String, dynamic>{};
  }

  /// Years where this club has data, for the global dashboard year selector.
  /// `clubId` only — never year-scoped.
  Future<ClubAdminAvailableYears> getAvailableYears(int clubId) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/available-years',
      queryParams: {'clubId': clubId},
    );
    return ClubAdminAvailableYears.fromJson(
        res.data ?? const <String, dynamic>{});
  }

  Future<ClubAdminOverview> getOverview(int clubId, {int? yearId}) async =>
      ClubAdminOverview.fromJson(await _get('overview', clubId, yearId));

  Future<ClubAdminMembership> getMembership(int clubId, {int? yearId}) async =>
      ClubAdminMembership.fromJson(await _get('membership', clubId, yearId));

  Future<ClubAdminDirectory> getDirectory(int clubId, {int? yearId}) async =>
      ClubAdminDirectory.fromJson(await _get('dashboard-directory', clubId, yearId));

  Future<ClubAdminBod> getBod(int clubId, {int? yearId}) async =>
      ClubAdminBod.fromJson(await _get('dashboard-bod', clubId, yearId));

  Future<ClubAdminFoundation> getFoundation(int clubId, {int? yearId}) async =>
      ClubAdminFoundation.fromJson(await _get('foundation', clubId, yearId));

  Future<ServiceProjectsOverview> getServiceProjectsOverview(int clubId,
          {int? yearId}) async =>
      ServiceProjectsOverview.fromJson(
          await _get('service-projects-overview', clubId, yearId));

  Future<ServiceProjectsAvenueDetail> getServiceProjectsAvenue(
    int clubId,
    String avenueKey, {
    int? yearId,
  }) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/service-projects-avenue',
      queryParams: {
        'clubId': clubId,
        'avenueKey': avenueKey,
        if (yearId != null && yearId > 0) 'yearId': yearId,
      },
    );
    return ServiceProjectsAvenueDetail.fromJson(
        res.data ?? const <String, dynamic>{});
  }

  Future<ClubAdminEGovernance> getEGovernance(int clubId, {int? yearId}) async =>
      ClubAdminEGovernance.fromJson(await _get('egovernance', clubId, yearId));

  Future<ClubAdminCommunication> getCommunication(int clubId,
          {int? yearId}) async =>
      ClubAdminCommunication.fromJson(
          await _get('communication', clubId, yearId));

  Future<ClubAdminWebsite> getWebsite(int clubId, {int? yearId}) async =>
      ClubAdminWebsite.fromJson(await _get('website', clubId, yearId));

  Future<ClubAdminPayments> getPayments(int clubId, {int? yearId}) async =>
      ClubAdminPayments.fromJson(await _get('payments', clubId, yearId));

  Future<ClubAdminRotaryNetwork> getDashboardRotaryNetwork(int clubId,
          {int? yearId}) async =>
      ClubAdminRotaryNetwork.fromJson(
          await _get('dashboard-rotary-network', clubId, yearId));
}
