import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart' as launcher;
import '../../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../../core/theme/app_colors.dart';
import '../../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../districts/overview/widgets/stat_card.dart';
import '../../../../../widgets/common/dashboard_refresh.dart';
import '../club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Dashboard › Marketplace sub-tab.
///
/// The public "Rotary Web Marketplace" is still under construction, so this is
/// an informational page: an amber "Coming Soon" banner, four KPI cards
/// (subscription / club-listing count / member id / platform), a centered hero
/// card with a "Launch Marketplace" action, an account-details card, and — when
/// the club already has draft listings — a small listings card. Everything is
/// read-only and rendered straight from `ClubAdminMarketplace`.
class DashboardMarketplaceSubtab extends StatefulWidget {
  final int clubId;
  const DashboardMarketplaceSubtab({super.key, required this.clubId});

  @override
  State<DashboardMarketplaceSubtab> createState() =>
      _DashboardMarketplaceSubtabState();
}

class _DashboardMarketplaceSubtabState
    extends State<DashboardMarketplaceSubtab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminMarketplace> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.getDashboardMarketplace(widget.clubId);
  }

  void _reload() =>
      setState(() => _future = _api.getDashboardMarketplace(widget.clubId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getDashboardMarketplace(widget.clubId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ClubAdminMarketplace>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        return DashboardRefresh.around(
          onRefresh: _refresh,
          child: _MarketplaceView(data: snap.data!),
        );
      },
    );
  }
}

// ── Main view ────────────────────────────────────────────────────────────────

class _MarketplaceView extends StatelessWidget {
  final ClubAdminMarketplace data;
  const _MarketplaceView({required this.data});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _ComingSoonBanner(),
          const SizedBox(height: 14),
          _KpiGrid(cards: [
            StatCard(
              label: 'Subscription',
              value: data.subscription.isEmpty ? '–' : data.subscription,
              sub: data.yearLabel.isEmpty ? null : 'RY ${data.yearLabel}',
              accent: AppColors.donutFillAmber,
            ),
            StatCard(
              label: 'Club Listings',
              value: '${data.clubListingsCount}',
              sub: 'Active listings',
              accent: AppColors.rotaryBlue,
            ),
            StatCard(
              label: 'Member ID',
              value: data.memberId.isEmpty ? '–' : data.memberId,
              sub: 'Marketplace identity',
              accent: AppColors.avenueInternational,
            ),
            StatCard(
              label: 'Platform',
              value: data.platform.isEmpty ? '–' : data.platform,
              sub: 'Hosting',
              accent: AppColors.avenueNewGen,
            ),
          ]),
          const SizedBox(height: 14),
          _HeroCard(
            platformUrl: data.platformUrl,
            launchUrl: data.launchUrl,
          ),
          const SizedBox(height: 14),
          const _WhatIsMarketplaceCard(),
          const SizedBox(height: 14),
          _AccountCard(account: data.account),
          const SizedBox(height: 14),
          _ListingsCard(listings: data.listings),
        ],
      ),
    );
  }
}

// ── Coming-soon banner ───────────────────────────────────────────────────────

class _ComingSoonBanner extends StatelessWidget {
  const _ComingSoonBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.donutTrackAmber,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warningLight),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.storefront_outlined,
              size: 20, color: AppColors.warningInk),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Coming Soon',
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.warningInk,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'The Rotary Web Marketplace is currently under development. '
                  'Soon your club will be able to list services, fundraisers '
                  'and offers for the wider Rotary community.',
                  style: AppFonts.body(
                    fontSize: 11.5,
                    height: 1.45,
                    color: AppColors.warningInk,
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

// ── KPI grid (2-col, last spans if odd) ──────────────────────────────────────

class _KpiGrid extends StatelessWidget {
  final List<StatCard> cards;
  const _KpiGrid({required this.cards});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += 2) {
      if (i + 1 < cards.length) {
        rows.add(Row(children: [
          Expanded(child: cards[i]),
          const SizedBox(width: 10),
          Expanded(child: cards[i + 1]),
        ]));
      } else {
        rows.add(cards[i]);
      }
      if (i + 2 < cards.length) rows.add(const SizedBox(height: 10));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }
}

// ── Card shell ───────────────────────────────────────────────────────────────

