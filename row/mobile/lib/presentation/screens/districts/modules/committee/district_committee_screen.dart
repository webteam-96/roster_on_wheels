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
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/rotary_year_bar.dart';
import 'committee_member_form_screen.dart';
import 'district_committee_group_form_screen.dart';
import 'district_committee_member_detail_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Combined District Committee screen.
//
// Mirrors the old app's single-screen flow: office-bearers (DG, DLF, …) shown
// as people first, then committee groups (CDMT, COT, …) as drill-down rows —
// all under one search + year selector. Replaces the old 2-tile hub.
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
  final int yearId;

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
    required this.yearId,
  });

  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        id: (j['id'] as int?) ?? 0,
        isMember: _asBool(j['isMember']),
        memberId: j['memberId'] as int?,
        name: j['name']?.toString() ?? '',
        mobile: j['mobile']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        designation: j['districtDesignation']?.toString() ?? '',
        clubName: j['clubName']?.toString() ?? '',
        remark: j['districtRemark']?.toString() ?? '',
        profilePhoto: j['profilePhoto']?.toString() ?? '',
        yearId: (j['yearId'] as int?) ?? 0,
      );
}

class _Group {
  final int id;
  final String groupName;
  final int yearId;
  final int memberCount;
  final int subGroupCount;
  const _Group({
    required this.id,
    required this.groupName,
    required this.yearId,
    this.memberCount = 0,
    this.subGroupCount = 0,
  });

  factory _Group.fromJson(Map<String, dynamic> j) => _Group(
        id: (j['id'] as int?) ?? 0,
        groupName: j['groupName']?.toString() ?? '',
        yearId: (j['yearId'] as int?) ?? 0,
        memberCount: (j['memberCount'] as num?)?.toInt() ?? 0,
        subGroupCount: (j['subGroupCount'] as num?)?.toInt() ?? 0,
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

/// A person found by searching group members across the district's committee
/// groups, with the list of groups they belong to. Powers the "find which
/// groups a person is in" search result.
class _PersonGroups {
  final String name;
  final String profilePhoto;
  final String mobile;
  final String email;
  final String clubName;
  final bool isMember;
  final List<({int id, String name, String designation})> groups;
  const _PersonGroups({
    required this.name,
    required this.profilePhoto,
    required this.mobile,
    required this.email,
    required this.clubName,
    required this.isMember,
    required this.groups,
  });
}

class _PersonAccum {
  final String name;
  String photo;
  String mobile;
  String email;
  String clubName;
  bool isMember;
  final List<int> groupIds = [];
  final List<({int id, String name, String designation})> groups = [];
  _PersonAccum({
    required this.name,
    required this.photo,
    required this.mobile,
    required this.email,
    required this.clubName,
    required this.isMember,
  });
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictCommitteeScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictCommitteeScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictCommitteeScreen> createState() => _DistrictCommitteeScreenState();
}

class _DistrictCommitteeScreenState extends State<DistrictCommitteeScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  bool _loading = true;
  String? _error;
  bool _loadingData = false;

  List<_RotaryYear> _years = [];
  // The full rotary-year master list (/api/rotary-years). The screen's view
  // filter uses `_years` (available-years — only years with committee data), but
  // the Add Member / Add Group forms must offer EVERY year including brand-new
  // ones not yet used, so their pickers are fed from `_allYears`.
  List<_RotaryYear> _allYears = [];
  int? _selectedYearId;
  List<_Member> _members = [];
  List<_Group> _groups = [];
  String _query = '';

  // Person-in-groups search: fan out the query across each group's members and
  // collect, per matched person, the groups they belong to. Debounced; the
  // token guards against out-of-order responses from rapid typing.
  Timer? _searchDebounce;
  bool _searchingGroups = false;
  int _searchToken = 0;
  List<_PersonGroups> _personGroups = [];

  String get _base => '/api/districts/${widget.districtId}/committee';

  @override
  void initState() {
    super.initState();
    _loadInitial();
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
    final q = v.trim();
    if (q.isEmpty) {
      setState(() {
        _personGroups = [];
        _searchingGroups = false;
      });
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 400), _runPersonSearch);
  }

