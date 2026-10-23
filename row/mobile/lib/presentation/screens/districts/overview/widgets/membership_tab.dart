import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/routing/route_names.dart';
import '../../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import 'district_dashboard_async.dart';
import 'stat_card.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Membership" tab of the District Admin dashboard, wired to
/// `GET /api/mobile/district-admin-dashboard/membership` (+ `/members` for the
/// directory). Mirrors the web console's Membership page
/// (`district-admin-dashboard/membership`):
/// Layout (top → bottom):
///   • 4 sub-tab pills (Directory / District Committee / Assistant Governors /
///     Clubs). Directory is inline and reveals the KPIs + Member Directory
///     below; the other three open the standalone screens the normal District
///     dashboard uses.
///   • 3 KPI tiles (Total / New This Year / Terminated) — the web dropped the
///     Goal banner, section header, Active Members KPI and gender breakdown, so
///     we do too.
///   • Member Directory — paged + searchable, wired to the real `/members`
///     endpoint.
class MembershipTab extends StatefulWidget {
  final int districtId;
  final int? yearId;
  const MembershipTab({super.key, required this.districtId, this.yearId});

  @override
  State<MembershipTab> createState() => _MembershipTabState();
}

class _MembershipTabState extends State<MembershipTab>
    with AutomaticKeepAliveClientMixin<MembershipTab> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();
  late Future<DistrictAdminMembership> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getMembership(widget.districtId, yearId: widget.yearId);
  }

  void _reload() => setState(
      () => _future = _api.getMembership(widget.districtId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getMembership(widget.districtId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<DistrictAdminMembership>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const DaLoading();
        }
        if (snap.hasError || !snap.hasData) {
          return DaError(error: snap.error ?? 'No data', onRetry: _reload);
        }
        return DashboardRefresh.around(
          onRefresh: _refresh,
          child: _MembershipBody(
            data: snap.data!,
            districtId: widget.districtId,
            yearId: widget.yearId,
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────────

const List<({String key, String label})> _kSubTabs = [
  (key: 'directors', label: 'Directory'),
  (key: 'district_committee', label: 'District Committee'),
  (key: 'ag', label: 'Assistant Governors'),
  (key: 'clubs', label: 'Clubs'),
];

class _MembershipBody extends StatefulWidget {
  final DistrictAdminMembership data;
  final int districtId;
  final int? yearId;
  const _MembershipBody({
    required this.data,
    required this.districtId,
    required this.yearId,
  });

  @override
  State<_MembershipBody> createState() => _MembershipBodyState();
}

class _MembershipBodyState extends State<_MembershipBody> {
  String _activeKey = 'directors';

  /// Directory stays inline (shows the KPIs + Member Directory below). The other
  /// three pills open the standalone screens the normal District dashboard uses.
  void _onSelect(String key) {
    if (key == 'directors') {
      setState(() => _activeKey = key);
      return;
    }
    final id = widget.districtId;
    final String? route = switch (key) {
      'district_committee' => RouteNames.districtCommittee(id),
      'ag' => RouteNames.districtAg(id),
      'clubs' => RouteNames.districtClubs(id),
      _ => null,
    };
    if (route != null) context.push(route);
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SubTabBar(active: _activeKey, onSelect: _onSelect),
          const SizedBox(height: 14),
          _KpiStrip(d: d),
          const SizedBox(height: 14),
          _MemberDirectory(districtId: widget.districtId, yearId: widget.yearId),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// KPI strip
// ─────────────────────────────────────────────────────────────────────────

class _KpiStrip extends StatelessWidget {
  final DistrictAdminMembership d;
  const _KpiStrip({required this.d});

  @override
  Widget build(BuildContext context) {
    final ry = d.district.yearLabel.isEmpty ? 'this RY' : 'RY ${d.district.yearLabel}';
    // Three KPIs only — Total / New This Year / Terminated — matching the web
    // console's Membership page (the Active Members KPI was removed there too).
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 3,
      crossAxisSpacing: 8,
      mainAxisSpacing: 8,
      childAspectRatio: 0.9,
      children: [
        StatCard(
          label: 'Total Members',
          value: d.totalMembers.toString(),
          sub: 'District-wide',
          accent: AppColors.rotaryBlue,
        ),
        StatCard(
          label: 'New This Year',
          value: d.newMembersThisYear.toString(),
          sub: ry,
          accent: AppColors.avenueNewGen,
          subTone: StatSubTone.up,
        ),
        StatCard(
          label: 'Terminated',
          value: d.terminatedThisYear.toString(),
          sub: ry,
          accent: AppColors.avenueClubService,
          subTone: StatSubTone.down,
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-tab bar
// ─────────────────────────────────────────────────────────────────────────

class _SubTabBar extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _SubTabBar({
    required this.active,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    // Even 2-column grid of equal-width pills — a content-sized Wrap produced
    // ragged, misaligned rows, and the user doesn't want horizontal scrolling.
    // A lone trailing pill (odd count) is centered at the same half width.
    Widget pillFor(int idx) => _SubTabPill(
          label: _kSubTabs[idx].label,
          isActive: _kSubTabs[idx].key == active,
          onTap: () => onSelect(_kSubTabs[idx].key),
        );

    const cols = 2;
    final rows = <Widget>[];
    for (int i = 0; i < _kSubTabs.length; i += cols) {
      final remaining = _kSubTabs.length - i;
      final Widget rowWidget;
      if (remaining == 1) {
        // Single pill: keep it half width but centered in the row.
        rowWidget = Row(
          children: [
            const Spacer(flex: 1),
            Expanded(flex: 2, child: pillFor(i)),
            const Spacer(flex: 1),
          ],
        );
      } else {
        rowWidget = Row(
          children: [
            Expanded(child: pillFor(i)),
            const SizedBox(width: 8),
            Expanded(child: pillFor(i + 1)),
          ],
        );
      }
      if (rows.isNotEmpty) rows.add(const SizedBox(height: 8));
      rows.add(rowWidget);
    }
    return Column(children: rows);
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
      color: isActive ? AppColors.rotaryGold : AppColors.slate100,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isActive ? AppColors.rotaryGold : AppColors.slate200,
            ),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
              color: isActive ? AppColors.primaryDeep : AppColors.slate700,
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Member Directory — wired to /members (paged + search)
// ─────────────────────────────────────────────────────────────────────────

const int _kDirPageSize = 20;

class _MemberDirectory extends StatefulWidget {
  final int districtId;
  final int? yearId;
  const _MemberDirectory({required this.districtId, this.yearId});

  @override
  State<_MemberDirectory> createState() => _MemberDirectoryState();
}

class _MemberDirectoryState extends State<_MemberDirectory> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();
  final TextEditingController _searchCtrl = TextEditingController();
  late Future<DaDirectoryPage> _future;
  Timer? _debounce;
  int _page = 1;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<DaDirectoryPage> _fetch() => _api.getMembers(
        widget.districtId,
        yearId: widget.yearId,
        page: _page,
        pageSize: _kDirPageSize,
        search: _search,
      );

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() {
        _search = v.trim();
        _page = 1;
        _future = _fetch();
      });
    });
  }

  void _goPage(int p) => setState(() {
        _page = p;
        _future = _fetch();
      });

  void _retry() => setState(() => _future = _fetch());

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: FutureBuilder<DaDirectoryPage>(
        future: _future,
        builder: (context, snap) {
          final loading = snap.connectionState != ConnectionState.done;
          final page = snap.data;
          final total = page?.totalCount ?? 0;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(loading, total),
              const Divider(height: 1, color: AppColors.slate100),
              if (loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(
                      child: SizedBox(
                          width: 22,
                          height: 22,
                          child:
                              CircularProgressIndicator(strokeWidth: 2.2))),
                )
              else if (snap.hasError)
                // The /members endpoint can 500 (backend only_full_group_by SQL
                // bug). Degrade to the web's pending copy + retry rather than a
                // hard error, so the section never looks broken.
                _message(
                    'Member directory is pending: backend wiring will populate this list.',
                    retry: true)
              else if (page == null || page.items.isEmpty)
                _emptyMessage()
              else
                _list(page),
              if (!loading &&
                  page != null &&
                  page.items.isNotEmpty &&
                  total > 0)
                _pager(page),
            ],
          );
        },
      ),
    );
  }

  Widget _header(bool loading, int total) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Member Directory',
                style: AppFonts.body(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                loading
                    ? '· …'
                    : '· $total member${total == 1 ? '' : 's'}',
                style: AppFonts.body(
                  fontSize: 11,
                  color: AppColors.slate500,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _searchCtrl,
            onChanged: _onSearchChanged,
            style: AppFonts.body(
                fontSize: 13, color: AppColors.textPrimary),
            decoration: InputDecoration(
              hintText: 'Search name, email or club…',
              hintStyle: AppFonts.body(
                  fontSize: 13, color: AppColors.slate400),
              prefixIcon:
                  const Icon(Icons.search_rounded, size: 18, color: AppColors.slate400),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(9),
                borderSide: const BorderSide(color: AppColors.slate200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(9),
                borderSide: const BorderSide(color: AppColors.slate200),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(9),
                borderSide: const BorderSide(color: AppColors.rotaryBlue),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyMessage() => _search.isNotEmpty
      ? _message('No members match your search.')
      : _message('No members to display for this district yet.');

  Widget _message(String text, {bool retry = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
      child: Column(
        children: [
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 12.5,
              color: AppColors.slate400,
              height: 1.4,
            ),
          ),
          if (retry) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _retry,
              icon: const Icon(Icons.refresh_rounded, size: 15),
              label: Text('Retry',
                  style: AppFonts.body(
                      fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _list(DaDirectoryPage page) {
    return Column(
      children: [
        for (int i = 0; i < page.items.length; i++) ...[
          if (i > 0) const Divider(height: 1, color: AppColors.slate100),
          _MemberRow(member: page.items[i]),
        ],
      ],
    );
  }

  Widget _pager(DaDirectoryPage page) {
    final start = (page.page - 1) * _kDirPageSize + 1;
    final end = (start - 1) + page.items.length;
    final canPrev = page.page > 1;
    final canNext = page.page < page.totalPages;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'Showing $start–$end of ${page.totalCount}',
              style: AppFonts.body(
                  fontSize: 11, color: AppColors.slate500),
            ),
          ),
          _PagerBtn(
            label: 'Prev',
            enabled: canPrev,
            onTap: () => _goPage(page.page - 1),
          ),
          const SizedBox(width: 6),
          Text(
            '${page.page}/${page.totalPages}',
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.slate700,
            ),
          ),
          const SizedBox(width: 6),
          _PagerBtn(
            label: 'Next',
            enabled: canNext,
            onTap: () => _goPage(page.page + 1),
          ),
        ],
      ),
    );
  }
}

class _PagerBtn extends StatelessWidget {
  final String label;
  final bool enabled;
  final VoidCallback onTap;
  const _PagerBtn({
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(7),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: AppColors.slate200),
          color: enabled ? Colors.white : AppColors.slate100,
        ),
        child: Text(
          label,
          style: AppFonts.body(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: enabled ? AppColors.slate700 : AppColors.slate400,
          ),
        ),
      ),
    );
  }
}

class _MemberRow extends StatelessWidget {
  final DaDirectoryMember member;
  const _MemberRow({required this.member});

  @override
  Widget build(BuildContext context) {
    final m = member;
    final contact = [
      if (m.mobile != null) m.mobile!,
      if (m.email != null) m.email!,
    ].join('  ·  ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _Avatar(name: m.name, photoPath: m.photoPath),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  m.name.isEmpty ? '–' : m.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (contact.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    contact,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 10.5,
                      color: AppColors.slate500,
                    ),
                  ),
                ],
                if (m.clubName != null) ...[
                  const SizedBox(height: 1),
                  Text(
                    m.clubName!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 10,
                      color: AppColors.slate400,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (m.role.isNotEmpty) ...[
            const SizedBox(width: 8),
            _RoleChip(role: m.role),
          ],
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String name;
  final String? photoPath;
  const _Avatar({required this.name, required this.photoPath});

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) {
    final url = ApiConstants.mediaUrl(photoPath);
    final fallback = Container(
      width: 34,
      height: 34,
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
    if (url.isEmpty) return fallback;
    return ClipOval(
      child: Image.network(
        url,
        width: 34,
        height: 34,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallback,
        loadingBuilder: (ctx, child, progress) =>
            progress == null ? child : fallback,
      ),
    );
  }
}

class _RoleChip extends StatelessWidget {
  final String role;
  const _RoleChip({required this.role});

  ({Color bg, Color fg}) get _colors {
    final r = role.toLowerCase();
    if (r == 'active') {
      return (bg: AppColors.background, fg: AppColors.successDark);
    }
    if (r == 'member') {
      return (bg: AppColors.muted, fg: AppColors.accentBlue);
    }
    if (r == 'director') {
      return (bg: AppColors.muted, fg: AppColors.primaryPrime);
    }
    if (r.contains('admin')) {
      return (bg: AppColors.muted, fg: AppColors.primaryPrime);
    }
    if (r.contains('ag') || r.contains('governor')) {
      return (bg: AppColors.background, fg: AppColors.warningInk);
    }
    return (bg: AppColors.slate100, fg: AppColors.slate700);
  }

  @override
  Widget build(BuildContext context) {
    final c = _colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        role,
        style: AppFonts.body(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: c.fg,
        ),
      ),
    );
  }
}
