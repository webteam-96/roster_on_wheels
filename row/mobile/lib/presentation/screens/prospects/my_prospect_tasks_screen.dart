import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/prospect_task_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/row/skeleton_list.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Follow-up tasks on prospects that the club assigned to the member: who to contact, by when, and a button to
/// mark the task done with a short note on the outcome.
class MyProspectTasksScreen extends StatefulWidget {
  const MyProspectTasksScreen({super.key, this.api});
  final ProspectTaskApi? api;

  @override
  State<MyProspectTasksScreen> createState() => _MyProspectTasksScreenState();
}

class _MyProspectTasksScreenState extends State<MyProspectTasksScreen> {
  late final ProspectTaskApi _api = widget.api ?? ProspectTaskApi();
  List<Map<String, dynamic>>? _tasks;
  String? _error;
  bool _showDone = false;
  int? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final tasks = await _api.mine(status: _showDone ? 'done' : 'open');
      if (mounted) setState(() => _tasks = tasks);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load your tasks.');
    }
  }

  Future<void> _complete(Map<String, dynamic> task) async {
    final noteController = TextEditingController();
    final ok = await showRowDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Mark as done'),
        content: TextField(
          controller: noteController,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Outcome (optional)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Done')),
        ],
      ),
    );
    final note = noteController.text.trim();
    noteController.dispose();
    if (ok != true || !mounted) return;
    setState(() => _busy = task['id'] as int);
    try {
      await _api.complete(task['id'] as int, note.isEmpty ? null : note);
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Task done');
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _open(Uri uri) async {
    if (!await launchUrl(uri) && mounted) SnackbarUtils.showError(context, 'Could not open this.');
  }

  @override
  Widget build(BuildContext context) {
    final tasks = _tasks;
    Widget body;
    if (_error != null) {
      body = EmptyStateWidget(
          icon: Icons.error_outline, title: 'Something went wrong', subtitle: _error, actionLabel: 'Try again', onAction: _load);
    } else if (tasks == null) {
      body = const RowSkeletonList();
    } else if (tasks.isEmpty) {
      body = EmptyStateWidget(
          icon: Icons.checklist_rounded,
          title: _showDone ? 'No finished tasks' : 'No follow-ups for you',
          subtitle: _showDone ? null : 'When your club asks you to follow up with a prospect, it shows here.');
    } else {
      body = RowRefresh(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [for (final t in tasks) _card(t)]),
      );
    }
    return Scaffold(
      appBar: const CustomAppBar(title: 'My prospect follow-ups'),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Open')),
                ButtonSegment(value: true, label: Text('Done')),
              ],
              selected: {_showDone},
              onSelectionChanged: (s) {
                setState(() {
                  _showDone = s.first;
                  _tasks = null;
                });
                _load();
              },
            ),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _card(Map<String, dynamic> t) {
    final due = DateTime.tryParse(t['dueDate']?.toString() ?? '');
    final today = DateUtils.dateOnly(DateTime.now());
    final open = t['status'] == 'open';
    final overdue = open && due != null && due.isBefore(today);
    final email = (t['prospectEmail'] as String?)?.trim() ?? '';
    final mobile = (t['prospectMobile'] as String?)?.trim() ?? '';
    final busy = _busy == t['id'];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t['title'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 4),
            Text(t['prospectName'] as String? ?? ''),
            Text(
              [
                '${overdue ? 'Overdue' : 'Due'} ${DateFormatter.toDisplay(due)}',
                t['clubName'],
              ].whereType<String>().where((s) => s.trim().isNotEmpty).join('  ·  '),
              style: TextStyle(color: overdue ? Theme.of(context).colorScheme.error : null),
            ),
            if ((t['notes'] as String?)?.trim().isNotEmpty == true)
              Padding(padding: const EdgeInsets.only(top: 6), child: Text(t['notes'] as String)),
            if (!open && (t['completionNote'] as String?)?.trim().isNotEmpty == true)
              Padding(padding: const EdgeInsets.only(top: 6), child: Text(t['completionNote'] as String)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (mobile.isNotEmpty)
                  OutlinedButton.icon(
                      onPressed: () => _open(Uri(scheme: 'tel', path: mobile)),
                      icon: const Icon(Icons.call_outlined, size: 18),
                      label: const Text('Call')),
                if (email.isNotEmpty)
                  OutlinedButton.icon(
                      onPressed: () => _open(Uri(scheme: 'mailto', path: email)),
                      icon: const Icon(Icons.mail_outline, size: 18),
                      label: const Text('Email')),
                if (open)
                  busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : FilledButton(onPressed: () => _complete(t), child: const Text('Mark as done')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
