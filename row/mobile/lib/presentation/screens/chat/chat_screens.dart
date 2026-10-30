import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/network/api_response.dart';
import '../../../core/services/chat_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The member's chats, newest activity first (feature `chat`).
class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key, this.api});
  final ChatApi? api;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  late final ChatApi _api = widget.api ?? ChatApi();
  List<Map<String, dynamic>>? _chats;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final chats = await _api.conversations();
      if (mounted) setState(() => _chats = chats);
    } catch (_) {
      if (mounted) setState(() => _chats = const []);
    }
  }

  Future<void> _open(int id, String title) async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ChatScreen(conversationId: id, title: title, me: context.read<AuthProvider>().memberId, api: _api)));
    _load();
  }

  Future<void> _newChat() async {
    final group = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('Chat with a member'),
              onTap: () => Navigator.pop(ctx, false)),
          ListTile(
              leading: const Icon(Icons.groups_outlined),
              title: const Text('New group'),
              onTap: () => Navigator.pop(ctx, true)),
        ]),
      ),
    );
    if (group == null || !mounted) return;
    final picked = await Navigator.of(context).push<_Picked>(
        MaterialPageRoute(builder: (_) => _PickMemberScreen(group: group)));
    if (picked == null || !mounted) return;
    try {
      final id = group
          ? await _api.createGroup(picked.clubId, picked.title, picked.members.keys.toList())
          : await _api.openDirect(picked.clubId, picked.members.keys.first);
      if (id != null && mounted) _open(id, group ? picked.title : picked.members.values.first);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final chats = _chats;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Chat'),
      floatingActionButton: FloatingActionButton(
        onPressed: _newChat,
        tooltip: 'New chat',
        child: const Icon(Icons.edit_outlined),
      ),
      body: chats == null
          ? const LoadingWidget()
          : chats.isEmpty
              ? const EmptyStateWidget(
                  icon: Icons.chat_bubble_outline,
                  title: 'No chats yet',
                  subtitle: 'Start a chat with a member of your club.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
  padding: const EdgeInsets.only(bottom: 88),
                    itemCount: chats.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final c = chats[i];
                      final title = (c['title'] as String?)?.trim().isNotEmpty == true ? c['title'] as String : 'Chat';
                      final unread = c['unread'] as int? ?? 0;
                      return ListTile(
                        leading: CircleAvatar(child: Icon(c['kind'] == 'group' ? Icons.groups_outlined : Icons.person_outline)),
                        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text(c['lastHidden'] == true ? 'Message hidden' : (c['lastBody'] as String? ?? ''),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: unread > 0 ? Badge(label: Text('$unread')) : null,
                        onTap: () => _open(c['id'] as int, title),
                      );
                    },
                  ),
                ),
    );
  }
}

/// One conversation. While open it asks for newer messages every 5 seconds.
class ChatScreen extends StatefulWidget {
  const ChatScreen(
      {super.key, required this.conversationId, required this.title, required this.me, this.api, this.pollEvery});
  final int conversationId;
  final String title;
  /// The signed-in member, whose messages sit on the right.
  final int me;
  final ChatApi? api;
  final Duration? pollEvery;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late final ChatApi _api = widget.api ?? ChatApi();
  final _messages = <Map<String, dynamic>>[];
  final _input = TextEditingController();
  Timer? _poll;
  bool _loaded = false;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _fetch();
    _poll = Timer.periodic(widget.pollEvery ?? const Duration(seconds: 5), (_) => _fetch());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  int? get _lastId => _messages.isEmpty ? null : _messages.last['id'] as int;

