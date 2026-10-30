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
import 'district_website_advertisement_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

const _maxActiveAds = 10;

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

class _Ad {
  final int id;
  final String advertisementImagePath;
  final String? documentPath;
  final String? description;
  final int sortOrder;
  final bool isActive;
  final int yearId;
  const _Ad({
    required this.id,
    required this.advertisementImagePath,
    this.documentPath,
    this.description,
    required this.sortOrder,
    required this.isActive,
    required this.yearId,
  });

  factory _Ad.fromJson(Map<String, dynamic> j) => _Ad(
        id: (j['id'] as int?) ?? 0,
        advertisementImagePath: j['advertisementImagePath']?.toString() ?? '',
        documentPath: j['documentPath']?.toString(),
        description: j['description']?.toString(),
        sortOrder: (j['sortOrder'] as int?) ?? 0,
        isActive: _asBool(j['isActive'] ?? true),
        yearId: (j['yearId'] as int?) ?? 0,
      );
}

// Older ad rows may have been saved with a bare filename instead of the full
// `/uploads/advertisement/filename.ext`. Normalize before building the URL.
String _normalizeAdPath(String path) {
  if (path.isEmpty) return path;
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return path;
  return '/uploads/advertisement/$path';
}

String _absUrl(String path) => ApiConstants.mediaUrl(_normalizeAdPath(path));

class DistrictWebsiteAdvertisementsScreen extends StatefulWidget {
  final int districtId;
  const DistrictWebsiteAdvertisementsScreen({super.key, required this.districtId});

  @override
  State<DistrictWebsiteAdvertisementsScreen> createState() => _DistrictWebsiteAdvertisementsScreenState();
}

