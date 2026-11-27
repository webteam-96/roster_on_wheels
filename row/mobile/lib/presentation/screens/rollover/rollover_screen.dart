import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Year-end rollover preview for a club or district (`api/rollover/{club|district}/{id}`): what carries into the
/// next Rotary year, who is already in place, and earlier runs. Read-only here; admins apply and undo on the web.
/// The API refuses anyone without admin rights on both years.
class RolloverScreen extends StatefulWidget {
  const RolloverScreen({super.key, required this.isDistrict, required this.id});
  final bool isDistrict;
  final int id;

  @override
  State<RolloverScreen> createState() => _RolloverScreenState();
}

const _actionLabels = {'add': 'Will be added', 'exists': 'Already there', 'left': 'No longer in the club'};

class _RolloverScreenState extends State<RolloverScreen> {
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
          '/api/rollover/${widget.isDistrict ? 'district' : 'club'}/${widget.id}',
          fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() { _data = res.data ?? const {}; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the rollover preview.');
    }
  }

  List<Map<String, dynamic>> _list(Object? v) => ((v as List?) ?? const []).cast<Map<String, dynamic>>();

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final theme = Theme.of(context).textTheme;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Year-end Rollover'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.event_repeat_outlined, title: 'Not available', subtitle: _error!)
          : d == null
              ? const LoadingWidget()
              : RowRefresh(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      Text('From ${d['fromYear']?['label'] ?? ''} into ${d['toYear']?['label'] ?? ''}', style: theme.titleMedium),
                      Text('Admins review and apply the rollover on the web. Each run can be undone there.', style: theme.bodySmall),
                      const SizedBox(height: 12),
                      Text('Committees', style: theme.titleSmall),
                      if (_list(d['committees']).isEmpty) const ListTile(dense: true, title: Text('No committees to carry over.')),
                      for (final c in _list(d['committees']))
                        ExpansionTile(
                          title: Text.rich(TextSpan(text: c['name'] as String? ?? '')),
                          subtitle: Text(_actionLabels[c['action']] ?? ''),
                          children: [
                            for (final m in _list(c['members']))
                              ListTile(
                                dense: true,
                                title: Text.rich(TextSpan(text: m['name'] as String? ?? '')),
                                trailing: Text(_actionLabels[m['action']] ?? ''),
                              ),
                          ],
                        ),
                      if (d['ipp'] case final Map ipp) ...[
                        const SizedBox(height: 12),
                        Text('Immediate Past President', style: theme.titleSmall),
                        ListTile(
                          dense: true,
                          title: Text.rich(TextSpan(text: ipp['name'] as String? ?? '')),
                          trailing: Text(_actionLabels[ipp['action']] ?? ''),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Text('Already in place for ${d['toYear']?['label'] ?? ''}', style: theme.titleSmall),
                      if (_list(d['incoming']).isEmpty) const ListTile(dense: true, title: Text('No officers entered yet.')),
                      for (final o in _list(d['incoming']))
                        ListTile(dense: true, title: Text.rich(TextSpan(text: o['name'] as String? ?? '')), subtitle: Text(o['designation'] as String? ?? '')),
                      const SizedBox(height: 12),
                      Text('Earlier rollovers', style: theme.titleSmall),
                      if (_list(d['runs']).isEmpty) const ListTile(dense: true, title: Text('No rollover has been run yet.')),
                      for (final r in _list(d['runs']))
                        ListTile(
                          dense: true,
                          title: Text((r['createdUtc'] as String? ?? '').split('T').first),
                          subtitle: Text(r['status'] == 'undone' ? 'Undone' : 'Applied'),
                        ),
                    ],
                  ),
                ),
    );
  }
}
