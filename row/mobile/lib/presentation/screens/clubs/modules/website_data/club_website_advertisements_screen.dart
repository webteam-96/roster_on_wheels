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
import '../../../../widgets/common/rotary_year_bar.dart';
import 'club_website_advertisement_form_screen.dart';
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

String _absUrl(String path) => ApiConstants.mediaUrl(path);

class ClubWebsiteAdvertisementsScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteAdvertisementsScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteAdvertisementsScreen> createState() => _ClubWebsiteAdvertisementsScreenState();
}

class _ClubWebsiteAdvertisementsScreenState extends State<ClubWebsiteAdvertisementsScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  List<_Ad> _ads = [];
  bool _loadingAds = false;
  // True while a drag-and-drop reorder is being persisted to the server.
  bool _savingOrder = false;

  int get _activeCount => _ads.where((a) => a.isActive).length;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      final allResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (allResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
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

  Future<void> _fetchAds(int yearId, {bool silent = false}) async {
    if (!silent) setState(() { _loadingAds = true; _ads = []; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/advertisements',
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

  /// Drag-and-drop reorder: optimistic local move, then persist the full new
  /// order via `reorder-all` (rewrites sort_order by position).
  Future<void> _onReorder(int oldIndex, int newIndex) async {
    if (_savingOrder) return;
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _ads.removeAt(oldIndex);
      _ads.insert(newIndex, item);
      _savingOrder = true;
    });
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/advertisements/reorder-all',
        body: {'orderedIds': _ads.map((a) => a.id).toList()},
      );
      if (_selectedYearId != null) await _fetchAds(_selectedYearId!, silent: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save order: $e'), backgroundColor: AppColors.error),
        );
        if (_selectedYearId != null) await _fetchAds(_selectedYearId!, silent: true);
      }
    } finally {
      if (mounted) setState(() => _savingOrder = false);
    }
  }

  Future<void> _openForm({_Ad? existing}) async {
    if (_selectedYearId == null) return;
    final initial = existing == null
        ? null
        : ClubAdvertisementFormInitial(
            id: existing.id,
            imagePath: existing.advertisementImagePath,
            documentPath: existing.documentPath,
            description: existing.description,
            sortOrder: existing.sortOrder,
            isActive: existing.isActive,
            yearId: existing.yearId,
          );
    final activeOthers = _ads
        .where((a) => a.isActive && a.id != (existing?.id ?? -1))
        .length;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ClubWebsiteAdvertisementFormScreen(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          initial: initial,
          activeCountExcludingThis: activeOthers,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _fetchAds(_selectedYearId!);
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
      await _api.delete('/api/clubs/${widget.clubId}/website-data/advertisements/${ad.id}');
      if (mounted && _selectedYearId != null) await _fetchAds(_selectedYearId!);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isClubAdminOf(widget.clubId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Advertisements',
        actions: [
          if (canManage && _selectedYearId != null)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add advertisement',
              onPressed: _activeCount >= _maxActiveAds
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
            RotaryYearBar<int>(
              value: _selectedYearId,
              margin: EdgeInsets.zero,
              options: [
                for (final y in _years)
                  RotaryYearOption(value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                if (v != null) _fetchAds(v);
              },
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
            const SizedBox(height: 16),
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
                              width: 14, height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2)),
                          const SizedBox(width: 8),
                          Text('Saving order…',
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textSecondary)),
                        ],
                      ),
                    )
                  else
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const Icon(Icons.drag_indicator,
                              size: 14, color: AppColors.textSecondary),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Drag the handle to reorder advertisements.',
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textSecondary),
                            ),
                          ),
                        ],
                      ),
                    ),
                  Expanded(
                    child: ReorderableListView.builder(
                      buildDefaultDragHandles: false,
                      itemCount: _ads.length,
                      onReorder: _onReorder,
                      proxyDecorator: (child, _, __) => Material(
                        elevation: 0,
                        color: Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                        child: child,
                      ),
                      itemBuilder: (ctx, i) => Padding(
                        key: ValueKey('club_ad_${_ads[i].id}'),
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _AdCard(
                          ad: _ads[i],
                          canManage: canManage,
                          disabled: _savingOrder,
                          onEdit: () => _openForm(existing: _ads[i]),
                          onDelete: () => _confirmDelete(_ads[i]),
                          dragHandle: ReorderableDragStartListener(
                            index: i,
                            child: const Padding(
                              padding: EdgeInsets.symmetric(
                                  horizontal: 4, vertical: 6),
                              child: Icon(Icons.drag_handle,
                                  size: 22, color: AppColors.textSecondary),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: _ads.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (ctx, i) => _AdCard(
                  ad: _ads[i],
                  canManage: false,
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
  final Widget? dragHandle;
  const _AdCard({
    required this.ad,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    this.disabled = false,
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
                      if (dragHandle != null) dragHandle!,
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
