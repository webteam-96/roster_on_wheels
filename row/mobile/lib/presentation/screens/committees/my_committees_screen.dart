import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/file_download_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Enhanced committees (feature `committees`): the member's club and district committees, and for each one its
/// subcommittees, members, private documents and message archive. Members can also write to the committee; the
/// message goes out by email to every member and lands in the archive. Structure and uploads are managed on the web.
class MyCommitteesScreen extends StatefulWidget {
  const MyCommitteesScreen({super.key});

  @override
  State<MyCommitteesScreen> createState() => _MyCommitteesScreenState();
}

class _MyCommitteesScreenState extends State<MyCommitteesScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _rows;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await _api.get<List<dynamic>>('/api/committees/mine', fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _rows = (res.data ?? const []).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) {
        setState(() {
          _rows = const [];
          _error = e is ApiException ? e.message : 'Could not load your committees.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Scaffold(
      appBar: const CustomAppBar(title: 'My committees'),
      body: rows == null
          ? const RowSkeletonList()
          : RowRefresh(
              onRefresh: _load,
              child: rows.isEmpty
                  ? ListView(children: [
                      EmptyStateWidget(
                        icon: _error != null ? Icons.error_outline : Icons.groups_outlined,
                        title: _error ?? 'You are not on a committee',
                        subtitle: _error != null ? 'Pull down to try again.' : 'Your club or district adds you to committees.',
                      ),
                    ])
                  : RowListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final r = rows[i];
                        final parent = r['parentName']?.toString();
                        final scope = [r['scopeName'], r['yearLabel']].where((x) => x != null && '$x'.isNotEmpty).join(', ');
                        return ListTile(
                          leading: Icon(r['kind'] == 'district' ? Icons.account_tree_outlined : Icons.groups_outlined),
                          title: Text(r['name']?.toString() ?? ''),
                          subtitle: Text(parent != null && parent.isNotEmpty ? '$scope\nUnder $parent' : scope),
                          isThreeLine: parent != null && parent.isNotEmpty,
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => CommitteeDetailScreen(kind: r['kind'] as String, id: r['id'] as int),
                          )),
                        );
                      },
                    ),
            ),
    );
  }
}

class CommitteeDetailScreen extends StatefulWidget {
  final String kind;
  final int id;
  const CommitteeDetailScreen({super.key, required this.kind, required this.id});

  @override
  State<CommitteeDetailScreen> createState() => _CommitteeDetailScreenState();
}

