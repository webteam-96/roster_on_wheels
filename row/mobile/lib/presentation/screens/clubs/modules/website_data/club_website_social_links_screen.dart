import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import 'club_website_social_link_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// design-allow: third-party brand colours (data, must match each network's own mark).
const _platformMeta = <String, (String, Color)>{
  'facebook': ('Facebook', Color(0xFF1877F2)),
  'instagram': ('Instagram', Color(0xFFC13584)),
  'twitter': ('Twitter / X', Color(0xFF000000)),
  'linkedin': ('LinkedIn', Color(0xFF0A66C2)),
  'youtube': ('YouTube', Color(0xFFFF0000)),
  'telegram': ('Telegram', Color(0xFF229ED9)),
  'pinterest': ('Pinterest', Color(0xFFBD081C)),
  'threads': ('Threads', Color(0xFF000000)),
  'website': ('Website', Color(0xFF6B7280)),
};

String _platformLabel(String value) =>
    _platformMeta[value]?.$1 ?? value;

Color _platformColor(String value) =>
    _platformMeta[value]?.$2 ?? AppColors.textSecondary;

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

class _SocialLink {
  final int id;
  final String platform;
  final String linkUrl;
  final int sortOrder;
  final bool isActive;
  final int yearId;
  const _SocialLink({
    required this.id,
    required this.platform,
    required this.linkUrl,
    required this.sortOrder,
    required this.isActive,
    required this.yearId,
  });

  factory _SocialLink.fromJson(Map<String, dynamic> j) => _SocialLink(
        id: (j['id'] as int?) ?? 0,
        platform: j['platform']?.toString() ?? '',
        linkUrl: j['linkUrl']?.toString() ?? '',
        sortOrder: (j['sortOrder'] as int?) ?? 0,
        isActive: _asBool(j['isActive'] ?? true),
        yearId: (j['yearId'] as int?) ?? 0,
      );
}

class ClubWebsiteSocialLinksScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteSocialLinksScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteSocialLinksScreen> createState() => _ClubWebsiteSocialLinksScreenState();
}

class _ClubWebsiteSocialLinksScreenState extends State<ClubWebsiteSocialLinksScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  int? _selectedYearId;
  List<_SocialLink> _links = [];
  bool _loadingLinks = false;
  // True while a drag-and-drop reorder is being persisted to the server.
  bool _savingOrder = false;
  // Monotonically increasing fetch token. Each call to _fetchLinks takes the
  // next value; only the response matching the current value is committed to
  // state. Prevents an older request that resolves later from clobbering a
  // newer year's data (race condition when the user changes year quickly).
  int _fetchToken = 0;

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
      final current = years.firstWhere((y) => y.isCurrent, orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''));
      setState(() {
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) await _fetchLinks(_selectedYearId!);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchLinks(int yearId, {bool silent = false}) async {
    final token = ++_fetchToken;
    if (!silent) setState(() { _loadingLinks = true; _links = []; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/social_media_links',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted || token != _fetchToken) return;
      final list = (resp.data ?? []).map((e) => _SocialLink.fromJson(e as Map<String, dynamic>)).toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() { _links = list; _loadingLinks = false; });
    } on ApiException catch (e) {
      if (!mounted || token != _fetchToken) return;
      if (e.statusCode == 404) {
        setState(() { _links = []; _loadingLinks = false; });
      } else {
        setState(() { _links = []; _loadingLinks = false; });
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to load: ${e.message}')));
      }
    } catch (_) {
      if (!mounted || token != _fetchToken) return;
      setState(() { _links = []; _loadingLinks = false; });
    }
  }

  /// Drag-and-drop reorder: optimistic local move, then persist the full new
  /// order via `reorder-all` (rewrites sort_order by position).
  Future<void> _onReorder(int oldIndex, int newIndex) async {
    if (_savingOrder) return;
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _links.removeAt(oldIndex);
      _links.insert(newIndex, item);
      _savingOrder = true;
    });
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/social_media_links/reorder-all',
        body: {'orderedIds': _links.map((l) => l.id).toList()},
      );
      if (_selectedYearId != null) await _fetchLinks(_selectedYearId!, silent: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save order: $e'), backgroundColor: AppColors.error),
        );
        if (_selectedYearId != null) await _fetchLinks(_selectedYearId!, silent: true);
      }
    } finally {
      if (mounted) setState(() => _savingOrder = false);
    }
  }

  Future<void> _openForm({_SocialLink? existing}) async {
    if (_selectedYearId == null) return;
    final initial = existing == null
        ? null
        : ClubSocialLinkFormInitial(
            id: existing.id,
            platform: existing.platform,
            linkUrl: existing.linkUrl,
            sortOrder: existing.sortOrder,
            isActive: existing.isActive,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ClubWebsiteSocialLinkFormScreen(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _fetchLinks(_selectedYearId!);
    }
  }

  Future<void> _confirmDelete(_SocialLink link) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Social Link'),
        content: Text('Delete the ${_platformLabel(link.platform)} link?'),
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
      await _api.delete('/api/clubs/${widget.clubId}/website-data/social_media_links/${link.id}');
      if (mounted && _selectedYearId != null) await _fetchLinks(_selectedYearId!);
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
        title: 'Social Media Links',
        actions: [
          if (canManage && _selectedYearId != null)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add link',
              onPressed: () => _openForm(),
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
          // Social media links are not year-specific (the backend returns the
          // same set regardless of year), so the year filter has been removed.
          // The current year is still loaded internally so new links can be
          // saved against a valid rotary year.
          if (_loadingLinks)
            const Center(child: Padding(padding: EdgeInsets.all(40), child: const CircularProgressIndicator(color: AppColors.primary)))
          else if (_links.isEmpty)
            Expanded(
              child: EmptyStateWidget(
                title: 'No links added yet',
                subtitle: canManage ? 'Tap + to add a social link.' : 'No social links added.',
                icon: Icons.share_outlined,
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
                              'Drag the handle to reorder links.',
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
                      itemCount: _links.length,
                      onReorder: _onReorder,
                      proxyDecorator: (child, _, __) => Material(
                        elevation: 6,
                        color: Colors.transparent,
                        borderRadius: BorderRadius.circular(10),
                        child: child,
                      ),
                      itemBuilder: (ctx, i) => Padding(
                        key: ValueKey('club_social_${_links[i].id}'),
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _LinkTile(
                          link: _links[i],
                          canManage: canManage,
                          disabled: _savingOrder,
                          onEdit: () => _openForm(existing: _links[i]),
                          onDelete: () => _confirmDelete(_links[i]),
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
                itemCount: _links.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, i) => _LinkTile(
                  link: _links[i],
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

class _LinkTile extends StatelessWidget {
  final _SocialLink link;
  final bool canManage;
  final bool disabled;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final Widget? dragHandle;
  const _LinkTile({
    required this.link,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    this.disabled = false,
    this.dragHandle,
  });

  @override
  Widget build(BuildContext context) {
    final color = _platformColor(link.platform);
    final label = _platformLabel(link.platform);
    final initial = label.isNotEmpty ? label[0].toUpperCase() : '?';
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              child: Center(
                child: Text(
                  initial,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: AppTextStyles.bodyMedium),
                  const SizedBox(height: 2),
                  Text(
                    link.linkUrl,
                    style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: link.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                link.isActive ? 'Active' : 'Inactive',
                style: AppTextStyles.caption.copyWith(
                  color: link.isActive ? AppColors.success : AppColors.textSecondary,
                ),
              ),
            ),
            if (canManage) ...[
              const SizedBox(width: 4),
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
      ),
    );
  }
}
