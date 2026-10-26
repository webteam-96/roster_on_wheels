import 'package:flutter/material.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/loading_widget.dart';

String grantStatusLabel(String? s) =>
    (s ?? '').replaceAll('_', ' ').replaceFirstMapped(RegExp(r'^\w'), (m) => m[0]!.toUpperCase());

/// One grant application of the club (`api/clubs/{id}/grants/applications/{appId}`): its details and history, the
/// steps the club may take now (submit, provide information, resubmit, submit the report, cancel), comments, and
/// edit while it is a draft or sent back. Income lines, partners, qualified members and files are kept on the web.
class GrantApplicationScreen extends StatefulWidget {
  const GrantApplicationScreen({super.key, required this.clubId, required this.applicationId});
  final int clubId;
  final int applicationId;

  @override
  State<GrantApplicationScreen> createState() => _GrantApplicationScreenState();
}

class _GrantApplicationScreenState extends State<GrantApplicationScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _app;
  bool _busy = false;

  String get _path => '/api/clubs/${widget.clubId}/grants/applications/${widget.applicationId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(_path, fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _app = res.data);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  Future<void> _run(String what, Future<void> Function() call) async {
    setState(() => _busy = true);
    try {
      await call();
      if (mounted) SnackbarUtils.showSuccess(context, what);
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _action(Map<String, dynamic> a) async {
    final action = a['action'] as String;
    final report = action == 'submit_report';
    final comment = TextEditingController();
    final summary = TextEditingController();
    final spent = TextEditingController();
    final reached = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(grantStatusLabel(action)),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (report) ...[
              TextField(controller: summary, maxLines: 3, decoration: const InputDecoration(labelText: 'What the project did')),
              TextField(
                  controller: spent,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Amount spent')),
              TextField(
                  controller: reached,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'People reached')),
            ],
            TextField(
                controller: comment,
                maxLines: 3,
                decoration: InputDecoration(labelText: a['commentRequired'] == true ? 'Comment (required)' : 'Comment')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirm')),
        ],
      ),
    );
    final body = {
      'comment': comment.text.trim(),
      if (report) 'reportSummary': summary.text.trim(),
      if (report) 'reportAmountSpent': num.tryParse(spent.text.trim()),
      if (report) 'reportBeneficiaries': int.tryParse(reached.text.trim()),
    };
    for (final c in [comment, summary, spent, reached]) {
      c.dispose();
    }
    if (ok != true || !mounted) return;
    await _run('Done', () => _api.post<dynamic>('$_path/actions/$action', body: body));
  }

  Future<void> _comment() async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add a comment'),
        content: TextField(controller: c, maxLines: 4, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
        ],
      ),
    );
    final text = c.text.trim();
    c.dispose();
    if (ok != true || text.isEmpty || !mounted) return;
    await _run('Comment sent', () => _api.post<dynamic>('$_path/comments', body: {'comment': text}));
  }

  @override
  Widget build(BuildContext context) {
    final a = _app;
    String money(Object? v) => v is num ? formatMoney(v, null) : '';
    return Scaffold(
      appBar: const CustomAppBar(title: 'Grant application'),
      body: a == null
          ? const LoadingWidget()
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  Text(a['title'] as String? ?? '', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Wrap(spacing: 8, children: [
                    Chip(label: Text(grantStatusLabel(a['status'] as String?))),
                    Chip(label: Text(a['yearLabel'] as String? ?? '')),
                  ]),
                  if ((a['rejectionReason'] as String?)?.isNotEmpty == true)
                    ListTile(title: const Text('Reason given'), subtitle: Text(a['rejectionReason'] as String)),
                  ListTile(
                    title: const Text('Amounts'),
                    subtitle: Text([
                      'Requested ${money(a['amountRequested'])}',
                      if (a['amountApproved'] != null) 'Approved ${money(a['amountApproved'])}',
                      if ((a['paid'] as num? ?? 0) > 0) 'Paid ${money(a['paid'])}',
                    ].join('  ·  ')),
                  ),
                  if ((a['description'] as String?)?.isNotEmpty == true)
                    ListTile(title: const Text('Project'), subtitle: Text(a['description'] as String)),
                  if ((a['location'] as String?)?.isNotEmpty == true)
                    ListTile(title: const Text('Location'), subtitle: Text(a['location'] as String)),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    if (a['editable'] == true)
                      OutlinedButton.icon(
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Edit'),
                        onPressed: _busy
                            ? null
                            : () async {
                                final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
                                    builder: (_) => GrantApplicationForm(clubId: widget.clubId, application: a)));
                                if (saved == true) _load();
                              },
                      ),
                    for (final act in ((a['actions'] as List?) ?? const []).cast<Map<String, dynamic>>())
                      FilledButton(
                        onPressed: _busy ? null : () => _action(act),
                        child: Text(grantStatusLabel(act['action'] as String?)),
                      ),
                    OutlinedButton.icon(
                        icon: const Icon(Icons.comment_outlined),
                        label: const Text('Comment'),
                        onPressed: _busy ? null : _comment),
                  ]),
                  const SizedBox(height: 16),
                  Text('History', style: Theme.of(context).textTheme.titleMedium),
                  for (final e in ((a['events'] as List?) ?? const []).cast<Map<String, dynamic>>().reversed)
                    ListTile(
                      dense: true,
                      title: Text(grantStatusLabel(e['action'] as String?)),
                      subtitle: Text([
                        e['comment'],
                        DateFormatter.toDisplayWithTime(DateTime.tryParse(e['createdDate']?.toString() ?? '')?.toLocal()),
                      ].whereType<String>().where((t) => t.isNotEmpty).join('\n')),
                    ),
                ],
              ),
            ),
    );
  }
}

