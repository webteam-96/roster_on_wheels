import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import 'district_website_social_link_form_screen.dart';

// design-allow: third-party brand colours (data, must match each network's own mark).
const _SOCIAL_PLATFORMS = <(String, String, Color)>[
  ('facebook', 'Facebook', Color(0xFF1877F2)),
  ('instagram', 'Instagram', Color(0xFFC13584)),
  ('twitter', 'Twitter / X', Color(0xFF000000)),
  ('linkedin', 'LinkedIn', Color(0xFF0A66C2)),
  ('youtube', 'YouTube', Color(0xFFFF0000)),
  ('telegram', 'Telegram', Color(0xFF229ED9)),
  ('pinterest', 'Pinterest', Color(0xFFBD081C)),
  ('threads', 'Threads', Color(0xFF000000)),
  ('website', 'Website', Color(0xFF6B7280)),
];

String _platformLabel(String value) =>
    _SOCIAL_PLATFORMS.firstWhere((p) => p.$1 == value, orElse: () => (value, value, AppColors.textSecondary)).$2;

Color _platformColor(String value) =>
    _SOCIAL_PLATFORMS.firstWhere((p) => p.$1 == value, orElse: () => (value, value, AppColors.textSecondary)).$3;

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

class DistrictWebsiteSocialLinksScreen extends StatefulWidget {
  final int districtId;
  const DistrictWebsiteSocialLinksScreen({super.key, required this.districtId});

  @override
  State<DistrictWebsiteSocialLinksScreen> createState() => _DistrictWebsiteSocialLinksScreenState();
}

class _DistrictWebsiteSocialLinksScreenState extends State<DistrictWebsiteSocialLinksScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  int? _selectedYearId;
  List<_SocialLink> _links = [];
  bool _loadingLinks = false;
  // Race-condition guard: each fetch claims a token; only the response whose
  // token still matches commits to state. Prevents an older year's response
  // from clobbering the newer one when the user changes year quickly.
  int _fetchToken = 0;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      // Try the year-restricted endpoint first; fall back to the full
      // /api/rotary-years list on ANY failure (deployed backend may not
      // expose available-years, returning 404/405).
      List<_RotaryYear> years = [];
      try {
        final availResp = await _api.get<List<dynamic>>(
          '/api/districts/${widget.districtId}/website-data/social-links/available-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (availResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {
        years = [];
      }
      if (years.isEmpty) {
        final allResp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (allResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      }
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

  Future<void> _fetchLinks(int yearId) async {
    final token = ++_fetchToken;
    setState(() { _loadingLinks = true; _links = []; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/website-data/social-links',
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

  Future<void> _openForm({_SocialLink? existing}) async {
    if (_selectedYearId == null) return;
    final initial = existing == null
        ? null
        : SocialLinkFormInitial(
            id: existing.id,
            platform: existing.platform,
            linkUrl: existing.linkUrl,
            sortOrder: existing.sortOrder,
            isActive: existing.isActive,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictWebsiteSocialLinkFormScreen(
          districtId: widget.districtId,
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
      await _api.delete('/api/districts/${widget.districtId}/website-data/social-links/${link.id}');
      if (mounted && _selectedYearId != null) await _fetchLinks(_selectedYearId!);
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
          else
            Expanded(
              child: ListView.separated(
                itemCount: _links.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, i) => _LinkTile(
                  link: _links[i],
                  canManage: canManage,
                  onEdit: () => _openForm(existing: _links[i]),
                  onDelete: () => _confirmDelete(_links[i]),
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
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _LinkTile({required this.link, required this.canManage, required this.onEdit, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final color = _platformColor(link.platform);
    final initial = _platformLabel(link.platform).isNotEmpty
        ? _platformLabel(link.platform)[0].toUpperCase()
        : '?';
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
                  Text(_platformLabel(link.platform), style: AppTextStyles.bodyMedium),
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
              IconButton(icon: const Icon(Icons.edit_outlined, size: 18), onPressed: onEdit, visualDensity: VisualDensity.compact),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                onPressed: onDelete,
                visualDensity: VisualDensity.compact,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
