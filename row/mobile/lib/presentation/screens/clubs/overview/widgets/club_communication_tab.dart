import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../modules/announcements/announcements_screen.dart';
import '../../modules/newsletters/newsletters_screen.dart';
import '../../modules/documents/documents_screen.dart';
import '../../modules/upcoming_events/upcoming_events_screen.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import 'club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Communication" hub — mirrors the web Communication landing and the District
/// dashboard's Communication tab: a compact, mobile-friendly icon-led KPI strip
/// plus a **sub-tab bar** (Upcoming Events / Announcements / Greetings /
/// Documents / Newsletters). Each tab embeds the FULL module screen inline
/// (its own search / status filter / add-FAB / edit / delete), so the buttons
/// are right there — no "View All" hop. Greetings is a read-only list
/// (auto-generated from member birthdays/anniversaries, Today/Week/Month) with
/// call shortcuts. Counts come from the live `/communication`
/// endpoint.
class ClubCommunicationTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubCommunicationTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubCommunicationTab> createState() => _ClubCommunicationTabState();
}

class _ClubCommunicationTabState extends State<ClubCommunicationTab>
    with AutomaticKeepAliveClientMixin<ClubCommunicationTab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminCommunication> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getCommunication(widget.clubId, yearId: widget.yearId);
  }

  void _reload() => setState(() =>
      _future = _api.getCommunication(widget.clubId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getCommunication(widget.clubId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<ClubAdminCommunication>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError || !snap.hasData) {
          return ClubDashboardError(
              error: snap.error ?? 'No data', onRetry: _reload);
        }
        return _CommunicationBody(
          data: snap.data!,
          clubId: widget.clubId,
          onRefresh: _refresh,
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────────

const List<({String key, String label})> _kCommSubTabs = [
  (key: 'events', label: 'Upcoming Events'),
  (key: 'announcements', label: 'Announcements'),
  (key: 'greetings', label: 'Greetings'),
  (key: 'documents', label: 'Documents'),
  (key: 'newsletters', label: 'Newsletters'),
];

class _CommunicationBody extends StatefulWidget {
  final ClubAdminCommunication data;
  final int clubId;
  final Future<void> Function() onRefresh;
  const _CommunicationBody({
    required this.data,
    required this.clubId,
    required this.onRefresh,
  });

  @override
  State<_CommunicationBody> createState() => _CommunicationBodyState();
}

class _CommunicationBodyState extends State<_CommunicationBody> {
  String _active = 'events';

  void _select(String key) => setState(() => _active = key);

  @override
  Widget build(BuildContext context) {
    final c = widget.data;
    // NestedScrollView so the KPI strip + sub-tab bar scroll AWAY as the active
    // tab's list scrolls up (they'd otherwise stay pinned and eat the screen).
    return NestedScrollView(
      headerSliverBuilder: (context, _) => [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: _KpiStrip(
              upcomingEvents: c.upcomingEventCount,
              announcements: c.announcementCount,
              newsletters: c.newsletterCount,
              documents: c.documentCount,
              greetingsToday: c.greetingsTodayCount,
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: _SubTabBar(active: _active, onSelect: _select),
          ),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 10)),
      ],
      body: _activeTab(c),
    );
  }

  Widget _activeTab(ClubAdminCommunication c) {
    final id = widget.clubId;
    switch (_active) {
      case 'announcements':
        return AnnouncementsScreen(
            key: const ValueKey('comm-announcements'),
            clubId: id,
            embedded: true);
      case 'greetings':
        return DashboardRefresh(
          onRefresh: widget.onRefresh,
          padding: const EdgeInsets.fromLTRB(12, 2, 12, 24),
          child: _GreetingsCard(
            birthdays: c.birthdaysThisMonth,
            anniversaries: c.anniversariesThisMonth,
          ),
        );
      case 'documents':
        return DocumentsScreen(
            key: const ValueKey('comm-documents'), clubId: id, embedded: true);
      case 'newsletters':
        return NewslettersScreen(
            key: const ValueKey('comm-newsletters'),
            clubId: id,
            embedded: true);
      case 'events':
      default:
        return UpcomingEventsScreen(
            key: const ValueKey('comm-events'), clubId: id, embedded: true);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-tab bar
// ─────────────────────────────────────────────────────────────────────────

class _SubTabBar extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _SubTabBar({required this.active, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          for (final t in _kCommSubTabs)
            _SubTabPill(
              label: t.label,
              isActive: t.key == active,
              onTap: () => onSelect(t.key),
            ),
        ],
      ),
    );
  }
}

class _SubTabPill extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;
  const _SubTabPill({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isActive ? AppColors.rotaryGold : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
              color: isActive ? AppColors.primaryDeep : AppColors.slate500,
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5 KPI tiles — compact, mobile-friendly (icon-led)
// ─────────────────────────────────────────────────────────────────────────

class _KpiStrip extends StatelessWidget {
  final int upcomingEvents;
  final int announcements;
  final int newsletters;
  final int documents;
  final int greetingsToday;
  const _KpiStrip({
    required this.upcomingEvents,
    required this.announcements,
    required this.newsletters,
    required this.documents,
    required this.greetingsToday,
  });

  @override
  Widget build(BuildContext context) {
    // Icon-led KPI tiles in a 2-across grid: a tinted 38×38 icon chip on the
    // left, big value + short label on the right. Clean and compact — matches
    // the app's OCV-GOV / District Awards design language and reads far better
    // than a flat block of numbers.
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      crossAxisSpacing: 10,
      mainAxisSpacing: 10,
      childAspectRatio: 2.55,
      children: [
        _MiniKpi(
          icon: Icons.event_rounded,
          label: 'Upcoming Events',
          value: upcomingEvents.toString(),
          accent: AppColors.rotaryBlue,
        ),
        _MiniKpi(
          icon: Icons.campaign_rounded,
          label: 'Announcements',
          value: announcements.toString(),
          accent: AppColors.avenueNewGen,
        ),
        _MiniKpi(
          icon: Icons.newspaper_rounded,
          label: 'Newsletters',
          value: newsletters.toString(),
          accent: AppColors.success,
        ),
        _MiniKpi(
          icon: Icons.folder_rounded,
          label: 'Documents',
          value: documents.toString(),
          accent: AppColors.rotaryGold,
        ),
        _MiniKpi(
          icon: Icons.celebration_rounded,
          label: 'Greetings Today',
          value: greetingsToday.toString(),
          accent: AppColors.avenueClubService,
        ),
      ],
    );
  }
}

/// Icon-led KPI tile: tinted icon chip · big value · short label.
class _MiniKpi extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color accent;
  const _MiniKpi({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 19, color: accent),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  value,
                  style: AppFonts.body(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    height: 1.0,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.slate500,
                    height: 1.15,
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

// ── Greetings card (birthdays + anniversaries · Today / Week / Month) ─────────

class _GreetingsCard extends StatefulWidget {
  final List<CommGreetingRow> birthdays;
  final List<CommGreetingRow> anniversaries;
  const _GreetingsCard({
    required this.birthdays,
    required this.anniversaries,
  });

  @override
  State<_GreetingsCard> createState() => _GreetingsCardState();
}

class _GreetingsCardState extends State<_GreetingsCard> {
  int _seg = 0; // 0 = Today, 1 = This Week, 2 = This Month
  static const _segs = ['Today', 'This Week', 'This Month'];

  List<CommGreetingRow> get _all {
    final list = [...widget.birthdays, ...widget.anniversaries];
    list.sort((a, b) {
      final d = a.day.compareTo(b.day);
      return d != 0 ? d : a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return list;
  }

  List<CommGreetingRow> _filtered() {
    final today = DateTime.now().day;
    final all = _all;
    switch (_seg) {
      case 0:
        return all.where((g) => g.day == today).toList();
      case 1:
        return all.where((g) => g.day >= today && g.day <= today + 6).toList();
      default:
        return all;
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _filtered();
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.celebration_rounded,
                  size: 16, color: AppColors.rotaryBlue),
              const SizedBox(width: 6),
              Text('Greetings',
                  style: AppFonts.body(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: AppColors.slate100,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text('${items.length}',
                    style: AppFonts.body(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.slate500)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: AppColors.slate100,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                for (var i = 0; i < _segs.length; i++)
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _seg = i),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color:
                              _seg == i ? Colors.white : Colors.transparent,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          _segs[i],
                          textAlign: TextAlign.center,
                          style: AppFonts.body(
                            fontSize: 11,
                            fontWeight:
                                _seg == i ? FontWeight.w800 : FontWeight.w600,
                            color: _seg == i
                                ? AppColors.rotaryBlue
                                : AppColors.slate500,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Wrap(
              spacing: 14,
              runSpacing: 6,
              children: [
                _greetLegend(
                    AppColors.accentBlue, Icons.cake_rounded, 'Birthday'),
                _greetLegend(AppColors.accentBlue,
                    Icons.favorite_rounded, 'Anniversary'),
              ],
            ),
          ),
          if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Center(
                child: Text(
                  _seg == 0
                      ? 'No greetings today'
                      : _seg == 1
                          ? 'No greetings this week'
                          : 'No greetings this month',
                  style: AppFonts.body(
                      fontSize: 12, color: AppColors.slate400),
                ),
              ),
            )
          else
            for (var i = 0; i < items.length; i++) ...[
              _GreetingRow(row: items[i]),
              if (i != items.length - 1)
                Container(
                    margin: const EdgeInsets.symmetric(vertical: 8),
                    height: 1,
                    color: AppColors.slate100),
            ],
        ],
      ),
    );
  }

  Widget _greetLegend(Color c, IconData icon, String t) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: c),
          const SizedBox(width: 4),
          Text(t,
              style: AppFonts.body(
                  fontSize: 10.5, color: AppColors.slate500)),
        ],
      );
}

class _GreetingRow extends StatelessWidget {
  final CommGreetingRow row;
  const _GreetingRow({required this.row});

  static const _birthdayColor = AppColors.accentBlue;
  static const _anniversaryColor = AppColors.accentBlue;

  @override
  Widget build(BuildContext context) {
    final color = row.isAnniversary ? _anniversaryColor : _birthdayColor;
    final mobile = (row.mobile ?? '').trim();
    return Row(
      children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            '${row.day}',
            style: AppFonts.body(
                fontSize: 13, fontWeight: FontWeight.w800, color: color),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(row.name,
                  style: AppFonts.body(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
              Row(
                children: [
                  Icon(
                      row.isAnniversary
                          ? Icons.favorite_rounded
                          : Icons.cake_rounded,
                      size: 11,
                      color: color),
                  const SizedBox(width: 3),
                  Text(
                    row.isAnniversary ? 'Anniversary' : 'Birthday',
                    style: AppFonts.body(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: color),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (mobile.isNotEmpty) ...[
          const SizedBox(width: 4),
          _contactBtn(
              const Icon(Icons.call_rounded,
                  size: 18, color: AppColors.statusDone),
              'Call',
              () => launchUrl(Uri(scheme: 'tel', path: mobile))),
        ],
      ],
    );
  }

  Widget _contactBtn(Widget icon, String tooltip, VoidCallback onTap) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(padding: const EdgeInsets.all(6), child: icon),
      ),
    );
  }
}
