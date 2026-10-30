import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import 'committee_member_form_screen.dart';
import 'district_committee_member_detail_screen.dart';
import 'district_committee_sub_group_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Shared models
// ---------------------------------------------------------------------------
class _SubGroup {
  final int id;
  final String subGroupName;
  final int groupId;
  const _SubGroup({
    required this.id,
    required this.subGroupName,
    required this.groupId,
  });

  factory _SubGroup.fromJson(Map<String, dynamic> j) => _SubGroup(
        id: (j['id'] as int?) ?? 0,
        subGroupName: j['subGroupName']?.toString() ?? '',
        groupId: (j['groupId'] as int?) ?? 0,
      );
}

class _Member {
  final int id;
  final bool isMember;
  final int? memberId;
  final String name;
  final String mobile;
  final String email;
  final String designation;
  final String clubName;
  final String remark;
  final String profilePhoto;

  const _Member({
    required this.id,
    required this.isMember,
    this.memberId,
    required this.name,
    required this.mobile,
    required this.email,
    required this.designation,
    required this.clubName,
    required this.remark,
    required this.profilePhoto,
  });

  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        id: (j['id'] as int?) ?? 0,
        isMember: j['isMember'] as bool? ?? false,
        memberId: j['memberId'] as int?,
        name: j['name']?.toString() ?? '',
        mobile: j['mobile']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        designation: j['designation']?.toString() ?? '',
        clubName: j['clubName']?.toString() ?? '',
        remark: j['remark']?.toString() ?? '',
        profilePhoto: j['profilePhoto']?.toString() ?? '',
      );
}


// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
String? _photoUrl(String? path) {
  final url = ApiConstants.mediaUrl(path);
  return url.isEmpty ? null : url;
}

