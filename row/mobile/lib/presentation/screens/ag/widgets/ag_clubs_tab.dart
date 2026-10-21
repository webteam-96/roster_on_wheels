import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/routing/route_names.dart';
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "My Clubs" tab — the AG's Club Directory. Wired to
/// `GET /api/mobile/ag-dashboard/clubs`.
///
/// Layout: header (title + AG name + club count) · 4 summary chips · search ·
/// club cards (Sync/Non-Sync + website pills, president/secretary, 4 stat cells).
class AgClubsTab extends StatefulWidget {
  final int? yearId;
  const AgClubsTab({super.key, this.yearId});

  @override
  State<AgClubsTab> createState() => _AgClubsTabState();
}

class _AgClubsTabState extends State<AgClubsTab>
    with AutomaticKeepAliveClientMixin<AgClubsTab> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgClubsResponse> _future;
  String _search = '';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getClubs(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgClubsTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() => _future = _api.getClubs(yearId: widget.yearId));
    }
  }

  void _reload() =>
      setState(() => _future = _api.getClubs(yearId: widget.yearId));

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgClubsResponse>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const AgLoading();
        }
        if (snap.hasError) {
          return AgError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;
        final q = _search.toLowerCase().trim();
        final filtered = q.isEmpty
            ? data.clubs
            : data.clubs
                .where((c) =>
                    c.clubName.toLowerCase().contains(q) ||
                    c.presidentName.toLowerCase().contains(q) ||
                    c.secretaryName.toLowerCase().contains(q))
                .toList();

        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 14, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Club Directory',
                textAlign: TextAlign.center,
                style: AppFonts.body(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              Text(
                'AG: ${data.ag.name.isEmpty ? ": " : data.ag.name} · ${data.clubs.length} club${data.clubs.length == 1 ? "" : "s"}',
                textAlign: TextAlign.center,
                style: AppFonts.body(
                    fontSize: 11.5, color: AppColors.slate500),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.center,
                children: [
                  _SummaryChip(
                      value: agFmtInt(data.totalMembers),
                      label: 'Total Members'),
                  _SummaryChip(
                      value: agFmtInt(data.totalMeetings),
                      label: 'Total Meetings'),
                  _SummaryChip(
                      value: agFmtInt(data.totalProjects),
                      label: 'Total Projects'),
                  _SummaryChip(
                      value: agFmtUsdShort(data.totalTrfInr),
                      label: 'Total TRF (USD)'),
                ],
              ),
              const SizedBox(height: 14),
              _SearchInput(
                value: _search,
                onChanged: (v) => setState(() => _search = v),
              ),
              const SizedBox(height: 14),
              if (data.clubs.isEmpty)
                const _EmptyState(
                  icon: Icons.search_rounded,
                  text: 'No clubs assigned to you yet.',
                )
              else if (filtered.isEmpty)
                _EmptyState(
                  icon: Icons.search_off_rounded,
                  text: 'No clubs match "$_search".',
                  onClear: () => setState(() => _search = ''),
                )
              else
                Column(
                  children: [for (final c in filtered) _ClubCard(club: c)],
                ),
              const SizedBox(height: 8),
              Text(
                'Data as of ${agToday()}',
                style: AppFonts.body(
                    fontSize: 10, color: AppColors.slate400),
                textAlign: TextAlign.right,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;
  final VoidCallback? onClear;
  const _EmptyState({required this.icon, required this.text, this.onClear});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 44),
      child: Column(
        children: [
          Icon(icon, size: 32, color: AppColors.slate400),
          const SizedBox(height: 10),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.slate500),
          ),
          if (onClear != null) ...[
            const SizedBox(height: 6),
            TextButton(
              onPressed: onClear,
              child: Text('Clear search',
                  style: AppFonts.body(
                      fontSize: 12, color: AppColors.rotaryBlue)),
            ),
          ],
        ],
      ),
    );
  }
}

