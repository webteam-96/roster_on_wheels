import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/pagination_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class TerminatedMembersScreen extends StatefulWidget {
  final int clubId;
  const TerminatedMembersScreen({super.key, required this.clubId});

  @override
  State<TerminatedMembersScreen> createState() => _TerminatedMembersScreenState();
}

class _TerminatedMembersScreenState extends State<TerminatedMembersScreen> {
  final ApiClient _api = ApiClient();
  final List<dynamic> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetch(reset: true);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/terminated-members',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => j as Map<String, dynamic>);
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalPages;
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (_) {
      setState(() { _loading = false; _loadingMore = false; });
    }
  }

  void _onLoadMore() {
    if (_page < _totalPages && !_loadingMore) {
      _page++;
      _fetch();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Terminated Members'),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search terminated members...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(icon: const Icon(Icons.clear), onPressed: () { _searchCtrl.clear(); _fetch(reset: true); })
                    : null,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
              ),
              onSubmitted: (_) => _fetch(reset: true),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _items.isEmpty
                    ? const EmptyStateWidget(icon: Icons.person_remove_outlined, title: 'No Terminated Members', subtitle: 'No terminated members found.')
                    : RefreshIndicator(
                        color: AppColors.primary,
                        onRefresh: () => _fetch(reset: true),
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
                          itemCount: _items.length + 1,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) {
                            if (i == _items.length) {
                              return PaginationWidget(
                                currentPage: _page,
                                totalPages: _totalPages,
                                totalCount: _totalCount,
                                isLoading: _loadingMore,
                                onLoadMore: _onLoadMore,
                              );
                            }
                            return _TerminatedCard(item: _items[i] as Map<String, dynamic>);
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

class _TerminatedCard extends StatelessWidget {
  final Map<String, dynamic> item;
  const _TerminatedCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final terminationDate = item['terminationDate'] != null
        ? DateFormatter.toDisplay(DateTime.tryParse(item['terminationDate'] as String))
        : null;
    final joinedDate = item['joinedDate'] != null
        ? DateFormatter.toDisplay(DateTime.tryParse(item['joinedDate'] as String))
        : null;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),

      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: AppColors.muted,
            child: const Icon(Icons.person_off_outlined, color: AppColors.error, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item['memberName'] as String? ?? 'Unknown', style: AppTextStyles.bodySemiBold),
                if (item['rotaryId'] != null)
                  Text(item['rotaryId'] as String, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    if (joinedDate != null)
                      Text('Joined: $joinedDate', style: AppTextStyles.caption.copyWith(color: AppColors.textMuted)),
                    if (joinedDate != null && terminationDate != null)
                      const Text('  ·  ', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                    if (terminationDate != null)
                      Text('Left: $terminationDate', style: AppTextStyles.caption.copyWith(color: AppColors.error)),
                  ],
                ),
                if (item['terminationReason'] != null && (item['terminationReason'] as String).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      item['terminationReason'] as String,
                      style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
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
