import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Goal oversight district matrix — mobile twin of the web `GoalOversightMatrix`
/// table (`GET district-summary-matrix`).
///
/// One ROW per district of the picked zone, with the chosen category laid out
/// horizontally in front of the district number. A summed TOTAL row closes the
/// table, and is hidden when the view is filtered to a single district (a total
/// of one row is noise), exactly as web does it.
///
/// ⚠️ A metric is NOT a fixed number of columns — see [GoalSummaryMetric.columnCount]:
///   • 1 — single-value: a RAG band (painted in its colour, holding a club
///     count) or a Membership "Summary" figure, which has no target. The number
///     lives in `cell.value`, NOT in target/achieved.
///   • 3 — `hasBaseline == false` (TRF): giving restarts at zero each year, so
///     the "as on July 1st" column is dropped entirely.
///   • 4 — the usual baseline · Target · Achieved · Percentage Achieved.
/// Header and body both size themselves from the same helper; they are separate
/// widget trees and will shear if that ever stops being true.
///
/// Mobile adaptations, both additive — the default view is field-for-field web:
///   • The District column is FROZEN while the rest scrolls horizontally, so the
///     district you are reading never scrolls off. This is why every row height
///     here is a fixed constant: the frozen column and the scrolling body are two
///     separate widget trees and their rows must line up to the pixel.
///   • A category filter (defaults to "All" = web's view) keeps the table usable
///     on a phone — four categories is easily 60+ columns. It narrows which
///     columns render; it never changes a value or a label.
class GoalDistrictMatrixTable extends StatefulWidget {
  final GoalDistrictSummaryMatrix matrix;

  /// When set, only this district is shown and the TOTAL row is hidden (mirrors
  /// web's District dropdown).
  final int? districtFilterId;

  /// Per-row download — that district's "District Goal Setting" workbook. Null
  /// hides the download affordance entirely.
  final Future<void> Function(int districtId, String districtNumber)? onDownloadDistrict;

  /// Per-row "view this district's clubs". Null hides the affordance.
  final void Function(int districtId, String districtNumber)? onViewClubs;

  /// Tapping the row opens that district's month-wise collection, as on web.
  /// The row-level icon buttons keep their own taps.
  final void Function(int districtId, String districtNumber)? onOpenMonthWise;

  const GoalDistrictMatrixTable({
    super.key,
    required this.matrix,
    this.districtFilterId,
    this.onDownloadDistrict,
    this.onViewClubs,
    this.onOpenMonthWise,
  });

  @override
  State<GoalDistrictMatrixTable> createState() => _GoalDistrictMatrixTableState();
}

class _GoalDistrictMatrixTableState extends State<GoalDistrictMatrixTable> {
  /// RAG band → the solid colour that band's value chip is painted.
  static const Map<String, Color> _ragColors = {
    'Red': AppColors.error,
    'Amber': AppColors.goldDark,
    'Green': AppColors.success,
    'SuperGreen': AppColors.success,
  };

  /// Which category the cards show. null → all of them.
  ///
  /// Defaults to Membership, matching web, which narrowed this page to one
  /// category at a time. "All" stays available as a chip.
  int? _categoryFilter;

  @override
  void initState() {
    super.initState();
    _categoryFilter = _defaultCategoryId();
  }

  @override
  void didUpdateWidget(covariant GoalDistrictMatrixTable old) {
    super.didUpdateWidget(old);
    // A new zone/year can bring a different category set — if the chosen one is
    // no longer in scope, fall back rather than showing an empty grid.
    final cats = widget.matrix.categories;
    if (_categoryFilter != null &&
        !cats.any((c) => c.categoryId == _categoryFilter)) {
      _categoryFilter = _defaultCategoryId();
    }
  }

  int? _defaultCategoryId() {
    final cats = widget.matrix.categories;
    if (cats.isEmpty) return null;
    for (final c in cats) {
      if (c.name.toLowerCase() == 'membership') return c.categoryId;
    }
    return cats.first.categoryId;
  }


