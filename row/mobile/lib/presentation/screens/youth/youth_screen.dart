import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/youth_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

const _statusLabel = {
  'applied': 'Applied',
  'approved': 'Approved',
  'declined': 'Declined',
  'attended': 'Attended',
  'completed': 'Completed',
  'withdrawn': 'Withdrawn',
};
const _actionLabel = {
  'approved': 'Approve',
  'declined': 'Decline',
  'attended': 'Mark attended',
  'completed': 'Mark completed',
  'withdrawn': 'Withdraw',
};
const _stateLabel = {
  'cleared': 'Cleared',
  'expiring': 'Expires soon',
  'expired': 'Expired',
  'incomplete': 'Incomplete',
};

DateTime? _date(dynamic v) => DateTime.tryParse(v?.toString() ?? '');
String _day(dynamic v) => _date(v) == null ? '' : DateFormatter.toDisplay(_date(v));

/// Youth programs (gap #12): the member's own Youth Protection clearance, and the club or district records of an
/// appointed youth officer or district youth chair.
class YouthScreen extends StatefulWidget {
  const YouthScreen({super.key, this.api});
  final YouthApi? api;

  @override
  State<YouthScreen> createState() => _YouthScreenState();
}

class _YouthScreenState extends State<YouthScreen> {
  late final YouthApi _api = widget.api ?? YouthApi();
  Map<String, dynamic>? _me;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final me = await _api.me();
      if (mounted) setState(() { _me = me; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    final mine = (me?['clearances'] as List? ?? const []).cast<Map<String, dynamic>>();
    final scopes = (me?['officerOf'] as List? ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: const CustomAppBar(title: 'Youth programs'),
      body: _error != null && me == null
          ? EmptyStateWidget(icon: Icons.error_outline, title: 'Could not load', subtitle: _error!)
          : me == null
              ? const LoadingWidget()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      const Padding(
                        padding: EdgeInsets.fromLTRB(4, 4, 4, 8),
                        child: Text('My Youth Protection clearance', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                      ),
                      if (mine.isEmpty)
                        const Card(
                          child: ListTile(
                            leading: Icon(Icons.shield_outlined),
                            title: Text('No clearance on record'),
                            subtitle: Text('Your club youth officer records your training and background check.'),
                          ),
                        ),
                      for (final c in mine) Card(child: _ClearanceTile(c)),
                      if (scopes.isNotEmpty) ...[
                        const Padding(
                          padding: EdgeInsets.fromLTRB(4, 16, 4, 8),
                          child: Text('Youth officer', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                        ),
                        for (final s in scopes)
                          Card(
                            child: ListTile(
                              leading: const Icon(Icons.groups_outlined),
                              title: Text(s['name']?.toString() ?? ''),
                              subtitle: Text(s['clubId'] == 0 ? 'District youth chair' : 'Club youth officer'),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => YouthScopeScreen(
                                    api: _api,
                                    districtId: s['districtId'] as int,
                                    clubId: s['clubId'] as int,
                                    name: s['name']?.toString() ?? ''),
                              )),
                            ),
                          ),
                      ],
                    ],
                  ),
                ),
    );
  }
}

class _ClearanceTile extends StatelessWidget {
  const _ClearanceTile(this.c, {this.onTap});
  final Map<String, dynamic> c;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final state = c['state']?.toString() ?? 'incomplete';
    final color = switch (state) {
      'expired' => Theme.of(context).colorScheme.error,
      'expiring' => Colors.orange.shade800,
      'cleared' => Colors.green.shade700,
      _ => null,
    };
    final expiry = _day(c['expiryDate']);
    return ListTile(
      onTap: onTap,
      title: Text(c['memberName']?.toString() ?? ''),
      subtitle: Text([
        c['clubName'],
        if (_day(c['trainingDate']).isNotEmpty) 'Training ${_day(c['trainingDate'])}',
        if (_day(c['checkDate']).isNotEmpty) 'Check ${_day(c['checkDate'])}',
        if (expiry.isNotEmpty) 'Expires $expiry',
      ].whereType<String>().where((t) => t.trim().isNotEmpty).join('\n')),
      trailing: Text(_stateLabel[state] ?? state, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
    );
  }
}