String _initials(String name) {
  final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return 'M';
  if (parts.length == 1) return parts[0][0].toUpperCase();
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

// ===========================================================================
// Widget 1: Sub-Groups list screen
// ===========================================================================
class CommitteeSubGroupsListScreen extends StatefulWidget {
  final int districtId;
  final int groupId;
  final String groupName;

  const CommitteeSubGroupsListScreen({
    super.key,
    required this.districtId,
    required this.groupId,
    required this.groupName,
  });

  @override
  State<CommitteeSubGroupsListScreen> createState() =>
      _CommitteeSubGroupsListScreenState();
}

class _CommitteeSubGroupsListScreenState
    extends State<CommitteeSubGroupsListScreen> {
  final _api = ApiClient();
  static const Color _accent = AppColors.accentBlue;

  bool _loading = true;
  String? _error;
  List<_SubGroup> _subGroups = [];

  String get _base =>
      '/api/districts/${widget.districtId}/committee/groups/${widget.groupId}/sub-groups';

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
      final list = (resp.data ?? [])
          .map((e) => _SubGroup.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _subGroups = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _subGroups = [];
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

  Future<void> _openSubGroupForm({_SubGroup? existing}) async {
    final initial = existing == null
        ? null
        : SubGroupFormInitial(id: existing.id, subGroupName: existing.subGroupName);
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictCommitteeSubGroupFormScreen(
          districtId: widget.districtId,
          groupId: widget.groupId,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetch();
  }


  Future<void> _confirmDelete(_SubGroup sg) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Sub-Group'),
        content: Text(
            "Delete sub-group '${sg.subGroupName}'? This will also remove all its members."),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('$_base/${sg.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  void _openSubGroup(_SubGroup sg) {
    final encoded = Uri.encodeComponent(sg.subGroupName);
    context.push(
        '/districts/${widget.districtId}/district-committee/groups/${widget.groupId}/sub-groups/${sg.id}?name=$encoded');
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Sub-Groups',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add Sub-Group',
              onPressed: () => _openSubGroupForm(),
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
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.groupName,
            style: AppTextStyles.bodyLarge.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            'Parent Group',
            style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 16),
          if (_subGroups.isEmpty)
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Expanded(
                    child: EmptyStateWidget(
                      title: 'No sub-groups yet',
                      subtitle: canManage
                          ? 'Tap "Add Sub-Group" to create one.'
                          : 'No sub-groups added yet.',
                      icon: Icons.layers_outlined,
                    ),
                  ),
                  if (canManage)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 24),
                      child: CustomButton(
                        label: 'Add Sub-Group',
                        icon: Icons.add,
                        onPressed: () => _openSubGroupForm(),
                      ),
                    ),
                ],
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: _subGroups.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, i) {
                  final sg = _subGroups[i];
                  return _SubGroupCard(
                    subGroup: sg,
                    accent: _accent,
                    canManage: canManage,
                    onTap: () => _openSubGroup(sg),
                    onEdit: () => _openSubGroupForm(existing: sg),
                    onDelete: () => _confirmDelete(sg),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _SubGroupCard extends StatelessWidget {
  final _SubGroup subGroup;
  final Color accent;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _SubGroupCard({
    required this.subGroup,
    required this.accent,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.layers_outlined, color: accent, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      subGroup.subGroupName,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.bold),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'View Members \u2192',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              if (canManage)
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_horiz),
                  onSelected: (v) {
                    if (v == 'edit') {
                      onEdit();
                    } else if (v == 'delete') {
                      onDelete();
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Edit')),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete', style: TextStyle(color: AppColors.error)),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ===========================================================================
// Widget 2: Sub-Group detail (members CRUD) screen
// ===========================================================================
class CommitteeSubGroupDetailScreen extends StatefulWidget {
  final int districtId;
  final int groupId;
  final int subGroupId;
  final String subGroupName;

  const CommitteeSubGroupDetailScreen({
    super.key,
    required this.districtId,
    required this.groupId,
    required this.subGroupId,
    required this.subGroupName,
  });

  @override
  State<CommitteeSubGroupDetailScreen> createState() =>
      _CommitteeSubGroupDetailScreenState();
}

class _CommitteeSubGroupDetailScreenState
    extends State<CommitteeSubGroupDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_Member> _members = [];

  String get _districtBase => '/api/districts/${widget.districtId}/committee';
  String get _subGroupBase =>
      '/api/districts/${widget.districtId}/committee/sub-groups/${widget.subGroupId}';

  @override
  void initState() {
    super.initState();
    _fetchMembers();
  }

  Future<void> _fetchMembers() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_subGroupBase/members',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _Member.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _members = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _members = [];
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

  Future<void> _confirmDelete(_Member m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete member?'),
        content: Text(
            'Remove "${m.name}" from this sub-group? This action cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('$_subGroupBase/members/${m.id}');
      if (mounted) await _fetchMembers();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  Future<void> _openMemberForm({_Member? existing}) async {
    final initial = existing == null
        ? null
        : CommitteeMemberFormInitial(
            id: existing.id,
            isMember: existing.isMember,
            memberId: existing.memberId,
            name: existing.name,
            mobile: existing.mobile,
            email: existing.email,
            designation: existing.designation,
            clubName: existing.clubName,
            remark: existing.remark,
            profilePhoto: existing.profilePhoto,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CommitteeMemberFormScreen(
          title: 'Sub-Group Member',
          searchEndpoint: '$_districtBase/search-members',
          createEndpoint: '$_subGroupBase/members',
          updateEndpointBuilder: (id) => '$_subGroupBase/members/$id',
          photoUploadEndpoint: '$_districtBase/upload-photo',
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetchMembers();
  }

  void _openMemberDetail(_Member m) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => DistrictCommitteeMemberDetailScreen(
          name: m.name,
          designation: m.designation,
          clubName: m.clubName,
          mobile: m.mobile,
          email: m.email,
          remark: m.remark,
          profilePhoto: m.profilePhoto,
          isMember: m.isMember,
        ),
      ),
    );
  }


  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: widget.subGroupName,
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add sub-group member',
              onPressed: () => _openMemberForm(),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetchMembers)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_members.isEmpty)
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Expanded(
                    child: EmptyStateWidget(
                      title: 'No sub-group members yet',
                      subtitle: canManage
                          ? 'Tap "Add Member" to add your first sub-group member.'
                          : 'No members added for this sub-group.',
                      icon: Icons.groups_outlined,
                    ),
                  ),
                  if (canManage)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 24),
                      child: CustomButton(
                        label: 'Add Member',
                        icon: Icons.add,
                        onPressed: () => _openMemberForm(),
                      ),
                    ),
                ],
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: _members.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, i) {
                  final m = _members[i];
                  return _SubGroupMemberCard(
                    member: m,
                    canManage: canManage,
                    onTap: () => _openMemberDetail(m),
                    onEdit: () => _openMemberForm(existing: m),
                    onDelete: () => _confirmDelete(m),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Member card
// ---------------------------------------------------------------------------
class _SubGroupMemberCard extends StatelessWidget {
  final _Member member;
  final bool canManage;
  final VoidCallback? onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _SubGroupMemberCard({
    required this.member,
    required this.canManage,
    this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final photo = _photoUrl(member.profilePhoto);
    final designation = member.designation.trim();
    final club = member.clubName.trim();
    final mobile = member.mobile.trim();
    final email = member.email.trim();
    final remark = member.remark.trim();

    final designationClub = [
      if (designation.isNotEmpty) designation,
      if (club.isNotEmpty) club,
    ].join(' · ');
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
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
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
                          _initials(member.name),
                          style: const TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    )
                  : Center(
                      child: Text(
                        _initials(member.name),
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
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          member.name.isEmpty ? 'Unnamed' : member.name,
                          style: AppTextStyles.bodyMedium
                              .copyWith(fontWeight: FontWeight.bold),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (!member.isMember) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.warning.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            'Non-Member',
                            style: AppTextStyles.caption.copyWith(
                              color: AppColors.warning,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (designationClub.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      designationClub,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
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
                  if (remark.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      remark,
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.textSecondary,
                        fontStyle: FontStyle.italic,
                      ),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (canManage)
              PopupMenuButton<String>(
                tooltip: 'Actions',
                icon: const Icon(Icons.more_horiz),
                onSelected: (v) {
                  if (v == 'edit') onEdit();
                  if (v == 'delete') onDelete();
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(
                    value: 'edit',
                    child: Row(children: [
                      Icon(Icons.edit_outlined, size: 18),
                      SizedBox(width: 8),
                      Text('Edit'),
                    ]),
                  ),
                  PopupMenuItem(
                    value: 'delete',
                    child: Row(children: [
                      Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                      SizedBox(width: 8),
                      Text('Delete', style: TextStyle(color: AppColors.error)),
                    ]),
                  ),
                ],
              )
            else if (onTap != null)
              const Padding(
                padding: EdgeInsets.only(left: 4, top: 2),
                child: Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.textSecondary,
                  size: 22,
                ),
              ),
          ],
        ),
      ),
      ),
    );
  }
}
