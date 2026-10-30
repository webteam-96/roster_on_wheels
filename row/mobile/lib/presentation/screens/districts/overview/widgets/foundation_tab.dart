import 'package:flutter/material.dart' hide Text;
import '../../../../../core/theme/app_colors.dart';
import '../../modules/district_events_screen.dart';
import '../../modules/district_projects_screen.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Foundation" tab of the District Admin dashboard.
///
/// Mirrors the web `district-admin-dashboard/foundation` page:
///   • a row of TRF summary KPIs (all "Coming Soon", same four as the web), and
///   • two sub-tabs — District Projects / District Events — each of which shows
///     the real, fully-manageable listing (add / edit / delete / paginate),
///     exactly like the web's embedded `DistrictProjectsSection` /
///     `DistrictEventsSection`.
///
/// The web's "District Foundation" section header and the "Set District
/// Foundation Collection Goals" banner are intentionally NOT rendered on mobile
/// (the dashboard already has its own app bar + year selector). The KPI cards
/// stay because the web still shows them.
class FoundationTab extends StatefulWidget {
  final int districtId;
  final int? yearId;
  const FoundationTab({super.key, required this.districtId, this.yearId});

  @override
  State<FoundationTab> createState() => _FoundationTabState();
}

class _FoundationTabState extends State<FoundationTab>
    with AutomaticKeepAliveClientMixin<FoundationTab> {
  // 'projects' | 'events' — matches the web's `topTab` (defaults to projects).
  String _topTab = 'projects';

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    // Projects/Events pill bar only — the TRF summary KPIs (Total Giving /
    // Annual Fund / Polio Fund / Major Donors) are intentionally omitted so the
    // tab goes straight to the District Projects / District Events listings.
    // Handed to the embedded module screen as a scroll-away header so the whole
    // tab is one scroll; tab switching stays reachable by scrolling back up.
    final header = Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
      child: _TopTabBar(
        active: _topTab,
        onSelect: (k) => setState(() => _topTab = k),
      ),
    );

    // The two sub-tabs embed the real district Projects / Events screens (app
    // bar suppressed via `embedded`, own year bar suppressed via `fixedYearId`
    // so the year comes from the district dashboard's global selector). Search,
    // pagination, add/edit/delete and the +Add FAB are unchanged.
    return _topTab == 'projects'
        ? DistrictProjectsScreen(
            key: const ValueKey('foundation-projects'),
            districtId: widget.districtId,
            embedded: true,
            fixedYearId: widget.yearId,
            header: header,
          )
        : DistrictEventsScreen(
            key: const ValueKey('foundation-events'),
            districtId: widget.districtId,
            embedded: true,
            fixedYearId: widget.yearId,
            header: header,
          );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-tab bar (District Projects / District Events)
// ─────────────────────────────────────────────────────────────────────────

class _TopTabBar extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _TopTabBar({required this.active, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          Expanded(
            child: _TabPill(
              label: 'District Projects',
              icon: Icons.assignment_rounded,
              isActive: active == 'projects',
              onTap: () => onSelect('projects'),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: _TabPill(
              label: 'District Events',
              icon: Icons.event_rounded,
              isActive: active == 'events',
              onTap: () => onSelect('events'),
            ),
          ),
        ],
      ),
    );
  }
}

class _TabPill extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool isActive;
  final VoidCallback onTap;
  const _TabPill({
    required this.label,
    required this.icon,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isActive ? AppColors.rotaryBlue : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon,
                  size: 15,
                  color: isActive ? Colors.white : AppColors.slate500),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
                    color: isActive ? Colors.white : AppColors.slate500,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
