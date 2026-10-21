import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import 'pph_attendee_history.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';

// ════════════════════════════════════════════════════════════════════════
// PPH Camps — 3-level model: Camp → Attendee (person) → Medical Reading (many).
//
// [PphCampAttendeesScreen] is Level 2 (a camp's attendee list); tapping an
// attendee opens Level 3 (their medical-reading history). The old flat
// `…/attendance` route is gone — adds POST `…/readings` (server reuses the
// attendee when the camp + mobile already exist, else creates them) and edits
// target `…/attendees/{id}` (person fields) or `…/readings/{id}` (one visit's
// medical fields).
//
// The whole flow is base-path driven so the same UI serves both
// `…/district-modules/{districtId}/pph-camps/{campId}` (district) and
// `…/clubs/{clubId}/pph-camps/{campId}` (club) — both controllers expose the
// identical attendees/readings endpoints. [DistrictRniCampAttendanceScreen] is
// the district wrapper kept for the existing GoRoute.
// ════════════════════════════════════════════════════════════════════════

// ── Shared option strings (MUST match the web form exactly) ──────────────────
const _sexOptions = ['Male', 'Female', 'Other'];
const _bpStatusOptions = [
  'None',
  'Pre-existing High Blood Pressure',
  'New High Blood Pressure Detected',
];
// Blood-sugar type stores the code (FBS/RBS); the UI shows the long label.
const _bloodSugarTypeOptions = ['FBS', 'RBS'];
const _bloodSugarTypeLabels = {
  'FBS': 'FBS (Fasting)',
  'RBS': 'RBS (Random)',
};
const _diabetesOptions = [
  'None',
  'Pre-existing Diabetes',
  'New Diabetes Detected',
];

double? _toD(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

int? _toI(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString());
}

// ── Models ───────────────────────────────────────────────────────────────────
class _PphReading {
  final int id;
  final int attendeeId;
  final int campId;
  final String? registrationNo;
  final DateTime? readingDate;
  final int? age;
  final int? bpSystolic;
  final int? bpDiastolic;
  final String? bloodSugarType;
  final double? bloodSugarValue;
  final double? heightCm;
  final double? weightKg;
  final double? bmi;
  final String? diabetesStatus;
  final String? bpStatus;
  final bool isOverweight;
  final bool isObese;
  final String? remarks;

  const _PphReading({
    required this.id,
    required this.attendeeId,
    required this.campId,
    this.registrationNo,
    this.readingDate,
    this.age,
    this.bpSystolic,
    this.bpDiastolic,
    this.bloodSugarType,
    this.bloodSugarValue,
    this.heightCm,
    this.weightKg,
    this.bmi,
    this.diabetesStatus,
    this.bpStatus,
    this.isOverweight = false,
    this.isObese = false,
    this.remarks,
  });

  factory _PphReading.fromJson(Map<String, dynamic> j) {
    DateTime? rd = DateTime.tryParse((j['readingDate'] ?? '').toString());
    if (rd != null && rd.year <= 1) rd = null; // `0001-01-01` => no value
    return _PphReading(
      id: (j['id'] as int?) ?? 0,
      attendeeId: (j['attendeeId'] as int?) ?? 0,
      campId: (j['campId'] as int?) ?? 0,
      registrationNo: j['registrationNo']?.toString(),
      readingDate: rd,
      age: _toI(j['age']),
      bpSystolic: _toI(j['bpSystolic']),
      bpDiastolic: _toI(j['bpDiastolic']),
      bloodSugarType: j['bloodSugarType']?.toString(),
      bloodSugarValue: _toD(j['bloodSugarValue']),
      heightCm: _toD(j['heightCm']),
      weightKg: _toD(j['weightKg']),
      bmi: _toD(j['bmi']),
      diabetesStatus: j['diabetesStatus']?.toString(),
      bpStatus: j['bpStatus']?.toString(),
      isOverweight: j['isOverweight'] as bool? ?? false,
      isObese: j['isObese'] as bool? ?? false,
      remarks: j['remarks']?.toString(),
    );
  }
}

class _PphAttendee {
  final int id;
  final int campId;
  final String name;
  final String mobileNo;
  final String? sex;
  final String? address;
  final bool isConsentedForMessages;
  final int readingCount;
  final _PphReading? latestReading;

  const _PphAttendee({
    required this.id,
    required this.campId,
    required this.name,
    required this.mobileNo,
    this.sex,
    this.address,
    this.isConsentedForMessages = false,
    this.readingCount = 0,
    this.latestReading,
  });

