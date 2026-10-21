import 'package:flutter/material.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../../data/models/club_overview_models.dart';
import '../../modules/members/club_members_screen.dart';
import '../../modules/past_presidents/past_presidents_screen.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import '../../../../widgets/common/member_growth_chart.dart';
import '../../../../widgets/common/expandable_record_card.dart';
import 'club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Membership" tab — wired to the live `/membership` endpoint, mirroring the
/// web Membership page (KPIs · Monthly Growth · Recent Joiners · Member
/// Directory). Member CRUD and Past Presidents open the existing module
/// screens (full add / edit / delete) via the header actions.
class ClubMembershipTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubMembershipTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubMembershipTab> createState() => _ClubMembershipTabState();
}

class _ClubMembershipTabState extends State<ClubMembershipTab>
    with AutomaticKeepAliveClientMixin<ClubMembershipTab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminMembership> _future;
  String _search = '';
  int _page = 1;
  static const _pageSize = 8;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getMembership(widget.clubId, yearId: widget.yearId);
  }

  void _reload() =>
      setState(() => _future = _api.getMembership(widget.clubId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch fresh data first, then swap it in so the current
  /// content stays on screen instead of flashing the full-screen loader.
  Future<void> _refresh() async {
    final f = _api.getMembership(widget.clubId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  Future<void> _openManageMembers() async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ClubMembersScreen(clubId: widget.clubId)));
    if (mounted) _reload();
  }

  Future<void> _openPastPresidents() async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PastPresidentsScreen(clubId: widget.clubId)));
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<ClubAdminMembership>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        final m = snap.data!;
        return DashboardRefresh(
          onRefresh: _refresh,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(
                clubName: m.clubName,
                yearLabel: m.yearLabel,
                onManage: _openManageMembers,
                onPastPresidents: _openPastPresidents,
              ),
              const SizedBox(height: 12),
              _kpis(m),
              const SizedBox(height: 14),
              _GrowthCard(growth: m.monthlyTrend),
              const SizedBox(height: 14),
              _RecentJoinersCard(joiners: m.recentJoiners),
              const SizedBox(height: 14),
              _DirectoryCard(
                members: m.members,
                clubName: m.clubName,
                search: _search,
                page: _page,
                pageSize: _pageSize,
                onSearch: (v) => setState(() {
                  _search = v;
                  _page = 1;
                }),
                onPage: (p) => setState(() => _page = p),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _kpis(ClubAdminMembership m) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _statBox('Members', [
          _kpiCell('Total', '${m.totalMembers}', AppColors.rotaryBlue),
          _kpiCell('Male', '${m.maleMembers}', AppColors.avenueInternational),
          _kpiCell('Female', '${m.femaleMembers}', AppColors.avenueClubService),
        ]),
        const SizedBox(height: 10),
        _statBox('This Rotary Year', [
          _kpiCell('New', '${m.newMembersThisYear}', AppColors.avenueNewGen),
          _kpiCell(
              'Terminated', '${m.terminatedThisYear}', AppColors.avenuePublicImage),
        ]),
      ],
    );
  }

  /// A bordered KPI box with a header and a divided row of labeled cells.
  Widget _statBox(String title, List<Widget> cells) {
    final row = <Widget>[];
    for (var i = 0; i < cells.length; i++) {
      row.add(Expanded(child: cells[i]));
      if (i != cells.length - 1) {
        row.add(Container(
            width: 1,
            height: 34,
            margin: const EdgeInsets.symmetric(horizontal: 12),
            color: AppColors.slate100));
      }
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(),
              style: AppFonts.body(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                  color: AppColors.slate500)),
          const SizedBox(height: 10),
          Row(crossAxisAlignment: CrossAxisAlignment.center, children: row),
        ],
      ),
    );
  }

  Widget _kpiCell(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label.toUpperCase(),
            style: AppFonts.body(
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.3,
                color: AppColors.slate500)),
        const SizedBox(height: 4),
        Text(value,
            style: AppFonts.body(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()])),
      ],
    );
  }
}

