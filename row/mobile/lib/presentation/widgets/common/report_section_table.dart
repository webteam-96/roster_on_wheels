import 'package:flutter/material.dart';
import '../../../core/services/report_xlsx_export.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// On-screen, collapsible view of a single report section — the SAME
/// [ReportColumn] set used for the Excel/CSV export, rendered as a horizontally
/// scrollable table so the data is visible in-app without downloading.
///
/// Header: icon + title + "N records" + optional [trailing] (e.g. an Excel
/// download button) + an expand chevron. Body (when expanded): the table,
/// capped at [maxRows] with a "showing X of Y" footer so huge sections stay
/// light — the full data is always available via the export.
class ReportSectionCard extends StatefulWidget {
  final String title;
  final List<ReportColumn> columns;
  final List<Map<String, dynamic>> rows;
  final IconData icon;
  final Color? accent;
  final Widget? trailing;
  final bool initiallyExpanded;
  final int maxRows;

  /// Flat list-row style (no card border/margin, muted monochrome icon) used
  /// when the card lives inside a grouped white panel — matches the web report
  /// list. Default `false` keeps the standalone rounded-card look.
  final bool flat;

  /// When set, rows are fetched lazily the first time the card is expanded
  /// (heavy/config-gated sections). [rows] is ignored while a loader is set;
  /// the loaded rows are cached and passed back via [onLoaded].
  final Future<List<Map<String, dynamic>>> Function()? rowsLoader;
  final ValueChanged<List<Map<String, dynamic>>>? onLoaded;

  /// Always-visible widget rendered under the header (before the table) — used
  /// for the per-section filter dropdown chips, mirroring the web report rows.
  final Widget? belowHeader;

  /// Overrides the "N records" subtitle (e.g. "12 records · filtered" or a
  /// "Please select an AG" hint), with an optional colour.
  final String? subtitleOverride;
  final Color? subtitleColor;

  const ReportSectionCard({
    super.key,
    required this.title,
    required this.columns,
    required this.rows,
    this.icon = Icons.table_chart_rounded,
    this.accent,
    this.trailing,
    this.initiallyExpanded = false,
    this.maxRows = 50,
    this.flat = false,
    this.rowsLoader,
    this.onLoaded,
    this.belowHeader,
    this.subtitleOverride,
    this.subtitleColor,
  });

  @override
  State<ReportSectionCard> createState() => _ReportSectionCardState();
}

class _ReportSectionCardState extends State<ReportSectionCard> {
  late bool _expanded = widget.initiallyExpanded;

  // Lazy-load state (only used when widget.rowsLoader != null).
  List<Map<String, dynamic>>? _lazyRows;
  bool _lazyLoading = false;
  Object? _lazyError;

