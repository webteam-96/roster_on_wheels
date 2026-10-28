import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/utils/meeting.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/event_zone.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/pagination_widget.dart';
import '../../../../widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent'] ?? j['current']),
      );
}

class _AttendanceRecord {
  final int id;
  final int? clubId;
  final int? yearId;
  final String eventName;
  final DateTime? eventDateTime;
  final String? eventRaw; // as sent, for DateFormatter.eventDateTime
  final int membersCount;
  final int annsCount;
  final int annetsCount;
  final int visitorsCount;
  final int rotariansCount;
  final int delegatesCount;

  const _AttendanceRecord({
    required this.id,
    this.clubId,
    this.yearId,
    this.eventName = '',
    this.eventDateTime,
    this.eventRaw,
    this.membersCount = 0,
    this.annsCount = 0,
    this.annetsCount = 0,
    this.visitorsCount = 0,
    this.rotariansCount = 0,
    this.delegatesCount = 0,
  });

  int get totalAttendees =>
      membersCount + annsCount + annetsCount + visitorsCount + rotariansCount + delegatesCount;

  factory _AttendanceRecord.fromJson(Map<String, dynamic> j) {
    DateTime? _dt(dynamic v) {
      final d = v == null ? null : DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }
    int _i(dynamic v) => (v as num?)?.toInt() ?? 0;
    return _AttendanceRecord(
      id: _i(j['id']),
      clubId: (j['clubId'] as num?)?.toInt(),
      yearId: (j['yearId'] as num?)?.toInt(),
      eventName: (j['eventName'] ?? '').toString(),
      eventDateTime: _dt(j['eventDateTime'] ?? j['meetingDate']),
      eventRaw: (j['eventDateTime'] ?? j['meetingDate'])?.toString(),
      membersCount: _i(j['membersCount']),
      annsCount: _i(j['annsCount']),
      annetsCount: _i(j['annetsCount']),
      visitorsCount: _i(j['visitorsCount']),
      rotariansCount: _i(j['rotariansCount']),
      delegatesCount: _i(j['delegatesCount']),
    );
  }
}

class _Attendee {
  final int id;
  final int memberId;
  final String memberName;

  _Attendee({required this.id, required this.memberId, required this.memberName});

  factory _Attendee.fromJson(Map<String, dynamic> j) => _Attendee(
        id: (j['id'] as num?)?.toInt() ?? 0,
        memberId: (j['memberId'] as num?)?.toInt() ?? (j['id'] as num?)?.toInt() ?? 0,
        memberName: (j['memberName'] ?? j['name'] ?? '').toString(),
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class AttendanceScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const AttendanceScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy, hh:mm a');
  final _searchCtrl = TextEditingController();

  final List<_AttendanceRecord> _records = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  String? _zone;

  Future<void> _bootstrap() async {
    EventZones.club(widget.clubId).then((z) {
      if (mounted) setState(() => _zone = z);
    });
    await _loadYears();
    await _fetch(reset: true);
  }

  Future<void> _loadYears() async {
    List<_RotaryYear> years = [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/attendance/years',
        fromJson: (j) => j as List<dynamic>,
      );
      years = (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      years = [];
    }
    if (years.isEmpty) {
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (resp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {
        years = [];
      }
    }
    final current = years.firstWhere(
      (y) => y.isCurrent,
      orElse: () => years.isNotEmpty
          ? years.first
          : const _RotaryYear(id: 0, yearLabel: ''),
    );
    if (!mounted) return;
    setState(() {
      _years = years;
      _selectedYearId = current.id != 0 ? current.id : null;
    });
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _records.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/attendance',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          'yearId': _selectedYearId ?? 0,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _AttendanceRecord.fromJson(j));
      setState(() {
        _records.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; _loadingMore = false; });
    }
  }

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/clubs/${widget.clubId}/attendance/$id');
      setState(() => _records.removeWhere((r) => r.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Attendance record deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _showCreateSheet() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _CreateAttendanceScreen(
          clubId: widget.clubId,
          yearId: _selectedYearId ?? 0,
          onSaved: () => _fetch(reset: true),
        ),
      ),
    );
  }

