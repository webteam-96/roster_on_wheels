import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/network/api_response.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/detail/detail_widgets.dart';
import '../find_rotarian/find_rotarian_detail_screen.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

// =============================================================================
// Read-only ClubInfoScreen
//
// Shows club header info + 4 tabs: Rotarians / BOD / Communication / Projects.
// There is NO add/edit/delete/role-management control on this screen — it is
// intended for non-admin viewers (e.g. members browsing another club).the
// =============================================================================

class ClubInfoScreen extends StatefulWidget {
  final int clubId;
  final bool embedded; // default false
  const ClubInfoScreen({super.key, required this.clubId, this.embedded = false});

  @override
  State<ClubInfoScreen> createState() => _ClubInfoScreenState();
}

class _ClubInfoScreenState extends State<ClubInfoScreen> {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  _ClubDetail? _club;

  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  // Match counts reported by each tab. null = tab hasn't loaded its data yet
  // (TabBarView lazy-builds children, so untouched tabs stay null).
  final Map<int, int?> _matchCounts = {0: null, 1: null, 2: null, 3: null};

  void _reportMatchCount(int tabIndex, int count) {
    if (!mounted) return;
    if (_matchCounts[tabIndex] == count) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _matchCounts[tabIndex] = count);
    });
  }

  @override
  void initState() {
    super.initState();
    _fetchClub();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchClub() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        ApiConstants.clubById(widget.clubId),
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data;
      if (data == null) {
        setState(() {
          _error = 'Club not found';
          _loading = false;
        });
        return;
      }
      setState(() {
        _club = _ClubDetail.fromJson(data);
        _loading = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.statusCode == 404 ? 'Club not found' : e.message;
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
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Builder(
          builder: (ctx) => _loading
              ? _buildHeaderPlusLoading()
              : _error != null
                  ? _buildHeaderPlusError()
                  : _buildContent(ctx),
        ),
      ),
    );
  }

  Widget _buildHeaderPlusLoading() {
    return Column(
      children: [
        _ClubInfoHeader(
          club: null,
          onBack: widget.embedded ? null : () => context.pop(),
        ),
        const Expanded(child: LoadingWidget()),
      ],
    );
  }

  Widget _buildHeaderPlusError() {
    return Column(
      children: [
        _ClubInfoHeader(
          club: null,
          onBack: widget.embedded ? null : () => context.pop(),
        ),
        Expanded(
          child: ErrorStateWidget(
            message: _error ?? 'Failed to load club',
            onRetry: _fetchClub,
          ),
        ),
      ],
    );
  }

  Widget _buildContent(BuildContext context) {
    final club = _club!;
    final tabController = DefaultTabController.of(context);
    return AnimatedBuilder(
      animation: tabController,
      builder: (context, _) => Column(
        children: [
          // Collapse the header when search is active so the list gets more
          // vertical room (back arrow stays visible).
          _ClubInfoHeader(
            club: club,
            onBack: widget.embedded ? null : () => context.pop(),
            initiallyCollapsed:
                tabController.index == 3 || _searchQuery.isNotEmpty,
          ),
          _buildSearchBar(),
          Container(
          margin: const EdgeInsets.fromLTRB(12, 6, 12, 8),
          decoration: BoxDecoration(
            color: AppColors.primaryLight.withOpacity(0.4),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.primary.withOpacity(0.15)),
          ),
          child: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            padding: const EdgeInsets.all(4),
            labelPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 0),
            labelStyle: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w700),
            unselectedLabelStyle: AppTextStyles.bodyMedium,
            tabs: [
              _buildTabLabel('Rotarians', 0, tabController.index),
              _buildTabLabel('BOD', 1, tabController.index),
              _buildTabLabel('Communication', 2, tabController.index),
              _buildTabLabel('Projects', 3, tabController.index),
            ],
          ),
        ),
          Expanded(
            // IndexedStack (not TabBarView) so all 4 tabs build eagerly on
            // mount and report their match counts. Trade-off: no swipe
            // gesture between tabs (tapping the TabBar still works).
            child: IndexedStack(
              index: tabController.index,
              children: [
                _RotariansTab(
                  clubId: widget.clubId,
                  searchQuery: _searchQuery,
                  onMatchCount: (c) => _reportMatchCount(0, c),
                ),
                _BodTab(
                  clubId: widget.clubId,
                  searchQuery: _searchQuery,
                  onMatchCount: (c) => _reportMatchCount(1, c),
                ),
                _CommunicationTab(
                  clubId: widget.clubId,
                  searchQuery: _searchQuery,
                  onMatchCount: (c) => _reportMatchCount(2, c),
                ),
                _ProjectsTab(
                  clubId: widget.clubId,
                  districtId: _club?.districtId ?? 0,
                  searchQuery: _searchQuery,
                  onMatchCount: (c) => _reportMatchCount(3, c),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabLabel(String label, int tabIndex, int activeIndex) {
    if (_searchQuery.isEmpty) return Tab(text: label);
    final count = _matchCounts[tabIndex];
    final isActive = tabIndex == activeIndex;
    final hasMatches = (count ?? 0) > 0;

    Color badgeBg;
    Color badgeFg;
    if (count == null) {
      badgeBg = isActive
          ? Colors.white.withValues(alpha: 0.25)
          : AppColors.border.withValues(alpha: 0.6);
      badgeFg = isActive ? Colors.white : AppColors.textMuted;
    } else if (hasMatches) {
      badgeBg = isActive ? Colors.white : AppColors.successLight;
      badgeFg = isActive ? AppColors.primary : AppColors.success;
    } else {
      badgeBg = isActive
          ? Colors.white.withValues(alpha: 0.25)
          : AppColors.border.withValues(alpha: 0.6);
      badgeFg = isActive ? Colors.white : AppColors.textMuted;
    }

    return Tab(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          const SizedBox(width: 6),
          Container(
            height: 20,
            constraints: const BoxConstraints(minWidth: 20),
            padding: const EdgeInsets.symmetric(horizontal: 5),
            decoration: BoxDecoration(
              color: badgeBg,
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Text(
              count == null ? '·' : '$count',
              style: AppTextStyles.caption.copyWith(
                color: badgeFg,
                fontWeight: FontWeight.w700,
                fontSize: 13,
                height: 1.0,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: TextField(
        controller: _searchController,
        onChanged: (v) => setState(() => _searchQuery = v.trim()),
        textInputAction: TextInputAction.search,
        style: AppTextStyles.body,
        decoration: InputDecoration(
          hintText: 'Search rotarians, BOD, communication, projects',
          hintStyle: AppTextStyles.body.copyWith(color: AppColors.textMuted),
          prefixIcon: const Icon(Icons.search_rounded,
              size: 20, color: AppColors.textMuted),
          suffixIcon: _searchQuery.isEmpty
              ? null
              : IconButton(
                  splashRadius: 18,
                  icon: const Icon(Icons.close_rounded,
                      size: 18, color: AppColors.textMuted),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                ),
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
          filled: true,
          fillColor: AppColors.surface,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.primary, width: 1.4),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// Club header band
// =============================================================================

class _ClubInfoHeader extends StatefulWidget {
  final _ClubDetail? club;
  final VoidCallback? onBack;
  final bool initiallyCollapsed;

  const _ClubInfoHeader({
    required this.club,
    required this.onBack,
    this.initiallyCollapsed = false,
  });

  @override
  State<_ClubInfoHeader> createState() => _ClubInfoHeaderState();
}

class _ClubInfoHeaderState extends State<_ClubInfoHeader> {
  late bool _collapsed = widget.initiallyCollapsed;

  @override
  void didUpdateWidget(covariant _ClubInfoHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initiallyCollapsed != widget.initiallyCollapsed) {
      setState(() => _collapsed = widget.initiallyCollapsed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.of(context).padding.top;
    final c = widget.club;
    final subtitle = c != null ? _buildSubtitle(c) : '';

    return Container(
      decoration: const BoxDecoration(color: AppColors.primaryPrime),
      padding: EdgeInsets.fromLTRB(8, top + 4, 16, _collapsed ? 10 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (widget.onBack != null)
                IconButton(
                  icon: const Icon(
                    Icons.arrow_back_ios_new_rounded,
                    size: 20,
                    color: Colors.white,
                  ),
                  onPressed: widget.onBack,
                )
              else
                const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      c?.clubName ?? 'Club',
                      style: AppFonts.display(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          subtitle,
                          style: AppFonts.body(
                            color: Colors.white.withOpacity(0.85),
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (c != null) _ActiveBadge(isActive: c.isActive),
              IconButton(
                tooltip: _collapsed ? 'Show club details' : 'Hide club details',
                icon: Icon(
                  _collapsed
                      ? Icons.keyboard_arrow_down_rounded
                      : Icons.keyboard_arrow_up_rounded,
                  color: Colors.white,
                ),
                onPressed: () => setState(() => _collapsed = !_collapsed),
              ),
            ],
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeInOut,
            alignment: Alignment.topCenter,
            child: _collapsed || c == null
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _buildLogoAndMeta(c),
                  ),
          ),
        ],
      ),
    );
  }

  String _buildSubtitle(_ClubDetail c) {
    final parts = <String>[];
    if (c.districtNumber != null && c.districtNumber!.isNotEmpty) {
      parts.add(c.districtNumber!);
    }
    if (c.zoneName != null && c.zoneName!.isNotEmpty) {
      parts.add('Zone ${c.zoneName}');
    }
    return parts.join('  |  ');
  }

  Widget _buildLogoAndMeta(_ClubDetail c) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ClubLogo(path: c.clubLogoPath),
        const SizedBox(width: 12),
        Expanded(child: _buildMetaGrid(c)),
      ],
    );
  }

  Widget _buildMetaGrid(_ClubDetail c) {
    final df = DateFormat('dd MMM yyyy');
    final meetingText = _buildMeetingText(c);
    final charterText = c.charterDate != null ? df.format(c.charterDate!) : '-';
    final venueText = _buildVenueText(c);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: _MetaCell(
                icon: Icons.badge_outlined,
                label: 'Rotary ID',
                value: (c.clubRotaryId == null || c.clubRotaryId!.isEmpty)
                    ? '-'
                    : c.clubRotaryId!,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _MetaCell(
                icon: Icons.event_outlined,
                label: 'Charter',
                value: charterText,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _MetaCell(
          icon: Icons.schedule_outlined,
          label: 'Meeting',
          value: meetingText.isEmpty ? '-' : meetingText,
          fullWidth: true,
        ),
        const SizedBox(height: 8),
        _MetaCell(
          icon: Icons.place_outlined,
          label: 'Venue',
          value: venueText.isEmpty ? '-' : venueText,
          fullWidth: true,
          maxLines: 2,
        ),
      ],
    );
  }

  String _buildMeetingText(_ClubDetail c) {
    final bits = <String>[];
    if (c.meetingDay != null && c.meetingDay!.isNotEmpty) bits.add(c.meetingDay!);
    final time = <String>[];
    if (c.meetingStartTime != null && c.meetingStartTime!.isNotEmpty) {
      time.add(c.meetingStartTime!);
    }
    if (c.meetingEndTime != null && c.meetingEndTime!.isNotEmpty) {
      time.add(c.meetingEndTime!);
    }
    if (time.isNotEmpty) bits.add(time.join(' - '));
    return bits.join(', ');
  }

  String _buildVenueText(_ClubDetail c) {
    final bits = <String>[];
    if (c.address != null && c.address!.isNotEmpty) bits.add(c.address!);
    if (c.city != null && c.city!.isNotEmpty) bits.add(c.city!);
    return bits.join(', ');
  }
}

class _ClubLogo extends StatelessWidget {
  final String? path;
  const _ClubLogo({required this.path});

  @override
  Widget build(BuildContext context) {
    final url = (path != null && path!.isNotEmpty)
        ? '${ApiConstants.mediaBaseUrl}$path'
        : null;
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.9),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
      ),
      clipBehavior: Clip.antiAlias,
      child: url == null
          ? const Icon(Icons.business, color: AppColors.primary, size: 28)
          : CachedNetworkImage(
              imageUrl: url,
              fit: BoxFit.cover,
              errorWidget: (_, __, ___) =>
                  const Icon(Icons.business, color: AppColors.primary, size: 28),
            ),
    );
  }
}

class _MetaCell extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool fullWidth;
  final int maxLines;

  const _MetaCell({
    required this.icon,
    required this.label,
    required this.value,
    this.fullWidth = false,
    this.maxLines = 1,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: fullWidth ? double.infinity : null,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.14),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withOpacity(0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 14, color: Colors.white.withOpacity(0.9)),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppFonts.body(
                    color: Colors.white.withOpacity(0.75),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: AppFonts.body(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: maxLines,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaChip({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: Colors.white.withOpacity(0.9)),
          const SizedBox(width: 4),
          Text(
            text,
            style: AppFonts.body(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActiveBadge extends StatelessWidget {
  final bool isActive;
  const _ActiveBadge({required this.isActive});

  @override
  Widget build(BuildContext context) {
    final bg = isActive
        ? AppColors.success.withOpacity(0.9)
        : AppColors.textMuted.withOpacity(0.9);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        isActive ? 'Active' : 'Inactive',
        style: AppFonts.body(
          color: Colors.white,
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

// =============================================================================
// Tab 1: Rotarians (members) — read-only
// =============================================================================

class _RotariansTab extends StatefulWidget {
  final int clubId;
  final String searchQuery;
  final void Function(int)? onMatchCount;
  const _RotariansTab({
    required this.clubId,
    this.searchQuery = '',
    this.onMatchCount,
  });

  @override
  State<_RotariansTab> createState() => _RotariansTabState();
}

class _RotariansTabState extends State<_RotariansTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  List<_ClubMember> _items = [];
  int _total = 0;
  int _page = 1;
  bool _loadingMore = false;
  static const int _pageSize = 50;

  // Search is done SERVER-SIDE: the query is passed to the members endpoint so
  // matches across the whole club (not just the loaded pages) are returned.
  // Debounced so we don't fire a request on every keystroke.
  Timer? _searchDebounce;

  /// More members exist on the server than we've loaded so far.
  bool get _hasMore => _items.length < _total;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _RotariansTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.searchQuery != widget.searchQuery) {
      _searchDebounce?.cancel();
      _searchDebounce = Timer(const Duration(milliseconds: 350), () {
        if (mounted) _fetch();
      });
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/members',
        queryParams: {
          'page': 1,
          'pageSize': _pageSize,
          if (widget.searchQuery.isNotEmpty) 'search': widget.searchQuery,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _ClubMember.fromJson(j),
      );
      if (!mounted) return;
      setState(() {
        _items = paged.items;
        _total = paged.totalCount;
        _page = 1;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/members',
        queryParams: {
          'page': next,
          'pageSize': _pageSize,
          if (widget.searchQuery.isNotEmpty) 'search': widget.searchQuery,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _ClubMember.fromJson(j),
      );
      if (!mounted) return;
      setState(() {
        _page = next;
        _items = [..._items, ...paged.items];
        _total = paged.totalCount;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to load more members')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const ShimmerList(itemCount: 6, itemHeight: 76);
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    // Server-side search: `_items`/`_total` already reflect the query, so the
    // badge count is the true number of matches across the whole club.
    final hasQuery = widget.searchQuery.isNotEmpty;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onMatchCount?.call(_total);
    });
    if (_items.isEmpty) {
      return hasQuery
          ? EmptyStateWidget(
              icon: Icons.search_off_rounded,
              title: 'No matches',
              subtitle: 'No members match "${widget.searchQuery}".',
            )
          : const EmptyStateWidget(
              icon: Icons.people_outline,
              title: 'No Members',
              subtitle: 'This club has no members listed.',
            );
    }
    // Search now runs server-side, so paging more results in-search is valid.
    final showLoadMore = _hasMore;
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _fetch,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _items.length + (showLoadMore ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i >= _items.length) {
            return _LoadMoreButton(
                loading: _loadingMore, onPressed: _loadMore);
          }
          return _MemberCard(
            member: _items[i],
            onTap: () => _openMemberDetail(context, _items[i].memberId),
          );
        },
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  final _ClubMember member;
  final VoidCallback? onTap;
  const _MemberCard({required this.member, this.onTap});

  @override
  Widget build(BuildContext context) {
    final photo = member.profilePhotoPath;
    final photoUrl = (photo != null && photo.isNotEmpty)
        ? '${ApiConstants.mediaBaseUrl}$photo'
        : null;

    return _TappableCard(
      onTap: onTap,
      child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SafeAvatar(url: photoUrl, radius: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        member.memberName,
                        style: AppTextStyles.bodyMedium
                            .copyWith(fontWeight: FontWeight.w700),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (member.isActive)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.successLight,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          'Active',
                          style: AppTextStyles.caption.copyWith(
                            color: AppColors.success,
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                      ),
                  ],
                ),
                if (member.designation != null &&
                    member.designation!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      member.designation!,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ),
                if (member.roles.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Wrap(
                      spacing: 4,
                      runSpacing: 4,
                      children: member.roles
                          .map((r) => _RoleChip(label: r))
                          .toList(),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
    );
  }
}

class _RoleChip extends StatelessWidget {
  final String label;
  const _RoleChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: AppTextStyles.caption.copyWith(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
          fontSize: 13,
        ),
      ),
    );
  }
}

// =============================================================================
// Tab 2: BOD — read-only
// =============================================================================

class _BodTab extends StatefulWidget {
  final int clubId;
  final String searchQuery;
  final void Function(int)? onMatchCount;
  const _BodTab({
    required this.clubId,
    this.searchQuery = '',
    this.onMatchCount,
  });

  @override
  State<_BodTab> createState() => _BodTabState();
}

class _BodTabState extends State<_BodTab> with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();

  bool _loadingYears = true;
  bool _loadingItems = false;
  String? _error;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  List<Map<String, dynamic>> _directors = [];

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _loadYears();
  }

  Future<void> _loadYears() async {
    setState(() {
      _loadingYears = true;
      _error = null;
    });
    try {
      // Only years that actually have board data. The backend `/years` endpoint
      // INNER-JOINs members + designations, so empty years never appear. (The
      // old `/available-years` path 404'd and silently fell back to ALL rotary
      // years, which is why the dropdown listed every year.)
      List<_RotaryYear> years = [];
      try {
        final yearsResp = await _api.get<List<dynamic>>(
          '/api/clubs/${widget.clubId}/board-of-directors/years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (yearsResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {}
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty
            ? years.first
            : const _RotaryYear(id: 0, yearLabel: ''),
      );
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loadingYears = false;
      });
      if (_selectedYearId != null) {
        await _fetchDirectors(_selectedYearId!);
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loadingYears = false;
      });
    }
  }

  Future<void> _fetchDirectors(int yearId) async {
    setState(() {
      _loadingItems = true;
      _directors = [];
    });
    try {
      final resp = await _api.get<dynamic>(
        '/api/clubs/${widget.clubId}/board-of-directors',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j,
      );
      final data = resp.data;
      List<dynamic> list;
      if (data is List) {
        list = data;
      } else if (data is Map<String, dynamic>) {
        list = data['items'] as List<dynamic>? ?? [];
      } else {
        list = [];
      }
      setState(() {
        _directors = list
            .whereType<Map<String, dynamic>>()
            .map((e) => e)
            .toList();
        _loadingItems = false;
      });
    } on ApiException catch (e) {
      setState(() {
        if (e.statusCode != 404) _error = e.message;
        _directors = [];
        _loadingItems = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loadingItems = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loadingYears) return const ShimmerList(itemCount: 6, itemHeight: 76);
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _loadYears);
    }

    return Column(
      children: [
        _buildYearSelector(),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildYearSelector() {
    if (_years.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Row(
        children: [
          Text('Year:', style: AppTextStyles.bodyMedium),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonFormField<int>(
              value: _selectedYearId,
              isDense: true,
              decoration: InputDecoration(
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              items: _years
                  .map((y) => DropdownMenuItem<int>(
                        value: y.id,
                        child: Text(
                          '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                        ),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v == null) return;
                setState(() => _selectedYearId = v);
                _fetchDirectors(v);
              },
            ),
          ),
        ],
      ),
    );
  }

  List<Map<String, dynamic>> _applySearch(List<Map<String, dynamic>> input) {
    final q = widget.searchQuery.toLowerCase();
    if (q.isEmpty) return input;
    return input.where((d) {
      final name = (d['memberName'] ?? '').toString();
      final desig =
          (d['designationName'] ?? d['designation'] ?? '').toString();
      final yearLabel = (d['yearLabel'] ?? '').toString();
      final hay = '$name $desig $yearLabel'.toLowerCase();
      return hay.contains(q);
    }).toList();
  }

  Widget _buildBody() {
    if (_loadingItems) return const ShimmerList(itemCount: 5, itemHeight: 76);
    final filtered = _applySearch(_directors);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onMatchCount?.call(filtered.length);
    });
    if (_directors.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.groups_2_outlined,
        title: 'No Board Members',
        subtitle: 'No directors listed for the selected year.',
      );
    }
    if (filtered.isEmpty) {
      return EmptyStateWidget(
        icon: Icons.search_off_rounded,
        title: 'No matches',
        subtitle: 'No directors match "${widget.searchQuery}".',
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _selectedYearId != null
          ? _fetchDirectors(_selectedYearId!)
          : Future.value(),
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: filtered.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          final memberId = (filtered[i]['memberId'] as num?)?.toInt() ?? 0;
          return _DirectorCard(
            data: filtered[i],
            onTap: memberId > 0
                ? () => _openMemberDetail(context, memberId)
                : null,
          );
        },
      ),
    );
  }
}

class _DirectorCard extends StatelessWidget {
  final Map<String, dynamic> data;
  final VoidCallback? onTap;
  const _DirectorCard({required this.data, this.onTap});

  @override
  Widget build(BuildContext context) {
    final name = data['memberName']?.toString() ?? 'Unknown';
    final designation =
        (data['designationName'] ?? data['designation'])?.toString() ?? '';
    final yearLabel = data['yearLabel']?.toString() ?? '';
    final photo =
        (data['profilePhotoPath'] ?? data['profilePhoto'])?.toString();
    final photoUrl = (photo != null && photo.isNotEmpty)
        ? '${ApiConstants.mediaBaseUrl}$photo'
        : null;

    return _TappableCard(
      onTap: onTap,
      child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          _SafeAvatar(url: photoUrl, radius: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: AppTextStyles.bodyMedium
                      .copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (designation.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      designation,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.primary, fontWeight: FontWeight.w600),
                    ),
                  ),
                if (yearLabel.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      yearLabel,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
    );
  }
}

// =============================================================================
// Tab 3: Communication — Upcoming Events + Announcements
// =============================================================================

class _CommunicationTab extends StatefulWidget {
  final int clubId;
  final String searchQuery;
  final void Function(int)? onMatchCount;
  const _CommunicationTab({
    required this.clubId,
    this.searchQuery = '',
    this.onMatchCount,
  });

  @override
  State<_CommunicationTab> createState() => _CommunicationTabState();
}

class _CommunicationTabState extends State<_CommunicationTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  List<_EventItem> _events = [];
  List<_AnnouncementItem> _announcements = [];
  int _eventsTotal = 0;
  int _eventsPage = 1;
  bool _loadingMoreEvents = false;
  int _annTotal = 0;
  int _annPage = 1;
  bool _loadingMoreAnn = false;
  static const int _pageSize = 10;

  bool get _hasMoreEvents => _events.length < _eventsTotal;
  bool get _hasMoreAnnouncements => _announcements.length < _annTotal;

  // Search runs SERVER-SIDE: the query is passed to both the events and
  // announcements endpoints so matches beyond the loaded pages are returned.
  // Debounced so we don't fire requests on every keystroke.
  Timer? _searchDebounce;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _CommunicationTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.searchQuery != widget.searchQuery) {
      _searchDebounce?.cancel();
      _searchDebounce = Timer(const Duration(milliseconds: 350), () {
        if (mounted) _fetch();
      });
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _fetchEventsPage(1),
        _fetchAnnouncementsPage(1),
      ]);
      final ev = results[0] as PagedResponse<_EventItem>;
      final an = results[1] as PagedResponse<_AnnouncementItem>;
      if (!mounted) return;
      setState(() {
        _events = ev.items;
        _eventsTotal = ev.totalCount;
        _eventsPage = 1;
        _announcements = an.items;
        _annTotal = an.totalCount;
        _annPage = 1;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<PagedResponse<_EventItem>> _fetchEventsPage(int page) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/upcoming-events',
        queryParams: {
          'page': page,
          'pageSize': _pageSize,
          if (widget.searchQuery.isNotEmpty) 'search': widget.searchQuery,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      return PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _EventItem.fromJson(j),
      );
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        return PagedResponse<_EventItem>(
            items: const [],
            totalCount: 0,
            page: page,
            pageSize: _pageSize,
            totalPages: 1);
      }
      rethrow;
    }
  }

  Future<PagedResponse<_AnnouncementItem>> _fetchAnnouncementsPage(
      int page) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/announcements',
        queryParams: {
          'page': page,
          'pageSize': _pageSize,
          if (widget.searchQuery.isNotEmpty) 'search': widget.searchQuery,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      return PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _AnnouncementItem.fromJson(j),
      );
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        return PagedResponse<_AnnouncementItem>(
            items: const [],
            totalCount: 0,
            page: page,
            pageSize: _pageSize,
            totalPages: 1);
      }
      rethrow;
    }
  }

  Future<void> _loadMoreEvents() async {
    if (_loadingMoreEvents || !_hasMoreEvents) return;
    setState(() => _loadingMoreEvents = true);
    try {
      final next = _eventsPage + 1;
      final paged = await _fetchEventsPage(next);
      if (!mounted) return;
      setState(() {
        _eventsPage = next;
        _events = [..._events, ...paged.items];
        _eventsTotal = paged.totalCount;
        _loadingMoreEvents = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingMoreEvents = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to load more events')),
      );
    }
  }

  Future<void> _loadMoreAnnouncements() async {
    if (_loadingMoreAnn || !_hasMoreAnnouncements) return;
    setState(() => _loadingMoreAnn = true);
    try {
      final next = _annPage + 1;
      final paged = await _fetchAnnouncementsPage(next);
      if (!mounted) return;
      setState(() {
        _annPage = next;
        _announcements = [..._announcements, ...paged.items];
        _annTotal = paged.totalCount;
        _loadingMoreAnn = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingMoreAnn = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to load more announcements')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const ShimmerList(itemCount: 5, itemHeight: 92);
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    // Server-side search: `_events`/`_announcements` and their totals already
    // reflect the query, so the badge count is the true number of matches.
    final events = _events;
    final announcements = _announcements;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.onMatchCount?.call(_eventsTotal + _annTotal);
      }
    });
    final hasQuery = widget.searchQuery.isNotEmpty;
    if (events.isEmpty && announcements.isEmpty) {
      if (!hasQuery) {
        return const EmptyStateWidget(
          icon: Icons.campaign_outlined,
          title: 'Nothing to show',
          subtitle: 'No upcoming events or announcements.',
        );
      }
      return EmptyStateWidget(
        icon: Icons.search_off_rounded,
        title: 'No matches',
        subtitle:
            'No events or announcements match "${widget.searchQuery}".',
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _fetch,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          const _SectionHeader(
            icon: Icons.event_outlined,
            title: 'Upcoming Events',
          ),
          const SizedBox(height: 8),
          if (events.isEmpty)
            _EmptySection(
              text: hasQuery
                  ? 'No matching events.'
                  : 'No upcoming events.',
            )
          else
            ...events.map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _EventCard(
                    item: e,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                          builder: (_) => _EventDetailPage(item: e)),
                    ),
                  ),
                )),
          if (events.isNotEmpty && _hasMoreEvents)
            _LoadMoreButton(
                loading: _loadingMoreEvents, onPressed: _loadMoreEvents),
          const SizedBox(height: 16),
          const _SectionHeader(
            icon: Icons.campaign_outlined,
            title: 'Announcements',
          ),
          const SizedBox(height: 8),
          if (announcements.isEmpty)
            _EmptySection(
              text: hasQuery
                  ? 'No matching announcements.'
                  : 'No announcements.',
            )
          else
            ...announcements.map((a) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _AnnouncementCard(
                    item: a,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                          builder: (_) => _AnnouncementDetailPage(item: a)),
                    ),
                  ),
                )),
          if (announcements.isNotEmpty && _hasMoreAnnouncements)
            _LoadMoreButton(
                loading: _loadingMoreAnn, onPressed: _loadMoreAnnouncements),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String title;
  const _SectionHeader({required this.icon, required this.title});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 4,
          height: 18,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 8),
        Icon(icon, size: 16, color: AppColors.primary),
        const SizedBox(width: 6),
        Text(
          title,
          style: AppTextStyles.bodyMedium.copyWith(
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}

class _EmptySection extends StatelessWidget {
  final String text;
  const _EmptySection({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        text,
        style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  final _EventItem item;
  final VoidCallback? onTap;
  const _EventCard({required this.item, this.onTap});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('dd MMM yyyy');
    return _TappableCard(
      onTap: onTap,
      child: Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardThumb(path: item.imagePath, icon: Icons.event),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.title,
                          style: AppTextStyles.bodyMedium
                              .copyWith(fontWeight: FontWeight.w700),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (item.status != null && item.status!.isNotEmpty)
                        _StatusBadge(label: item.status!),
                    ],
                  ),
                  const SizedBox(height: 4),
                  if (item.eventDate != null)
                    Row(
                      children: [
                        const Icon(Icons.calendar_today_outlined,
                            size: 12, color: AppColors.textSecondary),
                        const SizedBox(width: 4),
                        Text(
                          df.format(item.eventDate!),
                          style: AppTextStyles.caption,
                        ),
                      ],
                    ),
                  if (item.eventVenue != null && item.eventVenue!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Row(
                        children: [
                          const Icon(Icons.place_outlined,
                              size: 12, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              item.eventVenue!,
                              style: AppTextStyles.caption,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  final _AnnouncementItem item;
  final VoidCallback? onTap;
  const _AnnouncementCard({required this.item, this.onTap});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('dd MMM yyyy');
    return _TappableCard(
      onTap: onTap,
      child: Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardThumb(path: item.imagePath, icon: Icons.campaign_outlined),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.title,
                          style: AppTextStyles.bodyMedium
                              .copyWith(fontWeight: FontWeight.w700),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (item.status != null && item.status!.isNotEmpty)
                        _StatusBadge(label: item.status!),
                    ],
                  ),
                  const SizedBox(height: 4),
                  if (item.publishDate != null)
                    Row(
                      children: [
                        const Icon(Icons.schedule_outlined,
                            size: 12, color: AppColors.textSecondary),
                        const SizedBox(width: 4),
                        Text(
                          df.format(item.publishDate!),
                          style: AppTextStyles.caption,
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
    );
  }
}

class _CardThumb extends StatelessWidget {
  final String? path;
  final IconData icon;
  const _CardThumb({required this.path, required this.icon});

  @override
  Widget build(BuildContext context) {
    final url = (path != null && path!.isNotEmpty)
        ? (path!.startsWith('http')
            ? path!
            : '${ApiConstants.mediaBaseUrl}$path')
        : null;
    return Container(
      width: 80,
      height: 80,
      decoration: const BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(10),
          bottomLeft: Radius.circular(10),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      child: url == null
          ? Icon(icon, color: AppColors.primary, size: 28)
          : CachedNetworkImage(
              imageUrl: url,
              fit: BoxFit.cover,
              width: 80,
              height: 80,
              errorWidget: (_, __, ___) =>
                  Icon(icon, color: AppColors.primary, size: 28),
            ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String label;
  const _StatusBadge({required this.label});

  @override
  Widget build(BuildContext context) {
    final l = label.toLowerCase();
    Color bg;
    Color fg;
    if (l.contains('approv')) {
      bg = AppColors.successLight;
      fg = AppColors.success;
    } else if (l.contains('reject')) {
      bg = AppColors.errorLight;
      fg = AppColors.error;
    } else if (l.contains('pend')) {
      bg = AppColors.warningLight;
      fg = AppColors.warning;
    } else {
      bg = AppColors.infoLight;
      fg = AppColors.info;
    }
    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: AppTextStyles.caption.copyWith(
          color: fg,
          fontWeight: FontWeight.w700,
          fontSize: 13,
        ),
      ),
    );
  }
}

// =============================================================================
// Tab 4: Projects — read-only
// =============================================================================

const List<(String, String)> _kProjectModules = [
  ('club_service', 'Club Service'),
  ('community_service', 'Community Service'),
  ('vocational_service', 'Vocational Service'),
  ('international_service', 'International Service'),
  ('new_generation_service', 'New Generation Service'),
  ('public_image_initiative', 'Public Image Initiative'),
];

class _ProjectsTab extends StatefulWidget {
  final int clubId;
  final int districtId;
  final String searchQuery;
  final void Function(int)? onMatchCount;
  const _ProjectsTab({
    required this.clubId,
    required this.districtId,
    this.searchQuery = '',
    this.onMatchCount,
  });

  @override
  State<_ProjectsTab> createState() => _ProjectsTabState();
}

class _ProjectsTabState extends State<_ProjectsTab>
    with AutomaticKeepAliveClientMixin {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  String _selectedModuleKey = 'community_service';
  List<_ProjectItem> _items = [];

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void didUpdateWidget(covariant _ProjectsTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Once districtId becomes known (e.g. parent finished loading club),
    // kick off a fetch.
    if (oldWidget.districtId == 0 && widget.districtId != 0) {
      _fetch();
    }
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      List<_RotaryYear> years = [];
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (resp.data ?? [])
            .whereType<Map<String, dynamic>>()
            .map((e) => _RotaryYear.fromJson(e))
            .toList();
      } catch (_) {}

      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty
            ? years.first
            : const _RotaryYear(id: 0, yearLabel: ''),
      );
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
      });
      await _fetch();
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _fetch() async {
    if (widget.districtId == 0 || _selectedYearId == null) {
      setState(() {
        _items = [];
        _loading = false;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/clubs/${widget.clubId}/projects-view',
        queryParams: {
          'yearId': _selectedYearId,
          'moduleKey': _selectedModuleKey,
        },
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .whereType<Map<String, dynamic>>()
          .map((e) => _ProjectItem.fromJson(e))
          .toList();
      setState(() {
        _items = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
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

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Column(
      children: [
        _buildFilters(),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildFilters() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        children: [
          DropdownButtonFormField<int>(
              value: _selectedYearId,
              isDense: true,
              isExpanded: true,
              decoration: InputDecoration(
                isDense: true,
                labelText: 'Year',
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              items: _years
                  .map((y) => DropdownMenuItem<int>(
                        value: y.id,
                        child: Text(
                          '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v == null) return;
                setState(() => _selectedYearId = v);
                _fetch();
              },
            ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
              value: _selectedModuleKey,
              isDense: true,
              isExpanded: true,
              decoration: InputDecoration(
                isDense: true,
                labelText: 'Module',
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              items: _kProjectModules
                  .map((m) => DropdownMenuItem<String>(
                        value: m.$1,
                        child: Text(
                          m.$2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v == null) return;
                setState(() => _selectedModuleKey = v);
                _fetch();
              },
            ),
        ],
      ),
    );
  }

  List<_ProjectItem> _applySearch(List<_ProjectItem> input) {
    final q = widget.searchQuery.toLowerCase();
    if (q.isEmpty) return input;
    return input.where((p) {
      final hay = [
        p.title,
        p.description ?? '',
        p.location ?? '',
        p.moduleName ?? '',
        p.areaOfFocusName ?? '',
        p.otherAreaOfFocus ?? '',
      ].join(' ').toLowerCase();
      return hay.contains(q);
    }).toList();
  }

  Widget _buildBody() {
    if (widget.districtId == 0) {
      return const ShimmerList(itemCount: 4, itemHeight: 200);
    }
    if (_loading) return const ShimmerList(itemCount: 4, itemHeight: 200);
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    final filtered = _applySearch(_items);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onMatchCount?.call(filtered.length);
    });
    if (_items.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.volunteer_activism_outlined,
        title: 'No Projects',
        subtitle: 'No projects found for the selected year and module.',
      );
    }
    if (filtered.isEmpty) {
      return EmptyStateWidget(
        icon: Icons.search_off_rounded,
        title: 'No matches',
        subtitle: 'No projects match "${widget.searchQuery}".',
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _fetch,
      child: GridView.count(
        padding: const EdgeInsets.all(12),
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 0.68,
        children: filtered
            .map((it) => _ProjectCard(
                  item: it,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => _ProjectDetailPage(
                              item: it,
                              clubId: widget.clubId,
                              yearId: _selectedYearId ?? 0,
                            )),
                  ),
                ))
            .toList(),
      ),
    );
  }
}

class _ProjectCard extends StatelessWidget {
  final _ProjectItem item;
  final VoidCallback? onTap;
  const _ProjectCard({required this.item, this.onTap});

  @override
  Widget build(BuildContext context) {
    final hasFocus = (item.areaOfFocusName != null &&
            item.areaOfFocusName!.isNotEmpty) ||
        (item.otherAreaOfFocus != null && item.otherAreaOfFocus!.isNotEmpty);
    final focusLabel = (item.areaOfFocusName != null &&
            item.areaOfFocusName!.isNotEmpty)
        ? item.areaOfFocusName!
        : (item.otherAreaOfFocus ?? '');

    return _TappableCard(
      onTap: onTap,
      borderRadius: 10,
      child: Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          _ProjectTileImage(path: item.primaryPhoto),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.max,
                children: [
                  Flexible(
                    child: Text(
                      item.title,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (item.moduleName != null && item.moduleName!.isNotEmpty)
                    Text(
                      item.moduleName!,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  if (hasFocus) ...[
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.warningLight,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        focusLabel,
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.warning,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                  const Spacer(),
                  if (item.location != null && item.location!.isNotEmpty)
                    _MetaRow(
                      icon: Icons.place_outlined,
                      text: item.location!,
                    ),
                  if (item.projectDate != null)
                    _MetaRow(
                      icon: Icons.calendar_today_outlined,
                      text:
                          DateFormat('dd MMM yyyy').format(item.projectDate!),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
    );
  }
}

class _ProjectTileImage extends StatelessWidget {
  final String? path;
  const _ProjectTileImage({required this.path});

  @override
  Widget build(BuildContext context) {
    final url = (path != null && path!.isNotEmpty)
        ? (path!.startsWith('http')
            ? path!
            : '${ApiConstants.mediaBaseUrl}$path')
        : null;
    final placeholder = Container(
      height: 100,
      color: AppColors.primaryLight,
      alignment: Alignment.center,
      child: const Icon(
        Icons.volunteer_activism_outlined,
        color: AppColors.primary,
        size: 32,
      ),
    );
    if (url == null) return placeholder;
    return SizedBox(
      height: 100,
      width: double.infinity,
      child: CachedNetworkImage(
        imageUrl: url,
        fit: BoxFit.cover,
        placeholder: (_, __) => placeholder,
        errorWidget: (_, __, ___) => placeholder,
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: [
          Icon(icon, size: 12, color: AppColors.textSecondary),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.caption,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Models
// =============================================================================

class _ClubDetail {
  final int id;
  final int? districtId;
  final String clubName;
  final String? clubRotaryId;
  final String? districtNumber;
  final String? zoneName;
  final String? meetingDay;
  final String? meetingStartTime;
  final String? meetingEndTime;
  final DateTime? charterDate;
  final String? address;
  final String? city;
  final bool isActive;
  final String? clubLogoPath;

  const _ClubDetail({
    required this.id,
    this.districtId,
    required this.clubName,
    this.clubRotaryId,
    this.districtNumber,
    this.zoneName,
    this.meetingDay,
    this.meetingStartTime,
    this.meetingEndTime,
    this.charterDate,
    this.address,
    this.city,
    this.isActive = true,
    this.clubLogoPath,
  });

  factory _ClubDetail.fromJson(Map<String, dynamic> j) {
    DateTime? _dt(dynamic v) {
      if (v == null) return null;
      final d = DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }

    return _ClubDetail(
      id: (j['id'] as num?)?.toInt() ?? 0,
      districtId: (j['fkDistrictId'] as num?)?.toInt(),
      clubName:
          (j['clubName'] ?? j['name'] ?? 'Club').toString(),
      clubRotaryId: (j['clubRotaryId'] ?? j['rotaryId'])?.toString(),
      districtNumber:
          (j['districtNumber'] ?? j['districtCode'])?.toString(),
      zoneName: (j['zoneName'] ?? j['zone'])?.toString(),
      meetingDay: j['meetingDay']?.toString(),
      meetingStartTime:
          (j['meetingFromTime'] ?? j['meetingStartTime'])?.toString(),
      meetingEndTime:
          (j['meetingToTime'] ?? j['meetingEndTime'])?.toString(),
      charterDate: _dt(j['clubCharterDate'] ?? j['charterDate']),
      address: (j['meetingAddress'] ?? j['address'])?.toString(),
      city: j['city']?.toString(),
      isActive: _asBool(j['isActive'] ?? true),
      clubLogoPath: j['clubLogoPath']?.toString(),
    );
  }
}

class _ClubMember {
  final int id;
  final int memberId;
  final String memberName;
  final String? designation;
  final bool isActive;
  final String? profilePhotoPath;
  final List<String> roles;

  const _ClubMember({
    required this.id,
    required this.memberId,
    required this.memberName,
    this.designation,
    this.isActive = true,
    this.profilePhotoPath,
    this.roles = const [],
  });

  factory _ClubMember.fromJson(Map<String, dynamic> j) {
    final rolesRaw = j['roles'];
    final roles = rolesRaw is List
        ? rolesRaw.map((e) => e.toString()).toList()
        : const <String>[];
    return _ClubMember(
      id: (j['id'] as num?)?.toInt() ?? 0,
      memberId: (j['memberId'] as num?)?.toInt() ??
          (j['id'] as num?)?.toInt() ??
          0,
      memberName: (j['memberName'] ?? j['name'] ?? '').toString(),
      designation: j['designation']?.toString(),
      isActive: _asBool(j['membershipActive'] ?? j['isActive'] ?? true),
      profilePhotoPath: j['profilePhotoPath']?.toString(),
      roles: roles,
    );
  }
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({
    required this.id,
    required this.yearLabel,
    this.isCurrent = false,
  });

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ??
            j['label']?.toString() ??
            '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _EventItem {
  final int id;
  final String title;
  final DateTime? eventDate;
  final String? eventVenue;
  final String? imagePath;
  final String? status;

  const _EventItem({
    required this.id,
    required this.title,
    this.eventDate,
    this.eventVenue,
    this.imagePath,
    this.status,
  });

  factory _EventItem.fromJson(Map<String, dynamic> j) => _EventItem(
        id: (j['id'] as num?)?.toInt() ?? 0,
        title: (j['title'] ?? j['name'] ?? '').toString(),
        eventDate: j['eventDate'] != null
            ? DateTime.tryParse(j['eventDate'].toString())
            : null,
        eventVenue: (j['eventVenue'] ?? j['location'])?.toString(),
        imagePath: j['imagePath']?.toString(),
        status: j['status']?.toString(),
      );
}

class _AnnouncementItem {
  final int id;
  final String title;
  final DateTime? publishDate;
  final String? imagePath;
  final String? status;

  const _AnnouncementItem({
    required this.id,
    required this.title,
    this.publishDate,
    this.imagePath,
    this.status,
  });

  factory _AnnouncementItem.fromJson(Map<String, dynamic> j) {
    DateTime? _dt(dynamic v) {
      if (v == null) return null;
      final d = DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }

    return _AnnouncementItem(
      id: (j['id'] as num?)?.toInt() ?? 0,
      title: (j['title'] ?? '').toString(),
      publishDate: _dt(j['publishDateTime'] ?? j['publishDate']),
      imagePath: j['imagePath']?.toString(),
      status: j['status']?.toString(),
    );
  }
}

class _ProjectItem {
  final int id;
  final String title;
  final String? description;
  final String? location;
  final DateTime? projectDate;
  final num? projectCost;
  final int? directBeneficiaries;
  final int? manHours;
  final int? rotariansInvolved;
  final String? moduleName;
  final String? areaOfFocusName;
  final String? otherAreaOfFocus;
  final String? primaryPhoto;

  const _ProjectItem({
    required this.id,
    required this.title,
    this.description,
    this.location,
    this.projectDate,
    this.projectCost,
    this.directBeneficiaries,
    this.manHours,
    this.rotariansInvolved,
    this.moduleName,
    this.areaOfFocusName,
    this.otherAreaOfFocus,
    this.primaryPhoto,
  });

  factory _ProjectItem.fromJson(Map<String, dynamic> j) {
    DateTime? _dt(dynamic v) {
      if (v == null) return null;
      final d = DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }

    return _ProjectItem(
      id: (j['id'] as num?)?.toInt() ?? 0,
      title: (j['title'] ?? j['name'] ?? '').toString(),
      description: j['description']?.toString(),
      location: j['location']?.toString(),
      projectDate: _dt(j['projectDate']),
      projectCost: j['projectCost'] as num?,
      directBeneficiaries: (j['directBeneficiaries'] as num?)?.toInt(),
      manHours: (j['manHours'] as num?)?.toInt(),
      rotariansInvolved: (j['rotariansInvolved'] as num?)?.toInt(),
      moduleName: j['moduleName']?.toString(),
      areaOfFocusName: j['areaOfFocusName']?.toString(),
      otherAreaOfFocus: j['otherAreaOfFocus']?.toString(),
      primaryPhoto:
          (j['primaryPhoto'] ?? j['primaryPhotoPath'])?.toString(),
    );
  }
}

class _SafeAvatar extends StatelessWidget {
  final String? url;
  final double radius;
  final IconData fallbackIcon;
  const _SafeAvatar({required this.url, this.radius = 22, this.fallbackIcon = Icons.person});

  @override
  Widget build(BuildContext context) {
    final size = radius * 2;
    final placeholder = CircleAvatar(
      radius: radius,
      backgroundColor: AppColors.primaryLight,
      child: Icon(fallbackIcon, size: radius, color: AppColors.primary),
    );
    if (url == null || url!.isEmpty) return placeholder;
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: url!,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => placeholder,
        errorWidget: (_, __, ___) => placeholder,
      ),
    );
  }
}

// =============================================================================
// Tap-to-detail plumbing
//
// Rows in all four tabs are tappable: Rotarians/BOD open the shared member
// detail page; Communication (events + announcements) and Projects open the
// read-only detail pages below (built from the data already loaded in the
// list — no extra fetch).
// =============================================================================

/// Pushes the shared single-rotarian detail page. No-op for an invalid id.
void _openMemberDetail(BuildContext context, int memberId) {
  if (memberId <= 0) return;
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => FindRotarianDetailScreen(memberId: memberId),
    ),
  );
}

/// Wraps a card with a tap ripple clipped to its rounded corners. When [onTap]
/// is null the child is returned untouched, so non-actionable rows stay
/// visually identical and inert.
class _TappableCard extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  final double borderRadius;
  const _TappableCard({
    required this.child,
    this.onTap,
    this.borderRadius = 10,
  });

  @override
  Widget build(BuildContext context) {
    if (onTap == null) return child;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(borderRadius),
        child: child,
      ),
    );
  }
}

/// "Load More" footer button used by paged tabs (Rotarians, Communication).
/// Shows a spinner while [loading]; disabled during the in-flight fetch.
class _LoadMoreButton extends StatelessWidget {
  final bool loading;
  final VoidCallback onPressed;
  const _LoadMoreButton({required this.loading, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: OutlinedButton.icon(
          onPressed: loading ? null : onPressed,
          icon: loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.expand_more_rounded, size: 18),
          label: Text(loading ? 'Loading…' : 'Load More'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.primary,
            side: BorderSide(color: AppColors.primary.withValues(alpha: 0.4)),
            padding:
                const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            shape: const StadiumBorder(),
          ),
        ),
      ),
    );
  }
}

/// Read-only detail page for a Communication → Upcoming Event.
class _EventDetailPage extends StatelessWidget {
  final _EventItem item;
  const _EventDetailPage({required this.item});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('dd MMM yyyy');
    final imageUrl = detailMediaUrl(item.imagePath);
    final status = (item.status ?? '').trim();
    final venue = (item.eventVenue ?? '').trim();

    final rows = <Widget>[
      if (item.eventDate != null)
        DetailRow(label: 'Date', value: df.format(item.eventDate!)),
      if (venue.isNotEmpty) DetailRow(label: 'Venue', value: venue),
      if (status.isNotEmpty) DetailRow(label: 'Status', value: status),
    ];

    return DetailScaffold(
      title: 'Event',
      loading: false,
      error: null,
      onRetry: () {},
      body: (_) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DetailHeader(
            title: item.title,
            imageUrl: imageUrl,
            status: status.isNotEmpty ? status : null,
            meta: item.eventDate != null ? df.format(item.eventDate!) : null,
            icon: Icons.event,
          ),
          if (rows.isNotEmpty) ...[
            const SizedBox(height: 18),
            DetailSectionCard(
              icon: Icons.info_outline,
              title: 'Details',
              number: 1,
              child: Column(children: rows),
            ),
          ],
        ],
      ),
    );
  }
}

/// Read-only detail page for a Communication → Announcement.
class _AnnouncementDetailPage extends StatelessWidget {
  final _AnnouncementItem item;
  const _AnnouncementDetailPage({required this.item});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('dd MMM yyyy');
    final imageUrl = detailMediaUrl(item.imagePath);
    final status = (item.status ?? '').trim();

    final rows = <Widget>[
      if (item.publishDate != null)
        DetailRow(label: 'Published', value: df.format(item.publishDate!)),
      if (status.isNotEmpty) DetailRow(label: 'Status', value: status),
    ];

    return DetailScaffold(
      title: 'Announcement',
      loading: false,
      error: null,
      onRetry: () {},
      body: (_) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DetailHeader(
            title: item.title,
            imageUrl: imageUrl,
            status: status.isNotEmpty ? status : null,
            meta: item.publishDate != null ? df.format(item.publishDate!) : null,
            icon: Icons.campaign_outlined,
          ),
          if (rows.isNotEmpty) ...[
            const SizedBox(height: 18),
            DetailSectionCard(
              icon: Icons.info_outline,
              title: 'Details',
              number: 1,
              child: Column(children: rows),
            ),
          ],
        ],
      ),
    );
  }
}

/// Read-only project detail. The list-row [item] seeds the screen instantly,
/// then the dedicated detail endpoint
/// `GET /api/clubs/{clubId}/projects/{yearId}/{projectId}` is fetched to fill
/// in the fuller record and the `photos[]` gallery (the `projects-view` list
/// only carries a single `primaryPhoto`). Presentation mirrors
/// `club_finder_project_detail_screen.dart` — a swipeable photo carousel with
/// dot indicators, meta chips, a description, and a key/value detail card.
class _ProjectDetailPage extends StatefulWidget {
  final _ProjectItem item;
  final int clubId;
  final int yearId;
  const _ProjectDetailPage({
    required this.item,
    required this.clubId,
    required this.yearId,
  });

  @override
  State<_ProjectDetailPage> createState() => _ProjectDetailPageState();
}

class _ProjectDetailPageState extends State<_ProjectDetailPage> {
  final _api = ApiClient();
  final _pageCtrl = PageController();

  Map<String, dynamic>? _project;
  List<Map<String, dynamic>> _photos = const [];
  int _photoIndex = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    // Seed with the list-row data so the screen never opens blank.
    _project = _seedFromItem();
    _fetch();
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    super.dispose();
  }

  /// A raw-map view of the tapped list row so the carousel/title/chips paint
  /// immediately, before (and if) the detail endpoint responds.
  Map<String, dynamic> _seedFromItem() {
    final it = widget.item;
    return <String, dynamic>{
      'title': it.title,
      'description': it.description,
      'location': it.location,
      'projectDate': it.projectDate?.toIso8601String(),
      'moduleName': it.moduleName,
      'areaOfFocusName': it.areaOfFocusName,
      'otherAreaOfFocus': it.otherAreaOfFocus,
      'projectCost': it.projectCost,
      'directBeneficiaries': it.directBeneficiaries,
      'manHours': it.manHours,
      'rotariansInvolved': it.rotariansInvolved,
      'coverPhoto': it.primaryPhoto,
    };
  }

  Future<void> _fetch() async {
    if (widget.clubId == 0 || widget.yearId == 0 || widget.item.id == 0) {
      setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/${widget.yearId}/${widget.item.id}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data;
      if (data != null) {
        final photos = (data['photos'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList()
          // Primary first, otherwise original order.
          ..sort((a, b) => (_asBool(b['isPrimary']) ? 1 : 0)
              .compareTo(_asBool(a['isPrimary']) ? 1 : 0));
        setState(() {
          _project = data;
          _photos = photos;
          _loading = false;
        });
        return;
      }
      setState(() => _loading = false);
    } catch (_) {
      // Keep the seeded list-row view on failure.
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _project;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Project Detail'),
      body: SafeArea(
        child: _loading && p == null
            ? const LoadingWidget()
            : p == null
                ? _errorState()
                : RefreshIndicator(
                    onRefresh: _fetch,
                    child: ListView(
                      padding: EdgeInsets.zero,
                      children: [
                        _gallery(),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _title(p),
                              const SizedBox(height: 12),
                              _chips(p),
                              _description(p),
                              _details(p),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
      ),
    );
  }

  // ── Photo gallery (carousel) ──
  Widget _gallery() {
    final urls = _photos
        .map((ph) => detailMediaUrl(
            (ph['imagePath'] ?? ph['path'] ?? ph['url'])?.toString()))
        .whereType<String>()
        .where((u) => u.isNotEmpty)
        .toList();
    // Fall back to the list-row cover photo when the detail has no gallery.
    if (urls.isEmpty) {
      final cover = detailMediaUrl(widget.item.primaryPhoto);
      if (cover != null && cover.isNotEmpty) urls.add(cover);
    }
    if (urls.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        SizedBox(
          height: 240,
          child: PageView.builder(
            controller: _pageCtrl,
            itemCount: urls.length,
            onPageChanged: (i) => setState(() => _photoIndex = i),
            itemBuilder: (_, i) => CachedNetworkImage(
              imageUrl: urls[i],
              fit: BoxFit.cover,
              width: double.infinity,
              placeholder: (_, __) => Container(
                color: AppColors.muted,
                child: const RowSkeletonList(),
              ),
              errorWidget: (_, __, ___) => Container(
                color: AppColors.muted,
                child: const Icon(Icons.broken_image_outlined,
                    color: AppColors.textSecondary, size: 40),
              ),
            ),
          ),
        ),
        if (urls.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                urls.length,
                (i) => AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _photoIndex ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == _photoIndex
                        ? AppColors.primaryPrime
                        : AppColors.border,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _title(Map<String, dynamic> p) {
    final title = p['title']?.toString() ?? '';
    final club = p['clubName']?.toString() ?? '';
    final district = p['districtNumber']?.toString() ?? '';
    final subtitle = [
      if (club.isNotEmpty) club,
      if (district.isNotEmpty) 'RID $district',
    ].join('  •  ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: AppFonts.body(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            height: 1.25,
          ),
        ),
        if (subtitle.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ],
    );
  }

  Widget _chips(Map<String, dynamic> p) {
    final dt = _parseProjectDate(p['projectDate']?.toString());
    final focus =
        (p['areaOfFocusName']?.toString().trim().isNotEmpty ?? false)
            ? p['areaOfFocusName'].toString()
            : (p['otherAreaOfFocus']?.toString() ?? '');
    final chips = <Widget>[
      if (dt != null)
        _chip(Icons.calendar_today_outlined,
            DateFormat('dd MMM yyyy').format(dt)),
      if ((p['location']?.toString() ?? '').isNotEmpty)
        _chip(Icons.location_on_outlined, p['location'].toString()),
      if ((p['moduleName']?.toString() ?? '').isNotEmpty)
        _chip(Icons.category_outlined, p['moduleName'].toString()),
      if (focus.isNotEmpty) _chip(Icons.track_changes_outlined, focus),
    ];
    if (chips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Wrap(spacing: 8, runSpacing: 8, children: chips),
    );
  }

  Widget _chip(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.muted.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.primaryPrime),
          const SizedBox(width: 6),
          Text(
            text,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _description(Map<String, dynamic> p) {
    final desc = p['description']?.toString() ?? '';
    if (desc.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: _ExpandableText(
        text: desc,
        maxLines: 5,
        style: AppFonts.body(
          fontSize: 14,
          color: AppColors.textPrimary,
          height: 1.5,
        ),
      ),
    );
  }

  Widget _details(Map<String, dynamic> p) {
    String? money(dynamic v) {
      final n = (v is num) ? v : num.tryParse(v?.toString() ?? '');
      if (n == null || n == 0) return null;
      return formatMoney(n, p['currency']?.toString());
    }

    String? text(dynamic v) {
      final s = v?.toString().trim() ?? '';
      return s.isEmpty ? null : s;
    }

    String? count(dynamic v) {
      final n = (v is num) ? v : num.tryParse(v?.toString() ?? '');
      if (n == null || n == 0) return null;
      return n.toInt().toString();
    }

    final rows = <_KV>[
      _KV('Avenue', text(p['moduleName'])),
      _KV('Area of Focus',
          text(p['areaOfFocusName']) ?? text(p['otherAreaOfFocus'])),
      _KV('Project Cost', money(p['projectCost'])),
      _KV('Funding', text(p['fundingName'])),
      _KV('Direct Beneficiaries', count(p['directBeneficiaries'])),
      _KV('Man Hours', count(p['manHours'])),
      _KV('Rotarians Involved', count(p['rotariansInvolved'])),
      _KV('Rotaractors Involved', count(p['rotaractorsInvolved'])),
      _KV('Project Type', text(p['projectType'])),
      _KV('Joint Project',
          (p['isJointProject'] == true || p['isJointProject'] == 1)
              ? 'Yes'
              : null),
      _KV('Co-Host', text(p['coHostName'])),
      _KV('Year', text(p['yearName'])),
    ].where((kv) => kv.value != null).toList();

    if (rows.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(top: 20),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          for (int i = 0; i < rows.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.border),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 140,
                    child: Text(
                      rows[i].label,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      rows[i].value!,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _errorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                size: 48, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            Text(
              'Unable to load project',
              style: AppFonts.body(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _fetch, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

class _KV {
  final String label;
  final String? value;
  const _KV(this.label, this.value);
}

/// Text that clamps to [maxLines] with a "View more" / "View less" toggle.
/// The toggle only appears when the text actually overflows the clamp.
class _ExpandableText extends StatefulWidget {
  final String text;
  final int maxLines;
  final TextStyle? style;
  const _ExpandableText({
    required this.text,
    required this.maxLines,
    this.style,
  });

  @override
  State<_ExpandableText> createState() => _ExpandableTextState();
}

class _ExpandableTextState extends State<_ExpandableText> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final tp = TextPainter(
          text: TextSpan(text: widget.text, style: widget.style),
          maxLines: widget.maxLines,
          textDirection: Directionality.of(context),
        )..layout(maxWidth: constraints.maxWidth);
        final overflows = tp.didExceedMaxLines;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.text,
              style: widget.style,
              maxLines: _expanded ? null : widget.maxLines,
              overflow:
                  _expanded ? TextOverflow.visible : TextOverflow.ellipsis,
            ),
            if (overflows)
              GestureDetector(
                onTap: () => setState(() => _expanded = !_expanded),
                behavior: HitTestBehavior.opaque,
                child: Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    _expanded ? 'View less' : 'View more',
                    style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryPrime,
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

DateTime? _parseProjectDate(String? v) {
  if (v == null || v.isEmpty) return null;
  final d = DateTime.tryParse(v);
  return (d == null || d.year <= 1) ? null : d;
}