  // Query every group's members for the search term in parallel; group the
  // matches by person and record which groups each appears in.
  Future<void> _runPersonSearch() async {
    final q = _query.trim();
    if (q.isEmpty || _groups.isEmpty) {
      setState(() {
        _personGroups = [];
        _searchingGroups = false;
      });
      return;
    }
    final token = ++_searchToken;
    setState(() => _searchingGroups = true);

    final results = await Future.wait(_groups.map((g) async {
      try {
        final resp = await _api.get<List<dynamic>>(
          '$_base/groups/${g.id}/members',
          queryParams: {'search': q, 'pageSize': 200},
          fromJson: (j) =>
              j is List ? j : ((j as Map)['items'] as List? ?? const []),
        );
        return (group: g, members: resp.data ?? const []);
      } catch (_) {
        return (group: g, members: const <dynamic>[]);
      }
    }));

    if (!mounted || token != _searchToken) return;

    // person key → accumulator (contact + per-group designation)
    final byPerson = <String, _PersonAccum>{};
    for (final r in results) {
      for (final raw in r.members) {
        if (raw is! Map<String, dynamic>) continue;
        final name = (raw['name'] ?? '').toString().trim();
        if (name.isEmpty) continue;
        final memberId = raw['memberId'];
        final key = (memberId is int && memberId > 0)
            ? 'm$memberId'
            : 'n${name.toLowerCase()}';
        final acc = byPerson.putIfAbsent(
          key,
          () => _PersonAccum(
            name: name,
            photo: (raw['profilePhoto'] ?? '').toString(),
            mobile: (raw['mobile'] ?? '').toString(),
            email: (raw['email'] ?? '').toString(),
            clubName: (raw['clubName'] ?? '').toString(),
            isMember: _asBool(raw['isMember']),
          ),
        );
        // Backfill any contact field a later record fills in.
        if (acc.photo.isEmpty) acc.photo = (raw['profilePhoto'] ?? '').toString();
        if (acc.mobile.isEmpty) acc.mobile = (raw['mobile'] ?? '').toString();
        if (acc.email.isEmpty) acc.email = (raw['email'] ?? '').toString();
        if (acc.clubName.isEmpty) acc.clubName = (raw['clubName'] ?? '').toString();
        if (!acc.groupIds.contains(r.group.id)) {
          acc.groupIds.add(r.group.id);
          acc.groups.add((
            id: r.group.id,
            name: r.group.groupName,
            designation: (raw['districtDesignation'] ?? raw['designation'] ?? '')
                .toString()
                .trim(),
          ));
        }
      }
    }

    final list = byPerson.values
        .map((a) => _PersonGroups(
              name: a.name,
              profilePhoto: a.photo,
              mobile: a.mobile,
              email: a.email,
              clubName: a.clubName,
              isMember: a.isMember,
              groups: a.groups,
            ))
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    setState(() {
      _personGroups = list;
      _searchingGroups = false;
    });
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final availResp = await _api.get<List<dynamic>>(
        '$_base/members/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      List<_RotaryYear> years = (availResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      // Always pull the full rotary-year master list so the Add Member / Add
      // Group pickers can offer new years too (available-years only carries
      // years that already have committee data).
      final allResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final all = (allResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      _allYears = all;
      if (years.isEmpty) {
        final cur = all.where((y) => y.isCurrent).toList();
        years = cur.isNotEmpty ? cur : (all.isNotEmpty ? [all.first] : []);
      }
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () =>
            years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
      );
      if (!mounted) return;
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) await _loadData(_selectedYearId!);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadData(int yearId) async {
    setState(() {
      _loadingData = true;
      _members = [];
      _groups = [];
    });
    try {
      // Office-bearers and groups are independent lists for the same year —
      // fetch both at once so the combined screen fills in one pass.
      final results = await Future.wait([
        _fetchMembers(yearId),
        _fetchGroups(yearId),
      ]);
      if (!mounted) return;
      setState(() {
        _members = results[0] as List<_Member>;
        _groups = results[1] as List<_Group>;
        _loadingData = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingData = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Failed to load: $e')));
    }
  }

  Future<List<_Member>> _fetchMembers(int yearId) async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/members',
        queryParams: {'yearId': yearId, 'pageSize': 200},
        fromJson: (j) => j is List ? j : ((j as Map)['items'] as List? ?? const []),
      );
      return (resp.data ?? [])
          .map((e) => _Member.fromJson(e as Map<String, dynamic>))
          .toList();
    } on ApiException catch (e) {
      if (e.statusCode == 404) return const [];
      rethrow;
    }
  }