  factory _PphAttendee.fromJson(Map<String, dynamic> j) {
    final lr = j['latestReading'];
    return _PphAttendee(
      id: (j['id'] as int?) ?? 0,
      campId: (j['campId'] as int?) ?? 0,
      name: j['name']?.toString() ?? '',
      mobileNo: j['mobileNo']?.toString() ?? '',
      sex: j['sex']?.toString(),
      address: j['address']?.toString(),
      isConsentedForMessages: j['isConsentedForMessages'] as bool? ?? false,
      readingCount: (j['readingCount'] as int?) ?? 0,
      latestReading:
          lr is Map<String, dynamic> ? _PphReading.fromJson(lr) : null,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════
// District wrapper kept for the existing GoRoute — computes the base path and
// management permission, then delegates to the reusable attendees screen.
// ════════════════════════════════════════════════════════════════════════
class DistrictRniCampAttendanceScreen extends StatelessWidget {
  final int districtId;
  final int campId;
  final String campTitle;

  const DistrictRniCampAttendanceScreen({
    super.key,
    required this.districtId,
    required this.campId,
    required this.campTitle,
  });

  @override
  Widget build(BuildContext context) {
    final canManage =
        context.watch<AuthProvider>().isDistrictAdminOf(districtId);
    return PphCampAttendeesScreen(
      campBase: '/api/district-modules/$districtId/pph-camps/$campId',
      title: campTitle,
      canManage: canManage,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════
// Level 2 — Attendee list for a camp (reusable: district + club)
// ════════════════════════════════════════════════════════════════════════
class PphCampAttendeesScreen extends StatefulWidget {
  /// Base path up to and including `/pph-camps/{campId}` (no trailing slash).
  final String campBase;
  final String title;
  final bool canManage;

  const PphCampAttendeesScreen({
    super.key,
    required this.campBase,
    required this.title,
    required this.canManage,
  });

  @override
  State<PphCampAttendeesScreen> createState() => _PphCampAttendeesScreenState();
}

class _PphCampAttendeesScreenState extends State<PphCampAttendeesScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  bool _loading = true;
  String? _error;
  List<_PphAttendee> _all = [];
  String _query = '';

  String get _base => widget.campBase;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/attendees',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _PphAttendee.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _all = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _all = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  List<_PphAttendee> get _filtered {
    if (_query.trim().isEmpty) return _all;
    final q = _query.toLowerCase();
    return _all.where((a) {
      return a.name.toLowerCase().contains(q) ||
          a.mobileNo.toLowerCase().contains(q);
    }).toList();
  }

  Future<void> _openAddReading() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _ReadingEditorPage(
          campBase: _base,
          campAttendees: _all,
        ),
      ),
    );
    if (saved == true) await _fetch();
  }

  Future<void> _openAttendee(_PphAttendee a) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _AttendeeDetailPage(
          campBase: _base,
          attendeeId: a.id,
          canManage: widget.canManage,
        ),
      ),
    );
    // History edits change the reading count / latest reading shown here.
    if (changed == true) await _fetch();
  }

  Future<void> _openEditAttendee(_PphAttendee a) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AttendeeEditorPage(campBase: _base, attendee: a),
      ),
    );
    if (saved == true) await _fetch();
  }

  Future<void> _confirmDeleteAttendee(_PphAttendee a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Attendee'),
        content: Text(
            'Delete "${a.name}" and all ${a.readingCount} of their readings? '
            'This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('$_base/attendees/${a.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = widget.canManage;
    final items = _filtered;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: widget.title,
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add reading',
              onPressed: _openAddReading,
            ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            color: AppColors.background,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Attendees',
                  style: AppTextStyles.bodyMedium.copyWith(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _searchCtrl,
                  onChanged: (v) => setState(() => _query = v),
                  decoration: InputDecoration(
                    hintText: 'Search by name or mobile',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    filled: true,
                    fillColor: AppColors.surface,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 6, itemHeight: 100)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: _fetch)
                    : items.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const EmptyStateWidget(
                                  title: 'No attendees',
                                  subtitle:
                                      'No one has been registered for this camp yet.',
                                  icon: Icons.how_to_reg_outlined,
                                ),
                                if (canManage)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 12),
                                    child: ElevatedButton.icon(
                                      icon: const Icon(Icons.add),
                                      label: const Text('Add Reading'),
                                      onPressed: _openAddReading,
                                    ),
                                  ),
                              ],
                            ),
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: _fetch,
                            child: ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                              itemCount: items.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 10),
                              itemBuilder: (ctx, i) => _AttendeeCard(
                                a: items[i],
                                canManage: canManage,
                                onTap: () => _openAttendee(items[i]),
                                onEdit: () => _openEditAttendee(items[i]),
                                onDelete: () =>
                                    _confirmDeleteAttendee(items[i]),
                              ),
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

