import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/services/project_share_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Read-only detail page for a single Club-Finder project. Reached by tapping a
/// row in the Projects tab of [ClubFinderDetailScreen].
///
/// Fetches `GET /api/mobile/club-finder/projects/{projectId}?yearId=` which
/// returns `{ project, photos[] }`. [fallback] is the list-row map passed via
/// the router `extra`; it lets us paint the title/description immediately and
/// still show something if the detail endpoint ever fails.
class ClubFinderProjectDetailScreen extends StatefulWidget {
  final int projectId;
  final int? yearId;
  final Map<String, dynamic>? fallback;

  const ClubFinderProjectDetailScreen({
    super.key,
    required this.projectId,
    this.yearId,
    this.fallback,
  });

  @override
  State<ClubFinderProjectDetailScreen> createState() =>
      _ClubFinderProjectDetailScreenState();
}

class _ClubFinderProjectDetailScreenState
    extends State<ClubFinderProjectDetailScreen> {
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
    _project = widget.fallback;
    _fetch();
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
    });
    try {
      final qp = <String, dynamic>{};
      if (widget.yearId != null && widget.yearId! > 0) {
        qp['yearId'] = widget.yearId;
      }
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/projects/${widget.projectId}',
        queryParams: qp.isEmpty ? null : qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final data = resp.data ?? const {};
      final project = (data['project'] as Map?)?.cast<String, dynamic>();
      final photos = (data['photos'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();
      setState(() {
        if (project != null) _project = project;
        _photos = photos;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _project;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Project Detail',
        actions: [
          if (p != null)
            IconButton(
              tooltip: 'Share',
              icon: const Icon(Icons.share_outlined),
              onPressed: () => shareProject(
                context,
                projectId: widget.projectId,
                yearId: (p['yearId'] as num?)?.toInt() ?? widget.yearId,
              ),
            ),
        ],
      ),
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
        .map((ph) => _photoUrl(ph['imagePath']?.toString()))
        .whereType<String>()
        .toList();
    // Fall back to the list-row cover photo when the detail has no gallery.
    if (urls.isEmpty) {
      final cover = _photoUrl(widget.fallback?['coverPhoto']?.toString());
      if (cover != null) urls.add(cover);
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
                child: const Center(child: CircularProgressIndicator()),
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
    final dt = _parseDate(p['projectDate']?.toString());
    final chips = <Widget>[
      if (dt != null)
        _chip(Icons.calendar_today_outlined, DateFormat('dd MMM yyyy').format(dt)),
      if ((p['location']?.toString() ?? '').isNotEmpty)
        _chip(Icons.location_on_outlined, p['location'].toString()),
      if ((p['moduleName']?.toString() ?? '').isNotEmpty)
        _chip(Icons.category_outlined, p['moduleName'].toString()),
      if ((p['areaOfFocus']?.toString() ?? '').isNotEmpty)
        _chip(Icons.track_changes_outlined, p['areaOfFocus'].toString()),
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
              fontSize: 12,
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
      child: Text(
        desc,
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
      _KV('Area of Focus', text(p['areaOfFocus']) ?? text(p['otherAreaOfFocus'])),
      _KV('Project Cost', money(p['projectCost'])),
      _KV('Funding', text(p['fundingName'])),
      _KV('Direct Beneficiaries', count(p['directBeneficiaries'])),
      _KV('Man Hours', count(p['manHours'])),
      _KV('Rotarians Involved', count(p['rotariansInvolved'])),
      _KV('Rotaractors Involved', count(p['rotaractorsInvolved'])),
      _KV('Project Type', text(p['projectType'])),
      _KV('Joint Project',
          (p['isJointProject'] == true || p['isJointProject'] == 1) ? 'Yes' : null),
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

DateTime? _parseDate(String? v) {
  if (v == null || v.isEmpty) return null;
  final d = DateTime.tryParse(v);
  return (d == null || d.year <= 1) ? null : d;
}

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}