  Future<List<_Group>> _fetchGroups(int yearId) async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/groups',
        queryParams: {'yearId': yearId, 'pageSize': 200},
        fromJson: (j) => j is List ? j : ((j as Map)['items'] as List? ?? const []),
      );
      return (resp.data ?? [])
          .map((e) => _Group.fromJson(e as Map<String, dynamic>))
          .toList();
    } on ApiException catch (e) {
      if (e.statusCode == 404) return const [];
      rethrow;
    }
  }

  List<_Member> get _filteredMembers {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return _members;
    return _members.where((m) {
      return '${m.name} ${m.designation} ${m.clubName}'.toLowerCase().contains(q);
    }).toList();
  }

  List<_Group> get _filteredGroups {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return _groups;
    return _groups.where((g) => g.groupName.toLowerCase().contains(q)).toList();
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  void _openMember(_Member m) {
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

  void _openPersonDetail(_PersonGroups p) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => DistrictCommitteeMemberDetailScreen(
        name: p.name,
        designation: '',
        clubName: p.clubName,
        mobile: p.mobile,
        email: p.email,
        remark: '',
        profilePhoto: p.profilePhoto,
        isMember: p.isMember,
        districtId: widget.districtId,
        groups: p.groups,
      ),
    ));
  }

  void _openGroup(_Group g) => _pushGroup(g.id, g.groupName);

  void _pushGroup(int id, String name) {
    final encoded = Uri.encodeComponent(name);
    context.push(
        '/districts/${widget.districtId}/district-committee/groups/$id?name=$encoded');
  }

  // ── Add / edit / delete ─────────────────────────────────────────────────────
  Future<void> _openMemberForm({_Member? existing}) async {
    // Offer ALL rotary years (incl. brand-new ones) in the picker, not just
    // years that already have committee data.
    final yearSource = _allYears.isNotEmpty ? _allYears : _years;
    final yearOpts = yearSource
        .map((y) => CommitteeMemberYearOption(
            id: y.id, yearLabel: y.yearLabel, isCurrent: y.isCurrent))
        .toList();
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
          title: 'Committee Member',
          searchEndpoint: '$_base/search-members',
          createEndpoint: '$_base/members',
          updateEndpointBuilder: (id) => '$_base/members/$id',
          photoUploadEndpoint: '$_base/upload-photo',
          designationField: 'districtDesignation',
          remarkField: 'districtRemark',
          years: yearOpts,
          defaultYearId: existing?.yearId ?? _selectedYearId,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _loadData(_selectedYearId!);
    }
  }

  Future<void> _openGroupForm({_Group? existing}) async {
    // Offer ALL rotary years (incl. brand-new ones) in the picker, not just
    // years that already have committee data.
    final yearSource = _allYears.isNotEmpty ? _allYears : _years;
    final yearOpts = yearSource
        .map((y) => CommitteeGroupFormYear(
            id: y.id, yearLabel: y.yearLabel, isCurrent: y.isCurrent))
        .toList();
    final initial = existing == null
        ? null
        : CommitteeGroupFormInitial(
            id: existing.id, groupName: existing.groupName, yearId: existing.yearId);
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictCommitteeGroupFormScreen(
          districtId: widget.districtId,
          years: yearOpts,
          defaultYearId: _selectedYearId,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _loadData(_selectedYearId!);
    }
  }

  Future<void> _deleteMember(_Member m) async {
    final ok = await _confirm(
        'Delete member?', 'Remove "${m.name}" from the committee? This cannot be undone.');
    if (!ok) return;
    try {
      await _api.delete('$_base/members/${m.id}');
      if (mounted && _selectedYearId != null) await _loadData(_selectedYearId!);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  Future<void> _deleteGroup(_Group g) async {
    final ok = await _confirm('Delete Group',
        "Delete group '${g.groupName}'? This also removes all its members and sub-groups.");
    if (!ok) return;
    try {
      await _api.delete('$_base/groups/${g.id}');
      if (mounted && _selectedYearId != null) await _loadData(_selectedYearId!);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

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

  // ── Build ───────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final canManage =
        context.watch<AuthProvider>().isDistrictAdminOf(widget.districtId);
    final body = _loading
        ? const LoadingWidget()
        : _error != null
            ? ErrorStateWidget(message: _error!, onRetry: _loadInitial)
            : _buildBody(canManage);

    if (widget.embedded) {
      return Scaffold(backgroundColor: AppColors.background, body: body);
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'District Committee'),
      body: body,
    );
  }

  Widget _buildBody(bool canManage) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            children: [
              Row(
                children: [
                  if (_years.isNotEmpty)
                    Expanded(
                      child: RotaryYearBar<int>(
                        value: _selectedYearId,
                        margin: EdgeInsets.zero,
                        options: [
                          for (final y in _years)
                            RotaryYearOption(
                                value: y.id,
                                label: y.yearLabel,
                                isCurrent: y.isCurrent),
                        ],
                        onChanged: (v) {
                          setState(() => _selectedYearId = v);
                          if (v != null) _loadData(v);
                        },
                      ),
                    ),
                  if (canManage) ...[
                    const SizedBox(width: 8),
                    _AddMenu(
                      onMember: () => _openMemberForm(),
                      onGroup: () => _openGroupForm(),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _searchCtrl,
                onChanged: _onSearchChanged,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Search people (shows their groups), bearers, groups',
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
            ],
          ),
        ),
        Expanded(
          child: _loadingData
              ? const LoadingWidget()
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: () => _selectedYearId != null
                      ? _loadData(_selectedYearId!)
                      : Future.value(),
                  child: _buildList(canManage),
                ),
        ),
      ],
    );
  }

  Widget _buildList(bool canManage) {
    final members = _filteredMembers;
    final groups = _filteredGroups;
    final hasQuery = _query.trim().isNotEmpty;

    // Browse mode (no search): office bearers + committee groups.
    if (!hasQuery) {
      if (members.isEmpty && groups.isEmpty) {
        return ListView(
          children: [
            const SizedBox(height: 60),
            EmptyStateWidget(
              icon: Icons.groups_outlined,
              title: 'Nothing here yet',
              subtitle: canManage
                  ? 'Use the + button to add an office bearer or group.'
                  : 'No committee data for this year.',
            ),
          ],
        );
      }
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          ..._officeBearerSection(members, canManage),
          ..._groupSection(groups, canManage),
        ],
      );
    }

    // Search mode: person→groups results + office-bearer + group-name matches.
    final nothing =
        members.isEmpty && groups.isEmpty && _personGroups.isEmpty;
    if (nothing && _searchingGroups) {
      return const Center(child: LoadingWidget());
    }
    if (nothing && !_searchingGroups) {
      return ListView(
        children: [
          const SizedBox(height: 60),
          EmptyStateWidget(
            icon: Icons.search_off_rounded,
            title: 'No matches',
            subtitle: 'No people, office bearers or groups match "$_query".',
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        if (_searchingGroups || _personGroups.isNotEmpty) ...[
          if (_searchingGroups && _personGroups.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          for (final p in _personGroups) ...[
            _PersonGroupsCard(person: p, onTap: () => _openPersonDetail(p)),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 8),
        ],
        ..._officeBearerSection(members, canManage),
        ..._groupSection(groups, canManage),
      ],
    );
  }

  List<Widget> _officeBearerSection(List<_Member> members, bool canManage) {
    if (members.isEmpty) return const [];
    return [
      for (final m in members) ...[
        _MemberRow(
          member: m,
          canManage: canManage,
          onTap: () => _openMember(m),
          onEdit: () => _openMemberForm(existing: m),
          onDelete: () => _deleteMember(m),
        ),
        const SizedBox(height: 8),
      ],
      const SizedBox(height: 8),
    ];
  }

  List<Widget> _groupSection(List<_Group> groups, bool canManage) {
    if (groups.isEmpty) return const [];
    return [
      for (final g in groups) ...[
        _GroupRow(
          group: g,
          canManage: canManage,
          onTap: () => _openGroup(g),
          onEdit: () => _openGroupForm(existing: g),
          onDelete: () => _deleteGroup(g),
        ),
        const SizedBox(height: 8),
      ],
    ];
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
class _AddMenu extends StatelessWidget {
  final VoidCallback onMember;
  final VoidCallback onGroup;
  const _AddMenu({required this.onMember, required this.onGroup});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(10),
      ),
      child: PopupMenuButton<String>(
        tooltip: 'Add',
        icon: const Icon(Icons.add, color: Colors.white),
        onSelected: (v) => v == 'member' ? onMember() : onGroup(),
        itemBuilder: (_) => const [
          PopupMenuItem(
            value: 'member',
            child: Row(children: [
              Icon(Icons.person_add_alt_1_outlined, size: 18),
              SizedBox(width: 8),
              Text('Add Member'),
            ]),
          ),
          PopupMenuItem(
            value: 'group',
            child: Row(children: [
              Icon(Icons.group_add_outlined, size: 18),
              SizedBox(width: 8),
              Text('Add Group'),
            ]),
          ),
        ],
      ),
    );
  }
}

