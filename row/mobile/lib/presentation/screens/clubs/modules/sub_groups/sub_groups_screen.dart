import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import '../../../../../presentation/widgets/common/pagination_widget.dart';
import '../../../../../presentation/widgets/common/rotary_year_bar.dart';

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

class SubGroupsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const SubGroupsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<SubGroupsScreen> createState() => _SubGroupsScreenState();
}

class _SubGroupsScreenState extends State<SubGroupsScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  List<dynamic> _groups = [];
  bool _loading = true;
  int _currentPage = 1;
  int _totalPages = 1;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _loadYearsThenGroups();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Client-side filter — backend GET doesn't accept a search query.
  List<dynamic> get _filteredGroups {
    if (_search.trim().isEmpty) return _groups;
    final q = _search.trim().toLowerCase();
    return _groups.where((g) {
      final name = (g as Map<String, dynamic>)['groupName']?.toString().toLowerCase() ?? '';
      final desc = g['description']?.toString().toLowerCase() ?? '';
      return name.contains(q) || desc.contains(q);
    }).toList();
  }

  Future<void> _loadYearsThenGroups() async {
    List<_RotaryYear> years = [];
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
    final current = years.firstWhere(
      (y) => y.isCurrent,
      orElse: () =>
          years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
    );
    if (mounted) {
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
      });
    }
    await _loadGroups();
  }

  Future<void> _loadGroups({int page = 1}) async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/sub-groups?yearId=${_selectedYearId ?? 0}',
        fromJson: (j) => j as List<dynamic>,
      );
      if (resp.data != null) {
        setState(() {
          _groups = resp.data ?? [];
          _currentPage = 1;
          _totalPages = 1;
        });
      }
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to load sub-groups');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id, String groupName) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Sub-Group',
      message: 'Are you sure you want to delete $groupName? This will remove the group and its member associations.',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/sub-groups/$id');
      SnackbarUtils.showSuccess(context, 'Sub-group deleted');
      _loadGroups(page: _currentPage);
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to delete sub-group');
    }
  }

  void _openForm({Map<String, dynamic>? group}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _SubGroupFormScreen(
          clubId: widget.clubId,
          group: group,
          allGroups: _groups,
          yearId: _selectedYearId ?? 0,
          onSaved: () => _loadGroups(page: _currentPage),
        ),
      ),
    );
  }

  Future<void> _viewMembers(Map<String, dynamic> group) async {
    final groupId = group['id'] as int?;
    if (groupId == null) return;
    List<dynamic> members = [];
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/sub-groups/$groupId',
        fromJson: (j) => j,
      );
      final data = resp.data;
      if (data is Map<String, dynamic>) {
        members = (data['members'] as List?) ?? [];
      }
    } catch (_) {}
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(group['groupName']?.toString() ?? 'Members'),
        content: SizedBox(
          width: double.maxFinite,
          child: members.isEmpty
              ? const Text('No members assigned')
              : ListView.separated(
                  shrinkWrap: true,
                  itemCount: members.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final m = members[i] as Map<String, dynamic>;
                    final name = (m['memberName'] ?? m['name'])?.toString() ?? '-';
                    final mobile = m['mobileNumber']?.toString() ?? m['primaryMobileNumber']?.toString() ?? '';
                    final email = m['email']?.toString() ?? m['emailId']?.toString() ?? '';
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: CircleAvatar(
                        radius: 16,
                        backgroundColor: AppColors.primary.withOpacity(0.15),
                        child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                            style: const TextStyle(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w700,
                                fontSize: 13)),
                      ),
                      title: Text(name, style: AppTextStyles.body),
                      subtitle: Text(
                        [mobile, email].where((s) => s.isNotEmpty).join(' | '),
                        style: AppTextStyles.caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    );
                  },
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Sub Groups'),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          if (_years.isNotEmpty)
            RotaryYearBar<int>(
              value: _selectedYearId,
              options: [
                for (final y in _years)
                  RotaryYearOption(
                      value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() => _selectedYearId = v);
                _loadGroups();
              },
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _search = v),
              decoration: InputDecoration(
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 10),
                hintText: 'Search sub groups...',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _search.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() => _search = '');
                        },
                      ),
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _groups.isEmpty
                    ? const EmptyStateWidget(title: 'No sub-groups found')
                    : _filteredGroups.isEmpty
                        ? EmptyStateWidget(
                            title: 'No matches',
                            subtitle: 'No sub-groups match "$_search".',
                          )
                        : RefreshIndicator(
                            onRefresh: () => _loadGroups(page: _currentPage),
                            child: Column(
                              children: [
                                Expanded(
                                  child: ListView.separated(
                                    padding: const EdgeInsets.all(16),
                                    itemCount: _filteredGroups.length,
                                    separatorBuilder: (_, __) =>
                                        const SizedBox(height: 8),
                                    itemBuilder: (_, i) =>
                                        _buildGroupCard(_filteredGroups[i]),
                                  ),
                                ),
                                if (_search.isEmpty && _totalPages > 1)
                                  PaginationWidget(
                                    currentPage: _currentPage,
                                    totalPages: _totalPages,
                                    totalCount: 0,
                                    onLoadMore: () =>
                                        _loadGroups(page: _currentPage + 1),
                                  ),
                              ],
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildGroupCard(Map<String, dynamic> group) {
    // parentGroupId/description are not part of current API shape — guarded reads.
    final isNested = group['parentGroupId'] != null; // always false with new API
    final memberCount = group['memberCount'] as int? ?? 0;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: EdgeInsets.fromLTRB(isNested ? 28 : 16, 12, 8, 12),
        child: Row(
          children: [
            if (isNested) ...[
              Container(
                width: 3,
                height: 40,
                color: AppColors.primary.withOpacity(0.4),
                margin: const EdgeInsets.only(right: 12),
              ),
            ],
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.group, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    group['groupName']?.toString() ?? '',
                    style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w600),
                  ),
                  if (group['description'] != null &&
                      group['description'].toString().isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      group['description'].toString(),
                      style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(Icons.people, size: 14, color: Colors.grey),
                      const SizedBox(width: 4),
                      Text('$memberCount members',
                          style: AppTextStyles.caption.copyWith(color: Colors.grey[600])),
                    ],
                  ),
                ],
              ),
            ),
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'members') _viewMembers(group);
                if (v == 'edit') _openForm(group: group);
                if (v == 'delete') _delete(group['id'] as int, group['groupName']?.toString() ?? '');
              },
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'members', child: Text('View Members')),
                if (canManage)
                  const PopupMenuItem(value: 'edit', child: Text('Edit')),
                if (canManage)
                  const PopupMenuItem(value: 'delete', child: Text('Delete')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Form BottomSheet ──────────────────────────────────────────────────────────

class _SubGroupFormScreen extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? group;
  final List<dynamic> allGroups;
  final int yearId;
  final VoidCallback onSaved;

  const _SubGroupFormScreen({
    required this.clubId,
    required this.allGroups,
    required this.yearId,
    required this.onSaved,
    this.group,
  });

  @override
  State<_SubGroupFormScreen> createState() => _SubGroupFormScreenState();
}

