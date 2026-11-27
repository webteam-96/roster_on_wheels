import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/job_board_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Job postings and business offers of the member's districts (feature `job_board`): browse and search live posts,
/// report abuse, post a job or offer (the district's admins approve it first), see and withdraw one's own posts.
class JobBoardScreen extends StatefulWidget {
  const JobBoardScreen({super.key, this.api});
  final JobBoardApi? api;

  @override
  State<JobBoardScreen> createState() => _JobBoardScreenState();
}

const _statusLabels = {
  'pending': 'Waiting for approval',
  'approved': 'Live',
  'rejected': 'Not approved',
  'removed': 'Removed by the district',
  'withdrawn': 'Withdrawn',
  'expired': 'Expired',
};

class _JobBoardScreenState extends State<JobBoardScreen> {
  late final JobBoardApi _api = widget.api ?? JobBoardApi();
  final _search = TextEditingController();
  List<Map<String, dynamic>>? _posts;
  List<Map<String, dynamic>>? _mine;
  String? _kind;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _failed = false);
    try {
      final results = await Future.wait([_api.browse(kind: _kind, query: _search.text), _api.mine()]);
      if (!mounted) return;
      setState(() {
        _posts = results[0];
        _mine = results[1];
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _posts = const [];
        _mine = const [];
        _failed = true;
      });
      SnackbarUtils.showError(context, e.message);
    }
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    try {
      await action();
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, done);
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  Future<void> _report(Map<String, dynamic> post) async {
    final reason = TextEditingController();
    final ok = await showRowDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Report this post'),
        content: TextField(
          controller: reason,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'What is wrong with it?'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Report')),
        ],
      ),
    );
    final text = reason.text;
    reason.dispose();
    if (ok == true) await _run(() => _api.report(post['id'] as int, text), 'Thank you. The district admins will look at it.');
  }

  Future<void> _withdraw(Map<String, dynamic> post) async {
    final ok = await showRowDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Withdraw this post?'),
        content: const Text('Members will no longer see it.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Withdraw')),
        ],
      ),
    );
    if (ok == true) await _run(() => _api.withdraw(post['id'] as int), 'Post withdrawn');
  }

  Future<void> _newPost() async {
    final posted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _JobPostForm(api: _api)),
    );
    if (posted == true && mounted) {
      SnackbarUtils.showSuccess(context, 'Posted. It shows once a district admin approves it.');
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: const CustomAppBar(title: 'Jobs and offers'),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _newPost,
          icon: const Icon(Icons.add),
          label: const Text('Post'),
        ),
        body: Column(
          children: [
            const TabBar(tabs: [Tab(child: Text('Board')), Tab(child: Text('My posts'))]),
            Expanded(child: TabBarView(children: [_board(), _myPosts()])),
          ],
        ),
      ),
    );
  }

  Widget _board() {
    final posts = _posts;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _load(),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: 'Search title, company or place',
              border: const OutlineInputBorder(),
              isDense: true,
              suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward), tooltip: 'Search', onPressed: _load),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Wrap(spacing: 8, children: [
            for (final k in const [(null, 'All'), ('job', 'Jobs'), ('offer', 'Business offers')])
              ChoiceChip(
                label: Text(k.$2),
                selected: _kind == k.$1,
                onSelected: (_) {
                  setState(() => _kind = k.$1);
                  _load();
                },
              ),
          ]),
        ),
        Expanded(
          child: posts == null
              ? const LoadingWidget()
              : posts.isEmpty
                  ? EmptyStateWidget(
                      icon: Icons.work_outline,
                      title: _failed ? 'Could not load the board' : 'No posts here',
                      subtitle: _failed
                          ? 'Pull down or search again to retry.'
                          : 'Jobs and business offers from members of your district show here once approved.')
                  : RowRefresh(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 88),
                        children: [for (final p in posts) _card(p, mine: false)],
                      ),
                    ),
        ),
      ],
    );
  }

  Widget _myPosts() {
    final mine = _mine;
    if (mine == null) return const LoadingWidget();
    if (mine.isEmpty) {
      return const EmptyStateWidget(
          icon: Icons.post_add_outlined,
          title: 'You have not posted yet',
          subtitle: 'Post a job or a business offer for members of your district.');
    }
    return RowRefresh(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
        children: [for (final p in mine) _card(p, mine: true)],
      ),
    );
  }

  Widget _card(Map<String, dynamic> p, {required bool mine}) {
    final status = p['status'] as String? ?? '';
    final place = [p['company'], p['location']].whereType<String>().where((t) => t.trim().isNotEmpty).join(', ');
    final expires = DateFormatter.toDisplay(DateTime.tryParse(p['expiresOn']?.toString() ?? ''));
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Chip(
                label: Text(p['kind'] == 'offer' ? 'Business offer' : 'Job'),
                visualDensity: VisualDensity.compact,
              ),
              const SizedBox(width: 8),
              if (mine) Expanded(child: Text(_statusLabels[status] ?? status, style: const TextStyle(fontWeight: FontWeight.w600))),
            ]),
            const SizedBox(height: 4),
            Text(p['title'] as String? ?? '', style: Theme.of(context).textTheme.titleMedium),
            if (place.isNotEmpty) Text(place),
            const SizedBox(height: 8),
            Text(p['description'] as String? ?? ''),
            const SizedBox(height: 8),
            Row(children: [
              const Text('Contact: '),
              Expanded(child: SelectableText(p['contact'] as String? ?? '')),
            ]),
            Text([
              if ((p['postedBy'] as String?)?.isNotEmpty == true) p['postedBy'] as String,
              if ((p['clubName'] as String?)?.isNotEmpty == true) p['clubName'] as String,
            ].join(', ')),
            Row(children: [const Text('Until '), Text(expires)]),
            if (mine && (p['reviewNote'] as String?)?.isNotEmpty == true)
              Row(children: [const Text('District note: '), Expanded(child: Text(p['reviewNote'] as String))]),
            Align(
              alignment: Alignment.centerRight,
              child: mine
                  ? (status == 'pending' || status == 'approved')
                      ? TextButton(onPressed: () => _withdraw(p), child: const Text('Withdraw'))
                      : const SizedBox.shrink()
                  : p['mine'] == true
                      ? const SizedBox.shrink()
                      : TextButton.icon(
                          onPressed: () => _report(p),
                          icon: const Icon(Icons.flag_outlined, size: 18),
                          label: const Text('Report')),
            ),
          ],
        ),
      ),
    );
  }
}

