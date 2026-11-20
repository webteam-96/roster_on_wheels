import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Years of service and anniversaries for one of the member's clubs (`GET api/clubs/{id}/anniversaries`):
/// milestones, joining anniversaries, birthdays and wedding anniversaries in a month, then everyone's years of
/// service. Any member of the club may read it; members who hide their personal details are left out of birthdays.
class AnniversariesScreen extends StatefulWidget {
  const AnniversariesScreen({super.key});

  @override
  State<AnniversariesScreen> createState() => _AnniversariesScreenState();
}

const _months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

class _AnniversariesScreenState extends State<AnniversariesScreen> {
  final _api = ApiClient();
  int? _clubId;
  int? _year;
  int? _month;
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_clubId == null) {
      final clubs = context.read<AuthProvider>().memberClubIds.toSet().toList();
      if (clubs.isNotEmpty) {
        _clubId = clubs.first;
        _load();
      }
    }
  }

  Future<void> _load() async {
    final id = _clubId;
    if (id == null) return;
    setState(() {
      _data = null;
      _error = null;
    });
    try {
      final q = _year != null && _month != null ? '?year=$_year&month=$_month' : '';
      final res = await _api.get<Map<String, dynamic>>('/api/clubs/$id/anniversaries$q',
          fromJson: (j) => j as Map<String, dynamic>);
      if (!mounted) return;
      final d = res.data ?? const <String, dynamic>{};
      setState(() {
        _data = d;
        _year ??= d['year'] as int?;
        _month ??= d['month'] as int?;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the anniversaries.');
    }
  }

  void _shiftMonth(int delta) {
    if (_year == null || _month == null) return;
    final d = DateTime(_year!, _month! + delta);
    _year = d.year;
    _month = d.month;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final clubs = auth.memberClubIds.toSet().toList();
    if (clubs.isEmpty) {
      return const Scaffold(
        appBar: CustomAppBar(title: 'Anniversaries'),
        body: EmptyStateWidget(
            icon: Icons.cake_outlined, title: 'No club', subtitle: 'Anniversaries belong to the clubs you are a member of.'),
      );
    }
    final d = _data;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Anniversaries'),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Row(
              children: [
                if (clubs.length > 1)
                  Expanded(
                    child: DropdownButton<int>(
                      isExpanded: true,
                      value: _clubId,
                      items: [
                        for (final id in clubs) DropdownMenuItem(value: id, child: Text(auth.clubNameOf(id) ?? 'Club $id')),
                      ],
                      onChanged: (v) {
                        if (v == null) return;
                        _clubId = v;
                        _load();
                      },
                    ),
                  )
                else
                  Expanded(child: Text(auth.clubNameOf(clubs.first) ?? '', style: Theme.of(context).textTheme.titleSmall)),
                IconButton(
                    tooltip: 'Previous month', icon: const Icon(Icons.chevron_left), onPressed: () => _shiftMonth(-1)),
                Text(_month == null ? '' : '${_months[_month! - 1]} $_year'),
                IconButton(tooltip: 'Next month', icon: const Icon(Icons.chevron_right), onPressed: () => _shiftMonth(1)),
              ],
            ),
          ),
          Expanded(
            child: _error != null
                ? EmptyStateWidget(icon: Icons.cake_outlined, title: 'Not available', subtitle: _error!)
                : d == null
                    ? const LoadingWidget()
                    : RefreshIndicator(onRefresh: _load, child: _report(d)),
          ),
        ],
      ),
    );
  }

  Widget _report(Map<String, dynamic> d) {
    final rows = ((d['members'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final month = _months[((d['month'] as int?) ?? 1) - 1];
    final milestones = rows.where((r) => r['milestone'] == true).toList();
    final joins = rows.where((r) => r['joinAnniversaryDay'] != null && r['milestone'] != true).toList()
      ..sort((a, b) => (a['joinAnniversaryDay'] as int).compareTo(b['joinAnniversaryDay'] as int));
    final births = rows.where((r) => r['birthdayDay'] != null).toList()
      ..sort((a, b) => (a['birthdayDay'] as int).compareTo(b['birthdayDay'] as int));
    final weddings = rows.where((r) => r['weddingAnniversaryDay'] != null).toList()
      ..sort((a, b) => (a['weddingAnniversaryDay'] as int).compareTo(b['weddingAnniversaryDay'] as int));
    final theme = Theme.of(context);

    Widget section(String title, List<Map<String, dynamic>> items, String Function(Map<String, dynamic>) line, IconData icon) => Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Text(title, style: theme.textTheme.titleMedium),
                ),
                if (items.isEmpty)
                  const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Text('None this month.'))
                else
                  for (final r in items)
                    ListTile(dense: true, leading: Icon(icon), title: Text(r['memberName'] as String? ?? ''), subtitle: Text(line(r))),
              ],
            ),
          ),
        );

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        section('Milestones', milestones,
            (r) => '${r['joinAnniversaryDay']} $month: ${r['anniversaryYears']} years in the club', Icons.workspace_premium_outlined),
        section('Joining anniversaries', joins,
            (r) => '${r['joinAnniversaryDay']} $month: ${r['anniversaryYears']} years', Icons.event_available_outlined),
        section('Birthdays', births, (r) => '${r['birthdayDay']} $month', Icons.cake_outlined),
        section('Wedding anniversaries', weddings, (r) => '${r['weddingAnniversaryDay']} $month', Icons.favorite_border),
        Card(
          child: ExpansionTile(
            title: const Text('Years of service'),
            subtitle: Text('${rows.length} members'),
            children: [
              for (final r in rows)
                ListTile(
                  dense: true,
                  title: Text(r['memberName'] as String? ?? ''),
                  trailing: Text(r['yearsOfService'] == null ? '-' : '${r['yearsOfService']} yrs'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