class _DistrictWebsiteAdvertisementsScreenState extends State<DistrictWebsiteAdvertisementsScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  List<_Ad> _ads = [];
  bool _loadingAds = false;
  // True while a drag-and-drop reorder is being persisted. Disables
  // edit/delete/add while the bulk PUTs are in flight.
  bool _savingOrder = false;
  // Client-side filter on description. Backend GET only accepts `yearId`, so
  // searching is local. Drag handles are hidden while a query is active.
  String _searchQuery = '';

  List<_Ad> get _visibleAds {
    final q = _searchQuery.trim().toLowerCase();
    if (q.isEmpty) return _ads;
    return _ads.where((a) {
      final d = (a.description ?? '').toLowerCase();
      return d.contains(q);
    }).toList();
  }

  bool get _isFiltering => _searchQuery.trim().isNotEmpty;

  int get _activeCount => _ads.where((a) => a.isActive).length;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      final availResp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/website-data/advertisements/available-years',
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
      if (_selectedYearId != null) await _fetchAds(_selectedYearId!);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchAds(int yearId) async {
    setState(() { _loadingAds = true; _ads = []; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/website-data/advertisements',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? []).map((e) => _Ad.fromJson(e as Map<String, dynamic>)).toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() { _ads = list; _loadingAds = false; });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() { _ads = []; _loadingAds = false; });
      } else {
        setState(() { _loadingAds = false; });
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to load: ${e.message}')));
      }
    } catch (_) {
      setState(() { _loadingAds = false; });
    }
  }

  Future<void> _openForm({_Ad? existing}) async {
    if (_selectedYearId == null) return;
    final initial = existing == null
        ? null
        : AdvertisementFormInitial(
            id: existing.id,
            imagePath: existing.advertisementImagePath,
            documentPath: existing.documentPath,
            description: existing.description,
            sortOrder: existing.sortOrder,
            isActive: existing.isActive,
            yearId: existing.yearId,
          );
    // Active count excluding the ad being edited so toggling its own state
    // doesn't trip the limit.
    final activeOthers = _ads
        .where((a) => a.isActive && a.id != (existing?.id ?? -1))
        .length;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictWebsiteAdvertisementFormScreen(
          districtId: widget.districtId,
          yearId: _selectedYearId!,
          initial: initial,
          activeCountExcludingThis: activeOthers,
          defaultSortOrder: _ads.length,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _fetchAds(_selectedYearId!);
    }
  }

  /// Optimistically reorders the local list, then PUTs each item whose
  /// sortOrder no longer matches its index. On any failure, refetch to
  /// snap back to server state.
  Future<void> _onReorder(int oldIndex, int newIndex) async {
    if (_savingOrder) return;
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _ads.removeAt(oldIndex);
      _ads.insert(newIndex, item);
      _savingOrder = true;
    });
    final tasks = <Future<void>>[];
    for (var i = 0; i < _ads.length; i++) {
      final ad = _ads[i];
      if (ad.sortOrder == i) continue;
      tasks.add(_api.put(
        '/api/districts/${widget.districtId}/website-data/advertisements/${ad.id}',
        body: {
          'advertisementImagePath': ad.advertisementImagePath,
          'documentPath': ad.documentPath,
          'description': ad.description,
          'sortOrder': i,
          'isActive': ad.isActive,
        },
      ));
    }
    try {
      await Future.wait(tasks);
      if (_selectedYearId != null) await _fetchAds(_selectedYearId!);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to save order: $e'),
            backgroundColor: AppColors.error,
          ),
        );
        if (_selectedYearId != null) await _fetchAds(_selectedYearId!);
      }
    } finally {
      if (mounted) setState(() => _savingOrder = false);
    }
  }

  Future<void> _confirmDelete(_Ad ad) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Advertisement'),
        content: const Text('Delete this advertisement? This action cannot be undone.'),
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
      await _api.delete('/api/districts/${widget.districtId}/website-data/advertisements/${ad.id}');
      if (mounted && _selectedYearId != null) await _fetchAds(_selectedYearId!);
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
        title: 'Advertisements',
        actions: [
          if (canManage && _selectedYearId != null)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add advertisement',
              onPressed: (_activeCount >= _maxActiveAds || _savingOrder)
                  ? null
                  : () => _openForm(),
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
                      if (v != null) _fetchAds(v);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.info_outline, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Text(
                  'Active: $_activeCount / $_maxActiveAds',
                  style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
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
          if (_loadingAds)
            const Center(child: Padding(padding: EdgeInsets.all(40), child: const CircularProgressIndicator(color: AppColors.primary)))
          else if (_ads.isEmpty)
            Expanded(
              child: EmptyStateWidget(
                title: 'No advertisements yet',
                subtitle: canManage ? 'Tap + to add one.' : 'No advertisements added.',
                icon: Icons.image_outlined,
              ),
            )
          else if (_visibleAds.isEmpty)
            Expanded(
              child: EmptyStateWidget(
                title: 'No matches',
                subtitle: 'No advertisements match "$_searchQuery". Clear the search to see all.',
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
                              'Clear the search to reorder advertisements.',
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
                            itemCount: _visibleAds.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 12),
                            itemBuilder: (ctx, i) {
                              final ad = _visibleAds[i];
                              return _AdCard(
                                ad: ad,
                                canManage: canManage,
                                disabled: _savingOrder,
                                onEdit: () => _openForm(existing: ad),
                                onDelete: () => _confirmDelete(ad),
                              );
                            },
                          )
                        : ReorderableListView.builder(
                            buildDefaultDragHandles: false,
                            itemCount: _ads.length,
                            onReorder: _onReorder,
                            proxyDecorator: (child, _, __) => Material(
                              elevation: 0,
                              color: Colors.transparent,
                              borderRadius: BorderRadius.circular(12),
                              child: child,
                            ),
                            itemBuilder: (ctx, i) {
                              final ad = _ads[i];
                              return Padding(
                                key: ValueKey('district_ad_${ad.id}'),
                                padding: const EdgeInsets.only(bottom: 12),
                                child: _AdCard(
                                  ad: ad,
                                  canManage: canManage,
                                  disabled: _savingOrder,
                                  onEdit: () => _openForm(existing: ad),
                                  onDelete: () => _confirmDelete(ad),
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
                itemCount: _visibleAds.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (ctx, i) => _AdCard(
                  ad: _visibleAds[i],
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

class _AdCard extends StatelessWidget {
  final _Ad ad;
  final bool canManage;
  final bool disabled;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  /// Drag handle from `ReorderableDragStartListener` — only present when the
  /// parent is `ReorderableListView`. Lets the user long-press *just* the
  /// icon to start dragging, leaving normal taps on the card unchanged.
  final Widget? dragHandle;
  const _AdCard({
    required this.ad,
    required this.canManage,
    required this.disabled,
    required this.onEdit,
    required this.onDelete,
    this.dragHandle,
  });

  @override
  Widget build(BuildContext context) {
    final hasDoc = (ad.documentPath ?? '').isNotEmpty;
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
            aspectRatio: 454 / 518,
            child: Container(
              color: AppColors.background,
              child: ad.advertisementImagePath.isNotEmpty
                  ? Image.network(
                      _absUrl(ad.advertisementImagePath),
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
                        color: ad.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        ad.isActive ? 'Active' : 'Inactive',
                        style: AppTextStyles.caption.copyWith(
                          color: ad.isActive ? AppColors.success : AppColors.textSecondary,
                        ),
                      ),
                    ),
                    if (hasDoc) ...[
                      const SizedBox(width: 8),
                      const Icon(Icons.picture_as_pdf_outlined, size: 14, color: AppColors.textSecondary),
                      const SizedBox(width: 2),
                      Text('PDF', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                    ],
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
                if (ad.description != null && ad.description!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(ad.description!, style: AppTextStyles.body),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
