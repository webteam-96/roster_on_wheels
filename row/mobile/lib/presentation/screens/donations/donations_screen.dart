import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/services/donation_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Open donation campaigns of the member's clubs and districts (gap #13): goal, progress and a Give button that opens
/// the campaign's giving page in the browser, where the payment provider takes the card.
class DonationsScreen extends StatefulWidget {
  const DonationsScreen({super.key, this.api});
  final DonationApi? api;

  @override
  State<DonationsScreen> createState() => _DonationsScreenState();
}

class _DonationsScreenState extends State<DonationsScreen> {
  late final DonationApi _api = widget.api ?? DonationApi();
  List<Map<String, dynamic>>? _campaigns;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = await _api.campaigns();
      if (mounted) {
        setState(() {
          _campaigns = rows;
          _failed = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _campaigns = const [];
          _failed = true;
        });
      }
    }
  }

  Future<void> _give(String? url) async {
    final uri = Uri.tryParse(url ?? '');
    if (uri == null || !(uri.scheme == 'https' || uri.scheme == 'http')) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      SnackbarUtils.showError(context, 'Could not open the giving page');
    }
  }

  static String _money(num? v, String? currency) =>
      NumberFormat.simpleCurrency(name: currency ?? '', decimalDigits: 0).format(v ?? 0);

  @override
  Widget build(BuildContext context) {
    final rows = _campaigns;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Donations'),
      body: rows == null
          ? const LoadingWidget()
          : rows.isEmpty
              ? EmptyStateWidget(
                  icon: Icons.savings_outlined,
                  title: _failed ? 'Could not load campaigns' : 'No open campaigns',
                  subtitle: _failed
                      ? 'Come back later to try again.'
                      : 'Your club and district have no fundraising campaigns open right now.')
              : RowRefresh(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [for (final c in rows) _card(c)],
                  ),
                ),
    );
  }

  Widget _card(Map<String, dynamic> c) {
    final progress = (c['progress'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final currency = c['currency'] as String?;
    final goal = c['goalAmount'] as num? ?? 0;
    final raised = progress['raised'] as num? ?? 0;
    final donors = progress['donors'] as int? ?? 0;
    final percent = (progress['percent'] as num? ?? 0).toDouble();
    final end = DateTime.tryParse(c['endDate']?.toString() ?? '');
    final description = (c['description'] as String?)?.trim() ?? '';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(c['title'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
            Text(c['scopeType'] == 'district' ? 'District campaign' : 'Club campaign',
                style: Theme.of(context).textTheme.bodySmall),
            if (description.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(description, maxLines: 4, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 12),
            Text(goal > 0 ? '${_money(raised, currency)} of ${_money(goal, currency)}' : _money(raised, currency),
                style: const TextStyle(fontWeight: FontWeight.w600)),
            if (goal > 0) ...[
              const SizedBox(height: 6),
              RowProgressBar(value: (percent / 100).clamp(0.0, 1.0), minHeight: 6),
            ],
            const SizedBox(height: 6),
            Text([
              donors == 1 ? '1 donor' : '$donors donors',
              if (end != null) 'until ${DateFormatter.toDisplay(end)}',
            ].join(', ')),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(onPressed: () => _give(c['givingUrl'] as String?), child: const Text('Give')),
            ),
          ],
        ),
      ),
    );
  }
}
