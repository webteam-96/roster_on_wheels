import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/routing/route_names.dart';
import '../../../../../core/utils/member_count_label.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/pagination_widget.dart';
import '../../../../widgets/common/search_bar_widget.dart';
import 'cog_member_search_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
class _ClubMember {
  final int id;
  final int memberId;
  final int? clubMemberId;
  final String memberName;
  final String? email;
  final String? phone;
  final String? designation;
  final bool isActive;
  final String? rotaryId;
  final DateTime? joinedDate;
  final String? profilePhotoPath;
  final List<String> roles;
  final bool hasAdminRole;

  const _ClubMember({
    required this.id,
    required this.memberId,
    this.clubMemberId,
    required this.memberName,
    this.email,
    this.phone,
    this.designation,
    this.isActive = true,
    this.rotaryId,
    this.joinedDate,
    this.profilePhotoPath,
    this.roles = const [],
    this.hasAdminRole = false,
  });

  factory _ClubMember.fromJson(Map<String, dynamic> j) {
    final rolesRaw = j['roles'];
    final roles = rolesRaw is List
        ? rolesRaw.map((e) => e.toString()).toList()
        : const <String>[];
    return _ClubMember(
      id: (j['id'] as num?)?.toInt() ?? 0,
      memberId: (j['memberId'] as num?)?.toInt() ?? (j['id'] as num?)?.toInt() ?? 0,
      clubMemberId: (j['clubMemberId'] as num?)?.toInt(),
      memberName: (j['memberName'] ?? j['name'] ?? '').toString(),
      email: (j['emailId'] ?? j['email'])?.toString(),
      phone: (j['primaryMobileNumber'] ?? j['phone'] ?? j['mobile'])?.toString(),
      designation: j['designation']?.toString(),
      isActive: (j['membershipActive'] ?? j['isActive']) as bool? ?? true,
      rotaryId: j['rotaryId']?.toString(),
      joinedDate: j['joinedDate'] != null
          ? DateTime.tryParse(j['joinedDate'].toString())
          : null,
      profilePhotoPath: j['profilePhotoPath']?.toString(),
      roles: roles,
      hasAdminRole: j['hasAdminRole'] as bool? ?? false,
    );
  }
}

class _Member {
  final int id;
  final String memberName;
  final String? email;
  final String? phone;

  const _Member({
    required this.id,
    required this.memberName,
    this.email,
    this.phone,
  });

  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        id: (j['id'] as num?)?.toInt() ?? (j['memberId'] as num?)?.toInt() ?? 0,
        memberName: (j['memberName'] ?? j['name'] ?? '').toString(),
        email: (j['emailId'] ?? j['email'])?.toString(),
        phone: (j['primaryMobileNumber'] ?? j['phone'] ?? j['mobile'])?.toString(),
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class ClubMembersScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  const ClubMembersScreen({super.key, required this.clubId, this.embedded = false});

  @override
  State<ClubMembersScreen> createState() => _ClubMembersScreenState();
}

class _ClubMembersScreenState extends State<ClubMembersScreen> {
  final _api = ApiClient();

  final List<_ClubMember> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  String _search = '';

  // Club-wide roster counts straight off GET /api/clubs/{id}/members. That
  // payload carries `memberCount` (already NET of honorary) and `honoraryCount`
  // for the whole club — independent of the current page / search filter — so
  // the summary shows the regular count + honorary subset without a second call.
  int? _memberCount;
  int? _honoraryCount;

  /// Viewer's role decides the Directory ordering. A CLUB ADMIN of this club
  /// sees the backend's admins-first order, paginated 20 at a time. A plain
  /// CLUB MEMBER must NOT see admins floated to the top — they get a flat
  /// alphabetical list. To make the A→Z sort correct (not just within one
  /// page) we pull the whole roster in a single large page for that case.
  late final bool _isClubAdmin;

  /// The COG (Council of Governors) directory is presented as a flat A→Z
  /// roster for everyone — admins are NEVER floated to the top here, even when
  /// the viewer is a club admin of the COG club. So COG always uses the
  /// member-style (whole-roster, alphabetical) path.
  bool get _adminsFirst => _isClubAdmin && !_isCog;
  int get _pageSize => _adminsFirst ? 20 : 500;

