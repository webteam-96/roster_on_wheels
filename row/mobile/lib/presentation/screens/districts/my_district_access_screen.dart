import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/services/district_access_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Other districts the member was given time-limited access to (PETS, RLI, zone work). Each card opens that
/// district's member screens; the server checks the grant on every request, so access ends at the expiry.
class MyDistrictAccessScreen extends StatefulWidget {
  const MyDistrictAccessScreen({super.key, this.api});
  final DistrictAccessApi? api;

  @override
  State<MyDistrictAccessScreen> createState() => _MyDistrictAccessScreenState();
}

class _MyDistrictAccessScreenState extends State<MyDistrictAccessScreen> {
  late final DistrictAccessApi _api = widget.api ?? DistrictAccessApi();
  List<Map<String, dynamic>>? _grants;
  bool _failed = false;

  static const _purposes = {'PETS': 'PETS', 'RLI': 'RLI', 'ZONE': 'Zone work', 'OTHER': 'Other'};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _grants = null;
      _failed = false;
    });
    try {
      final grants = await _api.mine();
      if (mounted) setState(() => _grants = grants);
    } on Exception {
      if (mounted) setState(() { _grants = const []; _failed = true; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final grants = _grants;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Other districts'),
      body: grants == null
          ? const LoadingWidget()
          : _failed
              ? EmptyStateWidget(
                  icon: Icons.cloud_off_outlined,
                  title: 'Could not load your district access',
                  subtitle: 'Check your connection and try again.',
                  actionLabel: 'Try again',
                  onAction: _load)
              : grants.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.map_outlined,
                      title: 'No other districts',
                      subtitle: 'When you are given access to another district for PETS, RLI or zone work, it shows here until it expires.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [for (final g in grants) _card(g)],
                      ),
                    ),
    );
  }

  Widget _card(Map<String, dynamic> g) {
    final id = g['districtId'] as int? ?? 0;
    final number = g['districtNumber']?.toString() ?? '$id';
    final started = g['status'] != 'scheduled';
    final starts = DateFormatter.toDisplay(DateTime.tryParse(g['startsAtUtc']?.toString() ?? '')?.toLocal());
    final expires = DateFormatter.toDisplayWithTime(DateTime.tryParse(g['expiresAtUtc']?.toString() ?? '')?.toLocal());
    final purpose = _purposes[g['purpose']] ?? g['purpose']?.toString() ?? '';
    final note = g['note']?.toString() ?? '';
    final links = <(String, IconData, String)>[
      ('Members', Icons.people_outline, RouteNames.districtMembers(id)),
      ('Announcements', Icons.campaign_outlined, RouteNames.districtAnnouncements(id)),
      ('Events', Icons.event_outlined, RouteNames.districtUpcomingEvents(id)),
      ('Documents', Icons.description_outlined, RouteNames.districtDocuments(id)),
      ('Weblinks', Icons.link, RouteNames.districtWeblinks(id)),
    ];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('District $number', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(note.isEmpty ? purpose : '$purpose: $note'),
            const SizedBox(height: 4),
            Text(g['canWrite'] == true ? 'You can view and edit' : 'You can view',
                style: const TextStyle(fontSize: 13)),
            Text(started ? 'Until $expires' : 'From $starts, until $expires', style: const TextStyle(fontSize: 13)),
            if (g['status'] == 'expiring')
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('Ends soon', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            if (started && id > 0) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  for (final (label, icon, route) in links)
                    OutlinedButton.icon(onPressed: () => context.push(route), icon: Icon(icon, size: 18), label: Text(label)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
