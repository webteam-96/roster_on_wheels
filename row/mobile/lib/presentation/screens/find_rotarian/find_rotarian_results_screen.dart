import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/rotarian_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class FindRotarianResultsScreen extends StatefulWidget {
  final Map<String, dynamic> queryParams;
  const FindRotarianResultsScreen({super.key, required this.queryParams});

  @override
  State<FindRotarianResultsScreen> createState() =>
      _FindRotarianResultsScreenState();
}

class _FindRotarianResultsScreenState extends State<FindRotarianResultsScreen> {
  final _api = ApiClient();
  final _scrollCtrl = ScrollController();

  final List<RotarianItem> _items = [];
  int _page = 1;
  int _totalCount = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;

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

  Future<RotarianPage> _fetch(int page) async {
    final qp = <String, dynamic>{
      ...widget.queryParams,
      'page': page,
      'pageSize': 20,
    };
    final resp = await _api.get<Map<String, dynamic>>(
      '/api/mobile/find-rotarian',
      queryParams: qp,
      fromJson: (j) => j as Map<String, dynamic>,
    );
    if (!resp.isSuccess || resp.data == null) throw resp.error ?? 'Search failed';
    return RotarianPage.fromJson(resp.data!);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Rotarians'),
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
        icon: Icons.person_search_outlined,
        title: 'No Rotarians found',
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
                  fontSize: 12,
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
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              return _RotarianCard(item: _items[i]);
            },
          ),
        ),
      ],
    );
  }
}

class _RotarianCard extends StatelessWidget {
  final RotarianItem item;
  const _RotarianCard({required this.item});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push(RouteNames.findRotarianDetail(
          item.memberId,
          clubName: item.clubName,
          clubRotaryId: item.clubRotaryId,
        )),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _photo(item.profilePhoto),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.memberName,
                      style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if ((item.rotaryId ?? '').isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Rotary ID: ${item.rotaryId}',
                        style: AppFonts.body(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        _chip(item.clubName),
                        // COG is a special club; its district (1280) is hidden
                        // everywhere — drop the district chip for COG rows.
                        if (item.districtNumber.isNotEmpty && !_isCog(item))
                          _chip(item.districtNumber),
                        if ((item.city ?? '').isNotEmpty)
                          _chip(_join([item.city, item.state])),
                      ],
                    ),
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

  Widget _photo(String? path) {
    final url = _photoUrl(path);
    return ClipOval(
      child: Container(
        width: 54,
        height: 54,
        color: AppColors.primaryLight,
        child: url == null
            ? const Icon(Icons.person_rounded, color: AppColors.primary)
            : CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(color: AppColors.primaryLight),
                errorWidget: (_, __, ___) =>
                    const Icon(Icons.person_rounded, color: AppColors.primary),
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
          fontSize: 11,
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// COG is a special club identified purely by its name; its district (1280)
/// must never be surfaced. Mirrors the name-based detection used elsewhere.
bool _isCog(RotarianItem item) => item.clubName.trim().toLowerCase() == 'cog';

String _join(List<String?> parts) =>
    parts.whereType<String>().where((s) => s.isNotEmpty).join(', ');

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}
