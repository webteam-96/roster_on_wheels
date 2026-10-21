import 'package:flutter/material.dart';
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
import 'assign_clubs_form_screen.dart';

// ---------------------------------------------------------------------------
// Private models
// ---------------------------------------------------------------------------
class _ModeratorClub {
  final int id;
  final String clubName;
  final String clubRotaryId;
  const _ModeratorClub({
    required this.id,
    required this.clubName,
    required this.clubRotaryId,
  });
}

class _ModeratorGroup {
  final int memberId;
  final String memberName;
  final String mobile;
  final String email;
  final String? profilePhoto;
  final List<_ModeratorClub> clubs;

  _ModeratorGroup({
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

List<_ModeratorGroup> _groupRows(List<dynamic> rows) {
  final map = <int, _ModeratorGroup>{};
  for (final r in rows) {
    final m = r as Map<String, dynamic>;
    final mid = (m['memberId'] as int?) ?? 0;
    if (mid == 0) continue;
    map.putIfAbsent(
      mid,
      () => _ModeratorGroup(
        memberId: mid,
        memberName: m['memberName']?.toString() ?? '',
        mobile: m['mobile']?.toString() ?? '',
        email: m['email']?.toString() ?? '',
        profilePhoto: m['profilePhoto']?.toString(),
        clubs: [],
      ),
    );
    map[mid]!.clubs.add(_ModeratorClub(
          id: (m['clubId'] as int?) ?? 0,
          clubName: m['clubName']?.toString() ?? '',
          clubRotaryId: m['clubRotaryId']?.toString() ?? '',
        ));
  }
  return map.values.toList();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictClubModeratorScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictClubModeratorScreen({super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictClubModeratorScreen> createState() =>
      _DistrictClubModeratorScreenState();
}

class _DistrictClubModeratorScreenState
    extends State<DistrictClubModeratorScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_ModeratorGroup> _groups = [];

  String get _base => '/api/districts/${widget.districtId}/club-moderators';

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
      final resp = await _api.get<List<dynamic>>(
        _base,
        fromJson: (j) => j as List<dynamic>,
      );
      final rows = resp.data ?? [];
      setState(() {
        _groups = _groupRows(rows);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _groups = [];
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

  Future<void> _confirmDelete(_ModeratorGroup g) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove Moderator?'),
        content: Text(
            "Remove moderator '${g.memberName}'? This will unassign them from all their clubs."),
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
      await _api.delete('$_base/member/${g.memberId}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  Future<void> _openForm({_ModeratorGroup? editing}) async {
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
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AssignClubsFormScreen(
          title: 'Club Moderator',
          searchEndpoint: '$_base/search-members',
          availableClubsEndpoint: '$_base/available-clubs',
          saveEndpoint: _base,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetch();
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
        title: 'Club Moderator',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add Moderator',
              onPressed: () => _openForm(),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    if (_groups.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: EmptyStateWidget(
                title: 'No moderators assigned',
                subtitle: canManage
                    ? 'Tap "Add Moderator" to assign your first Club Moderator.'
                    : 'No club moderators have been assigned for this district.',
                icon: Icons.shield_outlined,
              ),
            ),
            if (canManage)
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: CustomButton(
                  label: 'Add Moderator',
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
        itemBuilder: (_, i) => _ModeratorCard(
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
class _ModeratorCard extends StatelessWidget {
  final _ModeratorGroup group;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ModeratorCard({
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
