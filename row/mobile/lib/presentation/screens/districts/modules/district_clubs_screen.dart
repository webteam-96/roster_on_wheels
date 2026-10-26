import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../core/network/api_client.dart';
import '../../clubs/club_info_screen.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Club {
  final int id;
  final String clubName;
  final String? city;
  final bool isActive;
  final int? totalMembers;
  // Of totalMembers, how many are honorary (ClubListDto.HonoraryMembers). The
  // displayed member count is totalMembers − honoraryMembers.
  final int? honoraryMembers;
  // Wave 13A4 — listing columns: auto-managed-from-Rotary.org flag + website.
  final bool isSyncedFromRotaryOrg;
  final String? websiteSubdomain;
  final DateTime? websiteEndDate;

  const _Club({
    required this.id,
    required this.clubName,
    this.city,
    this.isActive = true,
    this.totalMembers,
    this.honoraryMembers,
    this.isSyncedFromRotaryOrg = false,
    this.websiteSubdomain,
    this.websiteEndDate,
  });

  factory _Club.fromJson(Map<String, dynamic> j) => _Club(
        id: j['id'] as int? ?? j['clubId'] as int? ?? 0,
        clubName: j['clubName'] as String? ?? j['name'] as String? ?? '',
        city: j['city'] as String?,
        isActive: j['isActive'] as bool? ?? true,
        totalMembers: j['totalMembers'] as int?,
        honoraryMembers: j['honoraryMembers'] as int?,
        isSyncedFromRotaryOrg: j['isSyncedFromRotaryOrg'] as bool? ?? false,
        websiteSubdomain: (j['websiteSubdomain'] as String?)?.trim(),
        websiteEndDate:
            DateTime.tryParse(j['websiteEndDate']?.toString() ?? ''),
      );

  bool get hasWebsite => (websiteSubdomain ?? '').isNotEmpty;
  bool get websiteExpired =>
      hasWebsite &&
      websiteEndDate != null &&
      websiteEndDate!.isBefore(DateTime.now());
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictClubsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictClubsScreen({super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictClubsScreen> createState() => _DistrictClubsScreenState();
}

class _DistrictClubsScreenState extends State<DistrictClubsScreen> {
  final _api = ApiClient();

  final List<_Club> _items = [];
  bool _loading = true;
  String? _error;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _fetch(reset: true);
  }

  /// The backend endpoint `GET /api/districts/{id}/clubs` ignores any `search`
  /// query param (DistrictsController.GetClubs takes none) — it always returns
  /// the full club list. So we fetch once and filter locally by name/city.
  List<_Club> get _visible {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return _items;
    return _items
        .where((c) =>
            c.clubName.toLowerCase().contains(q) ||
            (c.city?.toLowerCase().contains(q) ?? false))
        .toList();
  }

  Future<void> _fetch({bool reset = false}) async {
    setState(() { _items.clear(); _loading = true; _error = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/clubs',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = resp.data ?? [];
      final clubs = list.map((j) => _Club.fromJson(j as Map<String, dynamic>)).toList();
      setState(() {
        _items.addAll(clubs);
        _loading = false;
      });
    } catch (e) {
      debugPrint('[DistrictClubs] error: $e');
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _onSearch(String value) {
    setState(() => _search = value);
  }

  Future<void> _confirmDelete(_Club club) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Club'),
        content: Text('Delete "${club.clubName}"? This action cannot be undone.'),
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
      await _api.delete('/api/clubs/${club.id}');
      if (mounted) await _fetch(reset: true);
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'District Clubs'),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SearchBarWidget(
              hint: 'Search by club name or city',
              onSearch: _onSearch,
            ),
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 8, itemHeight: 80)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
                    : _visible.isEmpty
                        ? EmptyStateWidget(
                            title: 'No Clubs Found',
                            subtitle: _search.isNotEmpty
                                ? 'No clubs match your search.'
                                : 'No clubs found for this district.',
                            icon: Icons.groups_outlined,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: () => _fetch(reset: true),
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _visible.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 10),
                              itemBuilder: (ctx, i) {
                                final club = _visible[i];
                                return _ClubCard(
                                  club: club,
                                  canManage: canManage,
                                  // From District → Clubs, always open the
                                  // read-only ClubInfoScreen (never the full
                                  // club dashboard). The dashboard remains
                                  // reachable via Home's Club Admin / Club
                                  // Member tiles.
                                  onTap: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          ClubInfoScreen(clubId: club.id),
                                    ),
                                  ),
                                  onDelete: () => _confirmDelete(club),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Club Card
// ---------------------------------------------------------------------------
class _ClubCard extends StatelessWidget {
  final _Club club;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _ClubCard({
    required this.club,
    required this.canManage,
    required this.onTap,
    required this.onDelete,
  });

  // Honorary count (clamped ≥ 0). ClubListDto.HonoraryMembers is a subset of
  // totalMembers.
  int _honoraryMembers(_Club c) {
    final h = c.honoraryMembers ?? 0;
    return h < 0 ? 0 : h;
  }

  // The displayed member count is REGULAR = totalMembers − honoraryMembers,
  // matching the web.
  int _regularMembers(_Club c) =>
      ((c.totalMembers ?? 0) - _honoraryMembers(c)).clamp(0, c.totalMembers ?? 0);

  // Group large counts with thousands separators (e.g. 100000 → "100,000") so
  // big clubs stay readable.
  String _grouped(int n) {
    final s = n.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buf.write(',');
      buf.write(s[i]);
    }
    return buf.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: Text(
                    club.clubName.isNotEmpty ? club.clubName[0].toUpperCase() : 'C',
                    style: AppTextStyles.h3.copyWith(color: AppColors.primary),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(club.clubName,
                              style: AppTextStyles.bodyMedium,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis),
                        ),
                        if (club.isSyncedFromRotaryOrg) ...[
                          const SizedBox(width: 6),
                          const _SyncedBadge(),
                        ],
                      ],
                    ),
                    if (club.city != null && club.city!.trim().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined,
                              size: 12, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              club.city!.trim(),
                              style: AppTextStyles.caption,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.people_outline,
                                size: 12, color: AppColors.textSecondary),
                            const SizedBox(width: 4),
                            Text(
                              '${_grouped(_regularMembers(club))} '
                              '${_regularMembers(club) == 1 ? 'Member' : 'Members'}',
                              style: AppTextStyles.caption,
                            ),
                          ],
                        ),
                        if (_honoraryMembers(club) > 0)
                          Text(
                            '${_grouped(_honoraryMembers(club))} Honorary',
                            style: AppTextStyles.caption,
                          ),
                        if (club.hasWebsite)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.language_rounded,
                                  size: 12,
                                  color: club.websiteExpired
                                      ? AppColors.warning
                                      : AppColors.success),
                              const SizedBox(width: 3),
                              Text(
                                club.websiteExpired ? 'Expired' : 'Website',
                                style: AppTextStyles.caption.copyWith(
                                  color: club.websiteExpired
                                      ? AppColors.warning
                                      : AppColors.success,
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right, color: AppColors.textSecondary, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// "Synced from Rotary.org" badge — marks clubs auto-managed from api.rotary.org
// ---------------------------------------------------------------------------
class _SyncedBadge extends StatelessWidget {
  const _SyncedBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.sync_rounded, size: 10, color: AppColors.primary),
          const SizedBox(width: 3),
          Text(
            'Synced',
            style: AppTextStyles.caption.copyWith(
              color: AppColors.primary,
              fontWeight: FontWeight.w700,
              fontSize: 9.5,
            ),
          ),
        ],
      ),
    );
  }
}