  Future<void> _runLazyLoad() async {
    if (_lazyLoading) return;
    setState(() {
      _lazyLoading = true;
      _lazyError = null;
    });
    try {
      final r = await widget.rowsLoader!();
      if (!mounted) return;
      setState(() {
        _lazyRows = r;
        _lazyLoading = false;
      });
      widget.onLoaded?.call(r);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _lazyError = e;
        _lazyLoading = false;
      });
    }
  }

  void _onHeaderTap() {
    setState(() => _expanded = !_expanded);
    if (_expanded &&
        widget.rowsLoader != null &&
        _lazyRows == null &&
        !_lazyLoading) {
      _runLazyLoad();
    }
  }

  @override
  Widget build(BuildContext context) {
    final lazy = widget.rowsLoader != null;
    final rows = lazy ? _lazyRows : widget.rows;
    final loaded = !lazy || _lazyRows != null;
    final count = rows?.length ?? 0;
    final hasData = loaded && count > 0;
    // Lazy rows are tappable even before load (so the tap triggers the fetch).
    final canTap = lazy || count > 0;
    final accent = widget.accent ?? AppColors.primary;
    final flat = widget.flat;
    // Flat rows use a muted, monochrome icon (like the web list); standalone
    // cards keep the coloured accent chip.
    final iconColor = flat ? AppColors.slate500 : accent;
    final chipColor = flat
        ? AppColors.slate400.withValues(alpha: 0.12)
        : accent.withValues(alpha: 0.12);

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: canTap ? _onHeaderTap : null,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: flat ? 14 : 12, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: chipColor,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(widget.icon, color: iconColor, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.title,
                        style: AppFonts.body(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                          height: 1.25,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 3),
                      Text(
                        widget.subtitleOverride ??
                            (!loaded
                                ? (_lazyLoading
                                    ? 'Loading…'
                                    : (_lazyError != null
                                        ? 'Tap to retry'
                                        : 'Tap to view'))
                                : hasData
                                    ? '$count record${count == 1 ? '' : 's'}'
                                    : 'No records'),
                        style: AppFonts.body(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: widget.subtitleColor ?? AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (widget.trailing != null) ...[
                  const SizedBox(width: 8),
                  widget.trailing!,
                ],
                if (canTap) ...[
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: _expanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: const Icon(Icons.expand_more_rounded,
                        color: AppColors.textMuted, size: 22),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (widget.belowHeader != null)
          Padding(
            padding: EdgeInsets.fromLTRB(flat ? 14 : 12, 0, flat ? 14 : 12, 10),
            child: widget.belowHeader,
          ),
        if (_expanded) ...[
          if (_lazyLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 22),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
              ),
            )
          else if (_lazyError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Text(
                'Could not load this section. Tap the row to retry.',
                style: AppFonts.body(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            )
          else if (hasData)
            _ReportTable(
              columns: widget.columns,
              rows: rows!,
              accent: accent,
              maxRows: widget.maxRows,
            )
          else if (loaded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Text(
                'No records for this section.',
                style: AppFonts.body(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            ),
        ],
      ],
    );

    if (flat) return content;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: content,
    );
  }
}

/// The horizontally scrollable table itself (header + capped data rows).
class _ReportTable extends StatelessWidget {
  final List<ReportColumn> columns;
  final List<Map<String, dynamic>> rows;
  final Color accent;
  final int maxRows;

  const _ReportTable({
    required this.columns,
    required this.rows,
    required this.accent,
    required this.maxRows,
  });

  // Excel "character width" → on-screen px (bounded so no single cell hogs the row).
  double _colWidth(ReportColumn c) => (c.width * 7.5).clamp(64.0, 240.0);

  String _cellText(dynamic v) {
    if (v == null) return '';
    if (v is bool) return v ? 'Yes' : 'No';
    final s = v.toString();
    if (s.isEmpty) return '';
    // Pretty-print ISO-ish dates; leave already-formatted / non-date text as-is.
    final iso = RegExp(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?');
    if (iso.hasMatch(s)) {
      final d = DateTime.tryParse(s);
      if (d != null) {
        if (d.year <= 1) return '';
        final mm = const [
          '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ][d.month];
        return '${d.day.toString().padLeft(2, '0')} $mm ${d.year}';
      }
    }
    return s;
  }

  @override
  Widget build(BuildContext context) {
    final shown = rows.length > maxRows ? rows.sublist(0, maxRows) : rows;
    final headerStyle = AppFonts.body(
      fontSize: 11,
      fontWeight: FontWeight.w800,
      color: AppColors.slate500,
      letterSpacing: 0.2,
    );
    final cellStyle = AppFonts.body(
      fontSize: 12,
      color: AppColors.textPrimary,
      height: 1.2,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Divider(height: 1, thickness: 1, color: AppColors.border),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row
              Container(
                color: AppColors.slate50,
                child: Row(
                  children: [
                    for (final c in columns)
                      Container(
                        width: _colWidth(c),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 9),
                        child: Text(c.label.toUpperCase(),
                            style: headerStyle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis),
                      ),
                  ],
                ),
              ),
              // Data rows
              for (var i = 0; i < shown.length; i++)
                Container(
                  decoration: BoxDecoration(
                    color: i.isEven ? Colors.white : AppColors.slate50,
                    border: const Border(
                        top: const BorderSide(color: AppColors.border, width: 0.5)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final c in columns)
                        Container(
                          width: _colWidth(c),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 8),
                          child: Text(_cellText(shown[i][c.key]),
                              style: cellStyle,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        if (rows.length > maxRows)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            color: AppColors.slate50,
            child: Text(
              'Showing first $maxRows of ${rows.length}: download for the full list.',
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
              ),
            ),
          ),
      ],
    );
  }
}
