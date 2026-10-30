import 'package:flutter/material.dart' hide Text;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_response.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import '../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Member {
  final int id;
  final String memberName;
  final String? emailId;
  final String? primaryMobileNumber;
  final String? bloodGroup;
  final String? gender;
  final String? profilePhotoPath;

  const _Member({
    required this.id,
    required this.memberName,
    this.emailId,
    this.primaryMobileNumber,
    this.bloodGroup,
    this.gender,
    this.profilePhotoPath,
  });

  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        id: j['id'] as int? ?? j['memberId'] as int? ?? 0,
        memberName: j['memberName'] as String? ?? '',
        emailId: j['emailId'] as String?,
        primaryMobileNumber: j['primaryMobileNumber'] as String?,
        bloodGroup: j['bloodGroup'] as String?,
        gender: j['gender'] as String?,
        profilePhotoPath: j['profilePhotoPath'] as String?,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class MembersListScreen extends StatefulWidget {
  const MembersListScreen({super.key});

  @override
  State<MembersListScreen> createState() => _MembersListScreenState();
}

class _MembersListScreenState extends State<MembersListScreen> {
  final _api = ApiClient();

  final List<_Member> _members = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  String _search = '';
  String _bloodGroup = '';
  String _gender = '';

  static const int _pageSize = 20;

  static const _bloodGroups = ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
  static const _genders = ['', 'Male', 'Female', 'Other'];

  @override
  void initState() {
    super.initState();
    _fetchMembers(reset: true);
  }