  List<GoalSummaryCategory> get _visibleCategories {
    final all = widget.matrix.categories;
    final f = _categoryFilter;
    if (f == null) return all;
    return all.where((c) => c.categoryId == f).toList();
  }

  List<GoalSummaryDistrictRow> get _visibleDistricts {
    final all = widget.matrix.districts;
    final f = widget.districtFilterId;
    if (f == null) return all;
    return all.where((d) => d.districtId == f).toList();
  }

  bool get _showTotal => widget.districtFilterId == null && _visibleDistricts.length > 1;

  @override
  Widget build(BuildContext context) {
    final m = widget.matrix;

    if (m.districts.isEmpty || m.categories.isEmpty) {
      return _card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            m.districts.isEmpty
                ? 'No districts to show for this zone / year.'
                : 'No goal categories in your scope for this zone.',
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ),
      );
    }

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _heading(),
          if (m.categories.length > 1) _categoryChips(),
          const Divider(height: 1, color: AppColors.slate100),
          _cardsList(),
          if (_showRagLegend) _ragLegend(),
        ],
      ),
    );
  }

  // ── heading ──────────────────────────────────────────────────────────────

  Widget _heading() {
    final m = widget.matrix;
    final shown = _visibleDistricts.length;
    final total = m.districts.length;
    final countText =
        shown == total ? '$total district(s)' : '$shown of $total district(s)';

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Goal Setting: district overview (read-only)',
            style: AppFonts.body(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            [
              if (m.zoneName.isNotEmpty) m.zoneName,
              if (m.yearLabel.isNotEmpty) m.yearLabel,
              countText,
            ].join(' · '),
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _categoryChips() {
    final cats = widget.matrix.categories;
    // Wrap (not a horizontal scroll) so every category chip shows its full label
    // on a phone — a scroll list clipped the last chips mid-word ("Youth Servi",
    // "P…"). The chips flow onto a second line instead.
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: Wrap(
        spacing: 6,
        runSpacing: 8,
        children: [
          _chip('All', _categoryFilter == null, () => setState(() => _categoryFilter = null)),
          for (final c in cats)
            _chip(c.name, _categoryFilter == c.categoryId,
                () => setState(() => _categoryFilter = c.categoryId)),
        ],
      ),
    );
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) {
    // No outer padding — the parent Wrap owns spacing/runSpacing.
    return Material(
      color: selected ? AppColors.primary : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
                color: selected ? AppColors.primary : AppColors.border),
          ),
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : AppColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }

  bool get _showRagLegend =>
      _visibleCategories.any((c) => c.metrics.any((mt) => mt.ragBand != null));

  /// Explains what the solid colours mean. Without it the RAG columns are just
  /// unlabelled coloured blocks.
  Widget _ragLegend() {
    Widget swatch(String band, String label) => Padding(
          padding: const EdgeInsets.only(right: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: _ragColors[band],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 5),
              Text(
                label,
                style: AppFonts.body(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        );

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        runSpacing: 6,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Text(
              'RAG: clubs by active members:',
              style: AppFonts.body(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          swatch('Red', 'Red 10–25'),
          swatch('Amber', 'Amber 26–40'),
          swatch('Green', 'Green 41+'),
        ],
      ),
    );
  }

  // ── mobile cards: one card per district, metrics stacked vertically ───────
  // A wide matrix can't be read on a phone, so each district becomes a card and
  // every metric's fields are label→value rows — no horizontal scrolling.

  Widget _cardsList() {
    final districts = _visibleDistricts;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < districts.length; i++)
          _districtCard(districts[i], i),
        if (_showTotal) _totalCard(),
      ],
    );
  }

  Widget _districtCard(GoalSummaryDistrictRow d, int index) {
    final download = widget.onDownloadDistrict;
    final viewClubs = widget.onViewClubs;
    final openMonth = widget.onOpenMonthWise;
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.slate100, width: 1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: openMonth == null
                ? null
                : () => openMonth(d.districtId, d.districtNumber),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
              child: Row(
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.rotaryBlue.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'D ${d.districtNumber}',
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.rotaryBlue,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (viewClubs != null)
                    IconButton(
                      onPressed: () => viewClubs(d.districtId, d.districtNumber),
                      icon: const Icon(Icons.groups_2_outlined, size: 18),
                      color: AppColors.rotaryBlue,
                      visualDensity: VisualDensity.compact,
                      tooltip:
                          "View all clubs' goal setting for D ${d.districtNumber}",
                    ),
                  if (download != null)
                    IconButton(
                      onPressed: () => download(d.districtId, d.districtNumber),
                      icon: const Icon(Icons.download_rounded, size: 18),
                      color: AppColors.slate400,
                      visualDensity: VisualDensity.compact,
                      tooltip: 'Download report for D ${d.districtNumber}',
                    ),
                  if (openMonth != null)
                    const Padding(
                      padding: EdgeInsets.only(left: 2, right: 4),
                      child: Icon(Icons.chevron_right_rounded,
                          size: 20, color: AppColors.slate400),
                    ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final c in _visibleCategories)
                  ..._categoryBlocks(c, (mi) => d.cell(c.categoryId, mi)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _totalCard() {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.slate50,
        border: Border(top: BorderSide(color: AppColors.slate400, width: 1.4)),
      ),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'TOTAL',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          for (final c in _visibleCategories)
            ..._categoryBlocks(
              c,
              (mi) => mi < c.totals.length ? c.totals[mi] : null,
            ),
        ],
      ),
    );
  }

  /// One category's metric blocks. Consecutive metrics that share a groupName
  /// (the RAG bands, the Summary rows) collapse under one heading, as the web
  /// table does with its tier-2 spans.
  List<Widget> _categoryBlocks(
    GoalSummaryCategory c,
    GoalSummaryCell? Function(int metricIndex) cellFor,
  ) {
    if (c.metrics.isEmpty) return const [];
    final showCatName = _visibleCategories.length > 1;
    final blocks = <Widget>[];
    var i = 0;
    while (i < c.metrics.length) {
      final group = c.metrics[i].groupName;
      final rows = <Widget>[];
      while (i < c.metrics.length && c.metrics[i].groupName == group) {
        rows.addAll(_metricRows(c.metrics[i], cellFor(i)));
        i++;
      }
      blocks.add(_groupBlock(group, rows));
    }
    return [
      if (showCatName)
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 2),
          child: Text(
            c.name.toUpperCase(),
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: AppColors.rotaryBlue,
              letterSpacing: 0.4,
            ),
          ),
        ),
      ...blocks,
    ];
  }

  Widget _groupBlock(String title, List<Widget> rows) {
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate100),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          ...rows,
        ],
      ),
    );
  }

  List<Widget> _metricRows(GoalSummaryMetric mt, GoalSummaryCell? cell) {
    if (mt.isSingle) {
      final rag = mt.ragBand == null ? null : _ragColors[mt.ragBand];
      return [_fieldRow(mt.baselineLabel, cell?.value, ragColor: rag)];
    }
    return [
      if (mt.hasBaseline) _fieldRow(mt.baselineLabel, cell?.asOnJul1),
      _fieldRow('Target', cell?.target),
      _fieldRow('Achieved', cell?.achieved),
      _fieldRow('Percentage Achieved', cell?.pct, strong: true),
    ];
  }

  Widget _fieldRow(String label, String? value,
      {bool strong = false, Color? ragColor}) {
    final text = (value == null || value.trim().isEmpty) ? '–' : value;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
                height: 1.2,
              ),
            ),
          ),
          const SizedBox(width: 10),
          if (ragColor != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
              decoration: BoxDecoration(
                color: ragColor,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                text,
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
            )
          else
            Text(
              text,
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: strong ? FontWeight.w800 : FontWeight.w700,
                color:
                    text == '–' ? AppColors.textMuted : AppColors.textPrimary,
              ),
            ),
        ],
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
  }
}