class _SubGroupFormScreenState extends State<_SubGroupFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _memberSearchCtrl = TextEditingController();

  bool _saving = false;
  bool _loadingMembers = true;

  List<Map<String, dynamic>> _allMembers = [];
  final Set<int> _selectedMemberIds = {};
  String _memberFilter = '';

  bool get _isEdit => widget.group != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _nameCtrl.text = widget.group!['groupName']?.toString() ?? '';
    }
    _loadFormData();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _memberSearchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadFormData() async {
    try {
      // Load all club members.
      final membersResp = await _api.get(
        '/api/clubs/${widget.clubId}/sub-groups/club-members',
        fromJson: (j) => j,
      );
      final membersList = membersResp.data is List
          ? membersResp.data as List
          : (membersResp.data as Map<String, dynamic>?)?['items'] as List? ??
              [];
      _allMembers = membersList.cast<Map<String, dynamic>>();

      // If editing, load existing group members.
      if (_isEdit) {
        try {
          final groupResp = await _api.get(
            '/api/clubs/${widget.clubId}/sub-groups/${widget.group!['id']}',
            fromJson: (j) => j,
          );
          final data = groupResp.data;
          if (data is Map<String, dynamic>) {
            final existing = (data['members'] as List?) ?? [];
            for (final m in existing) {
              final id =
                  (m as Map<String, dynamic>)['memberId'] as int? ??
                      m['id'] as int?;
              if (id != null) _selectedMemberIds.add(id);
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
    if (mounted) setState(() => _loadingMembers = false);
  }

  // The /sub-groups/club-members endpoint returns rows shaped like
  // {memberId, memberName, email, mobileNumber, ...}. Older code paths read
  // `m['id']` directly which crashes with a Null → int cast when the API uses
  // memberId. This helper reads memberId first and falls back to id.
  int? _memberIdOf(Map<String, dynamic> m) {
    final v = m['memberId'] ?? m['id'];
    if (v is int) return v;
    if (v is num) return v.toInt();
    if (v is String) return int.tryParse(v);
    return null;
  }

  List<Map<String, dynamic>> get _filteredMembers {
    if (_memberFilter.isEmpty) return _allMembers;
    final q = _memberFilter.toLowerCase();
    return _allMembers.where((m) {
      final name = (m['memberName'] ?? m['name'] ?? '').toString().toLowerCase();
      final email = (m['email'] ?? m['emailId'] ?? '').toString().toLowerCase();
      final mobile = (m['mobileNumber'] ?? m['primaryMobileNumber'] ?? '').toString();
      return name.contains(q) || email.contains(q) || mobile.contains(q);
    }).toList();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        final body = {
          'groupName': _nameCtrl.text.trim(),
          'memberIds': _selectedMemberIds.toList(),
        };
        await _api.put(
          '/api/clubs/${widget.clubId}/sub-groups/${widget.group!['id']}',
          body: body,
        );
      } else {
        final body = {
          'yearId': widget.yearId,
          'groupName': _nameCtrl.text.trim(),
          'memberIds': _selectedMemberIds.toList(),
        };
        await _api.post('/api/clubs/${widget.clubId}/sub-groups', body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Created');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to save sub-group');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toggleAll(bool select) {
    setState(() {
      if (select) {
        for (final m in _filteredMembers) {
          final id = _memberIdOf(m);
          if (id != null) _selectedMemberIds.add(id);
        }
      } else {
        for (final m in _filteredMembers) {
          final id = _memberIdOf(m);
          if (id != null) _selectedMemberIds.remove(id);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredMembers;
    final allFilteredSelected = filtered.isNotEmpty &&
        filtered.every((m) {
          final id = _memberIdOf(m);
          return id != null && _selectedMemberIds.contains(id);
        });

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Sub-Group' : 'Create Sub-Group',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
                      CustomTextField(
                        controller: _nameCtrl,
                        label: 'Group Name *',
                        validator: (v) =>
                            v == null || v.trim().isEmpty
                                ? 'Name is required'
                                : null,
                      ),
                      const SizedBox(height: 20),

                      // ── Member assignment section ──
                      Row(
                        children: [
                          const Icon(Icons.people, size: 18, color: AppColors.primary),
                          const SizedBox(width: 6),
                          Text(
                            'Assign Members (${_selectedMemberIds.length})',
                            style: AppTextStyles.body.copyWith(
                                fontWeight: FontWeight.w700,
                                color: AppColors.primary),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _memberSearchCtrl,
                        decoration: InputDecoration(
                          hintText: 'Search by name, email, mobile…',
                          prefixIcon:
                              const Icon(Icons.search, size: 20),
                          isDense: true,
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10)),
                          suffixIcon: _memberFilter.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.close, size: 18),
                                  onPressed: () {
                                    _memberSearchCtrl.clear();
                                    setState(() => _memberFilter = '');
                                  },
                                )
                              : null,
                        ),
                        onChanged: (v) =>
                            setState(() => _memberFilter = v.trim()),
                      ),
                      const SizedBox(height: 4),
                      if (!_loadingMembers && filtered.isNotEmpty)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton.icon(
                            onPressed: () =>
                                _toggleAll(!allFilteredSelected),
                            icon: Icon(
                              allFilteredSelected
                                  ? Icons.deselect
                                  : Icons.select_all,
                              size: 16,
                            ),
                            label: Text(allFilteredSelected
                                ? 'Deselect All'
                                : 'Select All'),
                          ),
                        ),
                      if (_loadingMembers)
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: Center(
                              child: CircularProgressIndicator()),
                        )
                      else
                        ...filtered.map((m) {
                          final id = _memberIdOf(m);
                          if (id == null) return const SizedBox.shrink();
                          final name =
                              (m['memberName'] ?? m['name'] ?? '')
                                  .toString();
                          final email =
                              (m['email'] ?? m['emailId'] ?? '').toString();
                          final selected =
                              _selectedMemberIds.contains(id);
                          return CheckboxListTile(
                            value: selected,
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            controlAffinity:
                                ListTileControlAffinity.leading,
                            activeColor: AppColors.primary,
                            title: Text(name,
                                style: AppTextStyles.body.copyWith(
                                    fontWeight: FontWeight.w500)),
                            subtitle: email.isNotEmpty
                                ? Text(email,
                                    style: AppTextStyles.caption,
                                    maxLines: 1,
                                    overflow:
                                        TextOverflow.ellipsis)
                                : null,
                            onChanged: (v) {
                              setState(() {
                                if (v == true) {
                                  _selectedMemberIds.add(id);
                                } else {
                                  _selectedMemberIds.remove(id);
                                }
                              });
                            },
                          );
                        }),
              const SizedBox(height: 24),
              CustomButton(
                label: _isEdit
                    ? 'Update Sub-Group'
                    : 'Create Sub-Group',
                onPressed: _saving ? null : _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
