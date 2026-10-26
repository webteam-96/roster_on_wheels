import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';

/// The next-year workspace for elect roles (N7, feature `planning_mode`, `api/planning`): the member's elect roles,
/// and per district the launchpad, the incoming team and each club's president- and secretary-elect.
/// Read-only in the app: the governor-elect appoints, invites and runs the cut-over on the web.
class NextYearScreen extends StatefulWidget {
  const NextYearScreen({super.key});

  @override
  State<NextYearScreen> createState() => _NextYearScreenState();
}

class _NextYearScreenState extends State<NextYearScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _roles;
  final _overviews = <int, Map<String, dynamic>>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final roles = ((await _api.get<List<dynamic>>('/api/planning/me', fromJson: (j) => j as List<dynamic>)).data ??
              const [])
          .cast<Map<String, dynamic>>();
      for (final d in roles.map((r) => r['districtId'] as int).toSet()) {
        try {
          final o = await _api.get<Map<String, dynamic>>('/api/planning/districts/$d',
              fromJson: (j) => j as Map<String, dynamic>);
          if (o.data != null) _overviews[d] = o.data!;
        } catch (_) {
          // a club-level elect may not see the district overview
        }
      }
      if (mounted) setState(() => _roles = roles);
    } catch (_) {
      if (mounted) setState(() => _roles = const []);
    }
  }

  static String _role(Map<String, dynamic>? r) => r == null ? 'Not appointed' : '${r['memberName'] ?? ''} (${r['status']})';

  @override
  Widget build(BuildContext context) {
    final roles = _roles;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Next year'),
      body: roles == null
          ? const LoadingWidget()
          : roles.isEmpty
              ? const EmptyStateWidget(
                  icon: Icons.event_repeat_outlined,
                  title: 'No elect role',
                  subtitle: 'When you are appointed for next year, your planning shows here.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      Text('Your roles', style: Theme.of(context).textTheme.titleMedium),
                      for (final r in roles)
                        ListTile(
                          title: Text(r['role'] as String? ?? ''),
                          subtitle: Text([r['clubName'] ?? 'District ${r['districtNumber'] ?? ''}', r['yearLabel'], r['status']]
                              .whereType<String>()
                              .join('  ·  ')),
                        ),
                      for (final o in _overviews.values) ..._district(o),
                    ],
                  ),
                ),
    );
  }

  List<Widget> _district(Map<String, dynamic> o) {
    final state = (o['state'] as Map?)?.cast<String, dynamic>() ?? const {};
    final launchpad = ((o['launchpad'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final team = ((o['team'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final clubs = ((o['clubs'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return [
      const Divider(height: 32),
      Text('District ${state['districtNumber'] ?? ''}  ·  ${state['planningYearLabel'] ?? ''}',
          style: Theme.of(context).textTheme.titleMedium),
      Text('State: ${state['state'] ?? ''}', style: Theme.of(context).textTheme.bodySmall),
      for (final i in launchpad)
        CheckboxListTile(
          value: i['done'] == true,
          onChanged: null,
          dense: true,
          title: Text(i['label'] as String? ?? ''),
          subtitle: Text(i['stub'] == true ? 'Coming later' : (i['detail'] as String? ?? '')),
        ),
      if (team.isNotEmpty) ExpansionTile(
        title: Text('Team (${team.length})'),
        children: [for (final t in team) ListTile(dense: true, title: Text(t['role'] as String? ?? ''), subtitle: Text(_role(t)))],
      ),
      if (clubs.isNotEmpty) ExpansionTile(
        title: Text('Clubs (${clubs.length})'),
        children: [
          for (final c in clubs)
            ListTile(
              dense: true,
              title: Text(c['clubName'] as String? ?? ''),
              subtitle: Text('President-elect: ${_role((c['pe'] as Map?)?.cast<String, dynamic>())}\n'
                  'Secretary-elect: ${_role((c['se'] as Map?)?.cast<String, dynamic>())}'),
            ),
        ],
      ),
    ];
  }
}