class _SummaryChip extends StatelessWidget {
  final String value;
  final String label;
  const _SummaryChip({required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.rotaryBlue,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: AppFonts.body(
                fontSize: 11,
                color: AppColors.slate500,
                fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _SearchInput extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const _SearchInput({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Row(
        children: [
          const Icon(Icons.search_rounded, size: 16, color: AppColors.slate400),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: TextEditingController(text: value)
                ..selection = TextSelection.collapsed(offset: value.length),
              onChanged: onChanged,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              decoration: InputDecoration(
                hintText: 'Search clubs…',
                hintStyle: AppFonts.body(
                    fontSize: 13, color: AppColors.slate400),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
              ),
            ),
          ),
          if (value.isNotEmpty)
            IconButton(
              onPressed: () => onChanged(''),
              icon: const Icon(Icons.close_rounded,
                  size: 14, color: AppColors.slate400),
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            ),
        ],
      ),
    );
  }
}

class _ClubCard extends StatelessWidget {
  final AgClubSummary club;
  const _ClubCard({required this.club});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(RouteNames.agClubDetail(club.clubId)),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                club.clubName,
                style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _SyncPill(synced: !club.isNonSync),
                  _WebsitePill(
                    status: club.clubWebsiteStatus,
                    subdomain: club.clubWebsiteSubdomain,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.person_outline_rounded,
                      size: 12, color: AppColors.slate400),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        style: AppFonts.body(
                            fontSize: 11, color: AppColors.slate500),
                        children: [
                          const TextSpan(
                              text: 'President: ',
                              style: TextStyle(color: AppColors.slate400)),
                          TextSpan(
                              text: club.presidentName.isEmpty
                                  ? 'Pending'
                                  : club.presidentName),
                        ],
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              if (club.secretaryName.isNotEmpty) ...[
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(Icons.badge_outlined,
                        size: 12, color: AppColors.slate400),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text.rich(
                        TextSpan(
                          style: AppFonts.body(
                              fontSize: 11, color: AppColors.slate500),
                          children: [
                            const TextSpan(
                                text: 'Secretary: ',
                                style: TextStyle(color: AppColors.slate400)),
                            TextSpan(text: club.secretaryName),
                          ],
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                childAspectRatio: 3.2,
                children: [
                  _StatCell(
                      icon: Icons.groups_rounded,
                      label: 'Members',
                      value: agFmtInt(club.members),
                      accent: true),
                  _StatCell(
                      icon: Icons.event_rounded,
                      label: 'Meetings',
                      value: agFmtInt(club.meetings)),
                  _StatCell(
                      icon: Icons.work_outline_rounded,
                      label: 'Projects',
                      value: agFmtInt(club.totalProjects)),
                  _StatCell(
                      icon: Icons.emoji_events_rounded,
                      label: 'TRF (USD)',
                      value: agFmtUsdShort(club.trfTotalInr),
                      accent: true),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Small pill primitive (uppercase label) used for the sync + website badges,
/// mirroring the web `Pill`.
class _MiniPill extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;
  const _MiniPill({required this.label, required this.bg, required this.fg});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          color: fg,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// Rotary.org sync state — emerald "SYNC" when synced, slate "NON-SYNC" when the
/// club is manually managed. Mirrors the web club-card pill.
class _SyncPill extends StatelessWidget {
  final bool synced;
  const _SyncPill({required this.synced});

  @override
  Widget build(BuildContext context) {
    return synced
        ? const _MiniPill(
            label: 'SYNC',
            bg: AppColors.background,
            fg: AppColors.successDark,
          )
        : const _MiniPill(
            label: 'NON-SYNC',
            bg: AppColors.slate100,
            fg: AppColors.slate500,
          );
  }
}

/// Build the club-website host from the stored subdomain, mirroring the web
/// `clubWebsiteUrl` (strip protocol/trailing slash, append the parent domain
/// when only a bare label was stored). Returns null when there's nothing usable.
String? _clubWebsiteHost(String? subdomain) {
  var s = (subdomain ?? '').trim().toLowerCase();
  if (s.isEmpty) return null;
  s = s.replaceFirst(RegExp(r'^https?://'), '');
  s = s.split('/').first;
  if (s.isEmpty) return null;
  if (!s.contains('.') && Brand.current.clubSiteParent.isNotEmpty) s = '$s.${Brand.current.clubSiteParent}';
  return s;
}

/// Club-website state pill — a tappable link (blue) for a live site, otherwise
/// a coloured status pill. Matches the web: active→link/"Website: Yes",
/// expired→red, none→slate.
class _WebsitePill extends StatelessWidget {
  final String status; // 'active' | 'expired' | 'none'
  final String? subdomain;
  const _WebsitePill({required this.status, this.subdomain});

  Future<void> _open(String host) async {
    final uri = Uri.parse('https://$host');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (status == 'active') {
      final host = _clubWebsiteHost(subdomain);
      if (host != null) {
        return Material(
          color: AppColors.muted,
          borderRadius: BorderRadius.circular(999),
          child: InkWell(
            onTap: () => _open(host),
            borderRadius: BorderRadius.circular(999),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.language_rounded,
                      size: 11, color: AppColors.rotaryBlue),
                  const SizedBox(width: 4),
                  Text(
                    host,
                    style: AppFonts.body(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.rotaryBlue,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }
      return const _MiniPill(
        label: 'WEBSITE: YES',
        bg: AppColors.background,
        fg: AppColors.successDark,
      );
    }
    if (status == 'expired') {
      return const _MiniPill(
        label: 'WEBSITE: EXPIRED',
        bg: AppColors.errorTint,
        fg: AppColors.errorDark,
      );
    }
    return const _MiniPill(
      label: 'WEBSITE: NO',
      bg: AppColors.slate100,
      fg: AppColors.slate500,
    );
  }
}

class _StatCell extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool accent;
  const _StatCell({
    required this.icon,
    required this.label,
    required this.value,
    this.accent = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: accent
            ? AppColors.rotaryBlue.withValues(alpha: 0.06)
            : AppColors.slate50,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, size: 11, color: AppColors.slate400),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  label,
                  style: AppFonts.body(
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate400,
                    letterSpacing: 0.4,
                  ),
                ),
                Text(
                  value,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    fontFeatures: const [FontFeature.tabularFigures()],
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
