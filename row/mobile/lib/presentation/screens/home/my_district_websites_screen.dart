import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// `accessibleDistricts` from `/api/auth/my-context` carries only `{id, number}` —
/// the backend's DistrictScopeDto has no WebsiteUrl. We derive the website URL
/// per district by hitting `/api/mobile/club-finder/{clubId}` for any club that
/// belongs to that district; the response includes `districtWebsite {clientDomain,
/// status}`. The backend (2026-06-22) writes the FINAL sanitised URL into
/// `clientDomain` (full https://… or "" when none), so we read it directly.

class _MyDistrict {
  final int id;
  final String number;
  final int? firstClubId; // any club in this district — used to resolve the website
  String? websiteUrl;
  bool resolving;
  bool resolved;

  _MyDistrict({
    required this.id,
    required this.number,
    required this.firstClubId,
  })  : websiteUrl = null,
        resolving = false,
        resolved = false;
}

class MyDistrictWebsitesScreen extends StatefulWidget {
  const MyDistrictWebsitesScreen({super.key});

  @override
  State<MyDistrictWebsitesScreen> createState() => _MyDistrictWebsitesScreenState();
}

class _MyDistrictWebsitesScreenState extends State<MyDistrictWebsitesScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_MyDistrict> _districts = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/auth/my-context',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final districtsRaw = (resp.data?['accessibleDistricts'] as List<dynamic>? ?? const []);
      final clubsRaw = (resp.data?['accessibleClubs'] as List<dynamic>? ?? const []);
      // Map districtId → first clubId we have access to in that district.
      // Also note the COG and IFRM clubs' districts: these are special clubs and
      // their districts (COG, "IFRM India") are hidden from the district-website
      // list (matches the COG district being hidden from My Connections).
      final clubByDistrict = <int, int>{};
      final hiddenDistrictIds = <int>{};
      for (final c in clubsRaw) {
        if (c is! Map<String, dynamic>) continue;
        final cid = c['id'] as int?;
        final did = c['districtId'] as int?;
        final cname = (c['name']?.toString() ?? '').trim().toLowerCase();
        if (did != null && (cname == 'cog' || cname.contains('ifrm'))) {
          hiddenDistrictIds.add(did);
        }
        if (cid == null || did == null) continue;
        clubByDistrict.putIfAbsent(did, () => cid);
      }
      final districts = <_MyDistrict>[];
      for (final d in districtsRaw) {
        if (d is! Map<String, dynamic>) continue;
        final id = d['id'] as int? ?? 0;
        if (id == 0) continue;
        if (hiddenDistrictIds.contains(id)) continue; // hide COG / IFRM districts
        districts.add(_MyDistrict(
          id: id,
          number: d['number']?.toString() ?? '',
          firstClubId: clubByDistrict[id],
        ));
      }
      setState(() {
        _districts = districts;
        _loading = false;
      });
      // Resolve URLs in parallel; most users have 1-2 districts.
      await Future.wait(districts.map(_resolveDistrictWebsite));
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _resolveDistrictWebsite(_MyDistrict d) async {
    if (d.resolved || d.firstClubId == null) {
      d.resolved = true;
      if (mounted) setState(() {});
      return;
    }
    d.resolving = true;
    if (mounted) setState(() {});
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-finder/${d.firstClubId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final dw = resp.data?['districtWebsite'];
      d.websiteUrl = _composeDistrictUrl(dw);
    } catch (_) {
      // leave websiteUrl null; row renders "No website configured"
    } finally {
      d.resolving = false;
      d.resolved = true;
      if (mounted) setState(() {});
    }
  }

  String? _composeDistrictUrl(dynamic dw) {
    if (dw is! Map<String, dynamic>) return null;
    if ((dw['status']?.toString() ?? '').toLowerCase() != 'active') return null;
    // Backend writes the FINAL sanitised URL into `clientDomain` — read directly.
    final url = (dw['clientDomain']?.toString() ?? '').trim();
    if (url.isEmpty) return null;
    return url.startsWith('http') ? url : 'https://$url';
  }

  Future<void> _openWebsite(_MyDistrict d) async {
    if (!d.resolved) {
      await _resolveDistrictWebsite(d);
    }
    final raw = d.websiteUrl;
    if (raw == null || raw.trim().isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No website configured for District ${d.number}.')),
      );
      return;
    }
    final uri = Uri.tryParse(raw);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not open $raw')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My District Websites'),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _load,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    if (_districts.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 80),
          EmptyStateWidget(
            icon: Icons.link_off,
            title: 'No districts',
            subtitle: 'You are not a member of any district yet.',
          ),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: _districts.length + 1,
      separatorBuilder: (_, i) => i == 0 ? const SizedBox.shrink() : const SizedBox(height: 10),
      itemBuilder: (_, i) {
        if (i == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'Tap a district to open its website',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
            ),
          );
        }
        final d = _districts[i - 1];
        final hasWebsite = (d.websiteUrl ?? '').isNotEmpty;
        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppColors.border),
          ),
          color: AppColors.surface,
          child: InkWell(
            onTap: () => _openWebsite(d),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.public_outlined, color: AppColors.primary, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          d.number.isEmpty ? 'District' : d.number,
                          style: AppFonts.body(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          d.resolving
                              ? 'Loading website…'
                              : (hasWebsite ? d.websiteUrl! : 'No website configured'),
                          style: AppTextStyles.caption.copyWith(
                            color: hasWebsite ? AppColors.primary : AppColors.textMuted,
                            fontWeight: hasWebsite ? FontWeight.w500 : FontWeight.w400,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (d.resolving)
                    const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    Icon(
                      hasWebsite ? Icons.open_in_new : Icons.link_off,
                      size: 20,
                      color: hasWebsite ? AppColors.primary : AppColors.textMuted,
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