  void _showEditSheet(_AttendanceRecord record) async {
    // Fetch full record detail for pre-population
    Map<String, dynamic>? detail;
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/attendance/${record.id}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      detail = resp.data;
    } catch (_) {
      detail = null;
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _CreateAttendanceScreen(
          clubId: widget.clubId,
          yearId: _selectedYearId ?? 0,
          onSaved: () => _fetch(reset: true),
          attendanceId: record.id,
          existingData: detail,
        ),
      ),
    );
  }

  void _openDetailPage(_AttendanceRecord record) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AttendanceDetailPage(
          clubId: widget.clubId,
          record: record,
          df: _df,
          zone: _zone,
        ),
      ),
    );
  }

  /// Per-level gating: only club admins of THIS club can manage.
  bool get canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Attendance'),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: _showCreateSheet,
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search by event name...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () { _searchCtrl.clear(); _fetch(reset: true); },
                      )
                    : null,
              ),
              onSubmitted: (_) => _fetch(reset: true),
              onChanged: (_) => setState(() {}),
            ),
          ),
          if (_years.isNotEmpty)
            RotaryYearBar<int>(
              value: _selectedYearId,
              options: [
                for (final y in _years)
                  RotaryYearOption(
                      value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                _fetch(reset: true);
              },
            ),
          Expanded(
            child: _selectedYearId == null && _years.isEmpty && !_loading
                ? const EmptyStateWidget(
                    title: 'Select a year to continue',
                    icon: Icons.calendar_today_outlined,
                  )
                : _buildContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    return _loading
          ? const ShimmerList(itemCount: 6, itemHeight: 90)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
              : _records.isEmpty
                  ? EmptyStateWidget(
                      title: 'No Attendance Records',
                      subtitle: canManage
                          ? 'Tap + to record attendance for a meeting.'
                          : 'No attendance has been recorded yet.',
                      icon: Icons.how_to_reg_outlined,
                      actionLabel: canManage ? 'New Record' : null,
                      onAction: canManage ? _showCreateSheet : null,
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: () => _fetch(reset: true),
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _records.length + 1,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (ctx, i) {
                          if (i == _records.length) {
                            return PaginationWidget(
                              currentPage: _page,
                              totalPages: _totalPages,
                              totalCount: _totalCount,
                              isLoading: _loadingMore,
                              onLoadMore: () {
                                if (_page < _totalPages && !_loadingMore) { _page++; _fetch(); }
                              },
                            );
                          }
                          final rec = _records[i];
                          return _AttendanceCard(
                            record: rec,
                            df: _df,
                            zone: _zone,
                            canManage: canManage,
                            onTap: () => _openDetailPage(rec),
                            onEdit: () => _showEditSheet(rec),
                            onDelete: () async {
                              final ok = await ConfirmationDialog.show(
                                context,
                                title: 'Delete Attendance',
                                message: 'Are you sure you want to delete "${rec.eventName}"?',
                              );
                              if (ok) _delete(rec.id);
                            },
                          );
                        },
                      ),
                    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _AttendanceCard extends StatelessWidget {
  final _AttendanceRecord record;
  final DateFormat df;
  final String? zone;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _AttendanceCard({
    required this.record,
    required this.df,
    this.zone,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  Color get _pctColor => AppColors.primary;

  Widget _countChip(String label, int count) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '$label: $count',
        style: AppTextStyles.caption.copyWith(
          fontSize: 11,
          color: AppColors.textSecondary,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: _pctColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: Text(
                    '${record.membersCount}',
                    style: AppTextStyles.bodyMedium.copyWith(color: _pctColor, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      record.eventName.isNotEmpty
                          ? record.eventName
                          : (record.eventDateTime != null ? df.format(record.eventDateTime!) : 'Unknown event'),
                      style: AppTextStyles.bodyMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      record.eventDateTime != null ? DateFormatter.eventDateTime(record.eventRaw, zone) : '',
                      style: AppTextStyles.caption,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Total: ${record.totalAttendees}',
                      style: AppTextStyles.caption,
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (record.membersCount > 0)
                          _countChip('Members', record.membersCount),
                        if (record.annsCount > 0)
                          _countChip('Anns', record.annsCount),
                        if (record.annetsCount > 0)
                          _countChip('Annets', record.annetsCount),
                        if (record.visitorsCount > 0)
                          _countChip('Visitors', record.visitorsCount),
                        if (record.rotariansCount > 0)
                          _countChip('Rotarians', record.rotariansCount),
                        if (record.delegatesCount > 0)
                          _countChip('Delegates', record.delegatesCount),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (canManage)
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onSelected: (v) {
                    if (v == 'edit') onEdit();
                    if (v == 'delete') onDelete();
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Edit')),
                    PopupMenuItem(value: 'delete', child: Text('Delete')),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Create Attendance Sheet
// ---------------------------------------------------------------------------
class _CreateAttendanceScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final VoidCallback onSaved;
  final int? attendanceId; // non-null => edit mode
  final Map<String, dynamic>? existingData; // pre-populated data for edit

  const _CreateAttendanceScreen({
    required this.clubId,
    required this.yearId,
    required this.onSaved,
    this.attendanceId,
    this.existingData,
  });

  bool get isEdit => attendanceId != null;

  @override
  State<_CreateAttendanceScreen> createState() => _CreateAttendanceScreenState();
}

class _CreateAttendanceScreenState extends State<_CreateAttendanceScreen> {
  final _api = ApiClient();
  final _displayDf = DateFormat('dd MMM yyyy');

  final _formKey = GlobalKey<FormState>();
  DateTime _meetingDate = DateTime.now();
  TimeOfDay? _meetingTime;
  List<_Attendee> _attendees = [];
  final Set<int> _selectedMemberIds = <int>{};
  final _eventNameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _meetingMode = 'in_person';
  final _meetingLinkCtrl = TextEditingController();
  bool _loadingMembers = true;
  bool _saving = false;
  String? _membersError;

  // Guest row state — each guest type has its own shape per web contract.
  final List<_GuestRowState> _anns = []; // {annName}
  final List<_GuestRowState> _annets = []; // {annetName}
  final List<_VisitorRowState> _visitors = []; // {visitorName, invitedBy}
  final List<_RotarianRowState> _rotarians = []; // {rotarianName, clubName}
  final List<_DelegateRowState> _delegates =
      []; // {rotarianName, districtDesignation, clubName}

  @override
  void dispose() {
    _eventNameCtrl.dispose();
    _descCtrl.dispose();
    _meetingLinkCtrl.dispose();
    for (final r in _anns) r.dispose();
    for (final r in _annets) r.dispose();
    for (final r in _visitors) r.dispose();
    for (final r in _rotarians) r.dispose();
    for (final r in _delegates) r.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _loadMembers();
    if (widget.isEdit && widget.existingData != null) {
      _prefillFromExisting(widget.existingData!);
    }
  }

  void _prefillFromExisting(Map<String, dynamic> data) {
    _eventNameCtrl.text = (data['eventName'] ?? '').toString();
    _descCtrl.text = (data['description'] ?? '').toString();
    _meetingMode = meetingModes.containsKey(data['meetingMode']) ? data['meetingMode'] as String : 'in_person';
    _meetingLinkCtrl.text = (data['meetingLink'] ?? '').toString();
    // eventLocal is the club's wall-clock; eventDateTime may be UTC ("…Z").
    final dt = DateTime.tryParse((data['eventLocal'] ?? data['eventDateTime'] ?? data['meetingDate'] ?? '').toString());
    if (dt != null) {
      _meetingDate = dt;
      if (dt.hour != 0 || dt.minute != 0) {
        _meetingTime = TimeOfDay(hour: dt.hour, minute: dt.minute);
      }
    }

    // Pre-select member IDs
    final memberIds = data['memberIds'] as List<dynamic>? ??
        (data['attendees'] as List<dynamic>?)
            ?.map((e) => (e as Map<String, dynamic>)['memberId'] ?? e['id'])
            .toList() ??
        [];
    for (final id in memberIds) {
      if (id is num) _selectedMemberIds.add(id.toInt());
    }

    // Pre-fill guest rows
    for (final g in (data['anns'] as List<dynamic>? ?? [])) {
      final m = g as Map<String, dynamic>;
      _anns.add(_GuestRowState(name: (m['annName'] ?? '').toString()));
    }
    for (final g in (data['annets'] as List<dynamic>? ?? [])) {
      final m = g as Map<String, dynamic>;
      _annets.add(_GuestRowState(name: (m['annetName'] ?? '').toString()));
    }
    for (final g in (data['visitors'] as List<dynamic>? ?? [])) {
      final m = g as Map<String, dynamic>;
      _visitors.add(_VisitorRowState(
        name: (m['visitorName'] ?? '').toString(),
        invitedBy: (m['invitedBy'] ?? '').toString(),
      ));
    }
    for (final g in (data['rotarians'] as List<dynamic>? ?? [])) {
      final m = g as Map<String, dynamic>;
      _rotarians.add(_RotarianRowState(
        name: (m['rotarianName'] ?? '').toString(),
        clubName: (m['clubName'] ?? '').toString(),
      ));
    }
    for (final g in (data['delegates'] as List<dynamic>? ?? [])) {
      final m = g as Map<String, dynamic>;
      _delegates.add(_DelegateRowState(
        name: (m['rotarianName'] ?? '').toString(),
        clubName: (m['clubName'] ?? '').toString(),
        designation: (m['districtDesignation'] ?? '').toString(),
      ));
    }
  }

  Future<void> _loadMembers() async {
    setState(() { _loadingMembers = true; _membersError = null; });
    try {
      final resp = await _api.get<dynamic>(
        '/api/clubs/${widget.clubId}/attendance/members',
        fromJson: (j) => j,
      );
      final data = resp.data;
      final List<dynamic> raw = data is List
          ? data
          : (data is Map<String, dynamic>
              ? (data['items'] as List<dynamic>? ?? [])
              : <dynamic>[]);
      setState(() {
        _attendees = raw
            .map((e) => _Attendee.fromJson(e as Map<String, dynamic>))
            .toList();
        _loadingMembers = false;
      });
    } catch (e) {
      setState(() { _membersError = e.toString(); _loadingMembers = false; });
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _meetingDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _meetingDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _meetingTime ?? TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _meetingTime = picked);
  }

  Future<void> _save() async {
    // Dismiss the keyboard so any error UI isn't covered by it.
    FocusScope.of(context).unfocus();

    if (!(_formKey.currentState?.validate() ?? false)) return;

    // Guest rows have no FormField validators, so any row whose name is
    // blank would be silently dropped by the .where() filter below. Catch
    // that explicitly so the user gets feedback instead of losing data.
    final emptySections = <String>[];
    FocusNode? firstEmptyFocus;
    void scan(String label, Iterable<dynamic> rows) {
      for (final r in rows) {
        if ((r.name as String).trim().isEmpty) {
          if (!emptySections.contains(label)) emptySections.add(label);
          firstEmptyFocus ??= r.nameFocus as FocusNode;
        }
      }
    }
    scan('Anns', _anns);
    scan('Annets', _annets);
    scan('Visitors', _visitors);
    scan('Rotarians', _rotarians);
    scan('Delegates', _delegates);

    if (emptySections.isNotEmpty) {
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Incomplete rows'),
          content: Text(
            'Please fill in the name for every row in: '
            '${emptySections.join(', ')}.\n\n'
            'Or remove any rows you don\'t need.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      if (mounted) firstEmptyFocus?.requestFocus();
      return;
    }

    setState(() => _saving = true);
    try {
      // Build combined datetime: date + time, formatted with :00 seconds
      DateTime combinedDt = _meetingDate;
      if (_meetingTime != null) {
        combinedDt = DateTime(_meetingDate.year, _meetingDate.month, _meetingDate.day,
            _meetingTime!.hour, _meetingTime!.minute);
      }
      final dtStr = '${combinedDt.year.toString().padLeft(4, '0')}-'
          '${combinedDt.month.toString().padLeft(2, '0')}-'
          '${combinedDt.day.toString().padLeft(2, '0')}T'
          '${combinedDt.hour.toString().padLeft(2, '0')}:'
          '${combinedDt.minute.toString().padLeft(2, '0')}:00';

      final body = {
        'eventName': _eventNameCtrl.text.trim(),
        'description': _descCtrl.text.trim(),
        'eventDateTime': dtStr,
        ...meetingPayload(_meetingMode, _meetingLinkCtrl.text),
        'memberIds': _selectedMemberIds.toList(),
        'anns': _anns
            .where((r) => r.name.trim().isNotEmpty)
            .map((r) => {'annName': r.name.trim()})
            .toList(),
        'annets': _annets
            .where((r) => r.name.trim().isNotEmpty)
            .map((r) => {'annetName': r.name.trim()})
            .toList(),
        'visitors': _visitors
            .where((r) => r.name.trim().isNotEmpty)
            .map((r) => {
                  'visitorName': r.name.trim(),
                  'invitedBy': r.invitedBy.trim().isEmpty ? null : r.invitedBy.trim(),
                })
            .toList(),
        'rotarians': _rotarians
            .where((r) => r.name.trim().isNotEmpty)
            .map((r) => {
                  'rotarianName': r.name.trim(),
                  'clubName': r.clubName.trim().isEmpty ? null : r.clubName.trim(),
                })
            .toList(),
        'delegates': _delegates
            .where((r) => r.name.trim().isNotEmpty)
            .map((r) => {
                  'rotarianName': r.name.trim(),
                  'districtDesignation': r.designation.trim().isEmpty ? null : r.designation.trim(),
                  'clubName': r.clubName.trim().isEmpty ? null : r.clubName.trim(),
                })
            .toList(),
      };
      if (widget.isEdit) {
        await _api.put('/api/clubs/${widget.clubId}/attendance/${widget.attendanceId}', body: body);
      } else {
        await _api.post('/api/clubs/${widget.clubId}/attendance', body: body);
      }
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(widget.isEdit ? 'Attendance updated' : 'Attendance saved'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e'), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  int get _presentCount => _selectedMemberIds.length;

  /// Focus a newly-added guest row's name field once the frame has rendered.
  /// Called from each guest section's `onAdd`. The post-frame deferral is
  /// needed because the TextField for the new row doesn't exist until after
  /// the rebuild that `setState` schedules.
  void _focusAfterFrame(FocusNode node) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) node.requestFocus();
    });
  }

  // ── Guest-section UI helpers ──────────────────────────────────────────────

  Widget _buildGuestSection<T>(
    String title,
    List<T> rows, {
    required VoidCallback onAdd,
    required Widget Function(int i, T r) rowBuilder,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text('$title (${rows.length})',
                  style: AppTextStyles.bodyMedium
                      .copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              TextButton.icon(
                onPressed: onAdd,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                ),
              ),
            ],
          ),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 4, top: 2, bottom: 6),
              child: Text(
                'None',
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textMuted),
              ),
            )
          else
            ...rows.asMap().entries.map((e) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: rowBuilder(e.key, e.value),
                )),
        ],
      ),
    );
  }

  Widget _plainNameRow({
    required TextEditingController nameCtrl,
    required FocusNode nameFocus,
    required VoidCallback onDelete,
  }) {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: nameCtrl,
            focusNode: nameFocus,
            decoration: const InputDecoration(
              isDense: true,
              hintText: 'Name',
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(),
            ),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.close, size: 18, color: AppColors.error),
          onPressed: onDelete,
          tooltip: 'Remove',
        ),
      ],
    );
  }

  Widget _visitorRow(_VisitorRowState r, {required VoidCallback onDelete}) {
    return Column(
      children: [
        _plainNameRow(nameCtrl: r.nameCtrl, nameFocus: r.nameFocus, onDelete: onDelete),
        const SizedBox(height: 4),
        TextField(
          controller: r.invitedByCtrl,
          decoration: const InputDecoration(
            isDense: true,
            hintText: 'Invited by',
            contentPadding:
                EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            border: OutlineInputBorder(),
          ),
        ),
      ],
    );
  }

  Widget _rotarianRow(_RotarianRowState r,
      {required VoidCallback onDelete}) {
    return Column(
      children: [
        _plainNameRow(nameCtrl: r.nameCtrl, nameFocus: r.nameFocus, onDelete: onDelete),
        const SizedBox(height: 4),
        TextField(
          controller: r.clubNameCtrl,
          decoration: const InputDecoration(
            isDense: true,
            hintText: 'Club name',
            contentPadding:
                EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            border: OutlineInputBorder(),
          ),
        ),
      ],
    );
  }

  Widget _delegateRow(_DelegateRowState r,
      {required VoidCallback onDelete}) {
    return Column(
      children: [
        _plainNameRow(nameCtrl: r.nameCtrl, nameFocus: r.nameFocus, onDelete: onDelete),
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: r.clubNameCtrl,
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: 'Club',
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: r.designationCtrl,
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: 'Designation',
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  border: OutlineInputBorder(),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: CustomAppBar(
        title: widget.isEdit ? 'Edit Attendance' : 'New Attendance',
      ),
      body: _loadingMembers
          ? const LoadingWidget()
          : _membersError != null
              ? Center(child: Text(_membersError!, style: AppTextStyles.caption.copyWith(color: AppColors.error)))
              : SingleChildScrollView(
                  // ListView lazily unmounts off-screen children, which drops
                  // the Form Element when the user scrolls to the Save button
                  // and causes _formKey.currentState to be null. A
                  // SingleChildScrollView + Column keeps every widget in the
                  // tree so the GlobalKey stays bound.
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Column(children: [
                    Form(
                      key: _formKey,
                      autovalidateMode: AutovalidateMode.onUserInteraction,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                                Text('1. Event Details', style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w700)),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _eventNameCtrl,
                                  maxLength: 500, // backend: Event Name StringLength(500)
                                  onChanged: (_) => setState(() {}), // live counter
                                  decoration: const InputDecoration(
                                    labelText: 'Event Name *',
                                    hintText: 'Enter event name',
                                    isDense: true,
                                    border: OutlineInputBorder(),
                                    counterText: '',
                                  ),
                                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Event name is required' : null,
                                ),
                                const SizedBox(height: 4),
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: Text('${_eventNameCtrl.text.length}/500', style: AppTextStyles.caption),
                                ),
                                const SizedBox(height: 8),
                                TextFormField(
                                  controller: _descCtrl,
                                  maxLength: 10000, // backend: Description StringLength(10000)
                                  maxLines: 4,
                                  keyboardType: TextInputType.multiline,
                                  textInputAction: TextInputAction.newline,
                                  onChanged: (_) => setState(() {}), // live counter
                                  decoration: const InputDecoration(
                                    labelText: 'Description *',
                                    hintText: 'Enter description',
                                    isDense: true,
                                    border: OutlineInputBorder(),
                                    counterText: '',
                                  ),
                                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Description is required' : null,
                                ),
                                const SizedBox(height: 4),
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: Text('${_descCtrl.text.length}/10000', style: AppTextStyles.caption),
                                ),
                                const SizedBox(height: 8),
                                MeetingModeField(
                                  mode: _meetingMode,
                                  linkController: _meetingLinkCtrl,
                                  onModeChanged: (m) => setState(() => _meetingMode = m),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Expanded(
                                      child: InkWell(
                                        onTap: _pickDate,
                                        borderRadius: BorderRadius.circular(8),
                                        child: InputDecorator(
                                          decoration: const InputDecoration(
                                            labelText: 'Event Date',
                                            contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                          ),
                                          child: Row(
                                            children: [
                                              const Icon(Icons.calendar_today_outlined, size: 16, color: AppColors.textSecondary),
                                              const SizedBox(width: 10),
                                              Text(_displayDf.format(_meetingDate), style: AppTextStyles.body),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: InkWell(
                                        onTap: _pickTime,
                                        borderRadius: BorderRadius.circular(8),
                                        child: InputDecorator(
                                          decoration: const InputDecoration(
                                            labelText: 'Event Time',
                                            contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                          ),
                                          child: Row(
                                            children: [
                                              const Icon(Icons.access_time_outlined, size: 16, color: AppColors.textSecondary),
                                              const SizedBox(width: 10),
                                              Text(
                                                _meetingTime != null ? _meetingTime!.format(context) : 'Select',
                                                style: _meetingTime != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 20),
                          Text('2. Attendance', style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Text('Members', style: AppTextStyles.bodyMedium),
                              const Spacer(),
                              if (!_loadingMembers)
                                Text('$_presentCount / ${_attendees.length} present', style: AppTextStyles.caption),
                            ],
                          ),
                          const SizedBox(height: 4),
                          if (_attendees.isEmpty)
                            const Padding(
                              padding: EdgeInsets.all(16),
                              child: Text('No members found'),
                            )
                          else
                            ..._attendees.map((a) {
                              final checked = _selectedMemberIds.contains(a.memberId);
                              return CheckboxListTile.adaptive(
                                value: checked,
                                onChanged: (v) => setState(() {
                                  if (v == true) {
                                    _selectedMemberIds.add(a.memberId);
                                  } else {
                                    _selectedMemberIds.remove(a.memberId);
                                  }
                                }),
                                title: Text(a.memberName, style: AppTextStyles.bodyMedium),
                                activeColor: AppColors.success,
                                controlAffinity: ListTileControlAffinity.leading,
                                dense: true,
                                contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                              );
                            }),
                          const SizedBox(height: 16),
                          _buildGuestSection<_GuestRowState>(
                            'Anns',
                            _anns,
                            onAdd: () {
                              final row = _GuestRowState();
                              setState(() => _anns.add(row));
                              _focusAfterFrame(row.nameFocus);
                            },
                            rowBuilder: (i, r) => _plainNameRow(
                              nameCtrl: r.nameCtrl,
                              nameFocus: r.nameFocus,
                              onDelete: () => setState(() {
                                _anns.removeAt(i).dispose();
                              }),
                            ),
                          ),
                          _buildGuestSection<_GuestRowState>(
                            'Annets',
                            _annets,
                            onAdd: () {
                              final row = _GuestRowState();
                              setState(() => _annets.add(row));
                              _focusAfterFrame(row.nameFocus);
                            },
                            rowBuilder: (i, r) => _plainNameRow(
                              nameCtrl: r.nameCtrl,
                              nameFocus: r.nameFocus,
                              onDelete: () => setState(() {
                                _annets.removeAt(i).dispose();
                              }),
                            ),
                          ),
                          _buildGuestSection<_VisitorRowState>(
                            'Visitors',
                            _visitors,
                            onAdd: () {
                              final row = _VisitorRowState();
                              setState(() => _visitors.add(row));
                              _focusAfterFrame(row.nameFocus);
                            },
                            rowBuilder: (i, r) => _visitorRow(
                              r,
                              onDelete: () => setState(() {
                                _visitors.removeAt(i).dispose();
                              }),
                            ),
                          ),
                          _buildGuestSection<_RotarianRowState>(
                            'Rotarians',
                            _rotarians,
                            onAdd: () {
                              final row = _RotarianRowState();
                              setState(() => _rotarians.add(row));
                              _focusAfterFrame(row.nameFocus);
                            },
                            rowBuilder: (i, r) => _rotarianRow(
                              r,
                              onDelete: () => setState(() {
                                _rotarians.removeAt(i).dispose();
                              }),
                            ),
                          ),
                          _buildGuestSection<_DelegateRowState>(
                            'Delegates',
                            _delegates,
                            onAdd: () {
                              final row = _DelegateRowState();
                              setState(() => _delegates.add(row));
                              _focusAfterFrame(row.nameFocus);
                            },
                            rowBuilder: (i, r) => _delegateRow(
                              r,
                              onDelete: () => setState(() {
                                _delegates.removeAt(i).dispose();
                              }),
                            ),
                          ),
                          const SizedBox(height: 16),
                          CustomButton(
                            label: 'Save',
                            onPressed: _saving ? null : _save,
                            isLoading: _saving,
                            fullWidth: true,
                          ),
                        ]),
                      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail Sheet
// ---------------------------------------------------------------------------
class _AttendanceDetailPage extends StatefulWidget {
  final int clubId;
  final _AttendanceRecord record;
  final DateFormat df;
  final String? zone;

  const _AttendanceDetailPage({
    required this.clubId,
    required this.record,
    required this.df,
    this.zone,
  });

  @override
  State<_AttendanceDetailPage> createState() => _AttendanceDetailPageState();
}

class _AttendanceDetailPageState extends State<_AttendanceDetailPage> {
  final _api = ApiClient();
  Map<String, dynamic>? _detail;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/attendance/${widget.record.id}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      setState(() {
        _detail = resp.data ?? {};
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  /// Compact serial-number badge shown as the row's leading widget so each
  /// attendee row has a clear "1, 2, 3, …" prefix.
  Widget _serialBadge(int n, Color color) {
    return Container(
      width: 28,
      height: 28,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        shape: BoxShape.circle,
      ),
      child: Text(
        '$n',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }

  Widget _buildCollapsibleCard(String title, IconData icon, Color color, int count, Widget content) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: AppColors.border)),
      child: ExpansionTile(
        initiallyExpanded: count > 0,
        leading: Icon(icon, color: color, size: 20),
        title: Row(
          children: [
            Text(title, style: AppTextStyles.bodyMedium),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('$count', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
            ),
          ],
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: count == 0
                ? Text('No ${title.toLowerCase()} recorded', style: AppTextStyles.caption.copyWith(fontStyle: FontStyle.italic))
                : content,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _detail ?? {};
    final members = (data['members'] as List<dynamic>?) ?? [];
    final anns = (data['anns'] as List<dynamic>?) ?? [];
    final annets = (data['annets'] as List<dynamic>?) ?? [];
    final visitors = (data['visitors'] as List<dynamic>?) ?? [];
    final rotarians = (data['rotarians'] as List<dynamic>?) ?? [];
    final delegates = (data['delegates'] as List<dynamic>?) ?? [];

    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: CustomAppBar(
        title: widget.record.eventName.isNotEmpty
            ? widget.record.eventName
            : 'Attendance Details',
      ),
      body: Column(
        children: [
          if ((data['description'] != null &&
                  data['description'].toString().isNotEmpty) ||
              widget.record.eventDateTime != null) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (data['description'] != null &&
                      data['description'].toString().isNotEmpty)
                    Text(data['description'].toString(),
                        style: AppTextStyles.caption),
                  if (widget.record.eventDateTime != null) ...[
                    const SizedBox(height: 4),
                    Text(DateFormatter.eventDateTime(widget.record.eventRaw, widget.zone),
                        style: AppTextStyles.caption),
                  ],
                  if ((data['meetingLink'] ?? '').toString().isNotEmpty) ...[
                    const SizedBox(height: 6),
                    TextButton.icon(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                      icon: const Icon(Icons.videocam_outlined, size: 18),
                      label: Text(data['meetingMode'] == 'hybrid' ? 'Join online (hybrid meeting)' : 'Join meeting'),
                      onPressed: () => launchUrl(Uri.parse(data['meetingLink'].toString()), mode: LaunchMode.externalApplication),
                    ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
          ],
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _error != null
                    ? Center(child: Text(_error!, style: AppTextStyles.caption.copyWith(color: AppColors.error)))
                    : ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          _buildCollapsibleCard('Members', Icons.people, Colors.blue, members.length,
                            Column(
                              children: members.asMap().entries.map((e) {
                                final mm = e.value as Map<String, dynamic>;
                                return ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: _serialBadge(e.key + 1, Colors.blue),
                                  title: Text((mm['memberName'] ?? '').toString(), style: AppTextStyles.bodyMedium),
                                );
                              }).toList(),
                            ),
                          ),
                          _buildCollapsibleCard('Anns', Icons.person_outline, Colors.green, anns.length,
                            Column(
                              children: anns.asMap().entries.map((e) {
                                final am = e.value as Map<String, dynamic>;
                                return ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: _serialBadge(e.key + 1, Colors.green),
                                  title: Text((am['annName'] ?? '').toString(), style: AppTextStyles.bodyMedium),
                                );
                              }).toList(),
                            ),
                          ),
                          _buildCollapsibleCard('Annets', Icons.person_outline, Colors.purple, annets.length,
                            Column(
                              children: annets.asMap().entries.map((e) {
                                final am = e.value as Map<String, dynamic>;
                                return ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: _serialBadge(e.key + 1, Colors.purple),
                                  title: Text((am['annetName'] ?? '').toString(), style: AppTextStyles.bodyMedium),
                                );
                              }).toList(),
                            ),
                          ),
                          _buildCollapsibleCard('Visitors', Icons.person_add, Colors.orange, visitors.length,
                            Column(
                              children: visitors.asMap().entries.map((e) {
                                final vm = e.value as Map<String, dynamic>;
                                return ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: _serialBadge(e.key + 1, Colors.orange),
                                  title: Text((vm['visitorName'] ?? '').toString(), style: AppTextStyles.bodyMedium),
                                  subtitle: Text('Invited by: ${(vm['invitedBy'] ?? '-').toString()}', style: AppTextStyles.caption),
                                );
                              }).toList(),
                            ),
                          ),
                          _buildCollapsibleCard('Rotarians (Other Club)', Icons.groups, Colors.teal, rotarians.length,
                            Column(
                              children: rotarians.asMap().entries.map((e) {
                                final rm = e.value as Map<String, dynamic>;
                                return ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: _serialBadge(e.key + 1, Colors.teal),
                                  title: Text((rm['rotarianName'] ?? '').toString(), style: AppTextStyles.bodyMedium),
                                  subtitle: Text('Club: ${(rm['clubName'] ?? '-').toString()}', style: AppTextStyles.caption),
                                );
                              }).toList(),
                            ),
                          ),
                          _buildCollapsibleCard('District Delegates', Icons.badge, Colors.red, delegates.length,
                            Column(
                              children: delegates.asMap().entries.map((e) {
                                final dm = e.value as Map<String, dynamic>;
                                return ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: _serialBadge(e.key + 1, Colors.red),
                                  title: Text((dm['rotarianName'] ?? '').toString(), style: AppTextStyles.bodyMedium),
                                  subtitle: Text(
                                    'Designation: ${(dm['districtDesignation'] ?? '-').toString()} | Club: ${(dm['clubName'] ?? '-').toString()}',
                                    style: AppTextStyles.caption,
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                        ],
                      ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Guest row state objects — each mirrors the web AttendanceBody shape:
//   anns:      [{annName}]
//   annets:    [{annetName}]
//   visitors:  [{visitorName, invitedBy}]
//   rotarians: [{rotarianName, clubName}]
//   delegates: [{rotarianName, districtDesignation, clubName}]
// ---------------------------------------------------------------------------

class _GuestRowState {
  final TextEditingController nameCtrl;
  final FocusNode nameFocus = FocusNode();
  _GuestRowState({String name = ''}) : nameCtrl = TextEditingController(text: name);
  String get name => nameCtrl.text;
  void dispose() {
    nameCtrl.dispose();
    nameFocus.dispose();
  }
}

class _VisitorRowState {
  final TextEditingController nameCtrl;
  final TextEditingController invitedByCtrl;
  final FocusNode nameFocus = FocusNode();
  _VisitorRowState({String name = '', String invitedBy = ''})
      : nameCtrl = TextEditingController(text: name),
        invitedByCtrl = TextEditingController(text: invitedBy);
  String get name => nameCtrl.text;
  String get invitedBy => invitedByCtrl.text;
  void dispose() {
    nameCtrl.dispose();
    invitedByCtrl.dispose();
    nameFocus.dispose();
  }
}

class _RotarianRowState {
  final TextEditingController nameCtrl;
  final TextEditingController clubNameCtrl;
  final FocusNode nameFocus = FocusNode();
  _RotarianRowState({String name = '', String clubName = ''})
      : nameCtrl = TextEditingController(text: name),
        clubNameCtrl = TextEditingController(text: clubName);
  String get name => nameCtrl.text;
  String get clubName => clubNameCtrl.text;
  void dispose() {
    nameCtrl.dispose();
    clubNameCtrl.dispose();
    nameFocus.dispose();
  }
}

class _DelegateRowState {
  final TextEditingController nameCtrl;
  final TextEditingController clubNameCtrl;
  final TextEditingController designationCtrl;
  final FocusNode nameFocus = FocusNode();
  _DelegateRowState({String name = '', String clubName = '', String designation = ''})
      : nameCtrl = TextEditingController(text: name),
        clubNameCtrl = TextEditingController(text: clubName),
        designationCtrl = TextEditingController(text: designation);
  String get name => nameCtrl.text;
  String get clubName => clubNameCtrl.text;
  String get designation => designationCtrl.text;
  void dispose() {
    nameCtrl.dispose();
    clubNameCtrl.dispose();
    designationCtrl.dispose();
    nameFocus.dispose();
  }
}

