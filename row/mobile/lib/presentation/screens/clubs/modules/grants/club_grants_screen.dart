import 'package:flutter/material.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'grant_application_screen.dart';

/// The club's district grant applications and where each one stands (feature `grants`, `api/clubs/{id}/grants`).
/// New applications, edits and status steps open GrantApplicationScreen / GrantApplicationForm.
class ClubGrantsScreen extends StatefulWidget {
  const ClubGrantsScreen({super.key, required this.clubId});
  final int clubId;

  @override
  State<ClubGrantsScreen> createState() => _ClubGrantsScreenState();
}

class _ClubGrantsScreenState extends State<ClubGrantsScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _apps;
  List<Map<String, dynamic>> _openCycles = const [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/clubs/${widget.clubId}/grants',
          fromJson: (j) => j as Map<String, dynamic>);
      final apps = ((res.data?['applications'] as List?) ?? const []).cast<Map<String, dynamic>>();
      final cycles = ((res.data?['cycles'] as List?) ?? const []).cast<Map<String, dynamic>>();
      if (mounted) {
        setState(() {
          _apps = apps;
          _openCycles = cycles.where((c) => c['status'] == 'open').toList();
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the grants.');
    }
  }

  Future<void> _open(int id) async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => GrantApplicationScreen(clubId: widget.clubId, applicationId: id)));
    _load();
  }

  Future<void> _new() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => GrantApplicationForm(clubId: widget.clubId, cycles: _openCycles)));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final apps = _apps;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Grants'),
      floatingActionButton: _openCycles.isEmpty
          ? null
          : FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add), label: const Text('New application')),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.savings_outlined, title: 'Not available', subtitle: _error!)
          : apps == null
              ? const LoadingWidget()
              : apps.isEmpty
                  ? EmptyStateWidget(
                      icon: Icons.savings_outlined,
                      title: 'No grant applications',
                      subtitle: _openCycles.isEmpty
                          ? 'When your district opens a grant cycle, you can apply here.'
                          : 'Your district has a grant cycle open. Tap New application to apply.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        itemCount: apps.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final a = apps[i];
                          final approved = a['amountApproved'];
                          return ListTile(
                            title: Text(a['title'] as String? ?? ''),
                            subtitle: Text([
                              a['yearLabel'],
                              'Requested ${formatMoney(a['amountRequested'] as num?, null)}',
                              if (approved != null) 'Approved ${formatMoney(approved as num, null)}',
                              if ((a['paid'] as num? ?? 0) > 0) 'Paid ${formatMoney(a['paid'] as num, null)}',
                              'Updated ${DateFormatter.toDisplay(DateTime.tryParse(a['updatedAt']?.toString() ?? ''))}',
                            ].whereType<String>().join('  ·  ')),
                            trailing: Chip(label: Text(grantStatusLabel(a['status'] as String?))),
                            onTap: () => _open(a['id'] as int),
                          );
                        },
                      ),
                    ),
    );
  }
}
