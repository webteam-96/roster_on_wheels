import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';

/// Attendance standing for the signed-in member, with makeups they log themselves (gap #5, 2026-11-19).
/// A makeup logged here waits until a club officer approves it; officers see the waiting ones on this screen.
/// API: AttendanceMakeupsController (api/clubs/{id}/attendance/standing|makeups|missed, api/attendance/my-makeups).
class MyAttendanceScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  const MyAttendanceScreen({super.key, required this.clubId, required this.yearId});

  @override
  State<MyAttendanceScreen> createState() => _MyAttendanceScreenState();
}

const _makeupTypes = <String, String>{
  'other_club': "Another club's meeting",
  'district_event': 'District event',
  'service_project': 'Service project',
  'online': 'Online meeting',
  'other': 'Other',
};

String _statusLabel(String s) => s == 'pending' ? 'Waiting for approval' : s == 'approved' ? 'Approved' : 'Rejected';

class _MyAttendanceScreenState extends State<MyAttendanceScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _standing; // the club's figures plus my own row
  Map<String, dynamic>? _me;
  List<Map<String, dynamic>> _mine = [];
  List<Map<String, dynamic>> _missed = [];
  List<Map<String, dynamic>> _waiting = []; // officers: every member's waiting makeup

  int get _myId => Provider.of<AuthProvider>(context, listen: false).memberId;
  bool get _isOfficer => Provider.of<AuthProvider>(context, listen: false).canEditClub(widget.clubId);
  String get _base => '/api/clubs/${widget.clubId}/attendance';

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<Map<String, dynamic>> _list(dynamic d) => (d as List<dynamic>? ?? []).cast<Map<String, dynamic>>();

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final q = {'yearId': widget.yearId};
      final results = await Future.wait([
        _api.get<Map<String, dynamic>>('$_base/standing', queryParams: q, fromJson: (j) => j as Map<String, dynamic>),
        _api.get<List<dynamic>>('$_base/makeups', queryParams: q, fromJson: (j) => j as List<dynamic>),
        _api.get<List<dynamic>>('$_base/missed', queryParams: q, fromJson: (j) => j as List<dynamic>),
      ]);
      final standing = results[0].data as Map<String, dynamic>?;
      final makeups = _list(results[1].data);
      final me = _list(standing?['members']).where((m) => m['memberId'] == _myId).toList();
      if (!mounted) return;
      setState(() {
        _standing = standing;
        _me = me.isEmpty ? null : me.first;
        _mine = makeups.where((m) => m['memberId'] == _myId).toList();
        _waiting = _isOfficer ? makeups.where((m) => m['status'] == 'pending' && m['memberId'] != _myId).toList() : [];
        _missed = _list(results[2].data);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e is ApiException ? e.message : e.toString(); _loading = false; });
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _act(Future<void> Function() call, String done) async {
    try {
      await call();
      _toast(done);
      await _load();
    } catch (e) {
      _toast(e is ApiException ? e.message : 'That did not work. Please try again.');
    }
  }

  Future<void> _withdraw(Map<String, dynamic> m) async {
    final ok = await ConfirmationDialog.show(context, title: 'Withdraw makeup', message: 'Withdraw this makeup? It has not been approved yet.');
    if (ok) await _act(() => _api.delete('/api/attendance/my-makeups/${m['id']}'), 'Makeup withdrawn.');
  }

  Future<void> _review(Map<String, dynamic> m, bool approve) => _act(
        () => _api.post('$_base/makeups/${m['id']}/review', body: {'approve': approve}),
        approve ? 'Makeup approved.' : 'Makeup rejected.',
      );

  Future<void> _logMakeup({int? missedId}) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      builder: (_) => _LogMakeupSheet(clubId: widget.clubId, missed: _missed, initialMissedId: missedId),
    );
    if (saved == true) {
      _toast('Makeup sent. A club officer will approve it.');
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My attendance'),
      floatingActionButton: _loading || _error != null
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _logMakeup(),
              backgroundColor: AppColors.primary,
              icon: const Icon(Icons.add, color: Colors.white),
              label: const Text('Log a makeup', style: TextStyle(color: Colors.white)),
            ),
      body: _loading
          ? const ShimmerList(itemCount: 5, itemHeight: 80)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                    children: [
                      _summary(),
                      if (_waiting.isNotEmpty) ...[
                        _heading('Waiting for your approval'),
                        for (final m in _waiting) _makeupTile(m, officer: true),
                      ],
                      _heading('Meetings you missed'),
                      if (_missed.isEmpty)
                        const EmptyStateWidget(title: 'No missed meetings', subtitle: 'You were present at every meeting this year.', icon: Icons.check_circle_outline)
                      else
                        for (final m in _missed) _missedTile(m),
                      _heading('My makeups'),
                      if (_mine.isEmpty)
                        const EmptyStateWidget(title: 'No makeups yet', subtitle: 'Attended another club, a district event or a service project? Log it as a makeup.', icon: Icons.event_available_outlined)
                      else
                        for (final m in _mine) _makeupTile(m),
                    ],
                  ),
                ),
    );
  }

  Widget _heading(String t) => Padding(
        padding: const EdgeInsets.only(top: 20, bottom: 8),
        child: Text(t, style: AppTextStyles.h3),
      );

  Widget _summary() {
    final me = _me;
    final pct = me?['percent'];
    final clubPct = _standing?['clubPercent'];
    final String headline = me == null
        ? 'Not counted'
        : me['exempt'] == true
            ? 'Exempt'
            : pct == null ? 'No meetings yet' : '$pct%';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('My attendance', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          Text(headline, style: AppTextStyles.h1.copyWith(color: AppColors.primary)),
          if (me != null) ...[
            const SizedBox(height: 8),
            Text('Present ${me['present']} of ${me['counted']} meetings. Made up ${me['madeUp']}. Excused ${me['excused']}.',
                style: AppTextStyles.bodyMedium),
          ],
          if (me?['rule85'] == true && me?['exempt'] != true) ...[
            const SizedBox(height: 8),
            Text('You qualify for the rule of 85. Ask your club secretary if you want to be excused from attendance.',
                style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 8),
          Text(clubPct == null ? 'Club attendance: no meetings yet' : 'Club attendance: $clubPct%',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          Text('A makeup counts within ${_standing?['windowDays'] ?? 14} days of a missed meeting.',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
        ],
      ),
    );
  }

  Widget _missedTile(Map<String, dynamic> m) {
    final has = m['hasMakeup'] == true || m['hasMakeup'] == 1;
    final closed = m['closed'] == true || m['closed'] == 1;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(m['eventName']?.toString() ?? ''),
        subtitle: Text(m['meetingDate']?.toString() ?? ''),
        trailing: has || closed
            ? Text(has ? 'Makeup logged' : 'Meeting closed')
            : TextButton(
                onPressed: () => _logMakeup(missedId: m['id'] as int?),
                child: const Text('Make up'),
              ),
      ),
    );
  }

  Widget _makeupTile(Map<String, dynamic> m, {bool officer = false}) {
    final status = m['status']?.toString() ?? 'approved';
    final type = _makeupTypes[m['makeupType']] ?? m['makeupType']?.toString() ?? '';
    final lines = [
      if (officer) m['memberName']?.toString() ?? '',
      '${m['makeupDate']}  $type',
      if (m['missedEventName'] != null) 'For ${m['missedEventName']}',
      if ((m['note'] ?? '').toString().isNotEmpty) m['note'].toString(),
      if (!officer) _statusLabel(status) + (status == 'rejected' && m['reviewNote'] != null ? ': ${m['reviewNote']}' : ''),
    ];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final l in lines) Text(l, style: AppTextStyles.bodyMedium),
            if (officer || status == 'pending')
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                if (officer) ...[
                  TextButton(onPressed: () => _review(m, false), child: const Text('Reject')),
                  FilledButton(onPressed: () => _review(m, true), child: const Text('Approve')),
                ] else
                  TextButton(onPressed: () => _withdraw(m), child: const Text('Withdraw')),
              ]),
          ],
        ),
      ),
    );
  }
}