// ── Status chip colour helpers (shared) ──────────────────────────────────────
Color _sexColor(String? sex) {
  switch (sex) {
    case 'Male':
      return AppColors.accentBlue;
    case 'Female':
      return AppColors.accentBlue;
    default:
      return AppColors.textSecondary;
  }
}

/// "None" is a normal/healthy result; any "Pre-existing"/"New …" is a warning.
Color _conditionColor(String? status) {
  if (status == null || status.isEmpty || status == 'None') {
    return AppColors.success;
  }
  return status.startsWith('New') ? AppColors.error : AppColors.warning;
}

Widget _statusChip(String text, Color color) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Text(
      text,
      style: AppTextStyles.caption.copyWith(
        color: color,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

class _AttendeeCard extends StatelessWidget {
  final _PphAttendee a;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _AttendeeCard({
    required this.a,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final initial = a.name.isNotEmpty ? a.name[0].toUpperCase() : '?';
    final lr = a.latestReading;
    final infoBits = <String>[];
    if (a.mobileNo.isNotEmpty) infoBits.add(a.mobileNo);
    if (lr?.age != null) infoBits.add('Age ${lr!.age}');

    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: AppColors.primary.withValues(alpha: 0.15),
                child: Text(
                  initial,
                  style: AppTextStyles.bodyMedium.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            a.name,
                            style: AppTextStyles.bodyMedium
                                .copyWith(fontWeight: FontWeight.bold),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (a.sex != null && a.sex!.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          _statusChip(a.sex!, _sexColor(a.sex)),
                        ],
                      ],
                    ),
                    if (infoBits.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        infoBits.join(' · '),
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _statusChip(
                          '${a.readingCount} reading${a.readingCount == 1 ? '' : 's'}',
                          AppColors.primary,
                        ),
                        if (lr?.bpStatus != null &&
                            lr!.bpStatus!.isNotEmpty &&
                            lr.bpStatus != 'None')
                          _statusChip(
                              'BP: ${lr.bpStatus}', _conditionColor(lr.bpStatus)),
                        if (lr?.diabetesStatus != null &&
                            lr!.diabetesStatus!.isNotEmpty &&
                            lr.diabetesStatus != 'None')
                          _statusChip(lr.diabetesStatus!,
                              _conditionColor(lr.diabetesStatus)),
                        if (lr?.bmi != null)
                          _statusChip(
                              '${lr!.bmi!.toStringAsFixed(1)} BMI', AppColors.info),
                      ],
                    ),
                  ],
                ),
              ),
              if (canManage)
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, size: 20),
                  onSelected: (v) {
                    if (v == 'edit') onEdit();
                    if (v == 'delete') onDelete();
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Edit attendee')),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete',
                          style: TextStyle(color: AppColors.error)),
                    ),
                  ],
                )
              else
                const Icon(Icons.chevron_right, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════
// Level 3 — Attendee detail (person + medical-reading history)
// ════════════════════════════════════════════════════════════════════════
class _AttendeeDetailPage extends StatefulWidget {
  final String campBase;
  final int attendeeId;
  final bool canManage;

  const _AttendeeDetailPage({
    required this.campBase,
    required this.attendeeId,
    required this.canManage,
  });

  @override
  State<_AttendeeDetailPage> createState() => _AttendeeDetailPageState();
}

class _AttendeeDetailPageState extends State<_AttendeeDetailPage> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _PphAttendee? _attendee;
  List<_PphReading> _history = [];
  // Whether anything changed so the parent list refetches its counts.
  bool _changed = false;

  String get _base => widget.campBase;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '$_base/attendees/${widget.attendeeId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final root = resp.data ?? const {};
      final att = root['attendee'];
      final hist = (root['history'] as List<dynamic>? ?? const [])
          .map((e) => _PphReading.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _attendee =
            att is Map<String, dynamic> ? _PphAttendee.fromJson(att) : null;
        _history = hist;
        _loading = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _addReading() async {
    final a = _attendee;
    if (a == null) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _ReadingEditorPage(campBase: _base, seedAttendee: a),
      ),
    );
    if (saved == true) {
      _changed = true;
      await _fetch();
    }
  }

  Future<void> _editReading(_PphReading r) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _ReadingEditorPage(campBase: _base, editReading: r),
      ),
    );
    if (saved == true) {
      _changed = true;
      await _fetch();
    }
  }

  Future<void> _deleteReading(_PphReading r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Reading'),
        content: Text(
            'Delete the reading from ${_fmtDate(r.readingDate)}? This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child:
                const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('$_base/readings/${r.id}');
      _changed = true;
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _attendee;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: CustomAppBar(
          title: a?.name.isNotEmpty == true ? a!.name : 'Attendee',
          onBack: () => Navigator.of(context).pop(_changed),
        ),
        floatingActionButton: (widget.canManage && a != null)
            ? FloatingActionButton.extended(
                onPressed: _addReading,
                icon: const Icon(Icons.add),
                label: const Text('Add Reading'),
              )
            : null,
        body: _loading
            ? const ShimmerList(itemCount: 5, itemHeight: 90)
            : _error != null
                ? ErrorStateWidget(message: _error!, onRetry: _fetch)
                : a == null
                    ? const Center(child: Text('Attendee not found'))
                    : RefreshIndicator(
                        color: AppColors.primary,
                        onRefresh: _fetch,
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                          children: [
                            _personCard(a),
                            const SizedBox(height: 16),
                            Text(
                              'Medical Readings (${_history.length})',
                              style: AppTextStyles.bodyMedium
                                  .copyWith(fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(height: 8),
                            if (_history.isEmpty)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 24),
                                child: Center(
                                  child: Text(
                                    'No readings recorded yet.',
                                    style: AppTextStyles.caption.copyWith(
                                        color: AppColors.textSecondary),
                                  ),
                                ),
                              )
                            else
                              ..._history.map((r) => Padding(
                                    padding: const EdgeInsets.only(bottom: 10),
                                    child: _ReadingCard(
                                      r: r,
                                      canManage: widget.canManage,
                                      onEdit: () => _editReading(r),
                                      onDelete: () => _deleteReading(r),
                                    ),
                                  )),
                          ],
                        ),
                      ),
      ),
    );
  }

  Widget _personCard(_PphAttendee a) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(a.name,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.bold)),
                ),
                if (a.sex != null && a.sex!.isNotEmpty)
                  _statusChip(a.sex!, _sexColor(a.sex)),
              ],
            ),
            const SizedBox(height: 8),
            _kv(Icons.phone_outlined, a.mobileNo.isEmpty ? '–' : a.mobileNo),
            if (a.address != null && a.address!.isNotEmpty)
              _kv(Icons.location_on_outlined, a.address!),
            _kv(
              a.isConsentedForMessages
                  ? Icons.check_circle_outline
                  : Icons.cancel_outlined,
              a.isConsentedForMessages
                  ? 'Consented for health messages'
                  : 'Not consented for messages',
              color: a.isConsentedForMessages
                  ? AppColors.success
                  : AppColors.textSecondary,
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(IconData icon, String text, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: color ?? AppColors.textSecondary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text,
                style: AppTextStyles.caption
                    .copyWith(color: color ?? AppColors.textSecondary)),
          ),
        ],
      ),
    );
  }
}

