import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The club's six RI-reported officer positions in ROW next to what Rotary International holds
/// (`api/clubs/{id}/ri-tools/officers`). Read-only, for the club's managers; the transfer-in wizard is on the web.
/// The RI side is the copy the server sync stored; this screen never calls Rotary.org.
class RiOfficersScreen extends StatefulWidget {
  const RiOfficersScreen({super.key, required this.clubId});
  final int clubId;

  @override
  State<RiOfficersScreen> createState() => _RiOfficersScreenState();
}

const _statusLabels = {
  'match': 'Matches RI',
  'different': 'Differs from RI',
  'missing_in_row': 'Missing in ROW',
  'missing_in_ri': 'Missing in RI',
  'empty': 'Not set in either',
  'not_synced': 'RI data not synced',
};

Color _statusColor(String? s) => switch (s) {
      'match' => const Color(0xFF2E7D32),
      'different' => const Color(0xFFB26A00),
      'missing_in_row' || 'missing_in_ri' => const Color(0xFFC62828),
      _ => Colors.grey,
    };

class _RiOfficersScreenState extends State<RiOfficersScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _data;
  String? _error;
  int? _yearId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/ri-tools/officers${_yearId == null ? '' : '?yearId=$_yearId'}',
          fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _data = res.data ?? const {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the officer compare.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      appBar: const CustomAppBar(title: 'RI officers'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.compare_arrows_outlined, title: 'Not available', subtitle: _error!)
          : d == null
              ? const LoadingWidget()
              : RefreshIndicator(onRefresh: _load, child: _body(context, d)),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> d) {
    final sync = (d['sync'] as Map?)?.cast<String, dynamic>() ?? const {};
    final synced = sync['status'] == 'ok' || sync['status'] == 'no_officers';
    final syncedAt = DateTime.tryParse(sync['syncedAtUtc'] as String? ?? '')?.toLocal();
    final years = ((d['years'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final year = (d['year'] as Map?)?.cast<String, dynamic>() ?? const {};
    final rows = ((d['rows'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (years.isNotEmpty)
          DropdownButton<int>(
            value: year['id'] as int?,
            isExpanded: true,
            items: [for (final y in years) DropdownMenuItem(value: y['id'] as int, child: Text('Rotary year ${y['label']}'))],
            onChanged: (v) {
              setState(() {
                _yearId = v;
                _data = null;
              });
              _load();
            },
          ),
        const SizedBox(height: 4),
        Text(
          synced
              ? 'RI officers last read ${syncedAt == null ? '' : MaterialLocalizations.of(context).formatMediumDate(syncedAt)}.'
              : sync['status'] == 'error'
                  ? 'The last RI officer sync failed. The RI column fills in after the next successful server sync.'
                  : 'RI officers for this club have not been synced yet. The server reads them once a day.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        for (final r in rows)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(child: Text(r['title'] as String? ?? '', style: Theme.of(context).textTheme.titleSmall)),
                    Text(_statusLabels[r['status']] ?? '',
                        style: TextStyle(color: _statusColor(r['status'] as String?), fontWeight: FontWeight.w600, fontSize: 12)),
                  ]),
                  const SizedBox(height: 6),
                  _holders(context, 'In ROW', r['row']),
                  _holders(context, 'In RI', synced ? r['ri'] : null, empty: synced ? 'None' : 'Not synced'),
                ],
              ),
            ),
          ),
        const SizedBox(height: 8),
        Text('Bring in members RI lists but ROW does not on the web admin, under RI Data.',
            style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }

  Widget _holders(BuildContext context, String label, Object? list, {String empty = 'None'}) {
    final people = ((list as List?) ?? const []).cast<Map<String, dynamic>>();
    final names = people
        .map((h) => '${h['name'] ?? ''}${h['rotaryId'] == null ? ' (no RI member id)' : ' (RI ${h['rotaryId']})'}')
        .join(', ');
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text('$label: ${people.isEmpty ? empty : names}', style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}