  Future<void> _fetch() async {
    try {
      final fresh = await _api.messages(widget.conversationId, after: _lastId);
      if (!mounted) return;
      final known = _messages.map((m) => m['id']).toSet();
      setState(() {
        _messages.addAll(fresh.where((m) => !known.contains(m['id'])));
        _loaded = true;
      });
      if (fresh.isNotEmpty) _api.markRead(widget.conversationId, _lastId!).catchError((_) {});
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      // The client key makes a retried send land once.
      await _api.send(widget.conversationId, text, '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 30)}');
      _input.clear();
      await _fetch();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _report(Map<String, dynamic> m) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Report message'),
        content: TextField(controller: reason, decoration: const InputDecoration(hintText: 'Why? (optional)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Report')),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (ok != true || !mounted) return;
    try {
      await _api.report(m['id'] as int, text);
      if (mounted) SnackbarUtils.showSuccess(context, 'Reported to the club admins');
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return Scaffold(
      appBar: CustomAppBar(title: widget.title),
      body: Column(
        children: [
          Expanded(
            child: !_loaded
                ? const LoadingWidget()
                : ListView.builder(
                    reverse: true,
                    padding: (const EdgeInsets.all(12)).add(const EdgeInsets.only(bottom: 88)),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) {
                      final m = _messages[_messages.length - 1 - i];
                      final mine = m['senderId'] == me;
                      final hidden = m['hidden'] == true;
                      return Align(
                        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                        child: GestureDetector(
                          onLongPress: mine || hidden ? null : () => _report(m),
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                            decoration: BoxDecoration(
                              color: mine
                                  ? Theme.of(context).colorScheme.primaryContainer
                                  : Theme.of(context).colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (!mine)
                                  Text(m['senderName'] as String? ?? '',
                                      style: Theme.of(context).textTheme.labelSmall),
                                Text(hidden ? 'This message was hidden by a moderator.' : (m['body'] as String? ?? ''),
                                    style: hidden ? const TextStyle(fontStyle: FontStyle.italic) : null),
                                Text(DateFormatter.toDisplayWithTime(
                                        DateTime.tryParse(m['createdAt']?.toString() ?? '')?.toLocal()),
                                    style: Theme.of(context).textTheme.labelSmall),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: const InputDecoration(hintText: 'Message', border: OutlineInputBorder()),
                    ),
                  ),
                  IconButton(
                    onPressed: _sending ? null : _send,
                    tooltip: 'Send',
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The club and the chosen members (id to name); [title] names a group.
typedef _Picked = ({int clubId, Map<int, String> members, String title});

/// Picks one member of one of the member's clubs for a direct chat, or several plus a name for a group.
class _PickMemberScreen extends StatefulWidget {
  const _PickMemberScreen({this.group = false});
  final bool group;

  @override
  State<_PickMemberScreen> createState() => _PickMemberScreenState();
}

class _PickMemberScreenState extends State<_PickMemberScreen> {
  final _api = ApiClient();
  final _search = TextEditingController();
  final _title = TextEditingController();
  final _chosen = <int, String>{};
  int? _clubId;
  List<Map<String, dynamic>>? _members;

  @override
  void initState() {
    super.initState();
    final clubs = context.read<AuthProvider>().memberClubIds;
    if (clubs.isNotEmpty) {
      _clubId = clubs.first;
      _load();
    } else {
      _members = const [];
    }
  }

  @override
  void dispose() {
    _search.dispose();
    _title.dispose();
    super.dispose();
  }

  void _done() {
    if (_title.text.trim().isEmpty || _chosen.isEmpty) {
      SnackbarUtils.showError(context, 'Name the group and choose at least one member.');
      return;
    }
    Navigator.pop<_Picked>(context, (clubId: _clubId!, members: Map.of(_chosen), title: _title.text.trim()));
  }

  Future<void> _load() async {
    setState(() => _members = null);
    try {
      final resp = await _api.get<Map<String, dynamic>>('/api/clubs/$_clubId/members',
          queryParams: {'page': 1, 'pageSize': 50, if (_search.text.trim().isNotEmpty) 'search': _search.text.trim()},
          fromJson: (j) => j as Map<String, dynamic>);
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _members = paged.items);
    } catch (_) {
      if (mounted) setState(() => _members = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final clubs = auth.memberClubIds.toSet().toList();
    final members = _members?.where((m) => m['id'] != auth.memberId).toList();
    return Scaffold(
      appBar: CustomAppBar(title: widget.group ? 'New group' : 'New chat'),
      floatingActionButton: widget.group
          ? FloatingActionButton.extended(
              onPressed: _done, icon: const Icon(Icons.check), label: Text('Create (${_chosen.length})'))
          : null,
      body: Column(
        children: [
          if (widget.group)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: TextField(
                controller: _title,
                maxLength: 100,
                decoration: const InputDecoration(labelText: 'Group name', border: OutlineInputBorder()),
              ),
            ),
          if (clubs.length > 1)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: DropdownButtonFormField<int>(
                initialValue: _clubId,
                decoration: const InputDecoration(labelText: 'Club', border: OutlineInputBorder()),
                items: [for (final id in clubs) DropdownMenuItem(value: id, child: Text(auth.clubNameOf(id) ?? 'Club $id'))],
                onChanged: (v) {
                  _clubId = v;
                  _chosen.clear(); // a group belongs to one club
                  _load();
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _search,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _load(),
              decoration: const InputDecoration(
                  hintText: 'Search members', prefixIcon: Icon(Icons.search), border: OutlineInputBorder()),
            ),
          ),
          Expanded(
            child: members == null
                ? const LoadingWidget()
                : members.isEmpty
                    ? const EmptyStateWidget(icon: Icons.person_search_outlined, title: 'No members found', subtitle: '')
                    : ListView.builder(
  padding: const EdgeInsets.only(bottom: 88),
                        itemCount: members.length,
                        itemBuilder: (_, i) {
                          final m = members[i];
                          final name = m['memberName'] as String? ?? '';
                          final id = m['id'] as int;
                          if (widget.group) {
                            return CheckboxListTile(
                              value: _chosen.containsKey(id),
                              title: Text(name),
                              onChanged: (on) => setState(() => on == true ? _chosen[id] = name : _chosen.remove(id)),
                            );
                          }
                          return ListTile(
                            leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                            title: Text(name),
                            onTap: () => Navigator.pop<_Picked>(context, (clubId: _clubId!, members: {id: name}, title: '')),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