String _fmtDate(DateTime? d) {
  if (d == null || d.year <= 1) return '–';
  return DateFormat('dd MMM yyyy').format(d);
}

class _ReadingCard extends StatelessWidget {
  final _PphReading r;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ReadingCard({
    required this.r,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final bp = (r.bpSystolic != null && r.bpDiastolic != null)
        ? '${r.bpSystolic}/${r.bpDiastolic} mmHg'
        : null;
    final sugar = (r.bloodSugarValue != null)
        ? '${r.bloodSugarValue!.toStringAsFixed(0)} mg/dl'
            '${r.bloodSugarType != null && r.bloodSugarType!.isNotEmpty ? ' (${r.bloodSugarType})' : ''}'
        : null;

    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.event_note_outlined,
                    size: 16, color: AppColors.primary),
                const SizedBox(width: 6),
                Text(
                  _fmtDate(r.readingDate),
                  style: AppTextStyles.bodyMedium
                      .copyWith(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                if (r.registrationNo != null && r.registrationNo!.isNotEmpty)
                  Text('Reg #${r.registrationNo}',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary)),
                if (canManage)
                  PopupMenuButton<String>(
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.more_vert, size: 18),
                    onSelected: (v) {
                      if (v == 'edit') onEdit();
                      if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Edit')),
                      PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete',
                            style: TextStyle(color: AppColors.error)),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (r.age != null) _statusChip('Age ${r.age}', AppColors.info),
                if (bp != null) _statusChip(bp, AppColors.textSecondary),
                if (sugar != null)
                  _statusChip(sugar, AppColors.textSecondary),
                if (r.bmi != null)
                  _statusChip('${r.bmi!.toStringAsFixed(1)} BMI',
                      r.isObese
                          ? AppColors.error
                          : (r.isOverweight
                              ? AppColors.warning
                              : AppColors.success)),
                if (r.bpStatus != null &&
                    r.bpStatus!.isNotEmpty &&
                    r.bpStatus != 'None')
                  _statusChip('BP: ${r.bpStatus}', _conditionColor(r.bpStatus)),
                if (r.diabetesStatus != null &&
                    r.diabetesStatus!.isNotEmpty &&
                    r.diabetesStatus != 'None')
                  _statusChip(
                      r.diabetesStatus!, _conditionColor(r.diabetesStatus)),
              ],
            ),
            if (r.remarks != null && r.remarks!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(r.remarks!,
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary)),
            ],
          ],
        ),
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════
// Reading editor — add (person + medical → POST /readings) or edit one
// reading (medical only → PUT /readings/{id})
// ════════════════════════════════════════════════════════════════════════
class _ReadingEditorPage extends StatefulWidget {
  final String campBase;