  Future<void> _fetchMembers({bool reset = false}) async {
    if (reset) {
      setState(() {
        _page = 1;
        _members.clear();
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }

    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/members',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          'search': _search,
          'bloodGroup': _bloodGroup,
          'gender': _gender,
        },
        fromJson: (json) => json as Map<String, dynamic>,
      );

      final data = resp.data ?? {};
      final paged = PagedResponse.fromJson(data, (j) => _Member.fromJson(j));

      setState(() {
        _members.addAll(paged.items);
        _totalPages = paged.totalPages;
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _deleteMember(int id) async {
    try {
      await _api.delete('/api/members/$id');
      setState(() => _members.removeWhere((m) => m.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Member deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _onLoadMore() {
    if (_page < _totalPages && !_loadingMore) {
      _page++;
      _fetchMembers();
    }
  }

  void _applyFilters() => _fetchMembers(reset: true);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      drawer: const CustomDrawer(),
      appBar: CustomAppBar(
        title: 'Members',
        titleStyle: AppFonts.display(fontWeight: FontWeight.w600, fontSize: 22),
        showBack: false,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu_rounded, color: AppColors.textPrimary, size: 28),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primaryPrime.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              '$_totalCount total',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: AppColors.primaryPrime,
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/members/create'),
        backgroundColor: AppColors.primaryPrime,
        foregroundColor: AppColors.white,
        icon: const Icon(Icons.person_add_rounded),
        label: const Text('Add Member'),
        shape: const StadiumBorder(),
      ),
      body: Column(
        children: [
          _buildFilterBar(),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
      child: Column(
        children: [
          SearchBarWidget(
            hint: 'Search by name or email...',
            onSearch: (v) {
              _search = v;
              _applyFilters();
            },
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _DropdownFilter(
                  label: 'Blood group',
                  value: _bloodGroup,
                  items: _bloodGroups,
                  onChanged: (v) {
                    _bloodGroup = v ?? '';
                    _applyFilters();
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _DropdownFilter(
                  label: 'Gender',
                  value: _gender,
                  items: _genders,
                  onChanged: (v) {
                    _gender = v ?? '';
                    _applyFilters();
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const ShimmerList(itemCount: 8, itemHeight: 100);
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: () => _fetchMembers(reset: true));
    }
    if (_members.isEmpty) {
      return EmptyStateWidget(
        title: 'No Members Found',
        subtitle: 'Try adjusting your search or filters.',
        icon: Icons.person_off_rounded,
        actionLabel: 'Add Member',
        onAction: () => context.push('/members/create'),
      );
    }

    return RefreshIndicator(
      color: AppColors.primaryPrime,
      onRefresh: () => _fetchMembers(reset: true),
      child: ListView.separated(
        padding: (const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 100)).add(const EdgeInsets.only(bottom: 88)),
        itemCount: _members.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (ctx, i) {
          if (i == _members.length) {
            return PaginationWidget(
              currentPage: _page,
              totalPages: _totalPages,
              totalCount: _totalCount,
              isLoading: _loadingMore,
              onLoadMore: _onLoadMore,
            );
          }
          return _MemberCard(
            member: _members[i],
            onTap: () => _showDetailSheet(_members[i]),
            onEdit: () => context.push('/members/${_members[i].id}/edit'),
            onDelete: () async {
              final confirmed = await ConfirmationDialog.show(
                context,
                title: 'Delete Member',
                message: 'Are you sure you want to delete "${_members[i].memberName}"? This action cannot be undone.',
              );
              if (confirmed) _deleteMember(_members[i].id);
            },
          );
        },
      ),
    );
  }

  void _showDetailSheet(_Member member) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      builder: (_) => _MemberDetailSheet(member: member),
    );
  }
}

// ---------------------------------------------------------------------------
// Member Card
// ---------------------------------------------------------------------------
class _MemberCard extends StatelessWidget {
  final _Member member;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _MemberCard({
    required this.member,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  static String _meta(dynamic m) => [m.gender, m.bloodGroup]
      .where((v) => v != null && '$v'.isNotEmpty)
      .join(' · ');

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder, width: 1),

      ),
      child: Material(
        color: AppColors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                _Avatar(member: member),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        member.memberName,
                        style: AppFonts.body(
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (member.emailId != null && member.emailId!.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          member.emailId!,
                          style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                      if (_meta(member).isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          _meta(member),
                          style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                // Row actions live in one menu (design.md 8.6): no permanent red delete on every row.
                PopupMenuButton<String>(
                  tooltip: 'Member actions',
                  icon: const Icon(Icons.more_vert_rounded, color: AppColors.textSecondary),
                  onSelected: (v) => v == 'edit' ? onEdit() : onDelete(),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Edit')),
                    PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: AppColors.error))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
class _Avatar extends StatelessWidget {
  final _Member member;
  const _Avatar({required this.member});

  @override
  Widget build(BuildContext context) {
    final initials = member.memberName.trim().split(' ').take(2).map((s) => s.isNotEmpty ? s[0].toUpperCase() : '').join();

    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.primaryPrime.withOpacity(0.1), width: 2),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(26),
        child: member.profilePhotoPath != null && member.profilePhotoPath!.isNotEmpty
            ? CachedNetworkImage(
                imageUrl: ApiConstants.mediaUrl(member.profilePhotoPath),
                width: 52,
                height: 52,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) => _InitialsAvatar(initials: initials),
                placeholder: (_, __) => _InitialsAvatar(initials: initials),
              )
            : _InitialsAvatar(initials: initials),
      ),
    );
  }
}

class _InitialsAvatar extends StatelessWidget {
  final String initials;
  const _InitialsAvatar({required this.initials});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withOpacity(0.08),
      ),
      child: Center(
        child: Text(
          initials.isEmpty ? '?' : initials,
          style: AppFonts.body(
            color: AppColors.primaryPrime,
            fontWeight: FontWeight.w800,
            fontSize: 16,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  final Color bgColor;
  const _Badge({required this.label, required this.color, required this.bgColor});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bgColor, borderRadius: BorderRadius.circular(8)),
      child: Text(
        label,
        style: AppFonts.body(
          color: color,
          fontWeight: FontWeight.w800,
          fontSize: 13,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Dropdown Filter
// ---------------------------------------------------------------------------
class _DropdownFilter extends StatelessWidget {
  final String label;
  final String value;
  final List<String> items;
  final ValueChanged<String?> onChanged;

  const _DropdownFilter({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.lightBorder),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButtonFormField<String>(
          value: value,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: label,
            labelStyle: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textSecondary,
            ),
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            contentPadding: EdgeInsets.zero,
          ),
          style: AppFonts.body(
            color: AppColors.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
          items: items.map((g) => DropdownMenuItem(value: g, child: Text(g.isEmpty ? 'All' : g))).toList(),
          onChanged: onChanged,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail Bottom Sheet
// ---------------------------------------------------------------------------
class _MemberDetailSheet extends StatelessWidget {
  final _Member member;
  const _MemberDetailSheet({required this.member});

  @override
  Widget build(BuildContext context) {
    final initials = member.memberName.trim().split(' ').take(2).map((s) => s.isNotEmpty ? s[0].toUpperCase() : '').join();

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (_, ctrl) => Column(
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(color: AppColors.lightBorder, borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(height: 24),
          Expanded(
            child: ListView(
              controller: ctrl,
              padding: (const EdgeInsets.symmetric(horizontal: AppSpacing.lg)).add(const EdgeInsets.only(bottom: 88)),
              children: [
                Center(
                  child: Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.primaryPrime.withOpacity(0.1), width: 4),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(50),
                      child: member.profilePhotoPath != null && member.profilePhotoPath!.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: ApiConstants.mediaUrl(member.profilePhotoPath),
                              width: 100,
                              height: 100,
                              fit: BoxFit.cover,
                              errorWidget: (_, __, ___) => _LargeInitialsAvatar(initials: initials),
                            )
                          : _LargeInitialsAvatar(initials: initials),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Center(
                  child: Text(
                    member.memberName,
                    style: AppFonts.display(
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (member.bloodGroup != null && member.bloodGroup!.isNotEmpty)
                      _Badge(label: member.bloodGroup!, color: AppColors.error, bgColor: AppColors.errorLight),
                    if (member.bloodGroup != null && member.gender != null) const SizedBox(width: 8),
                    if (member.gender != null && member.gender!.isNotEmpty)
                      _Badge(label: member.gender!, color: AppColors.primaryPrime, bgColor: AppColors.primaryPrime.withOpacity(0.08)),
                  ],
                ),
                const SizedBox(height: 32),
                _buildInfoSection('Contact Information', [
                  if (member.emailId != null && member.emailId!.isNotEmpty)
                    _DetailRow(icon: Icons.email_rounded, label: 'Email address', value: member.emailId!),
                  if (member.primaryMobileNumber != null && member.primaryMobileNumber!.isNotEmpty)
                    _DetailRow(icon: Icons.phone_rounded, label: 'Mobile number', value: member.primaryMobileNumber!),
                ]),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoSection(String title, List<Widget> children) {
    if (children.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: AppColors.textMuted,
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.primaryPrime.withOpacity(0.03),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.primaryPrime.withOpacity(0.05)),
          ),
          child: Column(children: children),
        ),
      ],
    );
  }
}

class _LargeInitialsAvatar extends StatelessWidget {
  final String initials;
  const _LargeInitialsAvatar({required this.initials});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 100,
      height: 100,
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withOpacity(0.08),
      ),
      child: Center(
        child: Text(
          initials.isEmpty ? '?' : initials,
          style: AppFonts.body(
            color: AppColors.primaryPrime,
            fontWeight: FontWeight.w800,
            fontSize: 32,
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _DetailRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(12),

            ),
            child: Icon(icon, size: 20, color: AppColors.primaryPrime),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textSecondary,
                  ),
                ),
                Text(
                  value,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