/// Post a job or a business offer. The server checks everything again; this only saves a round trip.
class _JobPostForm extends StatefulWidget {
  const _JobPostForm({required this.api});
  final JobBoardApi api;

  @override
  State<_JobPostForm> createState() => _JobPostFormState();
}

class _JobPostFormState extends State<_JobPostForm> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _company = TextEditingController();
  final _location = TextEditingController();
  final _contact = TextEditingController();
  String _kind = 'job';
  late DateTime _expires = DateUtils.dateOnly(DateTime.now()).add(const Duration(days: 30));
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_title, _description, _company, _location, _contact]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _required(String? v) => (v == null || v.trim().isEmpty) ? 'Required' : null;

  Future<void> _pickDate() async {
    final today = DateUtils.dateOnly(DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: _expires,
      firstDate: today,
      lastDate: today.add(const Duration(days: 90)),
    );
    if (picked != null) setState(() => _expires = picked);
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      await widget.api.create({
        'kind': _kind,
        'title': _title.text,
        'description': _description.text,
        'company': _company.text,
        'location': _location.text,
        'contact': _contact.text,
        // a calendar date, sent without a time so no zone can shift it
        'expiresOn': '${_expires.year.toString().padLeft(4, '0')}-${_expires.month.toString().padLeft(2, '0')}-'
            '${_expires.day.toString().padLeft(2, '0')}',
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const CustomAppBar(title: 'New post'),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'job', label: Text('Job')),
                ButtonSegment(value: 'offer', label: Text('Business offer')),
              ],
              selected: {_kind},
              onSelectionChanged: (s) => setState(() => _kind = s.first),
            ),
            const SizedBox(height: 16),
            TextFormField(
                controller: _title,
                maxLength: 150,
                validator: _required,
                decoration: const InputDecoration(labelText: 'Title')),
            TextFormField(
                controller: _description,
                maxLength: 4000,
                maxLines: 6,
                minLines: 3,
                validator: _required,
                decoration: const InputDecoration(labelText: 'Description')),
            TextFormField(
                controller: _company, maxLength: 150, decoration: const InputDecoration(labelText: 'Company (optional)')),
            TextFormField(
                controller: _location, maxLength: 150, decoration: const InputDecoration(labelText: 'Location (optional)')),
            TextFormField(
                controller: _contact,
                maxLength: 254,
                validator: _required,
                decoration: const InputDecoration(labelText: 'How to contact you (email or phone)')),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event_outlined),
              title: const Text('Show until'),
              subtitle: Text(DateFormatter.toDisplay(_expires)),
              onTap: _pickDate,
            ),
            const Text('Members of your district see the post after a district admin approves it.'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Send for approval'),
            ),
          ],
        ),
      ),
    );
  }
}
