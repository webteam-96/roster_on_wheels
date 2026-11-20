import 'package:flutter/material.dart' hide Text;
import '../../../core/services/volunteer_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The member's coming volunteer sign-ups with what the club sends them: the confirmation text and each reminder or
/// thank-you email, when it goes and whether it went (api/mobile/volunteers/my-signups).
class MyVolunteerSignupsScreen extends StatefulWidget {
  const MyVolunteerSignupsScreen({super.key, this.api});
  final VolunteerApi? api;

  @override
  State<MyVolunteerSignupsScreen> createState() => _MyVolunteerSignupsScreenState();
}

class _MyVolunteerSignupsScreenState extends State<MyVolunteerSignupsScreen> {
  late final VolunteerApi _api = widget.api ?? VolunteerApi();
  List<Map<String, dynamic>>? _signups;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await _api.mySignups();
      if (mounted) {
        setState(() {
          _signups = list;
          _failed = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _signups = const [];
          _failed = true;
        });
      }
    }
  }

  DateTime? _time(dynamic v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal();

  @override
  Widget build(BuildContext context) {
    final list = _signups;
    return Scaffold(
      appBar: const CustomAppBar(title: 'My volunteer sign-ups'),
      body: list == null
          ? const LoadingWidget()
          : list.isEmpty
              ? EmptyStateWidget(
                  icon: _failed ? Icons.cloud_off_outlined : Icons.event_available_outlined,
                  title: _failed ? 'Could not load your sign-ups' : 'No sign-ups coming up',
                  subtitle: _failed
                      ? 'Pull down or come back later to try again.'
                      : 'Slots you sign up for on a volunteer sheet will show here.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [for (final s in list) _card(s)],
                  ),
                ),
    );
  }

  Widget _card(Map<String, dynamic> s) {
    final reminders = (s['reminders'] as List? ?? const []).cast<Map<String, dynamic>>();
    final confirmation = (s['confirmationText'] as String? ?? '').trim();
    final start = DateFormatter.toDisplayWithTime(_time(s['startsAt']));
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(s['task'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 2),
            Text('${s['sheetTitle'] ?? ''}  ·  ${s['clubName'] ?? ''}'),
            Text(start),
            if (confirmation.isNotEmpty) ...[
              const SizedBox(height: 10),
              const Text('From the club', style: TextStyle(fontWeight: FontWeight.w600)),
              Text(confirmation),
            ],
            for (final r in reminders) ...[
              const Divider(height: 20),
              Text(r['subject'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(_status(r), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
              const SizedBox(height: 4),
              Text(r['body'] as String? ?? ''),
            ],
          ],
        ),
      ),
    );
  }

  String _status(Map<String, dynamic> r) {
    final sent = _time(r['sentAt']);
    if (sent != null) return 'Emailed ${DateFormatter.toDisplayWithTime(sent)}';
    final kind = r['kind'] == 'after' ? 'Thank-you email' : 'Reminder email';
    return '$kind due ${DateFormatter.toDisplayWithTime(_time(r['dueAt']))}';
  }
}