class _LogMakeupSheet extends StatefulWidget {
  final int clubId;
  final List<Map<String, dynamic>> missed;
  final int? initialMissedId;
  const _LogMakeupSheet({required this.clubId, required this.missed, this.initialMissedId});

  @override
  State<_LogMakeupSheet> createState() => _LogMakeupSheetState();
}

class _LogMakeupSheetState extends State<_LogMakeupSheet> {
  final _api = ApiClient();
  final _note = TextEditingController();
  DateTime _date = DateTime.now();
  String _type = 'other_club';
  int? _missedId;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _missedId = widget.initialMissedId;
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(now.year - 1), lastDate: now);
    if (d != null) setState(() => _date = d);
  }

  Future<void> _save() async {
    setState(() { _saving = true; _error = null; });
    try {
      await _api.post('/api/attendance/my-makeups', body: {
        'clubId': widget.clubId,
        'makeupDate': DateFormat('yyyy-MM-dd').format(_date),
        'makeupType': _type,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        if (_missedId != null) 'missedAttendanceId': _missedId,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() { _saving = false; _error = e is ApiException ? e.message : 'Could not send the makeup. Please try again.'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    // Meetings already made up or closed by an officer cannot take a new makeup.
    final open = widget.missed.where((m) => m['id'] == widget.initialMissedId
        || !(m['hasMakeup'] == true || m['hasMakeup'] == 1 || m['closed'] == true || m['closed'] == 1)).toList();
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Log a makeup', style: AppTextStyles.h3),
          const SizedBox(height: 4),
          Text('A club officer approves it before it counts.', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.calendar_today_outlined, size: 18),
            label: Text('Date: ${DateFormat('dd MMM yyyy').format(_date)}'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _type,
            decoration: const InputDecoration(labelText: 'What did you attend?', border: OutlineInputBorder()),
            items: [for (final e in _makeupTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _type = v ?? _type),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int?>(
            initialValue: _missedId,
            decoration: const InputDecoration(labelText: 'Meeting it makes up', border: OutlineInputBorder()),
            items: [
              const DropdownMenuItem<int?>(value: null, child: Text('Nearest missed meeting')),
              for (final m in open)
                DropdownMenuItem<int?>(value: m['id'] as int?, child: Text('${m['meetingDate']}  ${m['eventName']}', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() => _missedId = v),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            maxLength: 500,
            decoration: const InputDecoration(labelText: 'Note, for example the club or event name', border: OutlineInputBorder()),
          ),
          if (_error != null) Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_error!, style: AppTextStyles.caption.copyWith(color: AppColors.error)),
          ),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Sending...' : 'Send for approval'),
          ),
        ],
      ),
    );
  }
}