/// Search result: a person + the committee groups they're in (with the
/// designation held in each). The whole card taps through to the member
/// detail page (which lists the same groups, tappable to each group).
class _PersonGroupsCard extends StatelessWidget {
  final _PersonGroups person;
  final VoidCallback onTap;
  const _PersonGroupsCard({required this.person, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final photo = _photoUrl(person.profilePhoto);
    final n = person.groups.length;
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                child: Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primary.withValues(alpha: 0.12),
                        border: Border.all(color: AppColors.border),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: photo != null
                          ? Image.network(photo,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => _initialsBox())
                          : _initialsBox(),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            person.name,
                            style: AppTextStyles.bodyMedium
                                .copyWith(fontWeight: FontWeight.w700),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            'In $n ${n == 1 ? 'group' : 'groups'}',
                            style: AppTextStyles.caption
                                .copyWith(color: AppColors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
                  ],
                ),
              ),
              const Divider(height: 1),
              for (final g in person.groups)
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.groups_2_outlined,
                          size: 16, color: AppColors.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              g.designation.isNotEmpty ? g.designation : g.name,
                              style: AppTextStyles.body
                                  .copyWith(fontWeight: FontWeight.w700),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (g.designation.isNotEmpty)
                              Text(
                                g.name,
                                style: AppTextStyles.caption.copyWith(
                                    color: AppColors.textSecondary),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _initialsBox() => Center(
        child: Text(
          _initials(person.name),
          style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.bold),
        ),
      );
}

