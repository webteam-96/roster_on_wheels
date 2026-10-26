import 'dart:async';

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
import '../../../../widgets/common/empty_state_widget.dart';
import 'committee_member_form_screen.dart';
import 'district_committee_member_detail_screen.dart';
import 'district_committee_sub_group_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Group detail: ONE scrolling list with a Members section then a Sub Groups
// section (mirrors the main District Committee screen's Office-Bearers +
// Committee-Groups single list). Add is a FAB → Add Member / Add Sub-Group.
// ---------------------------------------------------------------------------
class _GroupMember {
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

  const _GroupMember({
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

  factory _GroupMember.fromJson(Map<String, dynamic> j) => _GroupMember(
        id: (j['id'] as int?) ?? 0,
        isMember: j['isMember'] as bool? ?? false,
        memberId: j['memberId'] as int?,
        name: j['name']?.toString() ?? '',
        mobile: j['mobile']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        designation: (j['districtDesignation'] ?? j['designation'])?.toString() ?? '',
        clubName: j['clubName']?.toString() ?? '',
        remark: (j['districtRemark'] ?? j['remark'])?.toString() ?? '',
        profilePhoto: j['profilePhoto']?.toString() ?? '',
      );
}

class _SubGroup {
  final int id;
  final String subGroupName;
  final int memberCount;
  const _SubGroup({
    required this.id,
    required this.subGroupName,
    this.memberCount = 0,
  });

  factory _SubGroup.fromJson(Map<String, dynamic> j) => _SubGroup(
        id: (j['id'] as int?) ?? 0,
        subGroupName: j['subGroupName']?.toString() ?? '',
        memberCount: (j['memberCount'] as num?)?.toInt() ?? 0,
      );
}

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

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictCommitteeGroupDetailScreen extends StatefulWidget {
  final int districtId;
  final int groupId;
  final String groupName;

  const DistrictCommitteeGroupDetailScreen({
    super.key,
    required this.districtId,
    required this.groupId,
    required this.groupName,
  });

  @override
  State<DistrictCommitteeGroupDetailScreen> createState() =>
      _DistrictCommitteeGroupDetailScreenState();
}

class _DistrictCommitteeGroupDetailScreenState
    extends State<DistrictCommitteeGroupDetailScreen> {
  final _api = ApiClient();

  // Members — server-side search (the group-members endpoint accepts a
  // `search` param matching name/mobile/email/club), debounced.
  final _searchCtrl = TextEditingController();
  String _query = '';
  Timer? _searchDebounce;

  bool _loadingMembers = true;
  String? _membersError;
  List<_GroupMember> _members = [];

  bool _loadingSub = true;
  String? _subError;
  List<_SubGroup> _subGroups = [];

  String get _districtBase => '/api/districts/${widget.districtId}/committee';
  String get _groupBase =>
      '/api/districts/${widget.districtId}/committee/groups/${widget.groupId}';

  @override
  void initState() {
    super.initState();
    _fetchMembers();
    _fetchSubGroups();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String v) {
    setState(() => _query = v);
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) _fetchMembers();
    });
  }

  // ── Members ─────────────────────────────────────────────────────────────────
  Future<void> _fetchMembers() async {
    setState(() {
      _loadingMembers = true;
      _membersError = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_groupBase/members',
        queryParams: {
          'pageSize': 200,
          if (_query.trim().isNotEmpty) 'search': _query.trim(),
        },
        fromJson: (j) => j is List ? j : ((j as Map)['items'] as List? ?? const []),
      );
      final list = (resp.data ?? [])
          .map((e) => _GroupMember.fromJson(e as Map<String, dynamic>))
          .toList();
      if (!mounted) return;
      setState(() {
        _members = list;
        _loadingMembers = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.statusCode == 404) {
          _members = [];
        } else {
          _membersError = e.message;
        }
        _loadingMembers = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _membersError = e.toString();
        _loadingMembers = false;
      });
    }
  }

  Future<void> _openMemberForm({_GroupMember? existing}) async {
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
          title: 'Group Member',
          searchEndpoint: '$_districtBase/search-members',
          createEndpoint: '$_groupBase/members',
          updateEndpointBuilder: (id) => '$_groupBase/members/$id',
          photoUploadEndpoint: '$_districtBase/upload-photo',
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetchMembers();
  }

  Future<void> _deleteMember(_GroupMember m) async {
    final ok = await _confirm('Delete member?',
        'Remove "${m.name}" from this group? This action cannot be undone.');
    if (!ok) return;
    try {
      await _api.delete('$_groupBase/members/${m.id}');
      if (mounted) await _fetchMembers();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  // ── Sub-Groups ──────────────────────────────────────────────────────────────
  Future<void> _fetchSubGroups() async {
    setState(() {
      _loadingSub = true;
      _subError = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_groupBase/sub-groups',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _SubGroup.fromJson(e as Map<String, dynamic>))
          .toList();
      if (!mounted) return;
      setState(() {
        _subGroups = list;
        _loadingSub = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.statusCode == 404) {
          _subGroups = [];
        } else {
          _subError = e.message;
        }
        _loadingSub = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _subError = e.toString();
        _loadingSub = false;
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
    if (saved == true && mounted) await _fetchSubGroups();
  }

  Future<void> _deleteSubGroup(_SubGroup sg) async {
    final ok = await _confirm('Delete Sub-Group',
        "Delete sub-group '${sg.subGroupName}'? This will also remove all its members.");
    if (!ok) return;
    try {
      await _api.delete('$_groupBase/sub-groups/${sg.id}');
      if (mounted) await _fetchSubGroups();
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

  // ── Shared ──────────────────────────────────────────────────────────────────
  Future<bool> _confirm(String title, String message) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(message),
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
    return ok == true;
  }

  @override
  Widget build(BuildContext context) {
    final canManage =
        context.watch<AuthProvider>().isDistrictAdminOf(widget.districtId);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: widget.groupName),
      floatingActionButton: canManage
          ? FloatingActionButton(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              tooltip: 'Add',
              onPressed: _showAddSheet,
              child: const Icon(Icons.add),
            )
          : null,
      body: _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    // First load — nothing fetched yet for either section.
    final firstLoad = _loadingMembers &&
        _loadingSub &&
        _members.isEmpty &&
        _subGroups.isEmpty &&
        _membersError == null &&
        _subError == null;
    if (firstLoad) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    return Column(
      children: [
        _searchField(),
        Expanded(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async {
              await Future.wait([_fetchMembers(), _fetchSubGroups()]);
            },
            child: _list(canManage),
          ),
        ),
      ],
    );
  }

  Widget _searchField() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: TextField(
        controller: _searchCtrl,
        onChanged: _onSearchChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: 'Search members & sub-groups',
          prefixIcon: const Icon(Icons.search_rounded, size: 20),
          suffixIcon: _query.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () {
                    _searchCtrl.clear();
                    _onSearchChanged('');
                  },
                ),
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
    );
  }

  // One scrolling list: a MEMBERS section then a SUB GROUPS section — same
  // single-list pattern as the main District Committee screen.
  Widget _list(bool canManage) {
    final hasQuery = _query.trim().isNotEmpty;
    final q = _query.trim().toLowerCase();
    // Members are filtered server-side; sub-groups client-side so one box covers both.
    final subs = hasQuery
        ? _subGroups
            .where((s) => s.subGroupName.toLowerCase().contains(q))
            .toList()
        : _subGroups;

    final children = <Widget>[];

    // ── Members ──
    if (_membersError != null) {
      children.add(_sectionError('Members', _membersError!, _fetchMembers));
    } else if (_members.isNotEmpty) {
      for (final m in _members) {
        children.add(_GroupMemberCard(
          member: m,
          canManage: canManage,
          onTap: () => _openMember(m),
          onEdit: () => _openMemberForm(existing: m),
          onDelete: () => _deleteMember(m),
        ));
        children.add(const SizedBox(height: 10));
      }
      children.add(const SizedBox(height: 8));
    }

    // ── Sub Groups ──
    if (_subError != null) {
      children.add(_sectionError('Sub Groups', _subError!, _fetchSubGroups));
    } else if (subs.isNotEmpty) {
      for (final sg in subs) {
        children.add(_SubGroupTile(
          subGroup: sg,
          canManage: canManage,
          onTap: () => _openSubGroup(sg),
          onEdit: () => _openSubGroupForm(existing: sg),
          onDelete: () => _deleteSubGroup(sg),
        ));
        children.add(const SizedBox(height: 10));
      }
    }

    if (children.isEmpty) {
      // A section can still be fetching (the two loads finish independently) —
      // don't flash an empty state until BOTH have settled.
      if (_loadingMembers || _loadingSub) {
        return const Center(
            child: const CircularProgressIndicator(color: AppColors.primary));
      }
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 80),
          EmptyStateWidget(
            icon: hasQuery ? Icons.search_off_rounded : Icons.groups_outlined,
            title: hasQuery ? 'No matches' : 'Nothing here yet',
            subtitle: hasQuery
                ? 'No members or sub-groups match "$_query".'
                : (canManage
                    ? 'Tap + to add a member or a sub-group.'
                    : 'No members or sub-groups added yet.'),
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
      children: children,
    );
  }

  Widget _sectionError(String label, String message, VoidCallback onRetry) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 16, 0, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionHeader(label: label),
          const SizedBox(height: 8),
          Text(message,
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }

  void _showAddSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.divider,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Add to ${widget.groupName}',
                    style: AppTextStyles.h4),
              ),
            ),
            const SizedBox(height: 6),
            _addOption(
              ctx,
              icon: Icons.person_add_alt_1_outlined,
              title: 'Add Member',
              subtitle: 'Add a person to this group',
              onTap: _openMemberForm,
            ),
            _addOption(
              ctx,
              icon: Icons.account_tree_outlined,
              title: 'Add Sub-Group',
              subtitle: 'Create a sub-group under this group',
              onTap: _openSubGroupForm,
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  Widget _addOption(
    BuildContext sheetCtx, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: AppColors.primary.withValues(alpha: 0.10),
        child: Icon(icon, color: AppColors.primary, size: 20),
      ),
      title: Text(title, style: AppTextStyles.bodySemiBold),
      subtitle: Text(subtitle, style: AppTextStyles.caption),
      onTap: () {
        Navigator.of(sheetCtx).pop();
        onTap();
      },
    );
  }

  void _openMember(_GroupMember m) {
    Navigator.of(context).push(MaterialPageRoute(
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
    ));
  }
}

// ---------------------------------------------------------------------------
// Member card
// ---------------------------------------------------------------------------
class _GroupMemberCard extends StatelessWidget {
  final _GroupMember member;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _GroupMemberCard({
    required this.member,
    required this.canManage,
    required this.onTap,
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
                              fontSize: 10,
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
            else
              const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
          ],
        ),
      ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-group tile
// ---------------------------------------------------------------------------
class _SubGroupTile extends StatelessWidget {
  final _SubGroup subGroup;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _SubGroupTile({
    required this.subGroup,
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
                  color: AppColors.primary.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.account_tree_outlined,
                    color: AppColors.primary, size: 22),
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
                      '${subGroup.memberCount} ${subGroup.memberCount == 1 ? "Member" : "Members"}',
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
                )
              else
                const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section header (accent bar + uppercase label) — mirrors the main District
// Committee screen's Office-Bearers / Committee-Groups headers.
// ---------------------------------------------------------------------------
class _SectionHeader extends StatelessWidget {
  final String label;
  const _SectionHeader({required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 4,
          height: 16,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          label.toUpperCase(),
          style: AppTextStyles.caption.copyWith(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
          ),
        ),
      ],
    );
  }
}
