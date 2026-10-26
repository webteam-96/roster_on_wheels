import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_button.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/rotary_year_bar.dart';
import 'assign_clubs_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Private models
// ---------------------------------------------------------------------------
class _AGClub {
  final int id;
  final String clubName;
  final String clubRotaryId;
  const _AGClub({
    required this.id,
    required this.clubName,
    required this.clubRotaryId,
  });
}

class _AGGroup {
  final int memberId;
  final String memberName;
  final String mobile;
  final String email;
  final String? profilePhoto;
  final List<_AGClub> clubs;

  _AGGroup({
    required this.memberId,
    required this.memberName,
    required this.mobile,
    required this.email,
    required this.profilePhoto,
    required this.clubs,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String? _photoUrl(String? path) {
  final url = ApiConstants.mediaUrl(path);
  return url.isEmpty ? null : url;
}

String _initials(String name) {
  final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts[0][0].toUpperCase();
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

List<_AGGroup> _groupRows(List<dynamic> rows) {
  final map = <int, _AGGroup>{};
  final seenClubsByMember = <int, Set<String>>{};
  for (final r in rows) {
    final m = r as Map<String, dynamic>;
    final mid = (m['memberId'] as int?) ?? 0;
    if (mid == 0) continue;
    map.putIfAbsent(
      mid,
      () => _AGGroup(
        memberId: mid,
        memberName: m['memberName']?.toString() ?? '',
        mobile: m['mobile']?.toString() ?? '',
        email: m['email']?.toString() ?? '',
        profilePhoto: m['profilePhoto']?.toString(),
        clubs: [],
      ),
    );
    final clubId = (m['clubId'] as int?) ?? 0;
    final clubName = m['clubName']?.toString() ?? '';
    final clubKey = clubId > 0 ? 'id:$clubId' : 'name:${clubName.toLowerCase()}';
    final seen = seenClubsByMember.putIfAbsent(mid, () => <String>{});
    if (!seen.add(clubKey)) continue;
    map[mid]!.clubs.add(_AGClub(
          id: clubId,
          clubName: clubName,
          clubRotaryId: m['clubRotaryId']?.toString() ?? '',
        ));
  }
  return map.values.toList();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictAgScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictAgScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictAgScreen> createState() => _DistrictAgScreenState();
}

class _DistrictAgScreenState extends State<DistrictAgScreen> {
  final _api = ApiClient();
  bool _loading = true; // initial load (years + first listing)
  bool _listLoading = false; // re-fetch when the year changes
  String? _error;
  List<_AGGroup> _groups = [];

  // Years: the listing filter shows only years that HAVE data; the add/edit
  // form shows ALL rotary years (mirrors the web AG page).
  List<AssignClubsYear> _dataYears = [];
  List<AssignClubsYear> _allYears = [];
  int? _selectedYearId;

  String get _base => '/api/districts/${widget.districtId}/ag';

  int? get _currentYearId {
    for (final y in _allYears) {
      if (y.isCurrent) return y.id;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.get<List<dynamic>>('$_base/years-with-data',
            fromJson: (j) => j as List<dynamic>),
        _api.get<List<dynamic>>('/api/rotary-years',
            fromJson: (j) => j as List<dynamic>),
      ]);
      final dataYears = (results[0].data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AssignClubsYear.fromJson)
          .toList();
      final allYears = (results[1].data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AssignClubsYear.fromJson)
          .toList();
      final current = dataYears.firstWhere(
        (y) => y.isCurrent,
        orElse: () => dataYears.isNotEmpty
            ? dataYears.first
            : const AssignClubsYear(id: 0, yearLabel: ''),
      );
      if (!mounted) return;
      setState(() {
        _dataYears = dataYears;
        _allYears = allYears;
        _selectedYearId = current.id != 0 ? current.id : null;
      });
      if (_selectedYearId != null) {
        await _fetchAgs(_selectedYearId!);
      }
      if (!mounted) return;
      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _fetchAgs(int yearId) async {
    setState(() {
      _listLoading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        _base,
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _groups = _groupRows(resp.data ?? []);
        _listLoading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 404) {
        setState(() {
          _groups = [];
          _listLoading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _listLoading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _listLoading = false;
      });
    }
  }

  void _onYearChanged(int? v) {
    if (v == null || v == _selectedYearId) return;
    setState(() => _selectedYearId = v);
    _fetchAgs(v);
  }

  // After add/edit/delete a year may gain its first record or lose its last, so
  // reload the data-year list and keep a sensible selection. [preferYearId] is
  // the year that was just saved — select it if it now has data.
  Future<void> _reconcileAfterChange({int? preferYearId}) async {
    List<AssignClubsYear> dy;
    try {
      final resp = await _api.get<List<dynamic>>('$_base/years-with-data',
          fromJson: (j) => j as List<dynamic>);
      dy = (resp.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AssignClubsYear.fromJson)
          .toList();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    setState(() => _dataYears = dy);

    if (preferYearId != null && dy.any((y) => y.id == preferYearId)) {
      if (preferYearId != _selectedYearId) {
        setState(() => _selectedYearId = preferYearId);
      }
      await _fetchAgs(preferYearId);
      return;
    }
    if (_selectedYearId != null && dy.any((y) => y.id == _selectedYearId)) {
      await _fetchAgs(_selectedYearId!);
      return;
    }
    final current = dy.firstWhere(
      (y) => y.isCurrent,
      orElse: () => dy.isNotEmpty
          ? dy.first
          : const AssignClubsYear(id: 0, yearLabel: ''),
    );
    if (current.id != 0) {
      setState(() => _selectedYearId = current.id);
      await _fetchAgs(current.id);
    } else {
      setState(() {
        _selectedYearId = null;
        _groups = [];
      });
    }
  }

  Future<void> _confirmDelete(_AGGroup g) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove AG?'),
        content: Text(
            "Remove AG '${g.memberName}'? This will unassign them from all their clubs."),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remove',
                style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      // Year-scoped delete: remove only the selected year's assignment.
      final path = _selectedYearId != null
          ? '$_base/member/${g.memberId}?yearId=$_selectedYearId'
          : '$_base/member/${g.memberId}';
      await _api.delete(path);
      if (mounted) await _reconcileAfterChange();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  Future<void> _openForm({_AGGroup? editing}) async {
    final initial = editing == null
        ? null
        : AssignClubsFormInitial(
            memberId: editing.memberId,
            memberName: editing.memberName,
            mobile: editing.mobile,
            email: editing.email,
            profilePhoto: editing.profilePhoto,
            alreadyAssignedClubs: editing.clubs
                .map((c) => AssignClubsAvailable(
                      id: c.id,
                      clubName: c.clubName,
                      clubRotaryId: c.clubRotaryId,
                    ))
                .toList(),
          );
    // Add defaults to the current rotary year; edit opens on the year being
    // viewed. The form lists ALL years so an AG can be assigned for any year.
    final addDefault = _currentYearId ??
        _selectedYearId ??
        (_allYears.isNotEmpty ? _allYears.first.id : null);
    final formYearId = editing == null ? addDefault : _selectedYearId;

    final result = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => AssignClubsFormScreen(
          title: 'Assistant Governor',
          searchEndpoint: '$_base/search-members',
          availableClubsEndpoint: '$_base/available-clubs',
          saveEndpoint: _base,
          initial: initial,
          years: _allYears,
          initialYearId: formYearId,
        ),
      ),
    );
    if (!mounted) return;
    // The form returns the saved yearId (int) on success, so we can jump the
    // listing to that year.
    if (result is int) {
      await _reconcileAfterChange(preferYearId: result);
    } else if (result == true) {
      await _reconcileAfterChange();
    }
  }


  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : CustomAppBar(
        title: 'Assistant Governor (AG)',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add AG',
              onPressed: () => _openForm(),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadInitial)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    return Column(
      children: [
        if (_dataYears.isNotEmpty) _buildYearBar(),
        Expanded(child: _buildList(canManage)),
      ],
    );
  }

  Widget _buildYearBar() {
    return RotaryYearBar<int>(
      value: _selectedYearId,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      options: [
        for (final y in _dataYears)
          RotaryYearOption(
              value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
      ],
      onChanged: _listLoading ? null : _onYearChanged,
    );
  }

  Widget _buildList(bool canManage) {
    if (_listLoading && _groups.isEmpty) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_groups.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: EmptyStateWidget(
                title: 'No assistant governors',
                subtitle: canManage
                    ? 'Tap "Add AG" to assign your first Assistant Governor.'
                    : 'No assistant governors have been assigned for this district.',
                icon: Icons.supervisor_account_outlined,
              ),
            ),
            if (canManage)
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: CustomButton(
                  label: 'Add AG',
                  icon: Icons.add,
                  onPressed: () => _openForm(),
                ),
              ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(16),
      child: ListView.separated(
        itemCount: _groups.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (_, i) => _AGCard(
          group: _groups[i],
          canManage: canManage,
          onEdit: () => _openForm(editing: _groups[i]),
          onDelete: () => _confirmDelete(_groups[i]),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _AGCard extends StatelessWidget {
  final _AGGroup group;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _AGCard({
    required this.group,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final photo = _photoUrl(group.profilePhoto);
    final mobile = group.mobile.trim();
    final email = group.email.trim();
    final mobileEmail = [
      if (mobile.isNotEmpty) mobile,
      if (email.isNotEmpty) email,
    ].join(' · ');

    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.primary.withValues(alpha: 0.12),
                    border: Border.all(color: AppColors.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: photo != null
                      ? Image.network(
                          photo,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Center(
                            child: Text(
                              _initials(group.memberName),
                              style: const TextStyle(
                                color: AppColors.primary,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        )
                      : Center(
                          child: Text(
                            _initials(group.memberName),
                            style: const TextStyle(
                              color: AppColors.primary,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        group.memberName.isEmpty
                            ? 'Unnamed'
                            : group.memberName,
                        style: AppTextStyles.bodyMedium
                            .copyWith(fontWeight: FontWeight.bold),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (mobileEmail.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          mobileEmail,
                          style: AppTextStyles.caption
                              .copyWith(color: AppColors.textSecondary),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                if (canManage) ...[
                  IconButton(
                    tooltip: 'Edit',
                    icon: const Icon(Icons.edit_outlined, size: 20),
                    onPressed: onEdit,
                  ),
                  IconButton(
                    tooltip: 'Remove',
                    icon: const Icon(Icons.delete_outline,
                        size: 20, color: AppColors.error),
                    onPressed: onDelete,
                  ),
                ],
              ],
            ),
            if (group.clubs.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: group.clubs
                    .map((c) => Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.business_rounded,
                                  size: 14, color: AppColors.primary),
                              const SizedBox(width: 4),
                              Text(
                                c.clubName,
                                style: AppTextStyles.caption.copyWith(
                                  color: AppColors.primary,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ))
                    .toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
