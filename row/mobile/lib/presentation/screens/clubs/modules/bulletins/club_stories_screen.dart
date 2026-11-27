import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

const _statusLabel = {
  'Pending': 'Waiting for review',
  'ChangesRequested': 'Changes requested',
  'Approved': 'Approved',
  'Rejected': 'Rejected',
};

/// Club stories (gap #6, `api/club-stories/{clubId}`). Members send a story and follow its review; a story sent back
/// for changes can be edited and sent again. Editors (club managers, the Public Image or Bulletin Editor office) see
/// every story and approve, reject or ask for changes. Approved stories can go into a bulletin and on the website.
class ClubStoriesScreen extends StatefulWidget {
  const ClubStoriesScreen({super.key, required this.clubId, this.embedded = false});
  final int clubId;
  final bool embedded;

  @override
  State<ClubStoriesScreen> createState() => _ClubStoriesScreenState();
}

class _ClubStoriesScreenState extends State<ClubStoriesScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _items;
  bool _canReview = false;
  String? _error;

  String get _base => '/api/club-stories/${widget.clubId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await _api.get<Map<String, dynamic>>(_base, fromJson: (j) => j as Map<String, dynamic>);
      if (!mounted) return;
      setState(() {
        _canReview = res.data?['canReview'] == true;
        _items = ((res.data?['items'] as List<dynamic>?) ?? const []).cast<Map<String, dynamic>>();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _write([Map<String, dynamic>? story]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _StoryForm(base: _base, api: _api, story: story),
    );
    if (saved == true) _load();
  }

  Future<void> _review(Map<String, dynamic> story) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ReviewForm(base: _base, api: _api, story: story),
    );
    if (done == true) _load();
  }

  Widget _tile(Map<String, dynamic> s) {
    final status = s['status'] as String? ?? '';
    // Members edit their own waiting or sent-back stories; editors review waiting ones and may edit a sent-back
    // story (the API allows only its author).
    final canEdit = _canReview ? status == 'ChangesRequested' : (status == 'Pending' || status == 'ChangesRequested');
    final note = s['reviewNote'] as String?;
    return ListTile(
      title: Text(s['title'] as String? ?? ''),
      subtitle: Text([
        _statusLabel[status] ?? status,
        if (_canReview) s['authorName'] as String? ?? '',
        DateFormatter.toDisplay(DateTime.tryParse(s['submittedDate']?.toString() ?? '')),
        if (note != null && note.isNotEmpty) 'Note: $note',
      ].where((t) => t.isNotEmpty).join('  ·  ')),
      isThreeLine: note != null && note.isNotEmpty,
      onTap: _canReview && status == 'Pending' ? () => _review(s) : (canEdit ? () => _write(s) : null),
      trailing: _canReview && status == 'Pending'
          ? const Icon(Icons.rate_review_outlined)
          : (canEdit ? const Icon(Icons.edit_outlined) : null),
    );
  }

  Widget _body() {
    final items = _items;
    if (_error != null && items == null) {
      return EmptyStateWidget(
          icon: Icons.error_outline, title: 'Could not load stories', subtitle: _error, actionLabel: 'Try again', onAction: _load);
    }
    if (items == null) return const LoadingWidget();
    return RowRefresh(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 88),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Text(
                _canReview
                    ? 'Stories from members. Tap one that waits for review to decide.'
                    : 'Send the club a story. An editor reviews it before it goes into the bulletin or on the website.',
                style: Theme.of(context).textTheme.bodyMedium),
          ),
          if (items.isEmpty)
            const Padding(
                padding: EdgeInsets.all(24),
                child: EmptyStateWidget(
                    icon: Icons.article_outlined, title: 'No stories yet', subtitle: 'Tap the button to write one.'))
          else
            for (final s in items) ...[_tile(s), const Divider(height: 1)],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fab = FloatingActionButton.extended(
        heroTag: 'story-new', onPressed: _write, icon: const Icon(Icons.edit_note), label: const Text('Write a story'));
    if (widget.embedded) {
      return Stack(children: [_body(), Positioned(right: 16, bottom: 16, child: fab)]);
    }
    return Scaffold(appBar: const CustomAppBar(title: 'Stories'), floatingActionButton: fab, body: _body());
  }
}

class _StoryForm extends StatefulWidget {
  const _StoryForm({required this.base, required this.api, this.story});
  final String base;
  final ApiClient api;
  final Map<String, dynamic>? story;

  @override
  State<_StoryForm> createState() => _StoryFormState();
}

class _StoryFormState extends State<_StoryForm> {
  late final _title = TextEditingController(text: widget.story?['title'] as String?);
  late final _body = TextEditingController(text: widget.story?['body'] as String?);
  bool _saving = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty || _body.text.trim().isEmpty) {
      SnackbarUtils.showError(context, 'Enter a title and the story.');
      return;
    }
    setState(() => _saving = true);
    final body = {'title': _title.text.trim(), 'body': _body.text.trim()};
    try {
      final id = widget.story?['id'];
      id == null
          ? await widget.api.post<dynamic>(widget.base, body: body)
          : await widget.api.put<dynamic>('${widget.base}/$id', body: body);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration d(String label) => InputDecoration(labelText: label, border: const OutlineInputBorder());
    final note = widget.story?['reviewNote'] as String?;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.story == null ? 'Write a story' : 'Edit your story', style: Theme.of(context).textTheme.titleLarge),
            if (note != null && note.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Editor note: $note', style: Theme.of(context).textTheme.bodyMedium),
            ],
            const SizedBox(height: 12),
            TextField(controller: _title, decoration: d('Title'), maxLength: 200),
            const SizedBox(height: 8),
            TextField(controller: _body, decoration: d('Story'), maxLines: 8, maxLength: 10000),
            const SizedBox(height: 8),
            FilledButton(onPressed: _saving ? null : _save, child: const Text('Send for review')),
          ],
        ),
      ),
    );
  }
}

class _ReviewForm extends StatefulWidget {
  const _ReviewForm({required this.base, required this.api, required this.story});
  final String base;
  final ApiClient api;
  final Map<String, dynamic> story;

  @override
  State<_ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends State<_ReviewForm> {
  final _note = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _decide(String decision) async {
    if (decision != 'approve' && _note.text.trim().isEmpty) {
      SnackbarUtils.showError(context, 'Write a note so the author knows why.');
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.post<dynamic>('${widget.base}/${widget.story['id']}/review',
          body: {'decision': decision, 'note': _note.text.trim().isEmpty ? null : _note.text.trim()});
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.story;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(s['title'] as String? ?? '', style: Theme.of(context).textTheme.titleLarge),
            Text(s['authorName'] as String? ?? '', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 12),
            Text(s['body'] as String? ?? ''),
            const SizedBox(height: 16),
            TextField(
                controller: _note,
                maxLines: 3,
                maxLength: 1000,
                decoration: const InputDecoration(
                    labelText: 'Note to the author (needed to send back or reject)', border: OutlineInputBorder())),
            const SizedBox(height: 8),
            FilledButton(onPressed: _saving ? null : () => _decide('approve'), child: const Text('Approve')),
            OutlinedButton(onPressed: _saving ? null : () => _decide('changes'), child: const Text('Ask for changes')),
            TextButton(onPressed: _saving ? null : () => _decide('reject'), child: const Text('Reject')),
          ],
        ),
      ),
    );
  }
}