/// One club's (clubId > 0) or the district's (clubId 0) youth records, for its appointed officer or chair.
class YouthScopeScreen extends StatefulWidget {
  const YouthScopeScreen({super.key, required this.api, required this.districtId, required this.clubId, required this.name});
  final YouthApi api;
  final int districtId;
  final int clubId;
  final String name;

  @override
  State<YouthScopeScreen> createState() => _YouthScopeScreenState();
}

class _YouthScopeScreenState extends State<YouthScopeScreen> {
  List<Map<String, dynamic>> _years = const [];
  int? _yearId;
  List<Map<String, dynamic>>? _people;
  List<Map<String, dynamic>>? _clearances;
  String? _error;
  bool get _chair => widget.clubId == 0;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final years = await widget.api.years();
      final current = years.firstWhere((y) => y['isCurrent'] == true, orElse: () => years.isEmpty ? const {} : years.first);
      if (!mounted) return;
      setState(() { _years = years; _yearId = current['id'] as int?; });
      await Future.wait([_loadPeople(), _loadClearances()]);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _loadPeople() async {
    final year = _yearId;
    if (year == null) return;
    setState(() => _people = null);
    try {
      final p = await widget.api.participants(widget.districtId, widget.clubId, year);
      if (mounted) setState(() => _people = p);
    } on ApiException catch (e) {
      if (mounted) setState(() { _people = const []; _error = e.message; });
    }
  }

  Future<void> _loadClearances() async {
    try {
      final c = await widget.api.clearances(widget.districtId, widget.clubId);
      if (mounted) setState(() => _clearances = c);
    } on ApiException catch (e) {
      if (mounted) setState(() { _clearances = const []; _error = e.message; });
    }
  }

