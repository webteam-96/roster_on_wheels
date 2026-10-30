import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/club_finder_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

enum ClubFinderMode { anyClub, nearMe }

class ClubFinderResultsScreen extends StatefulWidget {
  final ClubFinderMode mode;
  final Map<String, dynamic> queryParams;

  const ClubFinderResultsScreen({
    super.key,
    required this.mode,
    required this.queryParams,
  });

  @override
  State<ClubFinderResultsScreen> createState() => _ClubFinderResultsScreenState();
}

class _ClubFinderResultsScreenState extends State<ClubFinderResultsScreen> {
  final _api = ApiClient();
  final _scrollCtrl = ScrollController();

  final List<ClubFinderItem> _items = [];
  int _page = 1;
  int _totalCount = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;

  String get _path => widget.mode == ClubFinderMode.nearMe
      ? '/api/mobile/club-finder/near-me'
      : '/api/mobile/club-finder';

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _fetchFirstPage();
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollCtrl.hasClients) return;
    final pos = _scrollCtrl.position;
    if (pos.pixels > pos.maxScrollExtent - 300 &&
        !_loadingMore &&
        _items.length < _totalCount) {
      _loadMore();
    }
  }

  Future<void> _fetchFirstPage() async {
    setState(() {
      _loading = true;
      _error = null;
      _items.clear();
      _page = 1;
      _totalCount = 0;
    });
    try {
      final page = await _fetch(1);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _totalCount = page.totalCount;
        _page = 1;
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

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final page = await _fetch(next);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _page = next;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  Future<ClubFinderPage> _fetch(int page) async {
    final qp = <String, dynamic>{
      ...widget.queryParams,
      'page': page,
      'pageSize': 20,
    };
    final resp = await _api.get<Map<String, dynamic>>(
      _path,
      queryParams: qp,
      fromJson: (j) => j as Map<String, dynamic>,
    );
    if (!resp.isSuccess || resp.data == null) throw resp.error ?? 'Search failed';
    return ClubFinderPage.fromJson(resp.data!);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: widget.mode == ClubFinderMode.nearMe ? 'Near Me' : 'Search Results',
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetchFirstPage);
    }
    if (_items.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.search_off_rounded,
        title: 'No clubs found',
        subtitle: 'Try different filters.',
      );
    }
    return Column(
      children: [
        if (_totalCount > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '$_totalCount result${_totalCount == 1 ? '' : 's'}',
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        Expanded(
          child: ListView.separated(
            controller: _scrollCtrl,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            itemCount: _items.length + (_loadingMore ? 1 : 0),
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) {
              if (i >= _items.length) {
                return const Padding(
                  padding: EdgeInsets.all(16),
                  child: const RowSkeletonList(),
                );
              }
              return _ClubCard(item: _items[i]);
            },
          ),
        ),
      ],
    );
  }
}

class _ClubCard extends StatelessWidget {
  final ClubFinderItem item;
  const _ClubCard({required this.item});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push(RouteNames.clubFinderDetail(
          item.clubId,
          clubName: item.clubName,
          clubRotaryId: item.clubRotaryId,
        )),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _logo(item.clubLogo),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            item.clubName,
                            style: AppFonts.body(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        // Star marks clubs NOT auto-synced from Rotary.org
                        // (manually managed here). Shown only when the backend
                        // explicitly reports the club as non-synced; a null
                        // flag (field not yet returned by the list endpoint)
                        // leaves the card unstarred.
                        if (item.isNonSync) ...[
                          const SizedBox(width: 6),
                          const Padding(
                            padding: EdgeInsets.only(top: 1),
                            child: Tooltip(
                              message: 'Not synced from Rotary.org',
                              child: Icon(
                                Icons.star_rounded,
                                size: 18,
                                color: AppColors.rotaryGold,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (item.clubRotaryId.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Rotary ID: ${item.clubRotaryId}',
                        style: AppFonts.body(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        // COG is a special club; its district (1280) is hidden
                        // everywhere — drop the district chip for COG rows.
                        if (item.clubName.trim().toLowerCase() != 'cog')
                          _chip(item.districtNumber),
                        if (item.zoneName != null) _chip(item.zoneName!),
                        if ((item.city ?? '').isNotEmpty)
                          _chip(_join([item.city, item.state])),
                        if (item.distanceKm != null)
                          _chip('${item.distanceKm!.toStringAsFixed(1)} km'),
                      ],
                    ),
                    if ((item.meetingDay ?? '').isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.event_rounded, size: 14, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              item.meetingDay!,
                              style: AppFonts.body(
                                fontSize: 13,
                                color: AppColors.textSecondary,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }

  Widget _logo(String? path) {
    final url = _photoUrl(path);
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 56,
        height: 56,
        color: AppColors.primaryLight,
        child: url == null
            ? const Icon(Icons.account_balance_rounded, color: AppColors.primary)
            : CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(color: AppColors.primaryLight),
                errorWidget: (_, __, ___) =>
                    const Icon(Icons.account_balance_rounded, color: AppColors.primary),
              ),
      ),
    );
  }

  Widget _chip(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          fontSize: 13,
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

String _join(List<String?> parts) =>
    parts.whereType<String>().where((s) => s.isNotEmpty).join(', ');

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}