// ── Header ───────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final String clubName;
  final String yearLabel;
  final VoidCallback onManage;
  final VoidCallback onPastPresidents;
  const _Header({
    required this.clubName,
    required this.yearLabel,
    required this.onManage,
    required this.onPastPresidents,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Membership',
            style: AppFonts.body(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary)),
        Text(
            [
              if (clubName.isNotEmpty) clubName,
              if (yearLabel.isNotEmpty) 'RY $yearLabel',
            ].join(' · '),
            style: AppFonts.body(
                fontSize: 11.5, color: AppColors.slate500)),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: ElevatedButton.icon(
                onPressed: onManage,
                icon: const Icon(Icons.group_rounded, size: 16),
                label: Text('Manage Members',
                    style: AppFonts.body(
                        fontSize: 12, fontWeight: FontWeight.w700)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.rotaryBlue,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(vertical: 11),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onPastPresidents,
                icon: const Icon(Icons.workspace_premium_outlined, size: 16),
                label: Text('Past Presidents',
                    style: AppFonts.body(
                        fontSize: 12, fontWeight: FontWeight.w700)),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.rotaryBlue,
                  side: const BorderSide(color: AppColors.slate200),
                  padding: const EdgeInsets.symmetric(vertical: 11),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// ── Monthly growth ───────────────────────────────────────────────────────────

class _GrowthCard extends StatelessWidget {
  final List<MemberGrowthPoint> growth;
  const _GrowthCard({required this.growth});

  @override
  Widget build(BuildContext context) {
    return _Card(
      title: 'Monthly Growth',
      subtitle: 'New joiners by month · Male / Female / Honorary',
      child: growth.isEmpty
          ? _empty('No monthly data')
          : MemberGrowthChart(growth: growth),
    );
  }
}

// ── Recent joiners ───────────────────────────────────────────────────────────

class _RecentJoinersCard extends StatelessWidget {
  final List<MembershipMemberRow> joiners;
  const _RecentJoinersCard({required this.joiners});

  @override
  Widget build(BuildContext context) {
    return _Card(
      title: 'Recent Joiners',
      subtitle: 'Newest members this year',
      child: joiners.isEmpty
          ? _empty('No recent joiners')
          : Column(
              children: [
                for (var i = 0; i < joiners.length; i++) ...[
                  _joinerCard(joiners[i]),
                  if (i != joiners.length - 1)
                    Container(
                        margin: const EdgeInsets.symmetric(vertical: 4),
                        height: 1,
                        color: AppColors.slate100),
                ],
              ],
            ),
    );
  }

  Widget _joinerCard(MembershipMemberRow m) {
    final title = Text(m.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary));
    final expanded = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if ((m.mobile ?? '').isNotEmpty)
          _contactLine(Icons.phone_rounded, m.mobile!),
        if ((m.email ?? '').isNotEmpty)
          _contactLine(Icons.email_outlined, m.email!),
        if ((m.mobile ?? '').isEmpty && (m.email ?? '').isEmpty)
          Text('No contact details',
              style: AppFonts.body(
                  fontSize: 11, color: AppColors.slate400)),
      ],
    );
    return ExpandableRecordCard(
        key: ValueKey(m.memberId),
        collapsedTitle: title,
        expandedChild: expanded);
  }
}

// ── Member directory ─────────────────────────────────────────────────────────

const _palette = <int>[
  0xFF003DA5, 0xFF16A34A, 0xFFCA8A04, 0xFF9333EA, 0xFF0891B2,
  0xFFE11D48, 0xFFF59E0B, 0xFF64748B, 0xFFB45309, 0xFF0F172A, 0xFF7C3AED,
];

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
  if (parts.isEmpty) return '?';
  final letters = parts.map((p) => p[0]).join();
  return letters.substring(0, letters.length > 2 ? 2 : letters.length).toUpperCase();
}

class _DirectoryCard extends StatelessWidget {
  final List<MembershipMemberRow> members;
  final String clubName;
  final String search;
  final int page;
  final int pageSize;
  final ValueChanged<String> onSearch;
  final ValueChanged<int> onPage;
  const _DirectoryCard({
    required this.members,
    required this.clubName,
    required this.search,
    required this.page,
    required this.pageSize,
    required this.onSearch,
    required this.onPage,
  });

