import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../providers/auth_provider.dart';

/// Officer progression (gap agent): the club's named President-Nominee and the
/// suggested chain PN, PE, P, IPP. Members see it; club admins confirm or
/// dismiss each step. The API refuses to replace a sitting office holder.
class OfficerProgressionScreen extends StatefulWidget {
  final int clubId;
  const OfficerProgressionScreen({super.key, required this.clubId});

  @override
  State<OfficerProgressionScreen> createState() =>
      _OfficerProgressionScreenState();
}

class _OfficerProgressionScreenState extends State<OfficerProgressionScreen> {
  final _api = ApiClient();
  List<dynamic> _chains = [];
  bool _loading = true;
  String? _error;
  int? _busyStep;

  bool get _canManage => Provider.of<AuthProvider>(context, listen: false)
      .canEditClub(widget.clubId);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/officer-progression',
        queryParams: {'scope': 'club', 'scopeId': '${widget.clubId}'},
        fromJson: (j) => j as List<dynamic>,
      );
      _chains = resp.data ?? [];
    } on ApiException catch (e) {
      _error = e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _decide(int stepId, String action) async {
    setState(() => _busyStep = stepId);
    try {
      final resp = await _api.post<Map<String, dynamic>>(
        '/api/officer-progression/steps/$stepId/$action',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (mounted) {
        SnackbarUtils.showSuccess(
            context, resp.data?['message']?.toString() ?? 'Saved.');
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busyStep = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const CustomAppBar(title: 'Officer progression'),
      body: _loading
          ? const LoadingWidget()
          : _error != null
              ? EmptyStateWidget(
                  title: 'Could not load the officer progression',
                  subtitle: _error,
                  icon: Icons.error_outline,
                  actionLabel: 'Try again',
                  onAction: _load,
                )
              : _chains.isEmpty
                  ? const EmptyStateWidget(
                      title: 'No President-Nominee named yet',
                      subtitle:
                          'When the club names one, the following years appear here.',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [for (final c in _chains) _chainCard(c)],
                      ),
                    ),
    );
  }

  Widget _chainCard(dynamic c) {
    final steps = (c['steps'] as List<dynamic>? ?? []);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(c['memberName']?.toString() ?? '',
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600)),
            Text('President-Nominee ${c['nomineeYearLabel'] ?? ''}',
                style: const TextStyle(color: AppColors.textSecondary)),
            const Divider(),
            for (final s in steps) _stepRow(s as Map<String, dynamic>),
          ],
        ),
      ),
    );
  }

  Widget _stepRow(Map<String, dynamic> s) {
    final status = s['status']?.toString() ?? 'pending';
    final stepId = (s['stepId'] as num?)?.toInt() ?? 0;
    final holder = s['currentHolderName']?.toString();
    final clash = holder != null &&
        holder.isNotEmpty &&
        s['currentHolderIsNominee'] != true;
    final notOpen = s['yearId'] == null;
    final statusText = switch (status) {
      'confirmed' => 'Confirmed',
      'dismissed' => 'Dismissed',
      _ => 'Suggested',
    };
    final statusColor = switch (status) {
      'confirmed' => AppColors.success,
      'dismissed' => AppColors.textSecondary,
      _ => AppColors.warningDark,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${s['title']} · ${s['yearLabel']}',
                    style: const TextStyle(fontWeight: FontWeight.w500)),
              ),
              Text(statusText,
                  style: TextStyle(
                      color: statusColor, fontWeight: FontWeight.w600)),
            ],
          ),
          if (status == 'pending' && notOpen)
            const Text('This Rotary year is not open yet.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          if (status == 'pending' && clash)
            Text('$holder already holds this office.',
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textSecondary)),
          if (_canManage && status == 'pending')
            Row(
              children: [
                TextButton(
                  onPressed: _busyStep != null || notOpen || clash
                      ? null
                      : () => _decide(stepId, 'confirm'),
                  child: const Text('Confirm'),
                ),
                TextButton(
                  onPressed:
                      _busyStep != null ? null : () => _decide(stepId, 'dismiss'),
                  child: const Text('Dismiss'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
