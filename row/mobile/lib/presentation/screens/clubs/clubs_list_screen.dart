import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/club_model.dart';
import '../../../data/models/district_model.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

enum _ClubsStatus { idle, loading, loadingMore, success, error }

class ClubsProvider extends ChangeNotifier {
  final ApiClient _api = ApiClient();

  _ClubsStatus _status = _ClubsStatus.idle;
  List<ClubModel> _clubs = [];
  List<DistrictModel> _districts = [];
  String _error = '';
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  String _search = '';
  String? _isActiveFilter;
  int? _districtIdFilter;

  _ClubsStatus get status => _status;
  List<ClubModel> get clubs => _clubs;
  List<DistrictModel> get districts => _districts;
  String get error => _error;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  bool get isLoadingMore => _status == _ClubsStatus.loadingMore;
  int? get districtIdFilter => _districtIdFilter;
  String? get isActiveFilter => _isActiveFilter;

  Future<void> init() async {
    await Future.wait([fetchDistricts(), fetchClubs()]);
  }

  Future<void> fetchDistricts() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/districts',
        queryParams: {'page': 1, 'pageSize': 200},
      );
      final data = res.data;
      if (data != null) {
        final items = data['items'] as List<dynamic>? ?? [];
        _districts = items.map((e) => DistrictModel.fromJson(e as Map<String, dynamic>)).toList();
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> fetchClubs({bool refresh = false}) async {
    if (refresh) {
      _currentPage = 1;
      _clubs = [];
    }
    _status = _clubs.isEmpty ? _ClubsStatus.loading : _ClubsStatus.loadingMore;
    notifyListeners();

    try {
      final params = <String, dynamic>{
        'page': _currentPage,
        'pageSize': _pageSize,
        if (_search.isNotEmpty) 'search': _search,
        if (_isActiveFilter != null) 'isActive': _isActiveFilter,
        if (_districtIdFilter != null) 'fkDistrictId': _districtIdFilter,
      };

      final response = await _api.get<Map<String, dynamic>>('/clubs', queryParams: params);
      final data = response.data;
      if (data != null) {
        final items = data['items'] as List<dynamic>? ?? [];
        final newItems = items.map((e) => ClubModel.fromJson(e as Map<String, dynamic>)).toList();
        if (refresh || _currentPage == 1) {
          _clubs = newItems;
        } else {
          _clubs = [..._clubs, ...newItems];
        }
        _totalPages = (data['totalPages'] as int?) ?? 1;
        _totalCount = (data['totalCount'] as int?) ?? _clubs.length;
      }
      _status = _ClubsStatus.success;
    } catch (e) {
      _status = _ClubsStatus.error;
      _error = e.toString();
    }
    notifyListeners();
  }

  Future<void> loadMore() async {
    if (_currentPage >= _totalPages || isLoadingMore) return;
    _currentPage++;
    await fetchClubs();
  }

  void setSearch(String value) {
    _search = value;
    fetchClubs(refresh: true);
  }

  void setActiveFilter(String? value) {
    _isActiveFilter = value;
    fetchClubs(refresh: true);
  }

  void setDistrictFilter(int? districtId) {
    _districtIdFilter = districtId;
    fetchClubs(refresh: true);
  }

  Future<bool> deleteClub(int id) async {
    try {
      await _api.delete(ApiConstants.clubById(id));
      _clubs.removeWhere((c) => c.id == id);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

class ClubsListScreen extends StatefulWidget {
  const ClubsListScreen({super.key});

  @override
  State<ClubsListScreen> createState() => _ClubsListScreenState();
}

class _ClubsListScreenState extends State<ClubsListScreen> {
  late final ClubsProvider _provider;

  @override
  void initState() {
    super.initState();
    _provider = ClubsProvider();
    WidgetsBinding.instance.addPostFrameCallback((_) => _provider.init());
  }

  @override
  void dispose() {
    _provider.dispose();
    super.dispose();
  }

  Future<void> _onRefresh() => _provider.fetchClubs(refresh: true);

  Future<void> _confirmDelete(BuildContext ctx, ClubModel club) async {
    final confirmed = await ConfirmationDialog.show(
      ctx,
      title: 'Delete Club',
      message: 'Delete "${club.clubName}"? This cannot be undone.',
    );
    if (!confirmed) return;
    if (!ctx.mounted) return;
    final success = await _provider.deleteClub(club.id);
    if (!ctx.mounted) return;
    if (success) {
      SnackbarUtils.showSuccess(ctx, 'Club deleted successfully.');
    } else {
      SnackbarUtils.showError(ctx, _provider.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManageClubs = context.read<AuthProvider>().canManageClubs;
    return ChangeNotifierProvider.value(
      value: _provider,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        drawer: const CustomDrawer(),
        appBar: CustomAppBar(
          title: 'Clubs',
          titleStyle: AppFonts.body(fontWeight: FontWeight.bold, fontSize: 22),
        ),
        floatingActionButton: canManageClubs
            ? FloatingActionButton.extended(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.white,
                onPressed: () async {
                  await context.push(RouteNames.clubNew);
                  _provider.fetchClubs(refresh: true);
                },
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add Club'),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              )
            : null,
        body: Consumer<ClubsProvider>(
          builder: (context, provider, _) {
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                  child: SearchBarWidget(
                    hint: 'Search clubs...',
                    onSearch: provider.setSearch,
                  ),
                ),
                _FilterRow(provider: provider),
                Expanded(child: _buildBody(context, provider)),
                if (provider.status == _ClubsStatus.success && provider.clubs.isNotEmpty)
                  PaginationWidget(
                    currentPage: provider.currentPage,
                    totalPages: provider.totalPages,
                    totalCount: provider.totalCount,
                    isLoading: provider.isLoadingMore,
                    onLoadMore: provider.loadMore,
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context, ClubsProvider provider) {
    switch (provider.status) {
      case _ClubsStatus.loading:
        return const _ClubsShimmer();
      case _ClubsStatus.error:
        return ErrorStateWidget(
          message: provider.error,
          onRetry: () => provider.fetchClubs(refresh: true),
        );
      case _ClubsStatus.success:
      case _ClubsStatus.loadingMore:
        if (provider.clubs.isEmpty) {
          return const EmptyStateWidget(
            icon: Icons.business_rounded,
            title: 'No Clubs Found',
            subtitle: 'Add your first club to begin.',
          );
        }
        return RefreshIndicator(
          onRefresh: _onRefresh,
          color: AppColors.primaryPrime,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 100),
            itemCount: provider.clubs.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (ctx, index) {
              final club = provider.clubs[index];
              return _ClubCard(
                club: club,
                canManage: ctx.read<AuthProvider>().canManageClubs,
                onTap: () => ctx.push(RouteNames.clubDashboard(club.id)),
                onEdit: () async {
                  await ctx.push(RouteNames.clubEdit(club.id));
                  provider.fetchClubs(refresh: true);
                },
                onDelete: () => _confirmDelete(ctx, club),
              );
            },
          ),
        );
      case _ClubsStatus.idle:
        return const SizedBox.shrink();
    }
  }
}

// ---------------------------------------------------------------------------
// Filter row
// ---------------------------------------------------------------------------

class _FilterRow extends StatelessWidget {
  final ClubsProvider provider;
  const _FilterRow({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          child: Row(
            children: [
              _Chip(
                label: 'All',
                selected: provider.isActiveFilter == null,
                onTap: () => provider.setActiveFilter(null),
              ),
              const SizedBox(width: 8),
              _Chip(
                label: 'Active',
                selected: provider.isActiveFilter == 'true',
                onTap: () => provider.setActiveFilter('true'),
              ),
              const SizedBox(width: 8),
              _Chip(
                label: 'Inactive',
                selected: provider.isActiveFilter == 'false',
                onTap: () => provider.setActiveFilter('false'),
              ),
            ],
          ),
        ),
        if (provider.districts.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
            child: _DistrictDropdown(provider: provider),
          ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _Chip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryPrime : AppColors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? AppColors.primaryPrime : AppColors.lightBorder),

        ),
        child: Text(
          label,
          style: AppFonts.body(
            color: selected ? AppColors.white : AppColors.textSecondary,
            fontWeight: FontWeight.w700,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

class _DistrictDropdown extends StatelessWidget {
  final ClubsProvider provider;
  const _DistrictDropdown({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: provider.districtIdFilter != null ? AppColors.primaryPrime : AppColors.lightBorder,
          width: provider.districtIdFilter != null ? 1.5 : 1,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int?>(
          value: provider.districtIdFilter,
          isExpanded: true,
          hint: Text('Select District Filter', style: AppFonts.body(fontSize: 13, color: AppColors.textSecondary)),
          style: AppFonts.body(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600),
          items: [
            const DropdownMenuItem<int?>(value: null, child: Text('All Districts')),
            ...provider.districts.map(
              (d) => DropdownMenuItem<int?>(
                value: d.id,
                child: Text(d.districtNumber),
              ),
            ),
          ],
          onChanged: provider.setDistrictFilter,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Club Card
// ---------------------------------------------------------------------------

class _ClubCard extends StatelessWidget {
  final ClubModel club;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final bool canManage;

  const _ClubCard({
    required this.club,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

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
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.primaryPrime.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: club.clubLogoPath != null && club.clubLogoPath!.isNotEmpty
                          ? Image.network(
                              ApiConstants.mediaUrl(club.clubLogoPath),
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) =>
                                  const Icon(Icons.business_rounded, color: AppColors.primaryPrime, size: 28),
                            )
                          : const Icon(Icons.business_rounded, color: AppColors.primaryPrime, size: 28),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  club.clubName,
                                  style: AppFonts.body(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                    color: AppColors.textPrimary,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 8),
                              _StatusBadge(isActive: club.isActive),
                            ],
                          ),
                          if (club.districtName != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              club.districtName!,
                              style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w600),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    if (club.city != null && club.city!.isNotEmpty) ...[
                      _InfoBadge(icon: Icons.location_on_rounded, label: club.city!),
                      const SizedBox(width: 8),
                    ],
                    _InfoBadge(icon: Icons.people_rounded, label: '${club.totalMembers ?? 0} Members'),
                    const Spacer(),
                    if (canManage) ...[
                      _ActionButton(icon: Icons.edit_rounded, color: AppColors.primaryPrime, onTap: onEdit),
                      const SizedBox(width: 12),
                      _ActionButton(icon: Icons.delete_rounded, color: AppColors.error, onTap: onDelete),
                    ] else
                      const Icon(Icons.chevron_right_rounded, color: AppColors.textMuted),
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

class _InfoBadge extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoBadge({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withOpacity(0.05),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.primaryPrime),
          const SizedBox(width: 6),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.primaryPrime,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({required this.icon, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, size: 18, color: color),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final bool isActive;
  const _StatusBadge({required this.isActive});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: isActive ? AppColors.successLight : AppColors.errorLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        isActive ? 'Active' : 'Inactive',
        style: AppFonts.body(
          color: isActive ? AppColors.success : AppColors.error,
          fontWeight: FontWeight.w800,
          fontSize: 9,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shimmer
// ---------------------------------------------------------------------------

class _ClubsShimmer extends StatelessWidget {
  const _ClubsShimmer();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.md),
      itemCount: 7,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, __) => const _ShimmerCard(),
    );
  }
}

class _ShimmerCard extends StatelessWidget {
  const _ShimmerCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 110,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(width: 52, height: 52, decoration: BoxDecoration(color: AppColors.shimmerBase, borderRadius: BorderRadius.circular(16))),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 16, width: 180, color: AppColors.shimmerBase),
                  const SizedBox(height: 8),
                  Container(height: 12, width: 120, color: AppColors.shimmerBase),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