  @override
  Widget build(BuildContext context) {
    final q = search.toLowerCase().trim();
    final filtered = q.isEmpty
        ? members
        : members
            .where((m) =>
                m.name.toLowerCase().contains(q) ||
                (m.email ?? '').toLowerCase().contains(q) ||
                (m.mobile ?? '').contains(search) ||
                (m.rotaryId ?? '').toLowerCase().contains(q))
            .toList();
    final totalPages = (filtered.length / pageSize).ceil().clamp(1, 9999);
    final p = page.clamp(1, totalPages);
    final start = (p - 1) * pageSize;
    final end = (start + pageSize).clamp(0, filtered.length);
    final rows = filtered.sublist(start, end);

    return _Card(
      title: 'Member Directory',
      subtitle: '${clubName.isEmpty ? 'All members' : clubName} · ${members.length} members',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.slate50,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.slate200),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
            child: Row(
              children: [
                const Icon(Icons.search_rounded,
                    size: 16, color: AppColors.slate400),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: TextEditingController(text: search)
                      ..selection =
                          TextSelection.collapsed(offset: search.length),
                    onChanged: onSearch,
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.textPrimary),
                    decoration: InputDecoration(
                      hintText: 'Search name, ID, email or mobile…',
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
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text(
                    search.isEmpty
                        ? 'No members'
                        : 'No members match "$search"',
                    style: AppFonts.body(
                        fontSize: 12, color: AppColors.slate400)),
              ),
            )
          else
            Column(
              children: [
                for (var i = 0; i < rows.length; i++)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      color: AppColors.slate50,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.slate200),
                    ),
                    child: _memberCard(rows[i], start + i),
                  ),
              ],
            ),
          if (filtered.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: Text(
                        'Showing ${start + 1}–$end of ${filtered.length}',
                        style: AppFonts.body(
                            fontSize: 11, color: AppColors.slate500),
                        overflow: TextOverflow.ellipsis),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _navBtn('‹', p > 1, () => onPage(p - 1)),
                      const SizedBox(width: 6),
                      Text('$p / $totalPages',
                          style: AppFonts.body(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary)),
                      const SizedBox(width: 6),
                      _navBtn('›', p < totalPages, () => onPage(p + 1)),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _memberCard(MembershipMemberRow m, int idx) {
    final color = Color(_palette[idx % _palette.length]);
    final title = Row(
      children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration:
              BoxDecoration(color: color, borderRadius: BorderRadius.circular(9)),
          child: Text(_initials(m.name),
              style: AppFonts.body(
                  fontSize: 12, fontWeight: FontWeight.w800, color: Colors.white)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(m.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.rotaryBlue)),
        ),
      ],
    );
    final expanded = Padding(
      padding: const EdgeInsets.only(left: 44),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if ((m.mobile ?? '').isNotEmpty)
            _contactLine(Icons.phone_rounded, m.mobile!),
          if ((m.email ?? '').isNotEmpty)
            _contactLine(Icons.email_outlined, m.email!),
          if ((m.mobile ?? '').isEmpty && (m.email ?? '').isEmpty)
            Text('No contact details',
                style: AppFonts.body(
                    fontSize: 11, color: AppColors.slate400)),
        ],
      ),
    );
    return ExpandableRecordCard(
        key: ValueKey(m.memberId),
        collapsedTitle: title,
        expandedChild: expanded);
  }

  Widget _navBtn(String label, bool enabled, VoidCallback onTap) {
    return Opacity(
      opacity: enabled ? 1.0 : 0.35,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 30,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Text(label,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate500)),
        ),
      ),
    );
  }
}

// ── shared card shell + empty ────────────────────────────────────────────────

class _Card extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget child;
  const _Card(
      {required this.title, required this.subtitle, required this.child});

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
            Text(subtitle,
                style: AppFonts.body(
                    fontSize: 11, color: AppColors.slate500)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

Widget _empty(String text) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(text,
          style: AppFonts.body(
              fontSize: 12, color: AppColors.slate400)),
    );

/// Icon + value contact line used inside the expanded member / joiner cards.
Widget _contactLine(IconData icon, String value) => Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Icon(icon, size: 13, color: AppColors.slate400),
          const SizedBox(width: 6),
          Expanded(
            child: Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                    fontSize: 11.5, color: AppColors.slate500)),
          ),
        ],
      ),
    );
