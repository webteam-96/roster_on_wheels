import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/volunteer_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Volunteer sign-up sheets of the member's clubs (N4): sign up for a slot or cancel.
class VolunteersScreen extends StatefulWidget {
  const VolunteersScreen({super.key, this.api});
  final VolunteerApi? api;

  @override
  State<VolunteersScreen> createState() => _VolunteersScreenState();
}

class _VolunteersScreenState extends State<VolunteersScreen> {
  late final VolunteerApi _api = widget.api ?? VolunteerApi();
  List<Map<String, dynamic>>? _sheets;
  int? _busySlot;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final sheets = await _api.sheets();
      if (mounted) setState(() => _sheets = sheets);
    } catch (_) {
      if (mounted) setState(() => _sheets = const []);
    }
  }

  Future<void> _toggle(Map<String, dynamic> slot) async {
    final id = slot['id'] as int;
    final signedUp = slot['signedUp'] == true;
    setState(() => _busySlot = id);
    try {
      signedUp ? await _api.cancel(id) : await _api.signUp(id);
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, signedUp ? 'Sign-up cancelled' : 'You are signed up');
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busySlot = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sheets = _sheets;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Volunteering'),
      body: sheets == null
          ? const LoadingWidget()
          : sheets.isEmpty
              ? const EmptyStateWidget(
                  icon: Icons.volunteer_activism_outlined,
                  title: 'No open sign-up sheets',
                  subtitle: 'Your clubs have no volunteer sheets open right now.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [for (final s in sheets) _sheetCard(s)],
                  ),
                ),
    );
  }

  Widget _sheetCard(Map<String, dynamic> sheet) {
    final slots = (sheet['slots'] as List? ?? const []).cast<Map<String, dynamic>>();
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ListTile(
              title: Text(sheet['title'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text([sheet['clubName'], sheet['description']]
                  .whereType<String>()
                  .where((t) => t.trim().isNotEmpty)
                  .join('\n')),
            ),
            for (final slot in slots) _slotTile(slot),
          ],
        ),
      ),
    );
  }

  Widget _slotTile(Map<String, dynamic> slot) {
    final signedUp = slot['signedUp'] == true;
    final filled = slot['filled'] as int? ?? 0;
    final capacity = slot['capacity'] as int? ?? 0;
    final full = !signedUp && capacity > 0 && filled >= capacity;
    final busy = _busySlot == slot['id'];
    return ListTile(
      dense: true,
      title: Text(slot['task'] as String? ?? ''),
      subtitle: Text('${DateFormatter.toDisplayWithTime(DateTime.tryParse(slot['startsAt']?.toString() ?? '')?.toLocal())}'
          '  ·  $filled of $capacity'),
      trailing: busy
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : signedUp
              ? OutlinedButton(onPressed: () => _toggle(slot), child: const Text('Cancel'))
              : FilledButton(onPressed: full ? null : () => _toggle(slot), child: Text(full ? 'Full' : 'Sign up')),
    );
  }
}

/// The member's upcoming meeting duties (N4).
class MyDutiesScreen extends StatefulWidget {
  const MyDutiesScreen({super.key, this.api});
  final VolunteerApi? api;

  @override
  State<MyDutiesScreen> createState() => _MyDutiesScreenState();
}

class _MyDutiesScreenState extends State<MyDutiesScreen> {
  late final VolunteerApi _api = widget.api ?? VolunteerApi();
  List<Map<String, dynamic>>? _duties;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final duties = await _api.duties();
      if (mounted) setState(() => _duties = duties);
    } catch (_) {
      if (mounted) setState(() => _duties = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final duties = _duties;
    return Scaffold(
      appBar: const CustomAppBar(title: 'My meeting duties'),
      body: duties == null
          ? const LoadingWidget()
          : duties.isEmpty
              ? const EmptyStateWidget(
                  icon: Icons.assignment_ind_outlined,
                  title: 'No duties coming up',
                  subtitle: 'Meeting duties your club gives you will show here.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: duties.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final d = duties[i];
                      return ListTile(
                        title: Text(d['duty'] as String? ?? ''),
                        subtitle: Text([
                          DateFormatter.toDisplay(DateTime.tryParse(d['meetingDate']?.toString() ?? '')),
                          d['clubName'],
                          d['note'],
                        ].whereType<String>().where((t) => t.trim().isNotEmpty).join('  ·  ')),
                      );
                    },
                  ),
                ),
    );
  }
}
