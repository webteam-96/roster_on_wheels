import 'package:flutter/material.dart' hide Text;
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import '../../../../core/utils/money_format.dart';
import '../ag_project_detail_screen.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Service Projects" tab — wired to `GET /api/mobile/ag-dashboard/projects`.
///
/// Layout:
///   1. Header (title + subtitle)
///   2. 4 KPI cards (Total Projects / Beneficiaries / Man Hours / Cost)
///   3. AG Group Impact summary banner (blue gradient)
///   4. Projects by Club — horizontal bars (gold = top club)
///   5. Monthly Projects Trend — vertical mini-bars (gold = peak month)
///   6. Detailed projects table (search + client pagination)
class AgServiceProjectsTab extends StatefulWidget {
  final int? yearId;
  const AgServiceProjectsTab({super.key, this.yearId});

  @override
  State<AgServiceProjectsTab> createState() => _AgServiceProjectsTabState();
}

class _AgServiceProjectsTabState extends State<AgServiceProjectsTab>
    with AutomaticKeepAliveClientMixin<AgServiceProjectsTab> {
  static const int _pageSize = 20;

  // Avenue filter sentinels: "all" (no filter) and "none" (blank-avenue rows).
  static const String _kAllAvenues = '__all__';
  static const String _kNoAvenue = '__none__';

  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgProjectsResponse> _future;
  String _search = '';
  String _avenue = _kAllAvenues;
  int _page = 0;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getProjects(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgServiceProjectsTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() {
        _future = _api.getProjects(yearId: widget.yearId);
        _page = 0;
        _avenue = _kAllAvenues;
      });
    }
  }

  void _reload() => setState(() {
        _future = _api.getProjects(yearId: widget.yearId);
        _page = 0;
      });

  /// Default-newest-first sort (rows with a date come first, descending).
  List<AgProjectRow> _sortedNewest(List<AgProjectRow> rows) {
    final list = [...rows];
    list.sort((a, b) {
      final da = a.date ?? '';
      final db = b.date ?? '';
      return db.compareTo(da);
    });
    return list;
  }

  List<AgProjectRow> _filtered(List<AgProjectRow> rows) {
    Iterable<AgProjectRow> out = rows;
    // Avenue filter (mirrors web: "all" = no filter, "(none)" = blank avenue,
    // else exact match on the trimmed avenue).
    if (_avenue == _kNoAvenue) {
      out = out.where((p) => (p.avenue ?? '').trim().isEmpty);
    } else if (_avenue != _kAllAvenues) {
      out = out.where((p) => (p.avenue ?? '').trim() == _avenue);
    }
    final q = _search.toLowerCase().trim();
    if (q.isNotEmpty) {
      out = out.where((p) =>
          p.title.toLowerCase().contains(q) ||
          p.clubName.toLowerCase().contains(q));
    }
    return out.toList();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgProjectsResponse>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const AgLoading();
        }
        if (snap.hasError) {
          return AgError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;

        // Distinct clubs across all project rows.
        final distinctClubs =
            data.projects.map((p) => p.clubId).toSet().length;

        // Avenue options are DERIVED from the on-screen data (sorted), plus a
        // "(No avenue set)" bucket when any row has a blank avenue.
        final avenueOptions = <String>{
          for (final p in data.projects)
            if ((p.avenue ?? '').trim().isNotEmpty) p.avenue!.trim()
        }.toList()
          ..sort();
        final hasBlankAvenue =
            data.projects.any((p) => (p.avenue ?? '').trim().isEmpty);
        // Guard: if the selected avenue vanished (year switch), fall back to all.
        if (_avenue != _kAllAvenues &&
            _avenue != _kNoAvenue &&
            !avenueOptions.contains(_avenue)) {
          _avenue = _kAllAvenues;
        }

        final allSorted = _sortedNewest(data.projects);
        final filtered = _filtered(allSorted);
        final pageCount =
            filtered.isEmpty ? 1 : ((filtered.length - 1) ~/ _pageSize) + 1;
        final page = _page.clamp(0, pageCount - 1);
        final start = page * _pageSize;
        final end = (start + _pageSize) > filtered.length
            ? filtered.length
            : (start + _pageSize);
        final pageRows = filtered.isEmpty ? <AgProjectRow>[] : filtered.sublist(start, end);

        // Stable per-club index for color chips (by first appearance order).
        final clubIndex = <int, int>{};
        for (final p in data.projects) {
          clubIndex.putIfAbsent(p.clubId, () => clubIndex.length);
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _Header(),
              const SizedBox(height: 14),
              _KpiStrip(data: data, distinctClubs: distinctClubs),
              const SizedBox(height: 14),
              _ImpactBanner(data: data),
              const SizedBox(height: 14),
              _ProjectsByClubCard(counts: data.clubProjectCounts),
              const SizedBox(height: 14),
              _MonthlyTrendCard(counts: data.monthlyProjectCounts),
              const SizedBox(height: 14),
              _ProjectsTable(
                rows: pageRows,
                clubIndex: clubIndex,
                shownCount: filtered.length,
                totalCount: data.projects.length,
                search: _search,
                onSearchChanged: (v) => setState(() {
                  _search = v;
                  _page = 0;
                }),
                avenue: _avenue,
                avenueOptions: avenueOptions,
                hasBlankAvenue: hasBlankAvenue,
                allValue: _kAllAvenues,
                noneValue: _kNoAvenue,
                onAvenueChanged: (v) => setState(() {
                  _avenue = v;
                  _page = 0;
                }),
                fallbackYearId: widget.yearId,
                page: page,
                pageCount: pageCount,
                onPrev: page > 0 ? () => setState(() => _page = page - 1) : null,
                onNext: page < pageCount - 1
                    ? () => setState(() => _page = page + 1)
                    : null,
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Header
// ─────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.avenueVocational.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(Icons.work_outline_rounded,
              size: 18, color: AppColors.avenueVocational),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Service Projects',
                style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              Text(
                'Project activity, community impact, and monthly trends across your AG group',
                style: AppFonts.body(
                  fontSize: 11,
                  color: AppColors.slate500,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. KPI strip (2×2)
// ─────────────────────────────────────────────────────────────────────────

class _KpiStrip extends StatelessWidget {
  final AgProjectsResponse data;
  final int distinctClubs;
  const _KpiStrip({required this.data, required this.distinctClubs});

  @override
  Widget build(BuildContext context) {
    final manHoursPending = data.manHoursPending;
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _KpiTile(
                icon: Icons.work_outline_rounded,
                label: 'Total Projects',
                value: agFmtInt(data.totalProjects),
                sub:
                    'Across $distinctClubs club${distinctClubs == 1 ? "" : "s"}',
                color: AppColors.rotaryBlue,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiTile(
                icon: Icons.favorite_rounded,
                label: 'Total Beneficiaries',
                value: agFmtInt(data.totalBeneficiaries),
                sub: 'People directly served',
                color: AppColors.statusDone,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _KpiTile(
                icon: Icons.access_time_rounded,
                label: 'Total Man Hours',
                value: manHoursPending ? 'Pending' : agFmtInt(data.totalManHours),
                sub: manHoursPending
                    ? 'Awaiting data column'
                    : 'Volunteer time logged',
                color: AppColors.avenueNewGen,
                muted: manHoursPending,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiTile(
                icon: Icons.payments_rounded,
                label: 'Total Cost (${data.targetCurrency})',
                value: formatMoney(data.totalCost, data.targetCurrency),
                sub: 'Combined project spend',
                color: AppColors.goldPrime,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _KpiTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String sub;
  final Color color;
  final bool muted;
  const _KpiTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.sub,
    required this.color,
    this.muted = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 26,
                height: 26,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Icon(icon, size: 13, color: color),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate500,
                    letterSpacing: 0.4,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: AppFonts.body(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: muted ? AppColors.slate400 : AppColors.textPrimary,
              height: 1.0,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 4),
          Text(
            sub,
            style: AppFonts.body(
              fontSize: 10,
              color: AppColors.slate400,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Impact banner
// ─────────────────────────────────────────────────────────────────────────

class _ImpactBanner extends StatelessWidget {
  final AgProjectsResponse data;
  const _ImpactBanner({required this.data});

  @override
  Widget build(BuildContext context) {
    final manHoursPending = data.manHoursPending;
    final year = data.ag.yearLabel.isEmpty ? '–' : data.ag.yearLabel;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: AppColors.primaryDeep,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'AG GROUP IMPACT SUMMARY',
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: Colors.white.withValues(alpha: 0.7),
                    letterSpacing: 0.8,
                  ),
                ),
              ),
              Text(
                'RY $year',
                style: AppFonts.body(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  color: Colors.white.withValues(alpha: 0.7),
                  letterSpacing: 0.4,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _ImpactTile(
                  icon: Icons.work_outline_rounded,
                  value: agFmtInt(data.totalProjects),
                  label: 'Total Projects',
                ),
              ),
              Expanded(
                child: _ImpactTile(
                  icon: Icons.favorite_rounded,
                  value: agFmtInt(data.totalBeneficiaries),
                  label: 'Beneficiaries',
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _ImpactTile(
                  icon: Icons.access_time_rounded,
                  value:
                      manHoursPending ? 'Pending' : agFmtInt(data.totalManHours),
                  label: 'Man Hours',
                ),
              ),
              Expanded(
                child: _ImpactTile(
                  icon: Icons.payments_rounded,
                  value: formatMoney(data.totalCost, data.targetCurrency),
                  label: 'Cost (${data.targetCurrency})',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ImpactTile extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  const _ImpactTile({
    required this.icon,
    required this.value,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 3),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, size: 14, color: AppColors.goldPrime),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  value,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    height: 1.0,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  label,
                  style: AppFonts.body(
                    fontSize: 9.5,
                    color: AppColors.chart5,
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
// 4. Projects by Club
// ─────────────────────────────────────────────────────────────────────────

class _ProjectsByClubCard extends StatelessWidget {
  final Map<String, int> counts;
  const _ProjectsByClubCard({required this.counts});

  @override
  Widget build(BuildContext context) {
    final entries = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final peak = entries.isEmpty ? 0 : entries.first.value;
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
          Text(
            'Projects by Club',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700,
            ),
          ),
          Text(
            'Total projects executed per club',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 12),
          if (entries.isEmpty)
            const _CardEmpty(text: 'No projects yet.')
          else
            for (var i = 0; i < entries.length; i++) ...[
              _ClubBarRow(
                clubName: entries[i].key,
                value: entries[i].value,
                peak: peak,
                isTop: i == 0,
              ),
              if (i != entries.length - 1) const SizedBox(height: 10),
            ],
        ],
      ),
    );
  }
}

class _ClubBarRow extends StatelessWidget {
  final String clubName;
  final int value;
  final int peak;
  final bool isTop;
  const _ClubBarRow({
    required this.clubName,
    required this.value,
    required this.peak,
    required this.isTop,
  });

  @override
  Widget build(BuildContext context) {
    final pct = peak == 0 ? 0.0 : value / peak;
    final color = isTop ? AppColors.goldPrime : AppColors.rotaryBlue;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 96,
          child: Text(
            clubName,
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.slate700,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: pct,
              minHeight: 10,
              backgroundColor: AppColors.slate100,
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          width: 36,
          child: Text(
            agFmtInt(value),
            textAlign: TextAlign.right,
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: color,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Monthly Projects Trend — vertical mini-bars
// ─────────────────────────────────────────────────────────────────────────

class _MonthlyTrendCard extends StatelessWidget {
  final Map<String, int> counts; // "Jul 2025" -> count
  const _MonthlyTrendCard({required this.counts});

  static const _monthOrder = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
  };

  /// Parse "Jul 2025" -> a sortable integer (year*100 + month). Falls back to 0.
  int _key(String label) {
    final parts = label.split(' ');
    if (parts.length != 2) return 0;
    final m = _monthOrder[parts[0]] ?? 0;
    final y = int.tryParse(parts[1]) ?? 0;
    return y * 100 + m;
  }

  @override
  Widget build(BuildContext context) {
    final entries = counts.entries.toList()
      ..sort((a, b) => _key(a.key).compareTo(_key(b.key)));
    final peak = entries.isEmpty
        ? 0
        : entries.map((e) => e.value).reduce((a, b) => a > b ? a : b);
    final peakIdx =
        entries.indexWhere((e) => e.value == peak);
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
          Text(
            'Monthly Projects Trend',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700,
            ),
          ),
          Text(
            'Project count by month (combined across clubs)',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 12),
          if (entries.isEmpty)
            const _CardEmpty(text: 'No monthly data.')
          else ...[
            SizedBox(
              height: 130,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  for (var i = 0; i < entries.length; i++)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 3),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            Text(
                              '${entries[i].value}',
                              style: AppFonts.body(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w800,
                                color: i == peakIdx
                                    ? AppColors.goldPrime
                                    : AppColors.slate500,
                                fontFeatures: const [
                                  FontFeature.tabularFigures()
                                ],
                              ),
                            ),
                            const SizedBox(height: 3),
                            ClipRRect(
                              borderRadius: const BorderRadius.only(
                                topLeft: Radius.circular(5),
                                topRight: Radius.circular(5),
                              ),
                              child: Container(
                                width: double.infinity,
                                height: peak == 0
                                    ? 0
                                    : 90 * (entries[i].value / peak),
                                color: i == peakIdx
                                    ? AppColors.goldPrime
                                    : AppColors.rotaryBlue,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              _shortLabel(entries[i].key),
                              textAlign: TextAlign.center,
                              style: AppFonts.body(
                                fontSize: 9,
                                color: AppColors.slate400,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Gold bar = peak month',
              style: AppFonts.body(
                fontSize: 10,
                color: AppColors.slate400,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// "Jul 2025" -> "Jul" (month label only; full label is in the tooltip-less
  /// bar value above).
  String _shortLabel(String label) {
    final parts = label.split(' ');
    return parts.isEmpty ? label : parts.first;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Detailed projects table
// ─────────────────────────────────────────────────────────────────────────

class _ProjectsTable extends StatelessWidget {
  final List<AgProjectRow> rows; // current page
  final Map<int, int> clubIndex; // clubId -> color index
  final int shownCount; // filtered total (across pages)
  final int totalCount; // unfiltered total
  final String search;
  final ValueChanged<String> onSearchChanged;
  final String avenue;
  final List<String> avenueOptions;
  final bool hasBlankAvenue;
  final String allValue;
  final String noneValue;
  final ValueChanged<String> onAvenueChanged;
  final int? fallbackYearId;
  final int page;
  final int pageCount;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;
  const _ProjectsTable({
    required this.rows,
    required this.clubIndex,
    required this.shownCount,
    required this.totalCount,
    required this.search,
    required this.onSearchChanged,
    required this.avenue,
    required this.avenueOptions,
    required this.hasBlankAvenue,
    required this.allValue,
    required this.noneValue,
    required this.onAvenueChanged,
    required this.fallbackYearId,
    required this.page,
    required this.pageCount,
    required this.onPrev,
    required this.onNext,
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
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.slate100)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'All Projects: Detailed View',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700,
                  ),
                ),
                Text(
                  (shownCount == totalCount)
                      ? 'Showing $shownCount of $totalCount projects'
                      : 'Showing $shownCount of $totalCount projects · filtered',
                  style: AppFonts.body(
                    fontSize: 10.5,
                    color: AppColors.slate400,
                  ),
                ),
                const SizedBox(height: 8),
                _AvenueDropdown(
                  value: avenue,
                  options: avenueOptions,
                  hasBlank: hasBlankAvenue,
                  allValue: allValue,
                  noneValue: noneValue,
                  onChanged: onAvenueChanged,
                ),
                const SizedBox(height: 8),
                _SearchInput(value: search, onChanged: onSearchChanged),
              ],
            ),
          ),
          if (totalCount == 0)
            const _CardEmpty(
              text: 'No projects yet.',
              padding: EdgeInsets.symmetric(vertical: 28),
            )
          else if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Center(
                child: Text(
                  'No projects match your search.',
                  style: AppFonts.body(
                    fontSize: 12,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            )
          else ...[
            for (final p in rows)
              _ProjectRow(
                project: p,
                colorIndex: clubIndex[p.clubId] ?? 0,
                fallbackYearId: fallbackYearId,
              ),
            if (pageCount > 1)
              _Pager(
                page: page,
                pageCount: pageCount,
                onPrev: onPrev,
                onNext: onNext,
              ),
          ],
        ],
      ),
    );
  }
}

class _Pager extends StatelessWidget {
  final int page;
  final int pageCount;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;
  const _Pager({
    required this.page,
    required this.pageCount,
    required this.onPrev,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: const BoxDecoration(
        color: AppColors.slate50,
        border: Border(top: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        children: [
          _PagerBtn(
            icon: Icons.chevron_left_rounded,
            label: 'Prev',
            onTap: onPrev,
          ),
          const Spacer(),
          Text(
            'Page ${page + 1} of $pageCount',
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.slate500,
            ),
          ),
          const Spacer(),
          _PagerBtn(
            icon: Icons.chevron_right_rounded,
            label: 'Next',
            trailing: true,
            onTap: onNext,
          ),
        ],
      ),
    );
  }
}

class _PagerBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool trailing;
  final VoidCallback? onTap;
  const _PagerBtn({
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final fg = enabled ? AppColors.rotaryBlue : AppColors.slate400;
    final children = <Widget>[
      Icon(icon, size: 16, color: fg),
      Text(
        label,
        style: AppFonts.body(
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
          color: fg,
        ),
      ),
    ];
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: enabled ? AppColors.slate200 : AppColors.slate100,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: trailing ? children.reversed.toList() : children,
          ),
        ),
      ),
    );
  }
}

/// Avenue-of-Service filter — mirrors the web `<select>`: "All Avenues of
/// Service" default, one option per distinct avenue present in the data, and a
/// trailing "(No avenue set)" bucket when some rows carry no avenue.
class _AvenueDropdown extends StatelessWidget {
  final String value;
  final List<String> options;
  final bool hasBlank;
  final String allValue;
  final String noneValue;
  final ValueChanged<String> onChanged;
  const _AvenueDropdown({
    required this.value,
    required this.options,
    required this.hasBlank,
    required this.allValue,
    required this.noneValue,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          const Icon(Icons.filter_list_rounded,
              size: 15, color: AppColors.slate400),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: value,
                isDense: true,
                isExpanded: true,
                icon: const Icon(Icons.keyboard_arrow_down_rounded,
                    size: 18, color: AppColors.slate400),
                style: AppFonts.body(
                    fontSize: 12.5, color: AppColors.textPrimary),
                borderRadius: BorderRadius.circular(12),
                items: [
                  DropdownMenuItem(
                      value: allValue,
                      child: Text('All Avenues of Service',
                          style: AppFonts.body(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary))),
                  for (final a in options)
                    DropdownMenuItem(
                        value: a,
                        child: Text(a,
                            overflow: TextOverflow.ellipsis,
                            style: AppFonts.body(
                                fontSize: 12.5, color: AppColors.textPrimary))),
                  if (hasBlank)
                    DropdownMenuItem(
                        value: noneValue,
                        child: Text('(No avenue set)',
                            style: AppFonts.body(
                                fontSize: 12.5,
                                fontStyle: FontStyle.italic,
                                color: AppColors.slate500))),
                ],
                onChanged: (v) {
                  if (v != null) onChanged(v);
                },
              ),
            ),
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
              controller: TextEditingController(text: value)
                ..selection = TextSelection.collapsed(offset: value.length),
              onChanged: onChanged,
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textPrimary,
              ),
              decoration: InputDecoration(
                hintText: 'Search projects, clubs…',
                hintStyle: AppFonts.body(
                  fontSize: 12,
                  color: AppColors.slate400,
                ),
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

class _ProjectRow extends StatelessWidget {
  final AgProjectRow project;
  final int colorIndex;
  final int? fallbackYearId;
  const _ProjectRow({
    required this.project,
    required this.colorIndex,
    required this.fallbackYearId,
  });

  void _openDetail(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AgProjectDetailScreen(
          projectId: project.projectId,
          yearId: project.yearId > 0 ? project.yearId : fallbackYearId,
          row: project,
        ),
      ),
    );
  }

  ({Color bg, Color fg}) _fundingStyle() {
    switch (project.funding) {
      case 'Global Grant':
        return (bg: AppColors.warningLight, fg: AppColors.warningInk);
      case 'Self Funded':
        return (bg: AppColors.slate100, fg: AppColors.slate500);
      default:
        return (bg: AppColors.muted, fg: AppColors.rotaryBlue);
    }
  }

  String _truncTitle(String t) =>
      t.length <= 56 ? t : '${t.substring(0, 55)}…';

  @override
  Widget build(BuildContext context) {
    final clubColor = Color(agClubColor(colorIndex));
    final fs = _fundingStyle();
    final manHours = project.manHoursIsPending
        ? 'Pending'
        : (project.manHours > 0 ? '${agFmtInt(project.manHours)}h' : '–');
    final canOpen = project.canOpenDetail;
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Club chip + date row
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: clubColor,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  project.clubName.isEmpty ? '–' : project.clubName,
                  style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
              const Spacer(),
              Text(
                agFmtDate(project.date),
                style: AppFonts.body(
                  fontSize: 10,
                  color: AppColors.slate400,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              if (canOpen) ...[
                const SizedBox(width: 4),
                const Icon(Icons.chevron_right_rounded,
                    size: 16, color: AppColors.slate400),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Text(
            _truncTitle(project.title),
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 10,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _MetricChip(
                icon: Icons.payments_rounded,
                value: project.cost > 0
                    ? formatMoney(project.cost, project.currency)
                    : '–',
              ),
              _MetricChip(
                icon: Icons.favorite_rounded,
                value: project.beneficiaries > 0
                    ? agFmtInt(project.beneficiaries)
                    : '–',
              ),
              _MetricChip(
                icon: Icons.access_time_rounded,
                value: manHours,
                muted: project.manHoursIsPending,
              ),
              if (project.rotarians > 0)
                _MetricChip(
                  icon: Icons.groups_rounded,
                  value: '${agFmtInt(project.rotarians)} Rotarians',
                ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: fs.bg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  project.funding.isEmpty ? '–' : project.funding,
                  style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: fs.fg,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.slate100)),
      ),
      child: canOpen
          ? InkWell(onTap: () => _openDetail(context), child: content)
          : content,
    );
  }
}

class _MetricChip extends StatelessWidget {
  final IconData icon;
  final String value;
  final bool muted;
  const _MetricChip({
    required this.icon,
    required this.value,
    this.muted = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 10, color: AppColors.slate400),
        const SizedBox(width: 3),
        Text(
          value,
          style: AppFonts.body(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: muted ? AppColors.slate400 : AppColors.slate500,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

class _CardEmpty extends StatelessWidget {
  final String text;
  final EdgeInsets padding;
  const _CardEmpty({
    required this.text,
    this.padding = const EdgeInsets.symmetric(vertical: 18),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Center(
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 12,
            color: AppColors.slate400,
          ),
        ),
      ),
    );
  }
}
