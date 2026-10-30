import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../modules/event_payment_links/event_payment_links_screen.dart';
import '../../../districts/overview/widgets/stat_card.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import '../../../../widgets/common/labeled_stat.dart';
import '../../../../widgets/common/expandable_record_card.dart';
import 'club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Payment Links" tab — mirrors the web Payment Links module (KPI strip +
/// the Online Event & Payment Links list). Reads `/api/event-payment-links`;
/// full add / edit / delete / participants / report opens the existing
/// `EventPaymentLinksScreen` via "Manage".
class ClubPaymentLinksTab extends StatefulWidget {
  final int clubId;
  const ClubPaymentLinksTab({super.key, required this.clubId});

  @override
  State<ClubPaymentLinksTab> createState() => _ClubPaymentLinksTabState();
}

class _ClubPaymentLinksTabState extends State<ClubPaymentLinksTab>
    with AutomaticKeepAliveClientMixin<ClubPaymentLinksTab> {
  final ApiClient _api = ApiClient();
  late Future<List<Map<String, dynamic>>> _future;
  String _search = '';
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final res = await _api.get(
      '/api/event-payment-links',
      queryParams: {
        'clubId': widget.clubId,
        if (_search.trim().isNotEmpty) 'search': _search.trim(),
      },
      fromJson: (j) => j,
    );
    final raw = res.data;
    final list = raw is List
        ? raw
        : (raw is Map<String, dynamic>
            ? (raw['items'] as List<dynamic>? ?? const [])
            : const []);
    return list
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }

  void _reload() => setState(() => _future = _load());

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _load();
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  Future<void> _openManage() async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => EventPaymentLinksScreen(clubId: widget.clubId)));
    if (mounted) _reload();
  }

  Future<void> _openReport(int id) async {
    final uri = Uri.parse(
        '${ApiConstants.baseUrl}/api/event-payment-links/$id/report');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        final links = snap.data!;
        final total = links.length;
        final active =
            links.where((l) => l['isActive'] == true).length;
        final paid = links.fold<int>(
            0, (s, l) => s + ((l['paidCount'] as int?) ?? 0));
        final unpaid = links.fold<int>(
            0, (s, l) => s + ((l['unpaidCount'] as int?) ?? 0));
        final q = _search.toLowerCase().trim();
        final filtered = q.isEmpty
            ? links
            : links
                .where((l) => ((l['title'] ?? l['name'])?.toString() ?? '')
                    .toLowerCase()
                    .contains(q))
                .toList();

        return DashboardRefresh(
          onRefresh: _refresh,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Payment Links',
                  style: AppFonts.body(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              Text('Online event registrations, payment links & tracking',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate500)),
              const SizedBox(height: 12),
              _kpis(total, active, paid, unpaid),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _openManage,
                icon: const Icon(Icons.add_rounded, size: 16),
                label: Text('Add / Manage Payment Links',
                    style: AppFonts.body(
                        fontSize: 13, fontWeight: FontWeight.w700)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.rotaryBlue,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(vertical: 11),
                  shape: const StadiumBorder(),
                ),
              ),
              const SizedBox(height: 14),
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.slate200),
                ),
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Online Event & Payment Links',
                        style: AppFonts.body(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary)),
                    Text('Showing ${filtered.length} of $total links',
                        style: AppFonts.body(
                            fontSize: 13, color: AppColors.slate500)),
                    const SizedBox(height: 12),
                    _searchField(),
                    const SizedBox(height: 12),
                    if (filtered.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: Text(
                              total == 0
                                  ? 'No payment links yet'
                                  : 'No links match "$_search"',
                              style: AppFonts.body(
                                  fontSize: 13, color: AppColors.slate400)),
                        ),
                      )
                    else
                      Column(
                        children: [
                          for (var i = 0; i < filtered.length; i++) ...[
                            _LinkCard(
                              link: filtered[i],
                              onManage: _openManage,
                              onReport: () =>
                                  _openReport(filtered[i]['id'] as int),
                            ),
                            if (i != filtered.length - 1)
                              const SizedBox(height: 8),
                          ],
                        ],
                      ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _kpis(int total, int active, int paid, int unpaid) {
    final cards = [
      StatCard(
          label: 'Total Links',
          value: '$total',
          sub: 'All payment links',
          accent: AppColors.rotaryBlue),
      StatCard(
          label: 'Active Links',
          value: '$active',
          sub: 'Currently enabled',
          accent: AppColors.statusDone),
      StatCard(
          label: 'Paid',
          value: '$paid',
          sub: 'Across all links',
          accent: AppColors.avenueNewGen),
      StatCard(
          label: 'Unpaid',
          value: '$unpaid',
          sub: 'Pending registrations',
          accent: AppColors.avenuePublicImage),
    ];
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += 2) {
      rows.add(Row(children: [
        Expanded(child: cards[i]),
        const SizedBox(width: 10),
        Expanded(child: cards[i + 1]),
      ]));
      if (i + 2 < cards.length) rows.add(const SizedBox(height: 10));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }

  Widget _searchField() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate50,
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
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _search = v),
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              decoration: InputDecoration(
                hintText: 'Search title…',
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
        ],
      ),
    );
  }
}