class _CardShell extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget child;
  const _CardShell({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          if (subtitle.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Text(subtitle,
                  style: AppFonts.body(
                      fontSize: 11, color: AppColors.slate500)),
            ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

// ── Hero card ────────────────────────────────────────────────────────────────

class _HeroCard extends StatelessWidget {
  final String platformUrl;
  final String launchUrl;
  const _HeroCard({required this.platformUrl, required this.launchUrl});

  @override
  Widget build(BuildContext context) {
    final canLaunch = launchUrl.isNotEmpty;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.muted,
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(Icons.storefront_rounded,
                size: 28, color: AppColors.rotaryBlue),
          ),
          const SizedBox(height: 14),
          Text(
            'Rotary Web Marketplace',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          if (platformUrl.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              platformUrl,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppColors.slate500,
              ),
            ),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: canLaunch ? () => _open(launchUrl) : null,
              icon: const Icon(Icons.open_in_new_rounded, size: 16),
              label: Text(
                'Launch Marketplace',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.rotaryBlue,
                foregroundColor: Colors.white,
                disabledBackgroundColor: AppColors.slate200,
                disabledForegroundColor: AppColors.slate400,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 13),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
          ),
          if (!canLaunch) ...[
            const SizedBox(height: 8),
            Text(
              'Launch link not yet available',
              style: AppFonts.body(
                fontSize: 10.5,
                color: AppColors.slate400,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launcher.launchUrl(uri,
        mode: launcher.LaunchMode.externalApplication);
  }
}

// ── Account-details card ─────────────────────────────────────────────────────

class _AccountCard extends StatelessWidget {
  final MarketplaceAccount account;
  const _AccountCard({required this.account});

  @override
  Widget build(BuildContext context) {
    String dash(String v) => v.isEmpty ? '–' : v;
    final rows = <({String label, String value})>[
      (label: 'Club Name', value: dash(account.clubName)),
      (label: 'Marketplace ID', value: dash(account.marketplaceId)),
      (label: 'District', value: dash(account.districtNumber)),
      (label: 'Subscription', value: dash(account.subscription)),
      (label: 'Contact Support', value: account.contactSupport ?? '–'),
    ];
    return _CardShell(
      title: 'Account Details',
      subtitle: 'Your club’s marketplace account',
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            _DetailRow(label: rows[i].label, value: rows[i].value),
            if (i != rows.length - 1)
              Container(
                margin: const EdgeInsets.symmetric(vertical: 8),
                height: 1,
                color: AppColors.slate100,
              ),
          ],
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          flex: 4,
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.slate500,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          flex: 5,
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}

// ── Listings card ────────────────────────────────────────────────────────────

class _ListingsCard extends StatelessWidget {
  final List<MarketplaceListing> listings;
  const _ListingsCard({required this.listings});

  @override
  Widget build(BuildContext context) {
    return _CardShell(
      title: 'Your Club’s Listings',
      subtitle: 'Recently published on marketplace',
      child: listings.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text('No active listings yet.',
                  style: AppFonts.body(
                      fontSize: 12, color: AppColors.slate400)),
            )
          : Column(
              children: [
                for (var i = 0; i < listings.length; i++) ...[
                  _ListingRow(listing: listings[i]),
                  if (i != listings.length - 1)
                    Container(
                      margin: const EdgeInsets.symmetric(vertical: 8),
                      height: 1,
                      color: AppColors.slate100,
                    ),
                ],
              ],
            ),
    );
  }
}

/// "What is the Marketplace?" explainer (web parity) — shown while the feature
/// is in preview.
class _WhatIsMarketplaceCard extends StatelessWidget {
  const _WhatIsMarketplaceCard();

  static const _points = <String>[
    'List member businesses, products, and professional services',
    'Browse offerings from Rotary members across the district',
    'Promote social enterprises and NGO initiatives',
    'Create event listings with online payment links',
    'Connect with fellow Rotarian entrepreneurs',
  ];

  @override
  Widget build(BuildContext context) {
    return _CardShell(
      title: 'What is the Marketplace?',
      subtitle: '${Brand.current.productName} Web Marketplace',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final p in _points)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 5, right: 8),
                    child: Icon(Icons.check_circle_rounded,
                        size: 13, color: AppColors.rotaryBlue),
                  ),
                  Expanded(
                    child: Text(p,
                        style: AppFonts.body(
                            fontSize: 11.5,
                            color: AppColors.slate700,
                            height: 1.35)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ListingRow extends StatelessWidget {
  final MarketplaceListing listing;
  const _ListingRow({required this.listing});

  @override
  Widget build(BuildContext context) {
    final kind = listing.kind.isEmpty
        ? ''
        : '${listing.kind[0].toUpperCase()}${listing.kind.substring(1)}';
    final date = (listing.date ?? '').trim();
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                listing.title.isEmpty ? 'Untitled listing' : listing.title,
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              if (kind.isNotEmpty || date.isNotEmpty) ...[
                const SizedBox(height: 3),
                Wrap(
                  spacing: 10,
                  runSpacing: 2,
                  children: [
                    if (kind.isNotEmpty)
                      Text(
                        'Type: $kind',
                        style: AppFonts.body(
                          fontSize: 10.5,
                          color: AppColors.slate500,
                        ),
                      ),
                    if (date.isNotEmpty)
                      Text(
                        'Date: $date',
                        style: AppFonts.body(
                          fontSize: 10.5,
                          color: AppColors.slate500,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: 8),
        _statusBadge(listing.status),
      ],
    );
  }
}

({Color bg, Color fg}) _statusStyle(String status) {
  final s = status.toLowerCase();
  if (s.contains('active') || s.contains('open')) {
    return (bg: AppColors.successLight, fg: AppColors.successDark);
  }
  if (s.contains('closed') || s.contains('expired')) {
    return (bg: AppColors.errorLight, fg: AppColors.error);
  }
  if (s.contains('pending') || s.contains('draft')) {
    return (bg: AppColors.warningLight, fg: AppColors.warningInk);
  }
  return (bg: AppColors.slate100, fg: AppColors.slate500);
}

Widget _statusBadge(String status) {
  if (status.isEmpty) return const SizedBox.shrink();
  final st = _statusStyle(status);
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
    decoration:
        BoxDecoration(color: st.bg, borderRadius: BorderRadius.circular(999)),
    child: Text(
      status[0].toUpperCase() + status.substring(1),
      style: AppFonts.body(
          fontSize: 9.5, fontWeight: FontWeight.w800, color: st.fg),
    ),
  );
}
