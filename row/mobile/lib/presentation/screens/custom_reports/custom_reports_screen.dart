import 'package:flutter/material.dart' hide Text;
import 'package:flutter/widgets.dart' as w;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// The club's or district's saved custom reports (`api/{clubs|districts}/{id}/custom-reports`), for its officers:
/// run one and read it, or email it to the officers now. Reports are built and saved on the web admin.
class CustomReportsScreen extends StatefulWidget {
  const CustomReportsScreen({super.key, required this.isDistrict, required this.id});
  final bool isDistrict;
  final int id;

  @override
  State<CustomReportsScreen> createState() => _CustomReportsScreenState();
}

class _CustomReportsScreenState extends State<CustomReportsScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _reports;
  String? _error;

  String get _base => '/api/${widget.isDistrict ? 'districts' : 'clubs'}/${widget.id}/custom-reports';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<List<dynamic>>(_base, fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _reports = (res.data ?? const []).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the reports.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _reports;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Reports'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.table_chart_outlined, title: 'Not available', subtitle: _error!)
          : list == null
              ? const LoadingWidget()
              : list.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.table_chart_outlined,
                      title: 'No saved reports',
                      subtitle: 'Build and save a report in the web admin under Report Builder.')
                  : RowRefresh(
                      onRefresh: _load,
                      child: RowListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (ctx, i) {
                          final r = list[i];
                          final monthly = r['scheduleMonthly'] == true;
                          return ListTile(
                            leading: const Icon(Icons.table_chart_outlined),
                            title: w.Text(r['name'] as String? ?? ''),
                            subtitle: Text(monthly ? 'Emailed to officers every month' : 'Not scheduled'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
                                builder: (_) => _ReportResultScreen(base: _base, report: r))),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _ReportResultScreen extends StatefulWidget {
  const _ReportResultScreen({required this.base, required this.report});
  final String base;
  final Map<String, dynamic> report;

  @override
  State<_ReportResultScreen> createState() => _ReportResultScreenState();
}

class _ReportResultScreenState extends State<_ReportResultScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _result;
  String? _error;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    try {
      final res = await _api.post<Map<String, dynamic>>('${widget.base}/run',
          body: widget.report['definition'], fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _result = res.data ?? const {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not run the report.');
    }
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final res = await _api.post<Map<String, dynamic>>('${widget.base}/${widget.report['id']}/send',
          fromJson: (j) => j as Map<String, dynamic>);
      final sent = res.data?['sent'] ?? 0;
      messenger.showSnackBar(SnackBar(content: Text('Sent to $sent officer(s).')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not send the report.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  static String _cell(Object? v, String? type) {
    if (v == null) return '';
    if (type == 'bool') return (v is num ? v.toInt() : int.tryParse('$v')) == 1 ? 'Yes' : 'No';
    if (v is num) return v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(2);
    return '$v';
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    final columns = ((r?['columns'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final rows = ((r?['rows'] as List?) ?? const []).cast<List<dynamic>>();
    return Scaffold(
      appBar: CustomAppBar(title: widget.report['name'] as String? ?? 'Report'),
      floatingActionButton: r == null
          ? null
          : FloatingActionButton.extended(
              onPressed: _sending ? null : _send,
              icon: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.mail_outline),
              label: const Text('Email officers'),
            ),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.table_chart_outlined, title: 'Not available', subtitle: _error!)
          : r == null
              ? const LoadingWidget()
              : rows.isEmpty
                  ? const EmptyStateWidget(icon: Icons.table_chart_outlined, title: 'No rows', subtitle: 'No rows match this report.')
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                      children: [
                        Text(r['truncated'] == true ? '${rows.length} rows (cut at the row limit)' : '${rows.length} rows',
                            style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(height: 8),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: DataTable(
                            columns: [
                              for (final c in columns)
                                DataColumn(label: Text(c['label'] as String? ?? ''), numeric: c['type'] == 'number'),
                            ],
                            rows: [
                              for (final row in rows)
                                DataRow(cells: [
                                  for (var i = 0; i < columns.length; i++)
                                    DataCell(w.Text(_cell(i < row.length ? row[i] : null, columns[i]['type'] as String?))),
                                ]),
                            ],
                          ),
                        ),
                      ],
                    ),
    );
  }
}