class _CommitteeDetailScreenState extends State<CommitteeDetailScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _detail;
  List<Map<String, dynamic>>? _docs;
  List<Map<String, dynamic>>? _messages;
  String? _error;

  String get _base => '/api/committees/${widget.kind}/${widget.id}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _api.get<Map<String, dynamic>>(_base, fromJson: (j) => j as Map<String, dynamic>),
        _api.get<List<dynamic>>('$_base/documents', fromJson: (j) => j as List<dynamic>),
        _api.get<List<dynamic>>('$_base/messages', fromJson: (j) => j as List<dynamic>),
      ]);
      if (!mounted) return;
      setState(() {
        _error = null;
        _detail = results[0].data as Map<String, dynamic>?;
        _docs = ((results[1].data as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>();
        _messages = ((results[2].data as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>();
      });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not load the committee.');
    }
  }

  Future<void> _compose() async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ComposeSheet(path: '$_base/messages'),
    );
    if (sent == true) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Message sent to the committee.')));
      }
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: CustomAppBar(title: d?['name']?.toString() ?? 'Committee'),
        floatingActionButton: d == null
            ? null
            : FloatingActionButton.extended(
                onPressed: _compose,
                icon: const Icon(Icons.mail_outline),
                label: const Text('Write to committee'),
              ),
        body: _error != null
            ? EmptyStateWidget(icon: Icons.error_outline, title: _error!, actionLabel: 'Try again', onAction: _load)
            : d == null
                ? const RowSkeletonList()
                : Column(children: [
                    _header(d),
                    const TabBar(tabs: [Tab(text: 'Documents'), Tab(text: 'Messages'), Tab(text: 'Members')]),
                    Expanded(
                      child: TabBarView(children: [_documents(), _messagesTab(), _members(d)]),
                    ),
                  ]),
      ),
    );
  }

  Widget _header(Map<String, dynamic> d) {
    final path = ((d['path'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final children = ((d['children'] as List?) ?? const []).cast<Map<String, dynamic>>();
    if (path.length < 2 && children.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (path.length > 1) Text(path.map((p) => p['name']).join(' / '), style: Theme.of(context).textTheme.bodySmall),
        if (children.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text('Subcommittees: ${children.map((c) => c['name']).join(', ')}', style: Theme.of(context).textTheme.bodySmall),
        ],
      ]),
    );
  }

  Widget _documents() {
    final docs = _docs ?? const [];
    if (docs.isEmpty) {
      return const EmptyStateWidget(icon: Icons.description_outlined, title: 'No documents yet');
    }
    return RowRefresh(
      onRefresh: _load,
      child: RowListView.separated(
        itemCount: docs.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final doc = docs[i];
          return ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(doc['title']?.toString() ?? ''),
            subtitle: Text('${doc['originalName'] ?? ''}\n'
                '${doc['uploadedByName'] ?? ''}, ${DateFormatter.toDisplay(DateTime.tryParse(doc['createdDate']?.toString() ?? '')?.toLocal())}'),
            isThreeLine: true,
            trailing: const Icon(Icons.download_outlined),
            onTap: () => downloadAndOpenServerFile(context,
                filePath: '$_base/documents/${doc['id']}/file', fileName: doc['originalName']?.toString()),
          );
        },
      ),
    );
  }

  Widget _messagesTab() {
    final rows = _messages ?? const [];
    if (rows.isEmpty) {
      return const EmptyStateWidget(icon: Icons.mail_outline, title: 'No messages yet');
    }
    return RowRefresh(
      onRefresh: _load,
      child: RowListView.separated(
        padding: const EdgeInsets.only(bottom: 88),
        itemCount: rows.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final m = rows[i];
          return ExpansionTile(
            title: Text(m['subject']?.toString() ?? ''),
            subtitle: Text('${m['sentByName'] ?? ''}, '
                '${DateFormatter.toDisplay(DateTime.tryParse(m['createdDate']?.toString() ?? '')?.toLocal())}'),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            children: [Text(m['body']?.toString() ?? '')],
          );
        },
      ),
    );
  }

  Widget _members(Map<String, dynamic> d) {
    final members = ((d['members'] as List?) ?? const []).cast<Map<String, dynamic>>();
    if (members.isEmpty) return const EmptyStateWidget(icon: Icons.people_outline, title: 'No members yet');
    return RowListView.separated(
      itemCount: members.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final m = members[i];
        final designation = m['designation']?.toString();
        return ListTile(
          leading: const Icon(Icons.person_outline),
          title: Text(m['name']?.toString() ?? ''),
          subtitle: designation != null && designation.isNotEmpty ? Text(designation) : null,
        );
      },
    );
  }
}

class _ComposeSheet extends StatefulWidget {
  final String path;
  const _ComposeSheet({required this.path});

  @override
  State<_ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<_ComposeSheet> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_subject.text.trim().isEmpty || _body.text.trim().isEmpty) {
      setState(() => _error = 'Enter a subject and a message.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ApiClient().post(widget.path, body: {'subject': _subject.text.trim(), 'body': _body.text.trim()});
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e is ApiException ? e.message : 'Could not send the message.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Write to the committee', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text('Every member of this committee gets it by email.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 12),
        TextField(controller: _subject, maxLength: 200, decoration: const InputDecoration(labelText: 'Subject')),
        TextField(controller: _body, maxLength: 20000, minLines: 4, maxLines: 8, decoration: const InputDecoration(labelText: 'Message')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _send,
          icon: const Icon(Icons.send_outlined),
          label: Text(_busy ? 'Sending' : 'Send'),
        ),
      ]),
    );
  }
}
