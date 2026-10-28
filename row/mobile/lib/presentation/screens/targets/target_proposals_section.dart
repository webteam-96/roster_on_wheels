import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// District target setting (build spec B.29): the district's proposals per club and target. A club's managers accept
/// or counter here; the district reads the answers (it proposes on the web). No locking (module sheet).
class TargetProposalsSection extends StatefulWidget {
  const TargetProposalsSection({super.key, required this.isDistrict, required this.id});
  final bool isDistrict;
  final int id;

  @override
  State<TargetProposalsSection> createState() => _TargetProposalsSectionState();
}

const proposalMetricLabels = {
  'membership_growth': 'Membership growth',
  'meetings': 'Meetings held',
  'dues_collection': 'Dues collected (%)',
  'service_projects': 'Service projects',
  'foundation_giving': 'Foundation giving (USD)',
};

const _statusText = {'proposed': 'Waiting for the club', 'accepted': 'Accepted', 'countered': 'Countered'};

class _TargetProposalsSectionState extends State<TargetProposalsSection> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _rows;
  String? _error;
  bool _busy = false;

  String get _base => '/api/${widget.isDistrict ? 'districts' : 'clubs'}/${widget.id}/targets/proposals';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<List<dynamic>>(_base, fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _rows = (res.data ?? const []).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the target proposals.');
    }
  }

  Future<void> _answer(int id, {num? counter, String? note}) async {
    setState(() => _busy = true);
    try {
      if (counter == null) {
        await _api.post('/api/clubs/${widget.id}/targets/proposals/$id/accept');
      } else {
        await _api.post('/api/clubs/${widget.id}/targets/proposals/$id/counter', body: {'value': counter, 'note': note});
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _counterDialog(Map<String, dynamic> p) async {
    final value = TextEditingController();
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Counter: ${proposalMetricLabels[p['metric']] ?? p['metric']}'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: value, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Your target')),
          TextField(controller: note, maxLength: 500, decoration: const InputDecoration(labelText: 'Note to the district (optional)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Counter')),
        ],
      ),
    );
    final v = num.tryParse(value.text.trim());
    if (ok == true && v != null) await _answer(p['id'] as int, counter: v, note: note.text.trim().isEmpty ? null : note.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    if (_error != null) return const SizedBox.shrink(); // the switch is off or the viewer is not a manager
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 16),
      Text(widget.isDistrict ? 'Target proposals to clubs' : 'Targets proposed by the district',
          style: Theme.of(context).textTheme.titleMedium),
      if (rows == null)
        const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator())
      else if (rows.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No proposals for this Rotary year yet.'))
      else
        for (final p in rows)
          ListTile(
            title: Text('${widget.isDistrict ? '${p['clubName']}: ' : ''}${proposalMetricLabels[p['metric']] ?? p['metric']}'),
            subtitle: Text([
              'Proposed ${p['proposedValue']}',
              _statusText[p['status']] ?? '${p['status']}',
              if (p['status'] == 'countered') 'with ${p['counterValue']}${p['clubNote'] == null ? '' : ': ${p['clubNote']}'}',
            ].join(' · ')),
            trailing: !widget.isDistrict && p['status'] == 'proposed'
                ? Wrap(spacing: 4, children: [
                    TextButton(onPressed: _busy ? null : () => _answer(p['id'] as int), child: const Text('Accept')),
                    TextButton(onPressed: _busy ? null : () => _counterDialog(p), child: const Text('Counter')),
                  ])
                : null,
          ),
    ]);
  }
}