  /// Generic add from the attendee list — mobile-first reuse matches one of
  /// these existing attendees.
  final List<_PphAttendee> campAttendees;

  /// Add a reading for a known attendee (person fields prefilled + locked).
  final _PphAttendee? seedAttendee;

  /// Edit an existing reading (medical fields only).
  final _PphReading? editReading;

  const _ReadingEditorPage({
    required this.campBase,
    this.campAttendees = const [],
    this.seedAttendee,
    this.editReading,
  });

  @override
  State<_ReadingEditorPage> createState() => _ReadingEditorPageState();
}

class _ReadingEditorPageState extends State<_ReadingEditorPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _nameCtrl;
  late final TextEditingController _mobileCtrl;
  late final TextEditingController _addressCtrl;
  late final TextEditingController _ageCtrl;
  late final TextEditingController _bpSysCtrl;
  late final TextEditingController _bpDiaCtrl;
  late final TextEditingController _sugarValCtrl;
  late final TextEditingController _heightCtrl;
  late final TextEditingController _weightCtrl;
  late final TextEditingController _bmiCtrl;
  late final TextEditingController _remarksCtrl;

  String? _sex;
  String? _bpStatus;
  String? _bloodSugarType;
  String? _diabetesStatus;
  bool _isConsented = false;
  bool _saving = false;

  // Mobile-first reuse (generic add only).
  String? _reusedName;
  String? _lastAppliedMobile;

  bool get _isEdit => widget.editReading != null;
  bool get _personLocked => _isEdit || widget.seedAttendee != null;

  String get _base => widget.campBase;

  @override
  void initState() {
    super.initState();
    final r = widget.editReading;
    final seed = widget.seedAttendee;

    _nameCtrl = TextEditingController(text: seed?.name ?? '');
    _mobileCtrl = TextEditingController(text: seed?.mobileNo ?? '');
    _addressCtrl = TextEditingController(text: seed?.address ?? '');
    _sex = _validOrNull(seed?.sex, _sexOptions);
    _isConsented = seed?.isConsentedForMessages ?? false;

    _ageCtrl = TextEditingController(text: r?.age?.toString() ?? '');
    _bpSysCtrl = TextEditingController(text: r?.bpSystolic?.toString() ?? '');
    _bpDiaCtrl = TextEditingController(text: r?.bpDiastolic?.toString() ?? '');
    _sugarValCtrl =
        TextEditingController(text: r?.bloodSugarValue?.toString() ?? '');
    _heightCtrl = TextEditingController(text: r?.heightCm?.toString() ?? '');
    _weightCtrl = TextEditingController(text: r?.weightKg?.toString() ?? '');
    _bmiCtrl = TextEditingController(text: r?.bmi?.toString() ?? '');
    _remarksCtrl = TextEditingController(text: r?.remarks ?? '');

    _bloodSugarType = _validOrNull(r?.bloodSugarType, _bloodSugarTypeOptions);
    _bpStatus = _validOrNull(r?.bpStatus, _bpStatusOptions);
    _diabetesStatus = _validOrNull(r?.diabetesStatus, _diabetesOptions);

    _heightCtrl.addListener(_autoBmi);
    _weightCtrl.addListener(_autoBmi);
    _autoBmi();

    // Mobile-first reuse only applies to a generic add (no seed, not editing).
    if (!_personLocked) {
      _mobileCtrl.addListener(_onMobileChanged);
    }
  }

  String? _validOrNull(String? v, List<String> options) {
    if (v == null) return null;
    return options.contains(v) ? v : null;
  }

  /// BMI is display-only — the server recomputes it (and overweight/obese).
  void _autoBmi() {
    final h = double.tryParse(_heightCtrl.text.trim());
    final w = double.tryParse(_weightCtrl.text.trim());
    if (h == null || w == null || h <= 0 || w <= 0) {
      if (_bmiCtrl.text.isNotEmpty) _bmiCtrl.text = '';
      return;
    }
    final m = h / 100.0;
    final rounded = ((w / (m * m)) * 10).roundToDouble() / 10;
    _bmiCtrl.text = rounded.toStringAsFixed(1);
  }

  /// Cross-club history for the typed mobile — informational only. Looked up
  /// once the number is long enough to identify a person, debounced so typing
  /// doesn't fire a request per keystroke.
  PphMobileHistory? _mobileHistory;
  Timer? _historyDebounce;
  String? _historyForMobile;

  void _onMobileChangedHistory() {
    final digits = _mobileCtrl.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 7) { // shortest plausible international number
      _historyDebounce?.cancel();
      _historyForMobile = null;
      if (_mobileHistory != null) setState(() => _mobileHistory = null);
      return;
    }
    if (digits == _historyForMobile) return; // already looked this one up
    _historyDebounce?.cancel();
    _historyDebounce = Timer(const Duration(milliseconds: 450), () async {
      final h = await fetchPphMobileHistory(_api, widget.campBase, digits);
      if (!mounted) return;
      _historyForMobile = digits;
      // Only surface it when there IS something — a first-time attendee should
      // see no extra noise on the form.
      setState(() => _mobileHistory = (h == null || h.isEmpty) ? null : h);
    });
  }

  void _onMobileChanged() {
    _onMobileChangedHistory();
    final m = _mobileCtrl.text.trim();
    if (m.isEmpty) {
      if (_reusedName != null) {
        setState(() {
          _reusedName = null;
          _lastAppliedMobile = null;
        });
      }
      return;
    }
    if (m == _lastAppliedMobile) return;
    _PphAttendee? match;
    for (final a in widget.campAttendees) {
      if (a.mobileNo.trim() == m) {
        match = a;
        break;
      }
    }
    if (match == null) {
      _lastAppliedMobile = null;
      if (_reusedName != null) setState(() => _reusedName = null);
      return;
    }
    _lastAppliedMobile = m;
    setState(() {
      _nameCtrl.text = match!.name;
      _addressCtrl.text = match.address ?? '';
      _sex = _validOrNull(match.sex, _sexOptions);
      _isConsented = match.isConsentedForMessages;
      _reusedName = match.name;
    });
  }

  @override
  void dispose() {
    _historyDebounce?.cancel();
    _nameCtrl.dispose();
    _mobileCtrl.dispose();
    _addressCtrl.dispose();
    _ageCtrl.dispose();
    _bpSysCtrl.dispose();
    _bpDiaCtrl.dispose();
    _sugarValCtrl.dispose();
    _heightCtrl.dispose();
    _weightCtrl.dispose();
    _bmiCtrl.dispose();
    _remarksCtrl.dispose();
    super.dispose();
  }

  int? _toInt(String s) => int.tryParse(s.trim());
  double? _toDouble(String s) => double.tryParse(s.trim());
  String? _strOrNull(String s) {
    final t = s.trim();
    return t.isEmpty ? null : t;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        // Medical fields only (UpdatePphReadingDto).
        final body = <String, dynamic>{
          'age': _toInt(_ageCtrl.text),
          'bpSystolic': _toInt(_bpSysCtrl.text),
          'bpDiastolic': _toInt(_bpDiaCtrl.text),
          'bloodSugarType': _bloodSugarType,
          'bloodSugarValue': _toDouble(_sugarValCtrl.text),
          'heightCm': _toDouble(_heightCtrl.text),
          'weightKg': _toDouble(_weightCtrl.text),
          'diabetesStatus': _diabetesStatus,
          'bpStatus': _bpStatus,
          'remarks': _strOrNull(_remarksCtrl.text),
        };
        await _api.put('$_base/readings/${widget.editReading!.id}', body: body);
      } else {
        // Person + one reading (CreatePphReadingDto). Server reuses the attendee
        // when (camp, mobile) already exists, else creates them. BMI/overweight/
        // obese are computed server-side and not sent.
        final body = <String, dynamic>{
          'name': _nameCtrl.text.trim(),
          'mobileNo': _mobileCtrl.text.trim(),
          'sex': _sex,
          'address': _strOrNull(_addressCtrl.text),
          'age': _toInt(_ageCtrl.text),
          'bpSystolic': _toInt(_bpSysCtrl.text),
          'bpDiastolic': _toInt(_bpDiaCtrl.text),
          'bloodSugarType': _bloodSugarType,
          'bloodSugarValue': _toDouble(_sugarValCtrl.text),
          'heightCm': _toDouble(_heightCtrl.text),
          'weightKg': _toDouble(_weightCtrl.text),
          'diabetesStatus': _diabetesStatus,
          'bpStatus': _bpStatus,
          'isConsentedForMessages': _isConsented,
          'remarks': _strOrNull(_remarksCtrl.text),
        };
        await _api.post('$_base/readings', body: body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Save failed: $e';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    }
  }

  // ── Validators mirroring the backend DTO ranges ──
  String? _reqInt(String? v, String label, {int? min, int? max}) {
    final t = (v ?? '').trim();
    if (t.isEmpty) return '$label is required';
    final n = int.tryParse(t);
    if (n == null) return 'Enter a valid number';
    if (min != null && n < min) return '$label must be ≥ $min';
    if (max != null && n > max) return '$label must be ≤ $max';
    return null;
  }

  String? _reqNum(String? v, String label, {num? min, num? max}) {
    final t = (v ?? '').trim();
    if (t.isEmpty) return '$label is required';
    final n = double.tryParse(t);
    if (n == null) return 'Enter a valid number';
    if (min != null && n < min) return '$label must be ≥ $min';
    if (max != null && n > max) return '$label must be ≤ $max';
    return null;
  }

  Widget _sectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 10),
      child: Text(
        title,
        style: AppTextStyles.bodyMedium
            .copyWith(fontWeight: FontWeight.bold, color: AppColors.primary),
      ),
    );
  }

  Widget _dropdown({
    required String label,
    required String? value,
    required List<String> options,
    required ValueChanged<String?> onChanged,
    bool required = false,
    Map<String, String>? labels,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: required ? '$label *' : label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      ),
      items: [
        if (!required)
          const DropdownMenuItem<String>(value: null, child: Text('–')),
        ...options.map((o) =>
            DropdownMenuItem<String>(value: o, child: Text(labels?[o] ?? o))),
      ],
      validator: required
          ? (v) => (v == null || v.isEmpty) ? '$label is required' : null
          : null,
      onChanged: _saving ? null : onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = _isEdit
        ? 'Edit Reading'
        : (_personLocked ? 'Add Reading' : 'Add Attendee Reading');
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: title,
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    _isEdit ? 'Update' : 'Save',
                    style: AppTextStyles.bodyMedium.copyWith(
                        color: AppColors.white, fontWeight: FontWeight.w600),
                  ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            if (_reusedName != null)
              Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.info.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(8),
                  border:
                      Border.all(color: AppColors.info.withValues(alpha: 0.4)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.info_outline,
                        size: 18, color: AppColors.info),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Existing attendee "$_reusedName": details reused. '
                        'A new reading will be added.',
                        style: AppTextStyles.caption,
                      ),
                    ),
                  ],
                ),
              ),
            // ── Person section (hidden when editing a single reading) ──
            if (!_isEdit) ...[
              _sectionHeader('Attendee'),
              if (_personLocked)
                Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.muted,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Adding a new reading for ${_nameCtrl.text} '
                    '(${_mobileCtrl.text}).',
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textSecondary),
                  ),
                )
              else ...[
                CustomTextField(
                  label: 'Mobile No *',
                  controller: _mobileCtrl,
                  hint: 'Enter mobile number first',
                  keyboardType: TextInputType.phone,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: (v) => (v == null || v.trim().isEmpty)
                      ? 'Mobile number is required'
                      : null,
                ),
                if (_mobileHistory != null) ...[
                  const SizedBox(height: 10),
                  PphHistoryBanner(
                    history: _mobileHistory!,
                    onView: () =>
                        showPphHistorySheet(context, _mobileHistory!),
                  ),
                ],
                const SizedBox(height: 12),
                CustomTextField(
                  label: 'Name *',
                  controller: _nameCtrl,
                  hint: 'Full name',
                  validator: (v) => (v == null || v.trim().isEmpty)
                      ? 'Name is required'
                      : null,
                ),
                const SizedBox(height: 12),
                _dropdown(
                  label: 'Sex',
                  value: _sex,
                  options: _sexOptions,
                  required: true,
                  onChanged: (v) => setState(() => _sex = v),
                ),
                const SizedBox(height: 12),
                CustomTextField(
                  label: 'Address *',
                  controller: _addressCtrl,
                  hint: 'Enter address',
                  maxLines: 2,
                  validator: (v) => (v == null || v.trim().isEmpty)
                      ? 'Address is required'
                      : null,
                ),
              ],
            ],

            _sectionHeader('Medical Reading'),
            CustomTextField(
              label: 'Age *',
              controller: _ageCtrl,
              hint: 'Years',
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              validator: (v) => _reqInt(v, 'Age', min: 1, max: 150),
            ),
            const SizedBox(height: 12),
            Text('Blood Pressure (mmHg) *', style: AppTextStyles.bodyMedium),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: CustomTextField(
                    label: 'Systolic',
                    controller: _bpSysCtrl,
                    hint: 'mmHg',
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: (v) =>
                        _reqInt(v, 'Systolic', min: 1, max: 400),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: CustomTextField(
                    label: 'Diastolic',
                    controller: _bpDiaCtrl,
                    hint: 'mmHg',
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: (v) =>
                        _reqInt(v, 'Diastolic', min: 1, max: 300),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('Blood Sugar (mg/dl) *', style: AppTextStyles.bodyMedium),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: CustomTextField(
                    label: 'Value',
                    controller: _sugarValCtrl,
                    hint: 'mg/dl',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*')),
                    ],
                    validator: (v) =>
                        _reqNum(v, 'Blood sugar', min: 1, max: 2000),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _dropdown(
                    label: 'FBS / RBS',
                    value: _bloodSugarType,
                    options: _bloodSugarTypeOptions,
                    labels: _bloodSugarTypeLabels,
                    required: true,
                    onChanged: (v) => setState(() => _bloodSugarType = v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: CustomTextField(
                    label: 'Height (cm) *',
                    controller: _heightCtrl,
                    hint: 'cm',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*')),
                    ],
                    validator: (v) => _reqNum(v, 'Height', min: 1, max: 300),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: CustomTextField(
                    label: 'Weight (kg) *',
                    controller: _weightCtrl,
                    hint: 'kg',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*')),
                    ],
                    validator: (v) => _reqNum(v, 'Weight', min: 1, max: 500),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'BMI (auto-calculated)',
              controller: _bmiCtrl,
              hint: 'Computed from height & weight',
              readOnly: true,
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: 'Diabetes Status',
              value: _diabetesStatus,
              options: _diabetesOptions,
              onChanged: (v) => setState(() => _diabetesStatus = v),
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: 'BP Status',
              value: _bpStatus,
              options: _bpStatusOptions,
              onChanged: (v) => setState(() => _bpStatus = v),
            ),
            // Consent belongs to the person, so only collect it when creating /
            // reusing an attendee (not when editing a single reading).
            if (!_isEdit) ...[
              const SizedBox(height: 4),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text(
                    'Consented for health-related messages on mobile'),
                value: _isConsented,
                onChanged: _saving
                    ? null
                    : (v) => setState(() => _isConsented = v ?? false),
              ),
            ],
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Remarks',
              controller: _remarksCtrl,
              hint: 'Optional notes',
              maxLines: 3,
            ),
            const SizedBox(height: 24),
          ],
          ),
        ),
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════
// Attendee editor — person fields only (PUT /attendees/{id})
// ════════════════════════════════════════════════════════════════════════
class _AttendeeEditorPage extends StatefulWidget {
  final String campBase;
  final _PphAttendee attendee;