class _LinkCard extends StatelessWidget {
  final Map<String, dynamic> link;
  final VoidCallback onManage;
  final VoidCallback onReport;
  const _LinkCard({
    required this.link,
    required this.onManage,
    required this.onReport,
  });

  @override
  Widget build(BuildContext context) {
    final title = (link['title'] ?? link['name'])?.toString() ?? '';
    // Web maps formType==1 → "Standard", else → "Dynamic" (don't print the raw int).
    final typeLabel = link['formType'].toString() == '1' ? 'Standard' : 'Dynamic';
    final isActive = link['isActive'] == true;
    final reg = (link['registrationCount'] as int?) ?? 0;
    final paid = (link['paidCount'] as int?) ?? 0;
    final unpaid = (link['unpaidCount'] as int?) ?? 0;
    final created =
        (link['createdDate'] ?? link['createdAt'] ?? link['created'])
            ?.toString();

    final titleW = Text(title.isEmpty ? 'Untitled link' : title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary));
    final statusPill = Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: isActive ? AppColors.successLight : AppColors.slate100,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(isActive ? 'Active' : 'Inactive',
          style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color:
                  isActive ? AppColors.successDark : AppColors.slate500)),
    );
    final expanded = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        StatGrid(stats: [
          LabeledStat(
              label: 'Paid', value: '$paid', valueColor: AppColors.statusDone),
          LabeledStat(
              label: 'Unpaid',
              value: '$unpaid',
              valueColor: AppColors.warningDark),
          LabeledStat(label: 'Registrations', value: '$reg'),
        ]),
        const SizedBox(height: 8),
        StatGrid(stats: [
          LabeledStat(label: 'Type', value: typeLabel),
          LabeledStat(label: 'Created', value: created ?? ''),
        ]),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton.icon(
              onPressed: onReport,
              icon: const Icon(Icons.assessment_outlined, size: 15),
              label: Text('Report',
                  style: AppFonts.body(
                      fontSize: 13, fontWeight: FontWeight.w700)),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.slate700,
                side: const BorderSide(color: AppColors.slate200),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                minimumSize: const Size(0, 0),
                shape: const StadiumBorder(),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: onManage,
              icon: const Icon(Icons.settings_outlined, size: 15),
              label: Text('Manage',
                  style: AppFonts.body(
                      fontSize: 13, fontWeight: FontWeight.w700)),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.rotaryBlue,
                side: BorderSide(color: AppColors.rotaryBlue.withValues(alpha: 0.4)),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                minimumSize: const Size(0, 0),
                shape: const StadiumBorder(),
              ),
            ),
          ],
        ),
      ],
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: ExpandableRecordCard(
        key: ValueKey(link['id']),
        collapsedTitle: titleW,
        collapsedTrailing: statusPill,
        expandedChild: expanded,
      ),
    );
  }
}
