import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/search_bar_widget.dart';
import 'district_website_banner_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

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

class _Banner {
  final int id;
  final String bannerImagePath;
  final String? description;
  final int sortOrder;
  final bool isActive;
  final int yearId;
  const _Banner({
    required this.id,
    required this.bannerImagePath,
    this.description,
    required this.sortOrder,
    required this.isActive,
    required this.yearId,
  });

  factory _Banner.fromJson(Map<String, dynamic> j) => _Banner(
        id: (j['id'] as int?) ?? 0,
        bannerImagePath: j['bannerImagePath']?.toString() ?? '',
        description: j['description']?.toString(),
        sortOrder: (j['sortOrder'] as int?) ?? 0,
        isActive: _asBool(j['isActive'] ?? true),
        yearId: (j['yearId'] as int?) ?? 0,
      );
}

String _absUrl(String path) => ApiConstants.mediaUrl(path);

class DistrictWebsiteBannersScreen extends StatefulWidget {
  final int districtId;
  const DistrictWebsiteBannersScreen({super.key, required this.districtId});

  @override
  State<DistrictWebsiteBannersScreen> createState() => _DistrictWebsiteBannersScreenState();
}

class _DistrictWebsiteBannersScreenState extends State<DistrictWebsiteBannersScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  List<_Banner> _banners = [];
  bool _loadingBanners = false;
  // True while a drag-and-drop reorder is being persisted to the server. We
  // disable edit/delete and the add button during this window so concurrent
  // mutations don't race with the bulk PUTs.
  bool _savingOrder = false;
  // Client-side filter applied to the banner description. Backend GET only
  // accepts `yearId` (no search param), so we filter locally. While a query
  // is active the drag handles are hidden — reordering a filtered view would
  // produce wrong indices.
  String _searchQuery = '';

  List<_Banner> get _visibleBanners {
    final q = _searchQuery.trim().toLowerCase();
    if (q.isEmpty) return _banners;
    return _banners.where((b) {
      final d = (b.description ?? '').toLowerCase();
      return d.contains(q);
    }).toList();
  }

  bool get _isFiltering => _searchQuery.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      final availResp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/website-data/banners/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      List<_RotaryYear> years = (availResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      if (years.isEmpty) {
        final allResp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        final all = (allResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
        final cur = all.where((y) => y.isCurrent).toList();
        years = cur.isNotEmpty ? cur : (all.isNotEmpty ? [all.first] : []);
      }
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
      );
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) await _fetchBanners(_selectedYearId!);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchBanners(int yearId) async {
    setState(() { _loadingBanners = true; _banners = []; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/website-data/banners',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? []).map((e) => _Banner.fromJson(e as Map<String, dynamic>)).toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() { _banners = list; _loadingBanners = false; });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() { _banners = []; _loadingBanners = false; });
      } else {
        setState(() { _loadingBanners = false; });
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to load: ${e.message}')));
      }
    } catch (_) {
      setState(() { _loadingBanners = false; });
    }
  }

  Future<void> _openForm({_Banner? existing}) async {
    if (_selectedYearId == null) return;
    final initial = existing == null
        ? null
        : BannerFormInitial(
            id: existing.id,
            imagePath: existing.bannerImagePath,
            description: existing.description,
            sortOrder: existing.sortOrder,
            isActive: existing.isActive,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictWebsiteBannerFormScreen(
          districtId: widget.districtId,
          yearId: _selectedYearId!,
          initial: initial,
          // Newly-added banners always append at the end of the current list.
          // The user can then drag them to a different position from the list
          // screen — the form no longer asks for a sort order.
          defaultSortOrder: _banners.length,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _fetchBanners(_selectedYearId!);
    }
  }

  /// Handles a single hold-and-move drag event. Mutates the local list
  /// immediately (optimistic UI) then PUTs each item whose sortOrder changed.
  /// Any PUT failure triggers a refetch to revert to the server's truth.
  Future<void> _onReorder(int oldIndex, int newIndex) async {
    if (_savingOrder) return;
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _banners.removeAt(oldIndex);
      _banners.insert(newIndex, item);
      _savingOrder = true;
    });
    final tasks = <Future<void>>[];
    for (var i = 0; i < _banners.length; i++) {
      final b = _banners[i];
      if (b.sortOrder == i) continue;
      tasks.add(_api.put(
        '/api/districts/${widget.districtId}/website-data/banners/${b.id}',
        body: {
          'bannerImagePath': b.bannerImagePath,
          'description': b.description,
          'sortOrder': i,
          'isActive': b.isActive,
        },
      ));
    }
    try {
      await Future.wait(tasks);
      // Refetch so local sortOrder fields match server, and to confirm.
      if (_selectedYearId != null) await _fetchBanners(_selectedYearId!);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to save order: $e'),
            backgroundColor: AppColors.error,
          ),
        );
        if (_selectedYearId != null) await _fetchBanners(_selectedYearId!);
      }
    } finally {
      if (mounted) setState(() => _savingOrder = false);
    }
  }


  Future<void> _confirmDelete(_Banner b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Banner'),
        content: const Text('Delete this banner? This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/districts/${widget.districtId}/website-data/banners/${b.id}');
      if (mounted && _selectedYearId != null) await _fetchBanners(_selectedYearId!);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Banner Photos',
        actions: [
          if (canManage && _selectedYearId != null)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add banner',
              onPressed: _savingOrder ? null : () => _openForm(),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadInitial)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_years.isNotEmpty) ...[
            Row(
              children: [
                Text('Year:', style: AppTextStyles.bodyMedium),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButtonFormField<int>(
                    value: _selectedYearId,
                    decoration: InputDecoration(
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    items: _years.map((y) => DropdownMenuItem(
                      value: y.id,
                      child: Text('${y.yearLabel}${y.isCurrent ? " (Current)" : ""}'),
                    )).toList(),
                    onChanged: (v) {
                      setState(() => _selectedYearId = v);
                      if (v != null) _fetchBanners(v);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SearchBarWidget(
              hint: 'Search by description',
              onSearch: (q) => setState(() => _searchQuery = q),
            ),
            const SizedBox(height: 12),
          ],
          if (_loadingBanners)
            const Center(child: Padding(padding: EdgeInsets.all(40), child: const CircularProgressIndicator(color: AppColors.primary)))
          else if (_banners.isEmpty)
            Expanded(
              child: EmptyStateWidget(
                title: 'No banners yet',
                subtitle: canManage ? 'Tap + to add a banner.' : 'No banners added.',
                icon: Icons.image_outlined,
              ),
            )
          else if (_visibleBanners.isEmpty)
            Expanded(
              child: EmptyStateWidget(
                title: 'No matches',
                subtitle: 'No banners match "$_searchQuery". Clear the search to see all.',
                icon: Icons.search_off,
              ),
            )
          else if (canManage)
            Expanded(
              child: Column(
                children: [
                  if (_savingOrder)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Saving order…',
                            style: AppTextStyles.caption.copyWith(
                                color: AppColors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                  if (_isFiltering)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline,
                              size: 14, color: AppColors.textSecondary),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Clear the search to reorder banners.',
                              style: AppTextStyles.caption.copyWith(
                                  color: AppColors.textSecondary),
                            ),
                          ),
                        ],
                      ),
                    ),
                  Expanded(
                    child: _isFiltering
                        ? ListView.separated(
                            itemCount: _visibleBanners.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 12),
                            itemBuilder: (ctx, i) {
                              final banner = _visibleBanners[i];
                              return _BannerCard(
                                banner: banner,
                                canManage: canManage,
                                disabled: _savingOrder,
                                onEdit: () => _openForm(existing: banner),
                                onDelete: () => _confirmDelete(banner),
                              );
                            },
                          )
                        : ReorderableListView.builder(
                            buildDefaultDragHandles: false,
                            itemCount: _banners.length,
                            onReorder: _onReorder,
                            proxyDecorator: (child, _, __) => Material(
                              elevation: 0,
                              color: Colors.transparent,
                              borderRadius: BorderRadius.circular(12),
                              child: child,
                            ),
                            itemBuilder: (ctx, i) {
                              final banner = _banners[i];
                              return Padding(
                                key: ValueKey('district_banner_${banner.id}'),
                                padding: const EdgeInsets.only(bottom: 12),
                                child: _BannerCard(
                                  banner: banner,
                                  canManage: canManage,
                                  disabled: _savingOrder,
                                  onEdit: () => _openForm(existing: banner),
                                  onDelete: () => _confirmDelete(banner),
                                  dragHandle: ReorderableDragStartListener(
                                    index: i,
                                    child: const Padding(
                                      padding: EdgeInsets.symmetric(
                                          horizontal: 4, vertical: 6),
                                      child: Icon(
                                        Icons.drag_handle,
                                        size: 22,
                                        color: AppColors.textSecondary,
                                      ),
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: _visibleBanners.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (ctx, i) => _BannerCard(
                  banner: _visibleBanners[i],
                  canManage: false,
                  disabled: false,
                  onEdit: () {},
                  onDelete: () {},
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _BannerCard extends StatelessWidget {
  final _Banner banner;
  final bool canManage;
  final bool disabled;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  /// Optional drag handle widget shown at the left of the action row when
  /// the parent uses `ReorderableListView`. Wrapped in
  /// `ReorderableDragStartListener` by the caller so the drag only starts
  /// from this icon — taps on the card itself stay tap-only.
  final Widget? dragHandle;
  const _BannerCard({
    required this.banner,
    required this.canManage,
    required this.disabled,
    required this.onEdit,
    required this.onDelete,
    this.dragHandle,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 996 / 596,
            child: Container(
              color: AppColors.background,
              child: banner.bannerImagePath.isNotEmpty
                  ? Image.network(
                      _absUrl(banner.bannerImagePath),
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const Center(
                        child: const Icon(Icons.broken_image_outlined, size: 32, color: AppColors.textSecondary),
                      ),
                    )
                  : const Center(child: const Icon(Icons.image_outlined, size: 32, color: AppColors.textSecondary)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (dragHandle != null) ...[
                      dragHandle!,
                      const SizedBox(width: 4),
                    ],
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: banner.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        banner.isActive ? 'Active' : 'Inactive',
                        style: AppTextStyles.caption.copyWith(
                          color: banner.isActive ? AppColors.success : AppColors.textSecondary,
                        ),
                      ),
                    ),
                    const Spacer(),
                    if (canManage) ...[
                      IconButton(
                        icon: const Icon(Icons.edit_outlined, size: 18),
                        onPressed: disabled ? null : onEdit,
                        visualDensity: VisualDensity.compact,
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                        onPressed: disabled ? null : onDelete,
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ],
                ),
                if (banner.description != null && banner.description!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(banner.description!, style: AppTextStyles.body),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
