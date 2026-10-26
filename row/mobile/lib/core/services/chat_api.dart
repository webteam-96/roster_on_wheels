import '../network/api_client.dart';

/// Member chat (build spec 3.10, feature `chat`): `api/chat`. The app polls while a chat is open (no socket).
/// Errors throw ApiException with the server's message.
class ChatApi {
  ChatApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  Future<List<Map<String, dynamic>>> conversations() async => _list(await _api
      .get<List<dynamic>>('/api/chat/conversations', fromJson: (j) => j as List<dynamic>));

  /// Messages oldest first. [after] fetches only newer ones (polling); [before] pages back.
  Future<List<Map<String, dynamic>>> messages(int conversationId, {int? after, int? before}) async =>
      _list(await _api.get<List<dynamic>>('/api/chat/conversations/$conversationId/messages',
          queryParams: {if (after != null) 'after': after, if (before != null) 'before': before},
          fromJson: (j) => j as List<dynamic>));

  Future<Map<String, dynamic>?> send(int conversationId, String body, String clientKey) async =>
      (await _api.post<Map<String, dynamic>>('/api/chat/conversations/$conversationId/messages',
              body: {'body': body, 'clientKey': clientKey}, fromJson: (j) => j as Map<String, dynamic>))
          .data;

  Future<void> markRead(int conversationId, int messageId) =>
      _api.post<dynamic>('/api/chat/conversations/$conversationId/read', body: {'messageId': messageId});

  Future<void> report(int messageId, String reason) =>
      _api.post<dynamic>('/api/chat/messages/$messageId/report', body: {'reason': reason});

  /// Opens (or reopens) the direct chat with one member of a club; returns the conversation id.
  Future<int?> openDirect(int clubId, int memberId) async {
    final res = await _api.post<Map<String, dynamic>>('/api/chat/conversations',
        body: {'kind': 'direct', 'scope': 'club', 'ownerId': clubId, 'memberIds': [memberId]},
        fromJson: (j) => j as Map<String, dynamic>);
    return res.data?['id'] as int?;
  }

  /// Starts a group in a club with 1 to 255 other members; returns the conversation id.
  Future<int?> createGroup(int clubId, String title, List<int> memberIds) async {
    final res = await _api.post<Map<String, dynamic>>('/api/chat/conversations',
        body: {'kind': 'group', 'scope': 'club', 'ownerId': clubId, 'title': title, 'memberIds': memberIds},
        fromJson: (j) => j as Map<String, dynamic>);
    return res.data?['id'] as int?;
  }

  static List<Map<String, dynamic>> _list(dynamic res) => ((res.data as List?) ?? const []).cast<Map<String, dynamic>>();
}
