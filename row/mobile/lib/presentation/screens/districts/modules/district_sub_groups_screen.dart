import 'package:cached_network_image/cached_network_image.dart';
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
import 'district_sub_group_form_screen.dart';
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
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _SubGroup {
  final int id;
  final String groupName;
  final int yearId;
  final int memberCount;
  final List<int> memberIds;

  const _SubGroup({
    required this.id,
    required this.groupName,
    required this.yearId,
    required this.memberCount,
    this.memberIds = const [],
  });

  factory _SubGroup.fromJson(Map<String, dynamic> j) {
    final rawIds = j['memberIds'];
    final ids = <int>[];
    if (rawIds is List) {
      for (final e in rawIds) {
        if (e is int) {
          ids.add(e);
        } else if (e is num) {
          ids.add(e.toInt());
        } else if (e is String) {
          final p = int.tryParse(e);
          if (p != null) ids.add(p);
        }
      }
    }
    return _SubGroup(
      id: (j['id'] as int?) ?? 0,
      groupName: j['groupName']?.toString() ?? j['name']?.toString() ?? '',
      yearId: (j['yearId'] as int?) ?? 0,
      memberCount: (j['memberCount'] as int?) ?? ids.length,
      memberIds: ids,
    );
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictSubGroupsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictSubGroupsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictSubGroupsScreen> createState() => _DistrictSubGroupsScreenState();
}

class _DistrictSubGroupsScreenState extends State<DistrictSubGroupsScreen> {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;

  List<_SubGroup> _items = [];
  bool _loadingItems = false;

  String get _base => '/api/districts/${widget.districtId}/sub-groups';

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
      List<_RotaryYear> years = [];
      try {
        final availResp = await _api.get<List<dynamic>>(
          '$_base/available-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (availResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {
        years = [];
      }
      if (years.isEmpty) {
        try {
          final allResp = await _api.get<List<dynamic>>(
            '/api/rotary-years',
            fromJson: (j) => j as List<dynamic>,
          );
          final all = (allResp.data ?? [])
              .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
              .toList();
          years = all;
        } catch (_) {
          years = [];
        }
      }
      _RotaryYear current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () =>
            years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
      );
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) {
        await _fetchItems(_selectedYearId!);
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _fetchItems(int yearId) async {
    setState(() {
      _loadingItems = true;
      _items = [];
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        _base,
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _SubGroup.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _items = list;
        _loadingItems = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loadingItems = false;
        });
      } else {
        setState(() => _loadingItems = false);
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('Failed to load: ${e.message}')));
        }
      }
    } catch (e) {
      setState(() => _loadingItems = false);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed to load: $e')));
      }
    }
  }

  Future<void> _confirmDelete(_SubGroup g) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Sub Group'),
        content: Text("Delete sub-group '${g.groupName}'?"),
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
      await _api.delete('$_base/${g.id}');
      if (mounted && _selectedYearId != null) {
        await _fetchItems(_selectedYearId!);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Sub-group deleted'),
              backgroundColor: AppColors.success,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }


  Future<List<int>> _loadSubGroupMemberIds(int subGroupId) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '$_base/$subGroupId',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? const <String, dynamic>{};
      final ids = <int>[];
      final raw = data['memberIds'] ?? data['members'];
      if (raw is List) {
        for (final e in raw) {
          if (e is int) {
            ids.add(e);
          } else if (e is num) {
            ids.add(e.toInt());
          } else if (e is Map) {
            final mid = e['memberId'] ?? e['id'];
            if (mid is int) {
              ids.add(mid);
            } else if (mid is num) {
              ids.add(mid.toInt());
            }
          }
        }
      }
      return ids;
    } catch (_) {
      return const <int>[];
    }
  }

  // Read-only detail page: lists the members selected for this sub-group
  // (web parity: the "View Members" dialog on the district sub-groups page).
  void _openMembers(_SubGroup g) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _SubGroupMembersScreen(
          districtId: widget.districtId,
          subGroupId: g.id,
          groupName: g.groupName,
        ),
      ),
    );
  }

  Future<void> _openForm({_SubGroup? existing}) async {
    final yearOpts = _years
        .map((y) => DistrictSubGroupFormYear(
              id: y.id,
              yearLabel: y.yearLabel,
              isCurrent: y.isCurrent,
            ))
        .toList();
    List<int> initialIds = const [];
    if (existing != null) {
      try {
        initialIds = await _loadSubGroupMemberIds(existing.id);
      } catch (_) {}
      if (initialIds.isEmpty) initialIds = existing.memberIds;
    }
    final initial = existing == null
        ? null
        : DistrictSubGroupFormInitial(
            id: existing.id,
            groupName: existing.groupName,
            yearId: existing.yearId,
            memberIds: initialIds,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictSubGroupFormScreen(
          districtId: widget.districtId,
          years: yearOpts,
          defaultYearId: _selectedYearId,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _fetchItems(_selectedYearId!);
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
              title: 'Sub Groups',
              actions: [
                if (canManage)
                  IconButton(
                    icon: const Icon(Icons.add),
                    tooltip: 'Add Sub Group',
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
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_years.isNotEmpty) ...[
            RotaryYearBar<int>(
              value: _selectedYearId,
              margin: EdgeInsets.zero,
              options: [
                for (final y in _years)
                  RotaryYearOption(
                      value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                if (v != null) _fetchItems(v);
              },
            ),
            const SizedBox(height: 16),
          ],
          if (_loadingItems)
            const Expanded(
              child: const Center(
                child: const CircularProgressIndicator(color: AppColors.primary),
              ),
            )
          else if (_items.isEmpty)
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Expanded(
                    child: EmptyStateWidget(
                      title: 'No Sub Groups',
                      subtitle: canManage
                          ? 'Tap "Add Sub Group" to create one.'
                          : 'No sub-groups added yet.',
                      icon: Icons.group_work_outlined,
                    ),
                  ),
                  if (canManage)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 24),
                      child: CustomButton(
                        label: 'Add Sub Group',
                        icon: Icons.add,
                        onPressed: () => _openForm(),
                      ),
                    ),
                ],
              ),
            )
          else
            Expanded(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () async {
                  if (_selectedYearId != null) {
                    await _fetchItems(_selectedYearId!);
                  }
                },
                child: ListView.separated(
                  itemCount: _items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (ctx, i) {
                    final g = _items[i];
                    return _SubGroupCard(
                      item: g,
                      canManage: canManage,
                      onTap: () => _openMembers(g),
                      onView: () => _openMembers(g),
                      onEdit: () => _openForm(existing: g),
                      onDelete: () => _confirmDelete(g),
                    );
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _SubGroupCard extends StatelessWidget {
  final _SubGroup item;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onView;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _SubGroupCard({
    required this.item,
    required this.canManage,
    required this.onTap,
    required this.onView,
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
                child: const Icon(Icons.group_work_outlined,
                    color: AppColors.primary, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.groupName.isEmpty ? 'Unnamed' : item.groupName,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.bold),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${item.memberCount} member${item.memberCount == 1 ? '' : 's'}',
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
                    if (v == 'view') {
                      onView();
                    } else if (v == 'edit') {
                      onEdit();
                    } else if (v == 'delete') {
                      onDelete();
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'view', child: Text('View Members')),
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
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Members detail page — read-only listing of the sub-group's selected members
// ---------------------------------------------------------------------------
class _SubGroupMember {
  final int memberId;
  final String memberName;
  final String? clubName;
  final String? email;
  final String? mobileNumber;
  final String? profilePhotoPath;

  const _SubGroupMember({
    required this.memberId,
    required this.memberName,
    this.clubName,
    this.email,
    this.mobileNumber,
    this.profilePhotoPath,
  });

  factory _SubGroupMember.fromJson(Map<String, dynamic> j) => _SubGroupMember(
        memberId: (j['memberId'] as int?) ?? (j['id'] as int?) ?? 0,
        memberName: (j['memberName'] ?? j['name'] ?? '').toString(),
        clubName: j['clubName']?.toString(),
        email: j['email']?.toString(),
        mobileNumber: (j['mobileNumber'] ?? j['primaryMobileNumber'])?.toString(),
        profilePhotoPath: j['profilePhotoPath']?.toString(),
      );
}

class _SubGroupMembersScreen extends StatefulWidget {
  final int districtId;
  final int subGroupId;
  final String groupName;

  const _SubGroupMembersScreen({
    required this.districtId,
    required this.subGroupId,
    required this.groupName,
  });

  @override
  State<_SubGroupMembersScreen> createState() => _SubGroupMembersScreenState();
}

class _SubGroupMembersScreenState extends State<_SubGroupMembersScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  late String _groupName = widget.groupName;
  List<_SubGroupMember> _members = const [];

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
        '/api/districts/${widget.districtId}/sub-groups/${widget.subGroupId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? const <String, dynamic>{};
      final name = (data['groupName'] ?? data['name'])?.toString();
      final raw = (data['members'] as List?) ?? const [];
      final members = raw
          .whereType<Map>()
          .map((e) => _SubGroupMember.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      setState(() {
        if (name != null && name.trim().isNotEmpty) _groupName = name;
        _members = members;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _groupName.trim().isEmpty ? 'Sub Group Members' : _groupName,
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _members.isEmpty
                  ? const EmptyStateWidget(
                      title: 'No members in this group',
                      subtitle: 'No members have been added to this sub-group.',
                      icon: Icons.group_outlined,
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: _fetch,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                        itemCount: _members.length + 1,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (ctx, i) {
                          if (i == 0) {
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Text(
                                '${_members.length} member${_members.length == 1 ? '' : 's'}',
                                style: AppTextStyles.caption
                                    .copyWith(color: AppColors.textSecondary),
                              ),
                            );
                          }
                          return _MemberTile(member: _members[i - 1]);
                        },
                      ),
                    ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  final _SubGroupMember member;
  const _MemberTile({required this.member});

  @override
  Widget build(BuildContext context) {
    final initials = member.memberName
        .trim()
        .split(RegExp(r'\s+'))
        .take(2)
        .map((s) => s.isNotEmpty ? s[0].toUpperCase() : '')
        .join();
    final contact = [
      if ((member.mobileNumber ?? '').trim().isNotEmpty) member.mobileNumber!.trim(),
      if ((member.email ?? '').trim().isNotEmpty) member.email!.trim(),
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
        child: Row(
          children: [
            _Avatar(path: member.profilePhotoPath, initials: initials),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    member.memberName.isEmpty ? 'Unknown' : member.memberName,
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.bold),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if ((member.clubName ?? '').trim().isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      member.clubName!.trim(),
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.primary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (contact.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      contact,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String? path;
  final String initials;
  const _Avatar({required this.path, required this.initials});

  @override
  Widget build(BuildContext context) {
    final fallback = Container(
      width: 44,
      height: 44,
      alignment: Alignment.center,
      color: AppColors.primary.withValues(alpha: 0.12),
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: AppTextStyles.bodyMedium
            .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
      ),
    );
    final hasPhoto = (path ?? '').trim().isNotEmpty;
    return ClipOval(
      child: SizedBox(
        width: 44,
        height: 44,
        child: hasPhoto
            ? CachedNetworkImage(
                imageUrl: ApiConstants.mediaUrl(path),
                width: 44,
                height: 44,
                fit: BoxFit.cover,
                placeholder: (_, __) => fallback,
                errorWidget: (_, __, ___) => fallback,
              )
            : fallback,
      ),
    );
  }
}