/// New application (pick an open cycle) or edit one that is a draft or sent back.
class GrantApplicationForm extends StatefulWidget {
  const GrantApplicationForm({super.key, required this.clubId, this.application, this.cycles = const []});
  final int clubId;
  final Map<String, dynamic>? application;
  /// Open cycles of the club's district (new applications only).
  final List<Map<String, dynamic>> cycles;

  @override
  State<GrantApplicationForm> createState() => _GrantApplicationFormState();
}

class _GrantApplicationFormState extends State<GrantApplicationForm> {
  final _api = ApiClient();
  late final Map<String, dynamic> _a = widget.application ?? const {};
  late final _title = TextEditingController(text: _a['title'] as String?);
  late final _description = TextEditingController(text: _a['description'] as String?);
  late final _location = TextEditingController(text: _a['location'] as String?);
  late final _amount = TextEditingController(text: (_a['amountRequested'] as num?)?.toString());
  late final _beneficiaries = TextEditingController(text: (_a['beneficiaries'] as num?)?.toString());
  late int? _cycleId = widget.cycles.isEmpty ? null : widget.cycles.first['id'] as int;
  late bool _rules = _a['rulesAccepted'] as bool? ?? false;
  late final List<Map<String, dynamic>> _lines = ((_a['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();
  /// Expense lines are edited here (a submission needs at least one); income and partner lines pass through.
  late final List<({TextEditingController what, TextEditingController amount})> _expenses = [
    for (final l in _lines.where((l) => l['kind'] == 'expense'))
      (
        what: TextEditingController(text: l['description'] as String?),
        amount: TextEditingController(text: (l['amount'] as num?)?.toString())
      ),
  ];
  bool _saving = false;

  bool get _isNew => widget.application == null;

  @override
  void dispose() {
    for (final c in [_title, _description, _location, _amount, _beneficiaries, for (final e in _expenses) ...[e.what, e.amount]]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    // Members and the non-expense lines go back unchanged: the app does not edit them.
    final body = {
      if (_isNew) 'cycleId': _cycleId,
      'title': _title.text.trim(),
      'description': _description.text.trim(),
      'location': _location.text.trim(),
      'startDate': _a['startDate'],
      'endDate': _a['endDate'],
      'beneficiaries': int.tryParse(_beneficiaries.text.trim()),
      'amountRequested': num.tryParse(_amount.text.trim()) ?? 0,
      'rulesAccepted': _rules,
      'lines': [
        ..._lines.where((l) => l['kind'] != 'expense'),
        for (final e in _expenses)
          if (e.what.text.trim().isNotEmpty)
            {'kind': 'expense', 'description': e.what.text.trim(), 'amount': num.tryParse(e.amount.text.trim())},
      ],
      'members': _a['members'] ?? const [],
    };
    final base = '/api/clubs/${widget.clubId}/grants/applications';
    try {
      _isNew ? await _api.post<dynamic>(base, body: body) : await _api.put<dynamic>('$base/${_a['id']}', body: body);
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
    final rules = (_isNew
        ? widget.cycles.firstWhere((c) => c['id'] == _cycleId, orElse: () => const {})
        : (_a['cycle'] as Map?)?.cast<String, dynamic>() ?? const {})['rules'] as String?;
    return Scaffold(
      appBar: CustomAppBar(title: _isNew ? 'New grant application' : 'Edit application'),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_isNew)
            DropdownButtonFormField<int>(
              initialValue: _cycleId,
              decoration: d('Grant cycle'),
              items: [
                for (final c in widget.cycles)
                  DropdownMenuItem(value: c['id'] as int, child: Text('${c['yearLabel']}'))
              ],
              onChanged: (v) => setState(() => _cycleId = v),
            ),
          const SizedBox(height: 12),
          TextField(controller: _title, decoration: d('Project title')),
          const SizedBox(height: 12),
          TextField(controller: _description, decoration: d('What the project will do'), maxLines: 5),
          const SizedBox(height: 12),
          TextField(controller: _location, decoration: d('Location')),
          const SizedBox(height: 12),
          TextField(
              controller: _amount,
              decoration: d('Amount requested'),
              keyboardType: const TextInputType.numberWithOptions(decimal: true)),
          const SizedBox(height: 12),
          TextField(controller: _beneficiaries, decoration: d('People it will reach'), keyboardType: TextInputType.number),
          if (rules?.isNotEmpty == true) ...[
            const SizedBox(height: 12),
            Text(rules!, style: Theme.of(context).textTheme.bodySmall),
          ],
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _rules,
            title: const Text("I accept the district's grant rules"),
            onChanged: (v) => setState(() => _rules = v ?? false),
          ),
          const SizedBox(height: 8),
          Text('Budget: expenses', style: Theme.of(context).textTheme.titleMedium),
          for (final e in _expenses)
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: e.what, decoration: const InputDecoration(labelText: 'Item'))),
              const SizedBox(width: 8),
              Expanded(
                  child: TextField(
                      controller: e.amount,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Amount'))),
              IconButton(
                  tooltip: 'Remove',
                  icon: const Icon(Icons.close),
                  onPressed: () => setState(() => _expenses.remove(e))),
            ]),
          TextButton.icon(
            icon: const Icon(Icons.add),
            label: const Text('Add an expense'),
            onPressed: () => setState(() => _expenses.add((what: TextEditingController(), amount: TextEditingController()))),
          ),
          const Text('Income, partners, qualified members and files are added on the web.'),
          const SizedBox(height: 16),
          FilledButton(onPressed: _saving || (_isNew && _cycleId == null) ? null : _save, child: const Text('Save')),
        ],
      ),
    );
  }
}
