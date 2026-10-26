import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/routing/route_names.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/pagination_widget.dart';
import '../../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Member {
  final int id;
  final String memberName;
  final String? email;
  final String? phone;
  final String? designation;
  final String? clubName;
  final String? rotaryId;
  final String? profilePhotoPath;
  final DateTime? joinedDate;
  final List<String> roles;
  final bool hasDistrictAdminRole;
  final bool hasClubAdminRole;
  final bool isSuperAdmin;
  final bool isActive;

  const _Member({
    required this.id,
    required this.memberName,
    this.email,
    this.phone,
    this.designation,
    this.clubName,
    this.rotaryId,
    this.profilePhotoPath,
    this.joinedDate,
    this.roles = const [],
    this.hasDistrictAdminRole = false,
    this.hasClubAdminRole = false,
    this.isSuperAdmin = false,
    this.isActive = true,
  });

  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        id: j['id'] as int? ?? j['memberId'] as int? ?? 0,
        memberName: j['memberName'] as String? ?? j['name'] as String? ?? '',
        email: j['emailId'] as String? ?? j['email'] as String?,
        phone: j['primaryMobileNumber'] as String? ?? j['phone'] as String? ?? j['mobile'] as String?,
        designation: j['designation'] as String?,
        clubName: j['clubName'] as String?,
        rotaryId: j['rotaryId'] as String?,
        profilePhotoPath: j['profilePhotoPath'] as String?,
        joinedDate: j['joinedDate'] != null ? DateTime.tryParse(j['joinedDate'] as String) : null,
        roles: ((j['roles'] as List<dynamic>?) ?? const [])
            .map((r) => r.toString())
            .where((r) => r.isNotEmpty)
            .toList(),
        hasDistrictAdminRole: j['hasDistrictAdminRole'] as bool? ?? false,
        hasClubAdminRole: j['hasClubAdminRole'] as bool? ?? false,
        isSuperAdmin: j['isSuperAdmin'] as bool? ?? false,
        isActive: j['isActive'] as bool? ?? true,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictMembersScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictMembersScreen({super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictMembersScreen> createState() => _DistrictMembersScreenState();
}

class _DistrictMembersScreenState extends State<DistrictMembersScreen> {
  final _api = ApiClient();

  final List<_Member> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  String _search = '';
  static const int _pageSize = 20;

  @override
  void initState() {
    super.initState();
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
        '/api/districts/${widget.districtId}/members',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_search.isNotEmpty) 'search': _search,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Member.fromJson(j));
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!e.toString().contains('(404)')) setState(() => _error = e.toString());
      setState(() { _loading = false; _loadingMore = false; });
    }
  }

  void _onSearch(String value) {
    _search = value;
    _fetch(reset: true);
  }

  Widget _buildBody() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          // Backend already searches Name, Email ID, Mobile and Rotary ID
          // (DistrictService.GetMembersAsync). The hint surfaces that to the
          // user — the previous "Search members..." gave no clue that
          // anything other than name was supported, so users assumed it
          // wasn't.
          child: SearchBarWidget(
            hint: 'Search by name, Email ID, mobile or Rotary ID',
            onSearch: _onSearch,
          ),
        ),
        Expanded(
          child: _loading
              ? const ShimmerList(itemCount: 10, itemHeight: 72)
              : _error != null
                  ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
                  : _items.isEmpty
                      ? EmptyStateWidget(
                          title: 'No Members Found',
                          subtitle: _search.isNotEmpty
                              ? 'No members match your search.'
                              : 'No members found for this district.',
                          icon: Icons.person_outline,
                        )
                      : RefreshIndicator(
                          color: AppColors.primary,
                          onRefresh: () => _fetch(reset: true),
                          child: ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: _items.length + 1,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (ctx, i) {
                              if (i == _items.length) {
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
                              return _MemberTile(member: _items[i]);
                            },
                          ),
                        ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.embedded) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: _buildBody(),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'District Members',
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text(
              '$_totalCount total',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }
}

// ---------------------------------------------------------------------------
// Member Tile — single-row layout matching club_members_screen design
// ---------------------------------------------------------------------------
class _MemberTile extends StatelessWidget {
  final _Member member;
  const _MemberTile({required this.member});

  String? get _photoUrl {
    final url = ApiConstants.mediaUrl(member.profilePhotoPath);
    return url.isEmpty ? null : url;
  }

  String get _initials {
    final name = member.memberName;
    if (name.trim().isEmpty) return 'M';
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  bool get _hasAdminRole =>
      member.isSuperAdmin ||
      member.hasDistrictAdminRole ||
      member.hasClubAdminRole;

  // Hide redundant "Member" chip when an elevated role is present (matches web).
  List<String> get _displayRoles {
    if (member.roles.isEmpty) return const ['Member'];
    final hasElevated =
        member.roles.any((r) => r == 'Admin' || r == 'SuperAdmin');
    final filtered = member.roles
        .where((r) => !(r == 'Member' && hasElevated))
        .toList();
    return filtered.isEmpty ? const ['Member'] : filtered;
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        // District directory: show the member's club WITHIN this district (the
        // row's clubName), not clubs.first which may be a club in another
        // district (e.g. COG/IFRM). Endpoint returns no clubId, so match by name.
        onTap: () => context.push(RouteNames.directoryMemberDetail(member.id,
            clubName: member.clubName)),
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
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            member.memberName.isNotEmpty
                                ? member.memberName
                                : 'Member',
                            style: AppTextStyles.bodyMedium
                                .copyWith(fontWeight: FontWeight.w700),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (_hasAdminRole)
                          const Padding(
                            padding: EdgeInsets.only(left: 4),
                            child: const Icon(Icons.shield,
                                size: 14, color: AppColors.primary),
                          ),
                      ],
                    ),
                    if (member.clubName != null && member.clubName!.isNotEmpty)
                      Text(
                        member.clubName!,
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    if (member.email != null && member.email!.isNotEmpty)
                      Text(
                        member.email!,
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    if (member.phone != null && member.phone!.isNotEmpty)
                      Text(
                        member.phone!,
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        children: _displayRoles
                            .map((r) => Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.primaryLight,
                                    borderRadius: BorderRadius.circular(10),
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
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: member.isActive
                          ? AppColors.success.withValues(alpha: 0.12)
                          : AppColors.muted,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      member.isActive ? 'Active' : 'Inactive',
                      style: AppTextStyles.caption.copyWith(
                        color: member.isActive
                            ? AppColors.success
                            : AppColors.textSecondary,
                        fontSize: 10,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
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