class _MemberRow extends StatelessWidget {
  final _Member member;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _MemberRow({
    required this.member,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final photo = _photoUrl(member.profilePhoto);
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
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
                        errorBuilder: (_, __, ___) => _initialsBox(),
                      )
                    : _initialsBox(),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (member.designation.trim().isNotEmpty)
                      Text(
                        member.designation.trim(),
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            member.name.isEmpty ? 'Unnamed' : member.name,
                            style: AppTextStyles.bodyMedium
                                .copyWith(fontWeight: FontWeight.w700),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (!member.isMember) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.warning.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(8),
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
                  ],
                ),
              ),
              if (canManage)
                _RowMenu(onEdit: onEdit, onDelete: onDelete)
              else
                const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _initialsBox() => Center(
        child: Text(
          _initials(member.name),
          style: const TextStyle(
              color: AppColors.primary, fontWeight: FontWeight.bold),
        ),
      );
}

class _GroupRow extends StatelessWidget {
  final _Group group;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _GroupRow({
    required this.group,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withValues(alpha: 0.10),
                ),
                child: const Icon(Icons.groups_2_outlined, color: AppColors.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      group.groupName,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Builder(builder: (_) {
                      // Direct members only — sub-group members are NOT rolled in.
                      final count = group.memberCount;
                      return _CountChip(
                        icon: Icons.person_outline_rounded,
                        label: '$count ${count == 1 ? 'Member' : 'Members'}',
                      );
                    }),
                  ],
                ),
              ),
              if (canManage)
                _RowMenu(onEdit: onEdit, onDelete: onDelete)
              else
                const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _CountChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primary),
          const SizedBox(width: 4),
          Text(
            label,
            style: AppTextStyles.caption.copyWith(
              color: AppColors.primary,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

class _RowMenu extends StatelessWidget {
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _RowMenu({required this.onEdit, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Actions',
      icon: const Icon(Icons.more_horiz),
      onSelected: (v) => v == 'edit' ? onEdit() : onDelete(),
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
    );
  }
}
