import 'package:flutter/material.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import '../../modules/district_announcements_screen.dart';
import '../../modules/district_documents_screen.dart';
import '../../modules/district_newsletters_screen.dart';
import '../../modules/district_upcoming_events_screen.dart';
import 'district_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Communication" tab of the District Admin dashboard.
///
/// Compact KPI strip (from `GET .../communication`) + a sub-tab bar whose five
/// tabs each host the FULL module surface — District Events, Announcements,
/// Newsletters and Documents embed their real management screens (search,
/// status filter, add via FAB, edit/delete). Greetings is a read-only list
/// (auto-generated from member birthdays/anniversaries) with a Today/Week/Month
/// filter — nothing to add or edit there.
class CommunicationTab extends StatefulWidget {
  final int districtId;
  final int? yearId;
  const CommunicationTab({super.key, required this.districtId, this.yearId});

  @override
  State<CommunicationTab> createState() => _CommunicationTabState();
}

class _CommunicationTabState extends State<CommunicationTab>
    with AutomaticKeepAliveClientMixin<CommunicationTab> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();
  late Future<DistrictAdminCommunication> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getCommunication(widget.districtId, yearId: widget.yearId);
  }

  void _reload() => setState(
      () => _future = _api.getCommunication(widget.districtId, yearId: widget.yearId));

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<DistrictAdminCommunication>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const DaLoading();
        }
        if (snap.hasError || !snap.hasData) {
          return DaError(error: snap.error ?? 'No data', onRetry: _reload);
        }
        return _CommunicationBody(
          data: snap.data!,
          districtId: widget.districtId,
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────────

const List<({String key, String label})> _kCommSubTabs = [
  (key: 'events', label: 'District Events'),
  (key: 'announcements', label: 'Announcements'),
  (key: 'greetings', label: 'Greetings'),
  (key: 'newsletters', label: 'Newsletters'),
  (key: 'documents', label: 'Documents'),
];

class _CommunicationBody extends StatefulWidget {
  final DistrictAdminCommunication data;
  final int districtId;
  const _CommunicationBody({required this.data, required this.districtId});

  @override
  State<_CommunicationBody> createState() => _CommunicationBodyState();
}

class _CommunicationBodyState extends State<_CommunicationBody> {
  String _active = 'events';

  void _select(String key) => setState(() => _active = key);

  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    final docCount =
        d.documentCount != 0 ? d.documentCount : d.documents.length;
    final greetToday = d.greetingsTodayCount != 0
        ? d.greetingsTodayCount
        : d.greetings.where((g) => g.bucket == 'today').length;

    // NestedScrollView so the KPI strip + sub-tab bar scroll AWAY as the active
    // tab's list scrolls up (they'd otherwise stay pinned and eat the screen).
    // The body hosts the full embedded module screen (its own search / status
    // filter / add-FAB / edit / delete), or the read-only Greetings list.
    return NestedScrollView(
      headerSliverBuilder: (context, _) => [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: _KpiStrip(
              upcomingEvents: d.upcomingEventCount,
              announcements: d.announcementCount,
              newsletters: d.newsletterCount,
              documents: docCount,
              greetingsToday: greetToday,
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
      body: _activeTab(d),
    );
  }

  Widget _activeTab(DistrictAdminCommunication d) {
    final id = widget.districtId;
    switch (_active) {
      case 'announcements':
        return DistrictAnnouncementsScreen(
            key: const ValueKey('comm-announcements'),
            districtId: id,
            embedded: true);
      case 'greetings':
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(12, 2, 12, 24),
          child: _GreetingsSection(greetings: d.greetings),
        );
      case 'newsletters':
        return DistrictNewslettersScreen(
            key: const ValueKey('comm-newsletters'),
            districtId: id,
            embedded: true);
      case 'documents':
        return DistrictDocumentsScreen(
            key: const ValueKey('comm-documents'),
            districtId: id,
            embedded: true);
      case 'events':
      default:
        return DistrictUpcomingEventsScreen(
            key: const ValueKey('comm-events'),
            districtId: id,
            embedded: true);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-tab bar (District Events / Announcements / Greetings / Documents)
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
// 5 KPI tiles — compact, mobile-friendly
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

// ─────────────────────────────────────────────────────────────────────────
// Shared section shell (white card with icon + title + count badge header)
// ─────────────────────────────────────────────────────────────────────────

class _SectionShell extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final Widget child;
  const _SectionShell({
    required this.icon,
    required this.iconColor,
    required this.title,
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
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Row(
              children: [
                Icon(icon, size: 17, color: iconColor),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const Spacer(),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.slate100),
          child,
        ],
      ),
    );
  }
}

class _EmptyBody extends StatelessWidget {
  final IconData icon;
  final Color tint;
  final String text;
  const _EmptyBody({required this.icon, required this.tint, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 20),
      child: Column(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: tint.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 20, color: tint),
          ),
          const SizedBox(height: 10),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 12,
              color: AppColors.slate400,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Greetings section (Today / Week / Month)
// ─────────────────────────────────────────────────────────────────────────

class _GreetingsSection extends StatefulWidget {
  final List<DaGreeting> greetings;
  const _GreetingsSection({required this.greetings});

  @override
  State<_GreetingsSection> createState() => _GreetingsSectionState();
}

class _GreetingsSectionState extends State<_GreetingsSection> {
  String _bucket = 'today'; // today | week | month

  bool _matches(DaGreeting g) {
    switch (_bucket) {
      case 'today':
        return g.bucket == 'today';
      case 'week':
        return g.bucket == 'today' || g.bucket == 'this_week';
      case 'month':
        return g.bucket == 'today' ||
            g.bucket == 'this_week' ||
            g.bucket == 'next_week';
      default:
        return true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = widget.greetings.where(_matches).toList();
    return _SectionShell(
      icon: Icons.celebration_rounded,
      iconColor: AppColors.avenueClubService,
      title: 'Greetings',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
            child: Row(
              children: [
                for (final t in const [
                  ('today', 'Today'),
                  ('week', 'Week'),
                  ('month', 'Month'),
                ]) ...[
                  Expanded(
                    child: _SegPill(
                      label: t.$2,
                      active: _bucket == t.$1,
                      onTap: () => setState(() => _bucket = t.$1),
                    ),
                  ),
                  if (t.$1 != 'month') const SizedBox(width: 6),
                ],
              ],
            ),
          ),
          if (filtered.isEmpty)
            const _EmptyBody(
              icon: Icons.celebration_rounded,
              tint: AppColors.avenueClubService,
              text: 'No greetings in this period.',
            )
          else
            for (int i = 0; i < filtered.length; i++) ...[
              if (i > 0) const Divider(height: 1, color: AppColors.slate100),
              _GreetingRow(greeting: filtered[i]),
            ],
        ],
      ),
    );
  }
}

class _SegPill extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _SegPill({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? AppColors.rotaryGold : AppColors.slate100,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 7),
          child: Center(
            child: Text(
              label,
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                color: active ? AppColors.primaryDeep : AppColors.slate500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _GreetingRow extends StatelessWidget {
  final DaGreeting greeting;
  const _GreetingRow({required this.greeting});

  String get _initials {
    final parts =
        greeting.name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) {
    final g = greeting;
    final url = ApiConstants.mediaUrl(g.photoPath);
    final fallback = Container(
      width: 36,
      height: 36,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.slate100,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.slate200),
      ),
      child: Text(
        _initials.isEmpty ? '?' : _initials,
        style: AppFonts.body(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          color: AppColors.slate500,
        ),
      ),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      child: Row(
        children: [
          if (url.isEmpty)
            fallback
          else
            ClipOval(
              child: Image.network(
                url,
                width: 36,
                height: 36,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => fallback,
                loadingBuilder: (ctx, child, p) => p == null ? child : fallback,
              ),
            ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  g.name.isEmpty ? '–' : g.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (g.clubName != null) ...[
                  const SizedBox(height: 1),
                  Text(
                    g.clubName!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 10,
                      color: AppColors.slate500,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          _GreetingKindBadge(kind: g.kind),
        ],
      ),
    );
  }
}

class _GreetingKindBadge extends StatelessWidget {
  final String kind;
  const _GreetingKindBadge({required this.kind});

  @override
  Widget build(BuildContext context) {
    final isBirthday = kind.toLowerCase() == 'birthday';
    final bg = isBirthday ? AppColors.background : AppColors.muted;
    final fg = isBirthday ? AppColors.warningInk : AppColors.errorDark;
    final icon = isBirthday ? Icons.cake_rounded : Icons.favorite_rounded;
    final label = isBirthday ? 'Birthday' : 'Anniversary';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: fg),
          const SizedBox(width: 3),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              color: fg,
            ),
          ),
        ],
      ),
    );
  }
}

