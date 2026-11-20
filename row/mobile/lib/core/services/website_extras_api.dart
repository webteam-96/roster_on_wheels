import '../network/api_client.dart';

/// A club website's address and public pages (`api/clubs/{id}/website-extras`), for the member's share screen.
/// siteUrl is null when the club has no website. Errors throw ApiException with the server's message.
class WebsiteExtrasApi {
  WebsiteExtrasApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  Future<({String? siteUrl, List<({String title, String path})> pages})> clubSite(int clubId) async {
    final res = await _api.get<Map<String, dynamic>>('/api/clubs/$clubId/website-extras',
        fromJson: (j) => j as Map<String, dynamic>);
    final d = res.data ?? const {};
    final url = d['siteUrl']?.toString() ?? '';
    final pages = (d['pages'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map((p) => (title: p['title']?.toString() ?? '', path: p['path']?.toString() ?? '/'))
        .toList();
    return (siteUrl: url.isEmpty ? null : url.replaceAll(RegExp(r'/+$'), ''), pages: pages);
  }

  /// Full address of one page: the site address plus the page path (home is the bare address).
  static String pageUrl(String siteUrl, String path) => path == '/' ? siteUrl : '$siteUrl$path';
}
