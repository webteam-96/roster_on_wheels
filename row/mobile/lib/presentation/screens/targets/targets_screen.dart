import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';

/// Live target dashboard for a club or district (feature `target_dashboard`, `api/{clubs|districts}/{id}/targets`).
/// Read-only, for the club's or district's managers; the API narrows what each one sees.
class TargetsScreen extends StatefulWidget {
  const TargetsScreen({super.key, required this.isDistrict, required this.id});
  final bool isDistrict;
  final int id;

  @override
  State<TargetsScreen> createState() => _TargetsScreenState();
}

const _metricLabels = {
  'members': 'Members',
  'growth': 'Net growth',
  'newMembers': 'New members',
  'dues': 'Dues collected',
  'attendance': 'Attendance %',
  'meetings': 'Meetings held',
  'projects': 'Projects',
  'foundation': 'Foundation giving',
};

Color _statusColor(String? s) => switch (s) {
      'green' => const Color(0xFF2E7D32),
      'amber' => const Color(0xFFB26A00),
      'red' => const Color(0xFFC62828),
      _ => Colors.grey,
    };

class _TargetsScreenState extends State<TargetsScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
          '/api/${widget.isDistrict ? 'districts' : 'clubs'}/${widget.id}/targets',
          fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _data = res.data ?? const {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the targets.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Targets'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.flag_outlined, title: 'Not available', subtitle: _error!)
          : d == null
              ? const LoadingWidget()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      Text('${d['yearLabel'] ?? ''}  ·  ${d['yearElapsedPercent'] ?? 0}% of the year passed',
                          style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 8),
                      ..._metricTiles((d['totals'] as Map?)?.cast<String, dynamic>() ?? const {}),
                      if (widget.isDistrict) ...[
                        const SizedBox(height: 16),
                        Text('Clubs', style: Theme.of(context).textTheme.titleMedium),
                        for (final c in ((d['clubs'] as List?) ?? const []).cast<Map<String, dynamic>>())
                          ExpansionTile(
                            leading: Icon(Icons.circle, size: 12, color: _statusColor(c['status'] as String?)),
                            title: Text(c['clubName'] as String? ?? ''),
                            subtitle: c['agName'] == null ? null : Text('AG ${c['agName']}'),
                            children: _metricTiles((c['metrics'] as Map?)?.cast<String, dynamic>() ?? const {}),
                          ),
                      ],
                    ],
                  ),
                ),
    );
  }

  List<Widget> _metricTiles(Map<String, dynamic> metrics) => [
        for (final key in _metricLabels.keys)
          if (metrics[key] case final Map m)
            ListTile(
              dense: true,
              title: Text(_metricLabels[key]!),
              subtitle: m['target'] == null
                  ? null
                  : LinearProgressIndicator(
                      value: ((m['percent'] as num? ?? 0) / 100).clamp(0, 1).toDouble(),
                      color: _statusColor(m['status'] as String?),
                    ),
              trailing: Text(m['target'] == null ? '${_n(m['actual'])}' : '${_n(m['actual'])} / ${_n(m['target'])}'),
            ),
      ];

  static String _n(Object? v) => v is num ? (v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(1)) : '';
}