  /// True when this is the COG club. COG members are searchable by many extra
  /// fields server-side (district / year / designation / classification /
  /// family name), so we surface that with a helper line under the search bar
  /// — only here, since COG is where those searches matter.
  late final bool _isCog;

  /// Members (and the COG directory for everyone): alphabetical, no
  /// admins-at-top. Club admins of a non-COG club: backend order as-is.
  List<_ClubMember> get _display {
    if (_adminsFirst) return _items;
    return List<_ClubMember>.from(_items)
      ..sort((a, b) =>
          a.memberName.toLowerCase().compareTo(b.memberName.toLowerCase()));
  }

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    _isClubAdmin = auth.isClubAdminOf(widget.clubId);
    _isCog = auth.cogClubId == widget.clubId;
    _fetch(reset: true);
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/members',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_search.isNotEmpty) 'search': _search,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? {};
      final paged = PagedResponse.fromJson(data, (j) => _ClubMember.fromJson(j));
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalPages;
        _totalCount = paged.totalCount;
        // Club-wide counts ride on the same payload (net member + honorary).
        _memberCount = (data['memberCount'] as num?)?.toInt() ?? _memberCount;
        _honoraryCount = (data['honoraryCount'] as num?)?.toInt() ?? _honoraryCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; _loadingMore = false; });
    }
  }

  void _onSearch(String value) {
    _search = value;
    _fetch(reset: true);
  }

  /// COG-only tap-through search bar. Looks like the normal search field but is
  /// non-editable — tapping it (anywhere) opens [CogMemberSearchScreen] instead
  /// of showing a keyboard. The trailing tune icon hints it opens filters.
  Widget _cogSearchEntry() {
    final clubName = context.read<AuthProvider>().clubNameOf(widget.clubId);
    return InkWell(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => CogMemberSearchScreen(
          clubId: widget.clubId,
          clubName: clubName,
        ),
      )),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.lightBorder, width: 1),

        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            const Icon(Icons.search_rounded, size: 20, color: AppColors.textSecondary),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Search members...',
                style: AppTextStyles.bodyMedium.copyWith(color: AppColors.textMuted),
              ),
            ),
            const Icon(Icons.tune_rounded, size: 20, color: AppColors.primary),
          ],
        ),
      ),
    );
  }

  Future<void> _removeMember(int memberId, String memberName) async {
    try {
      await _api.delete('/api/clubs/${widget.clubId}/members/$memberId');
      setState(() => _items.removeWhere((m) => m.memberId == memberId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Member removed from club'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Remove failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _showAddMemberDialog() {
    showDialog(
      context: context,
      builder: (_) => _AddMemberDialog(
        clubId: widget.clubId,
        onAdded: () => _fetch(reset: true),
      ),
    );
  }

  /// Club Admin role is id = 2, club-scoped. Both directions POST to the admin
  /// controller (same endpoints the overview Directory subtab uses):
  ///   Promote → POST /api/admin/assign-role
  ///   Demote  → POST /api/admin/remove-role
  /// body: { memberId, roleId: 2, clubId }.
  Future<void> _toggleAdmin(_ClubMember m, bool makeAdmin) async {
    final who = m.memberName.trim().isEmpty ? 'this member' : m.memberName;
    final clubName = context.read<AuthProvider>().clubNameOf(widget.clubId);
    final ofClub =
        (clubName != null && clubName.isNotEmpty) ? ' of $clubName' : '';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(makeAdmin ? 'Make Admin' : 'Remove Admin'),
        content: Text(makeAdmin
            ? 'Make $who an Admin$ofClub?'
            : 'Remove $who as an Admin$ofClub?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              makeAdmin ? 'Make Admin' : 'Remove',
              style: TextStyle(
                  color: makeAdmin ? AppColors.primary : AppColors.error),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _api.post(
        makeAdmin
            ? ApiConstants.adminAssignRole
            : ApiConstants.adminRemoveRole,
        body: {
          'memberId': m.memberId,
          'roleId': 2,
          'clubId': widget.clubId,
        },
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(makeAdmin ? 'Promoted to Club Admin' : 'Removed Club Admin role'),
            backgroundColor: AppColors.success,
          ),
        );
        await _fetch(reset: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = context.watch<AuthProvider>().isSuperAdmin;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : const CustomAppBar(title: 'Club Members'),
      floatingActionButton: canManage
          ? FloatingActionButton(
              onPressed: _showAddMemberDialog,
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.person_add_outlined, color: Colors.white),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // COG (Council of Governors) directory: the 60+ audience found
                // the single "smart" omni-search box confusing, so tapping the
                // bar opens a dedicated per-field filter page (name/mobile, year,
                // designation, district + more) that searches server-side. Other
                // clubs keep the inline typing search.
                if (_isCog)
                  _cogSearchEntry()
                else
                  SearchBarWidget(
                    hint: 'Search members...',
                    onSearch: _onSearch,
                  ),
                if (_isCog)
                  Padding(
                    padding: const EdgeInsets.only(top: 6, left: 4, right: 4),
                    child: Text(
                      'Tap to search by name, mobile, designation, '
                      'district and more.',
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.textMuted,
                        height: 1.3,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (_memberCount != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Row(
                children: [
                  const Icon(Icons.people_outline,
                      size: 14, color: AppColors.textSecondary),
                  const SizedBox(width: 5),
                  Text(
                    // COG shows just the total roster (members + honorary
                    // combined); other clubs show the net member count + the
                    // honorary subset. `memberCount` is already net of honorary.
                    _isCog
                        ? () {
                            final total =
                                _memberCount! + (_honoraryCount ?? 0);
                            return '$total member${total == 1 ? '' : 's'}';
                          }()
                        : memberCountLabel(
                            total: _memberCount!,
                            alreadyNet: true,
                            honorary: _honoraryCount),
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 10, itemHeight: 72)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
                    : _items.isEmpty
                        ? EmptyStateWidget(
                            title: 'No Members',
                            subtitle: _search.isNotEmpty
                                ? 'No members match your search.'
                                : (canManage
                                    ? 'Add members using the button below.'
                                    : 'No members to display.'),
                            icon: Icons.people_outline,
                            actionLabel: canManage ? 'Add Member' : null,
                            onAction: canManage ? _showAddMemberDialog : null,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: () => _fetch(reset: true),
                            child: Builder(builder: (context) {
                              final display = _display;
                              return ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
                              itemCount: display.length + 1,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                if (i == display.length) {
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
                                final member = display[i];
                                return _MemberTile(
                                  member: member,
                                  isClubAdmin: canManage,
                                  // COG (Council of Governors) directory shows the
                                  // per-club designation under the name. Gated to
                                  // COG only; hidden when the field is null/empty
                                  // (it stays null until the members endpoint adds
                                  // `cm.Designation` to its SELECT projection).
                                  isCog: _isCog,
                                  // Make/Remove Club Admin is available to this
                                  // club's own admin (club-scoped, mirrors the
                                  // overview Directory subtab). Add / Edit /
                                  // Remove-from-Club stay gated on `canManage`
                                  // (SuperAdmin) and remain hidden in mobile.
                                  canManageAdmins: _isClubAdmin,
                                  onRemove: () async {
                                    final ok = await ConfirmationDialog.show(
                                      context,
                                      title: 'Remove Member',
                                      message: 'Remove "${member.memberName}" from this club?',
                                    );
                                    if (ok) _removeMember(member.memberId, member.memberName);
                                  },
                                  // Club Directory members list → the member
                                  // detail offers the Edit button (still gated to
                                  // the club's own admin). Same flag as the
                                  // overview Directory subtab.
                                  onViewDetails: () => context.push(
                                      RouteNames.directoryMemberDetail(
                                          member.memberId,
                                          fromDirectory: true,
                                          clubId: widget.clubId,
                                          // Thread the member's admin status so
                                          // the detail page's "Make/Remove Admin"
                                          // app-bar button (which replaced the
                                          // inline row icon) shows the right
                                          // label. Only meaningful to a club
                                          // admin; the detail re-gates on that.
                                          hasAdminRole: _isClubAdmin
                                              ? member.hasAdminRole
                                              : null)),
                                  onEdit: () => context.push(RouteNames.memberEdit(member.memberId, clubId: widget.clubId)),
                                  onMakeAdmin: () => _toggleAdmin(member, true),
                                  onRemoveAdmin: () => _toggleAdmin(member, false),
                                );
                              },
                            );
                          }),
                          ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Member Tile — rich card with role chips + admin popup menu
// ---------------------------------------------------------------------------
class _MemberTile extends StatelessWidget {
  final _ClubMember member;
  final bool isClubAdmin;
  final bool canManageAdmins;
  final bool isCog;
  final VoidCallback onRemove;
  final VoidCallback onViewDetails;
  final VoidCallback onEdit;
  final VoidCallback onMakeAdmin;
  final VoidCallback onRemoveAdmin;

  const _MemberTile({
    required this.member,
    required this.isClubAdmin,
    required this.canManageAdmins,
    required this.isCog,
    required this.onRemove,
    required this.onViewDetails,
    required this.onEdit,
    required this.onMakeAdmin,
    required this.onRemoveAdmin,
  });

  String get _initials {
    if (member.memberName.trim().isEmpty) return 'M';
    final parts = member.memberName.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  String? get _photoUrl {
    final p = member.profilePhotoPath;
    if (p == null || p.isEmpty) return null;
    return p.startsWith('http') ? p : '${ApiConstants.mediaBaseUrl}$p';
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
        onTap: onViewDetails,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildAvatar(),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.memberName,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    // COG-only: per-club designation under the name (hidden when
                    // empty — the field is null until the backend adds
                    // `cm.Designation` to the members-endpoint SELECT).
                    if (isCog && (member.designation ?? '').trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          member.designation!.trim(),
                          style: AppTextStyles.caption.copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    // COG directory hides the email/mobile contact rows in the
                    // listing (privacy — Council of Governors profiles). Other
                    // clubs keep showing them.
                    if (!isCog &&
                        member.email != null &&
                        member.email!.isNotEmpty)
                      Text(member.email!,
                          style: AppTextStyles.caption
                              .copyWith(color: AppColors.textSecondary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    if (!isCog &&
                        member.phone != null &&
                        member.phone!.isNotEmpty)
                      Text(member.phone!,
                          style: AppTextStyles.caption
                              .copyWith(color: AppColors.textSecondary)),
                    // COG directory also hides the role chips (Member / Club
                    // Admin / …) — Council of Governors tiles show only the
                    // name + designation. Other clubs keep the role chips.
                    if (!isCog && member.roles.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Wrap(
                          spacing: 4,
                          runSpacing: 4,
                          children: member.roles
                              .map((r) => Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppColors.primaryLight,
                                      borderRadius:
                                          BorderRadius.circular(10),
                                    ),
                                    child: Text(
                                      r,
                                      style: AppTextStyles.caption.copyWith(
                                        color: AppColors.primary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ))
                              .toList(),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  // Make/Remove Club Admin used to be an inline shield icon on
                  // every row here — but it sat right where you tap to open the
                  // member, so admins kept promoting people by mistake. It has
                  // moved to a labelled "Make Admin"/"Remove Admin" button in the
                  // member detail page's app bar (opened via onViewDetails). Club
                  // admins now just get the chevron here → tap opens the member.
                  // The full popup is kept only for the SuperAdmin path
                  // (isClubAdmin), which is hidden in mobile.
                  if (isClubAdmin)
                    PopupMenuButton<String>(
                      icon: const Icon(Icons.more_vert,
                          size: 20, color: AppColors.textSecondary),
                      onSelected: (v) {
                        switch (v) {
                          case 'view':
                            onViewDetails();
                            break;
                          case 'edit':
                            onEdit();
                            break;
                          case 'makeAdmin':
                            onMakeAdmin();
                            break;
                          case 'removeAdmin':
                            onRemoveAdmin();
                            break;
                          case 'remove':
                            onRemove();
                            break;
                        }
                      },
                      itemBuilder: (_) => [
                        // View / Edit / Remove-from-Club are SuperAdmin-only
                        // (isClubAdmin == isSuperAdmin here) and stay hidden in
                        // mobile. Club admins see ONLY the Make/Remove Admin item.
                        if (isClubAdmin)
                          const PopupMenuItem(value: 'view', child: Text('View Details')),
                        if (isClubAdmin)
                          const PopupMenuItem(value: 'edit', child: Text('Edit Member')),
                        if (!member.hasAdminRole)
                          const PopupMenuItem(
                              value: 'makeAdmin',
                              child: Text('Make Club Admin')),
                        if (member.hasAdminRole)
                          const PopupMenuItem(
                              value: 'removeAdmin',
                              child: Text('Remove Club Admin')),
                        if (isClubAdmin)
                          const PopupMenuItem(
                            value: 'remove',
                            child: Text('Remove from Club',
                                style: TextStyle(color: AppColors.error)),
                          ),
                      ],
                    )
                  else
                    const Icon(Icons.chevron_right,
                        color: AppColors.textSecondary, size: 20),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAvatar() {
    final url = _photoUrl;
    if (url == null) {
      return CircleAvatar(
        radius: 22,
        backgroundColor: AppColors.primaryLight,
        child: Text(_initials,
            style: AppTextStyles.bodyMedium
                .copyWith(color: AppColors.primary)),
      );
    }
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: url,
        width: 44,
        height: 44,
        fit: BoxFit.cover,
        errorWidget: (_, __, ___) => CircleAvatar(
          radius: 22,
          backgroundColor: AppColors.primaryLight,
          child: Text(_initials,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: AppColors.primary)),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Add Member Dialog
// ---------------------------------------------------------------------------
class _AddMemberDialog extends StatefulWidget {
  final int clubId;
  final VoidCallback onAdded;

  const _AddMemberDialog({required this.clubId, required this.onAdded});

  @override
  State<_AddMemberDialog> createState() => _AddMemberDialogState();
}

class _AddMemberDialogState extends State<_AddMemberDialog> {
  final _api = ApiClient();

  List<_Member> _allMembers = [];
  List<_Member> _filtered = [];
  bool _loading = true;
  bool _adding = false;
  int? _selectedMemberId;
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadMembers();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMembers() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/members',
        queryParams: {'page': 1, 'pageSize': 100},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Member.fromJson(j));
      setState(() {
        _allMembers = paged.items;
        _filtered = List.from(_allMembers);
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  void _onSearch(String query) {
    setState(() {
      _filtered = query.isEmpty
          ? List.from(_allMembers)
          : _allMembers.where((m) =>
              m.memberName.toLowerCase().contains(query.toLowerCase()) ||
              (m.email?.toLowerCase().contains(query.toLowerCase()) ?? false)).toList();
    });
  }

  Future<void> _addMember() async {
    if (_selectedMemberId == null) return;
    setState(() => _adding = true);

    try {
      await _api.post('/api/clubs/${widget.clubId}/members', body: {
        'memberId': _selectedMemberId,
      });
      if (mounted) {
        Navigator.of(context).pop();
        widget.onAdded();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Member added to club'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Add Member to Club', style: AppTextStyles.h3),
            const SizedBox(height: 12),
            TextField(
              controller: _searchCtrl,
              onChanged: _onSearch,
              decoration: InputDecoration(
                hintText: 'Search members...',
                prefixIcon: const Icon(Icons.search, size: 20),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 300,
              child: _loading
                  ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
                  : _filtered.isEmpty
                      ? Center(
                          child: Text('No members found', style: AppTextStyles.body.copyWith(color: AppColors.textMuted)),
                        )
                      : ListView.builder(
                          itemCount: _filtered.length,
                          itemBuilder: (ctx, i) {
                            final m = _filtered[i];
                            final isSelected = _selectedMemberId == m.id;
                            return ListTile(
                              dense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              leading: CircleAvatar(
                                backgroundColor: isSelected ? AppColors.primary : AppColors.primaryLight,
                                radius: 18,
                                child: Text(
                                  m.memberName.isNotEmpty ? m.memberName[0].toUpperCase() : 'M',
                                  style: AppTextStyles.caption.copyWith(
                                    color: isSelected ? Colors.white : AppColors.primary,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              title: Text(m.memberName, style: AppTextStyles.body),
                              subtitle: m.email != null && m.email!.isNotEmpty
                                  ? Text(m.email!, style: AppTextStyles.caption, maxLines: 1, overflow: TextOverflow.ellipsis)
                                  : null,
                              selected: isSelected,
                              selectedTileColor: AppColors.primaryLight,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                              onTap: () => setState(() => _selectedMemberId = isSelected ? null : m.id),
                              trailing: isSelected
                                  ? const Icon(Icons.check_circle, color: AppColors.primary, size: 20)
                                  : null,
                            );
                          },
                        ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _selectedMemberId != null && !_adding ? _addMember : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                    ),
                    child: _adding
                        ? const SizedBox(
                            width: 18, height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Add Member'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