  const _AttendeeEditorPage({
    required this.campBase,
    required this.attendee,
  });

  @override
  State<_AttendeeEditorPage> createState() => _AttendeeEditorPageState();
}

class _AttendeeEditorPageState extends State<_AttendeeEditorPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _nameCtrl;
  late final TextEditingController _mobileCtrl;
  late final TextEditingController _addressCtrl;
  String? _sex;
  bool _isConsented = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final a = widget.attendee;
    _nameCtrl = TextEditingController(text: a.name);
    _mobileCtrl = TextEditingController(text: a.mobileNo);
    _addressCtrl = TextEditingController(text: a.address ?? '');
    _sex = _sexOptions.contains(a.sex) ? a.sex : null;
    _isConsented = a.isConsentedForMessages;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _mobileCtrl.dispose();
    _addressCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'name': _nameCtrl.text.trim(),
        'mobileNo': _mobileCtrl.text.trim(),
        'sex': _sex,
        'address': _addressCtrl.text.trim(),
        'isConsentedForMessages': _isConsented,
      };
      await _api.put('${widget.campBase}/attendees/${widget.attendee.id}',
          body: body);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Save failed: $e';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Edit Attendee',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : Text('Update',
                    style: AppTextStyles.bodyMedium.copyWith(
                        color: AppColors.white, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            CustomTextField(
              label: 'Mobile No *',
              controller: _mobileCtrl,
              hint: 'Mobile number',
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Mobile number is required'
                  : null,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Name *',
              controller: _nameCtrl,
              hint: 'Full name',
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Name is required' : null,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _sex,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Sex *',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              items: _sexOptions
                  .map((o) =>
                      DropdownMenuItem<String>(value: o, child: Text(o)))
                  .toList(),
              validator: (v) =>
                  (v == null || v.isEmpty) ? 'Sex is required' : null,
              onChanged: _saving ? null : (v) => setState(() => _sex = v),
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Address *',
              controller: _addressCtrl,
              hint: 'Enter address',
              maxLines: 2,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Address is required' : null,
            ),
            const SizedBox(height: 4),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text(
                  'Consented for health-related messages on mobile'),
              value: _isConsented,
              onChanged: _saving
                  ? null
                  : (v) => setState(() => _isConsented = v ?? false),
            ),
          ],
          ),
        ),
      ),
    );
  }
}