  Future<void> _run(Future<void> Function() work, String done, Future<void> Function() reload) async {
    try {
      await work();
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, done);
      await reload();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  Future<void> _participantActions(Map<String, dynamic> p) async {
    final next = youthNextStatuses(p['status']?.toString() ?? '', chair: _chair);
    if (next.isEmpty) return;
    final pick = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(p['fullName']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w600))),
          for (final s in next) ListTile(title: Text(_actionLabel[s] ?? s), onTap: () => Navigator.pop(ctx, s)),
        ]),
      ),
    );
    if (pick == null) return;
    await _run(() => widget.api.setStatus(widget.districtId, widget.clubId, p['id'] as int, pick), 'Status changed', _loadPeople);
  }

  Future<void> _addParticipant() async {
    final name = TextEditingController();
    final email = TextEditingController();
    var program = 'ryla';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Add participant'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: program,
              decoration: const InputDecoration(labelText: 'Program'),
              items: const [
                DropdownMenuItem(value: 'ryla', child: Text('RYLA')),
                DropdownMenuItem(value: 'rli', child: Text('RLI')),
              ],
              onChanged: (v) => set(() => program = v ?? 'ryla'),
            ),
            TextField(controller: name, maxLength: 150, decoration: const InputDecoration(labelText: 'Full name')),
            TextField(
                controller: email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: 'Contact email (optional)')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (ok != true || _yearId == null) return;
    await _run(
        () => widget.api.addParticipant(widget.clubId, {
              'program': program,
              'yearId': _yearId,
              'fullName': name.text.trim(),
              'contactEmail': email.text.trim().isEmpty ? null : email.text.trim(),
            }),
        'Participant added',
        _loadPeople);
  }

  Future<void> _editClearance(Map<String, dynamic> c) async {
    final dates = <String, DateTime?>{
      'trainingDate': _date(c['trainingDate']),
      'checkDate': _date(c['checkDate']),
      'expiryDate': _date(c['expiryDate']),
    };
    const labels = {'trainingDate': 'Training date', 'checkDate': 'Background check date', 'expiryDate': 'Expiry date'};
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(c['memberName']?.toString() ?? ''),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            for (final k in labels.keys)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(labels[k]!),
                subtitle: Text(dates[k] == null ? 'Not set' : DateFormatter.toDisplay(dates[k])),
                trailing: dates[k] == null
                    ? const Icon(Icons.calendar_today_outlined)
                    : IconButton(
                        tooltip: 'Clear',
                        icon: const Icon(Icons.close),
                        onPressed: () => set(() => dates[k] = null)),
                onTap: () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(
                    context: ctx,
                    initialDate: dates[k] ?? now,
                    firstDate: DateTime(now.year - 20),
                    lastDate: DateTime(now.year + 10),
                  );
                  if (picked != null) set(() => dates[k] = picked);
                },
              ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    String? day(DateTime? d) => d == null
        ? null
        : '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    await _run(
        () => widget.api.saveClearance(widget.districtId, widget.clubId, c['memberId'] as int,
            {for (final k in dates.keys) k: day(dates[k])}),
        'Clearance saved',
        _loadClearances);
  }

  @override
  Widget build(BuildContext context) {
    final people = _people;
    final clearances = _clearances;
    return DefaultTabController(
      length: 2,
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(
            title: Text(widget.name),
            bottom: const TabBar(tabs: [Tab(text: 'RYLA and RLI'), Tab(text: 'Youth Protection')]),
          ),
          floatingActionButton: _chair
              ? null
              : FloatingActionButton.extended(
                  onPressed: _addParticipant, icon: const Icon(Icons.person_add_alt), label: const Text('Add participant')),
          body: TabBarView(children: [
            Column(children: [
              if (_years.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: DropdownButtonFormField<int>(
                    initialValue: _yearId,
                    decoration: const InputDecoration(labelText: 'Program year'),
                    items: [
                      for (final y in _years)
                        DropdownMenuItem(value: y['id'] as int, child: Text(y['label']?.toString() ?? '')),
                    ],
                    onChanged: (v) {
                      setState(() => _yearId = v);
                      _loadPeople();
                    },
                  ),
                ),
              Expanded(
                child: people == null
                    ? const LoadingWidget()
                    : people.isEmpty
                        ? EmptyStateWidget(
                            icon: Icons.school_outlined,
                            title: 'No participants',
                            subtitle: _error ?? 'Nobody is recorded for this program year yet.')
                        : RefreshIndicator(
                            onRefresh: _loadPeople,
                            child: ListView.separated(
                              padding: const EdgeInsets.fromLTRB(12, 8, 12, 88),
                              itemCount: people.length,
                              separatorBuilder: (_, __) => const Divider(height: 1),
                              itemBuilder: (_, i) {
                                final p = people[i];
                                final status = p['status']?.toString() ?? '';
                                return ListTile(
                                  title: Text(p['fullName']?.toString() ?? ''),
                                  subtitle: Text([
                                    (p['program'] == 'rli') ? 'RLI' : 'RYLA',
                                    p['sponsorClubName'],
                                  ].whereType<String>().join('  ·  ')),
                                  trailing: Text(_statusLabel[status] ?? status),
                                  onTap: youthNextStatuses(status, chair: _chair).isEmpty ? null : () => _participantActions(p),
                                );
                              },
                            ),
                          ),
              ),
            ]),
            clearances == null
                ? const LoadingWidget()
                : clearances.isEmpty
                    ? EmptyStateWidget(
                        icon: Icons.shield_outlined,
                        title: 'No clearances',
                        subtitle: _error ?? 'No Youth Protection clearances are recorded yet.')
                    : RefreshIndicator(
                        onRefresh: _loadClearances,
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 88),
                          itemCount: clearances.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) => _ClearanceTile(clearances[i], onTap: () => _editClearance(clearances[i])),
                        ),
                      ),
          ]),
        ),
      ),
    );
  }
}
