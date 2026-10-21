import 'package:flutter/material.dart';

import '../../../../core/network/api_exceptions.dart';
import '../../../../core/services/goal_setting_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "View clubs" — every club of ONE district, read-only. Mobile twin of web's
/// `ClubGoalSettingPanel`, opened from a district row of the oversight matrix.
///
/// Two views over the same clubs, as on web:
///   • Goals     — the category's goal columns, plus each club's RAG band and
///                 active-member count (Membership only).
///   • Month-wise — one metric at a time, Jul→Jun, with a year total.
///
/// ⚠️ The three endpoints behind this are gated on Admin|SuperAdmin server-side,
/// so a member holding ONLY a goal role is refused. That is surfaced in plain
/// words rather than as a raw failure — see [_friendly].
Future<void> showGoalClubMatrixSheet(
  BuildContext context, {
  required int districtId,
  required String districtNumber,
  required int yearId,
  required List<GoalCategory> categories,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, controller) => _GoalClubMatrixSheet(
        districtId: districtId,
        districtNumber: districtNumber,
        yearId: yearId,
        categories: categories,
        scrollController: controller,
      ),
    ),
  );
}

enum _View { goals, monthly }

class _GoalClubMatrixSheet extends StatefulWidget {
  final int districtId;
  final String districtNumber;
  final int yearId;
  final List<GoalCategory> categories;
  final ScrollController scrollController;

  const _GoalClubMatrixSheet({
    required this.districtId,
    required this.districtNumber,
    required this.yearId,
    required this.categories,
    required this.scrollController,
  });

  @override
  State<_GoalClubMatrixSheet> createState() => _GoalClubMatrixSheetState();
}

class _GoalClubMatrixSheetState extends State<_GoalClubMatrixSheet> {
  final GoalSettingApi _api = GoalSettingApi();

  late int? _categoryId = widget.categories.isEmpty
      ? null
      : widget.categories.first.id;
  _View _view = _View.goals;

  GoalClubMatrix? _matrix;
  GoalClubMonthlyMatrix? _monthly;
  String? _metricKey;

  bool _loading = true;
  String? _error;
  String _query = '';
  bool _downloading = false;

  static const double _clubColW = 150;
  static const double _valueColW = 104;
  static const double _monthColW = 62;
  static const double _ragColW = 74;
  static const double _headerH = 62;
  static const double _rowH = 42;

  static const Map<String, Color> _ragColors = {
    'Red': AppColors.error,
    'Amber': AppColors.goldDark,
    'Green': AppColors.success,
    'SuperGreen': AppColors.success,
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// A 403 here means the caller holds a goal role but no admin role — the
  /// server gate, not a bug. Say that plainly instead of "HTTP 403".
  String _friendly(Object e) {
    if (e is ApiException && e.statusCode == 403) {
      return 'Club goals are limited to Club/District Admins and Super Admins. '
          'Your goal-oversight role alone cannot open this.';
    }
    return friendlyErrorMessage(e, fallback: 'Could not load club goals.');
  }

  Future<void> _load() async {
    final cat = _categoryId;
    if (cat == null) {
      setState(() {
        _loading = false;
        _error = 'No goal categories available.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_view == _View.goals) {
        final m = await _api.getScopedClubsMatrix(cat, widget.districtId, widget.yearId);
        if (!mounted) return;
        setState(() {
          _matrix = m;
          _loading = false;
        });
      } else {
        final m = await _api.getScopedClubsMonthlyMatrix(
            cat, widget.districtId, widget.yearId);
        if (!mounted) return;
        setState(() {
          _monthly = m;
          // Keep the chosen metric when it still exists; else take the first.
          final keys = m?.fields.map((f) => f.fieldKey).toList() ?? const [];
          if (_metricKey == null || !keys.contains(_metricKey)) {
            _metricKey = keys.isEmpty ? null : keys.first;
          }
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _friendly(e);
      });
    }
  }

  void _setCategory(int id) {
    if (id == _categoryId) return;
    setState(() {
      _categoryId = id;
      _matrix = null;
      _monthly = null;
      _metricKey = null;
    });
    _load();
  }

  void _setView(_View v) {
    if (v == _view) return;
    setState(() => _view = v);
    _load();
  }

  List<GoalMatrixRow> get _visibleClubs {
    final q = _query.trim().toLowerCase();
    final all = _matrix?.clubs ?? const <GoalMatrixRow>[];
    if (q.isEmpty) return all;
    return all.where((c) => c.clubName.toLowerCase().contains(q)).toList();
  }

  List<GoalClubMonthlyRow> get _visibleMonthlyClubs {
    final q = _query.trim().toLowerCase();
    final all = _monthly?.clubs ?? const <GoalClubMonthlyRow>[];
    if (q.isEmpty) return all;
    return all.where((c) => c.clubName.toLowerCase().contains(q)).toList();
  }

  Future<void> _download() async {
    if (_downloading) return;
    setState(() => _downloading = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _api.downloadScopedAllClubsReport(widget.districtId, widget.yearId);
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(
        content: Text('Report ready: check your downloads.'),
      ));
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.error,
        content: Text(_friendly(e),
            style: const TextStyle(color: Colors.white)),
      ));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      child: Column(
        children: [
          _header(),
          const Divider(height: 1, color: AppColors.slate100),
          _controls(),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Club Goal Setting',
                  style: AppFonts.body(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'District ${widget.districtNumber} · read-only',
                  style: AppFonts.body(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Download all clubs (Excel)',
            onPressed: _downloading ? null : _download,
            icon: _downloading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download_rounded),
            color: AppColors.primary,
          ),
          IconButton(
            icon: const Icon(Icons.close_rounded),
            color: AppColors.textSecondary,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  Widget _controls() {
    return Column(
      children: [
        if (widget.categories.length > 1)
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
              children: [
                for (final c in widget.categories)
                  _chip(c.name, c.id == _categoryId, () => _setCategory(c.id)),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
          child: Row(
            children: [
              _toggle('Goals', _view == _View.goals, () => _setView(_View.goals)),
              const SizedBox(width: 6),
              _toggle('Month-wise', _view == _View.monthly,
                  () => _setView(_View.monthly)),
              const SizedBox(width: 10),
              Expanded(
                child: SizedBox(
                  height: 38,
                  child: TextField(
                    onChanged: (v) => setState(() => _query = v),
                    style: AppFonts.body(fontSize: 12.5),
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: 'Search club',
                      hintStyle: AppFonts.body(
                          fontSize: 12.5, color: AppColors.textMuted),
                      prefixIcon: const Icon(Icons.search_rounded, size: 18),
                      contentPadding: EdgeInsets.zero,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(9),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(9),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_view == _View.monthly && (_monthly?.fields.isNotEmpty ?? false))
          _metricPicker(),
      ],
    );
  }

  Widget _metricPicker() {
    final fields = _monthly!.fields;
    final selected =
        fields.firstWhere((f) => f.fieldKey == _metricKey, orElse: () => fields.first);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: Row(
        children: [
          Text(
            'Metric',
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: PopupMenuButton<String>(
              onSelected: (v) => setState(() => _metricKey = v),
              constraints: const BoxConstraints(maxWidth: 340, maxHeight: 420),
              itemBuilder: (_) => [
                for (final f in fields)
                  PopupMenuItem<String>(
                    value: f.fieldKey,
                    child: Text(f.fieldLabel,
                        style: AppFonts.body(fontSize: 13)),
                  ),
              ],
              child: Container(
                padding: const EdgeInsets.fromLTRB(11, 9, 7, 9),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        selected.fieldLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppFonts.body(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    const Icon(Icons.arrow_drop_down_rounded,
                        size: 18, color: AppColors.textMuted),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
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
      ),
    );
  }

  Widget _toggle(String label, bool selected, VoidCallback onTap) {
    return Material(
      color: selected ? AppColors.primary : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border:
                Border.all(color: selected ? AppColors.primary : AppColors.border),
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

  // ── body ─────────────────────────────────────────────────────────────────

  Widget _body() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) return _message(_error!, isError: true);

    if (_view == _View.goals) {
      final m = _matrix;
      if (m == null || m.clubs.isEmpty) {
        return _message('No clubs found in this district.');
      }
      if (_visibleClubs.isEmpty) return _message('No clubs match "$_query".');
      return _goalsTable(m);
    }

    final m = _monthly;
    if (m == null || m.clubs.isEmpty) {
      return _message('No clubs found in this district.');
    }
    if (m.fields.isEmpty) {
      return _message('This category collects nothing month by month.');
    }
    if (_visibleMonthlyClubs.isEmpty) {
      return _message('No clubs match "$_query".');
    }
    return _monthlyTable(m);
  }

  Widget _message(String text, {bool isError = false}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isError ? Icons.lock_outline_rounded : Icons.groups_2_outlined,
              size: 34,
              color: isError ? AppColors.error : AppColors.slate400,
            ),
            const SizedBox(height: 10),
            Text(
              text,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 12.5,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Frozen Club column + horizontally scrolling values. Row heights are fixed
  /// constants because the two sides are separate widget trees — they must line
  /// up to the pixel or the table shears.
  Widget _frozenTable({
    required List<String> rowLabels,
    required Widget scrollingHeader,
    required List<Widget> scrollingRows,
    Widget? banner,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (banner != null) banner,
        Expanded(
          child: SingleChildScrollView(
            controller: widget.scrollController,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: _clubColW,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _headCell('CLUB', _clubColW,
                          align: TextAlign.left, height: _headerH),
                      for (var i = 0; i < rowLabels.length; i++)
                        Container(
                          height: _rowH,
                          width: _clubColW,
                          alignment: Alignment.centerLeft,
                          padding: const EdgeInsets.symmetric(horizontal: 10),
                          decoration: BoxDecoration(
                            color: i.isEven ? Colors.white : AppColors.slate50,
                            border: const Border(
                                bottom: BorderSide(
                                    color: AppColors.slate100, width: 1)),
                          ),
                          child: Text(
                            rowLabels[i],
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppFonts.body(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                              height: 1.15,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                Container(width: 1, color: AppColors.slate100),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [scrollingHeader, ...scrollingRows],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _goalsTable(GoalClubMatrix m) {
    final cols = m.dataColumns;
    final clubs = _visibleClubs;
    return _frozenTable(
      banner: m.isMembership ? _ragLegend() : null,
      rowLabels: clubs.map((c) => c.clubName).toList(),
      scrollingHeader: Row(
        children: [
          if (m.isMembership)
            _headCell('RAG', _ragColW, height: _headerH),
          for (final c in cols)
            _headCell(c.headingWithUnit, _valueColW, height: _headerH),
        ],
      ),
      scrollingRows: [
        for (var i = 0; i < clubs.length; i++)
          Container(
            height: _rowH,
            decoration: BoxDecoration(
              color: i.isEven ? Colors.white : AppColors.slate50,
              border: const Border(
                  bottom: BorderSide(color: AppColors.slate100, width: 1)),
            ),
            child: Row(
              children: [
                if (m.isMembership) _ragCell(clubs[i]),
                for (final c in cols)
                  _valueCell(clubs[i].values[c.fieldKey], _valueColW),
              ],
            ),
          ),
      ],
    );
  }

  Widget _monthlyTable(GoalClubMonthlyMatrix m) {
    final clubs = _visibleMonthlyClubs;
    final key = _metricKey ?? m.fields.first.fieldKey;
    return _frozenTable(
      banner: _monthlyNote(m, key),
      rowLabels: clubs.map((c) => c.clubName).toList(),
      scrollingHeader: Row(
        children: [
          for (final p in m.months)
            _headCell(p.label, _monthColW,
                height: _headerH, dim: !p.isAvailable),
          _headCell('TOTAL', _monthColW + 12, height: _headerH),
        ],
      ),
      scrollingRows: [
        for (var i = 0; i < clubs.length; i++)
          Container(
            height: _rowH,
            decoration: BoxDecoration(
              color: i.isEven ? Colors.white : AppColors.slate50,
              border: const Border(
                  bottom: BorderSide(color: AppColors.slate100, width: 1)),
            ),
            child: Row(
              children: [
                for (final p in m.months)
                  _valueCell(clubs[i].valueFor(key, p.month), _monthColW),
                _valueCell(clubs[i].totals[key], _monthColW + 12, bold: true),
              ],
            ),
          ),
      ],
    );
  }

  Widget _monthlyNote(GoalClubMonthlyMatrix m, String key) {
    final label = m.fields
        .firstWhere((f) => f.fieldKey == key, orElse: () => m.fields.first)
        .fieldLabel;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: Text(
        '$label collected per month'
        '${m.yearLabel.isEmpty ? '' : ' · RY ${m.yearLabel}'}: future months of '
        'the current year show ": ".',
        style: AppFonts.body(
          fontSize: 11,
          height: 1.35,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary,
        ),
      ),
    );
  }

  Widget _ragLegend() {
    Widget dot(String band, String label) => Padding(
          padding: const EdgeInsets.only(right: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(
                  color: _ragColors[band],
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 4),
              Text(label,
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  )),
            ],
          ),
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        runSpacing: 4,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text('RAG (active members):',
                style: AppFonts.body(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                )),
          ),
          dot('Red', 'Red 10–25'),
          dot('Amber', 'Amber 26–40'),
          dot('Green', 'Green 41–50'),
          dot('SuperGreen', 'Super Green 51+'),
        ],
      ),
    );
  }

  Widget _ragCell(GoalMatrixRow row) {
    final color = _ragColors[row.rag];
    return Tooltip(
      message: '${row.memberCount} active member(s)',
      child: Container(
        width: _ragColW,
        height: _rowH,
        alignment: Alignment.center,
        color: color ?? AppColors.slate100,
        child: Text(
          // No band (<10 members) reads as a dash, never as a colour.
          color == null ? '–' : row.rag,
          style: AppFonts.body(
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            color: color == null ? AppColors.textMuted : Colors.white,
          ),
        ),
      ),
    );
  }

  Widget _headCell(
    String text,
    double width, {
    TextAlign align = TextAlign.right,
    double height = _headerH,
    bool dim = false,
  }) {
    return Container(
      width: width,
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      alignment:
          align == TextAlign.left ? Alignment.centerLeft : Alignment.bottomRight,
      decoration: const BoxDecoration(
        color: AppColors.primaryDeep,
        border: Border(
          left: BorderSide(color: Colors.white24, width: 1),
          bottom: BorderSide(color: AppColors.goldPrime),
        ),
      ),
      child: Text(
        text,
        textAlign: align,
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
          fontSize: 9.5,
          height: 1.15,
          fontWeight: FontWeight.w700,
          color: dim ? Colors.white38 : Colors.white,
        ),
      ),
    );
  }

  Widget _valueCell(String? value, double width, {bool bold = false}) {
    final text = (value == null || value.trim().isEmpty) ? '–' : value;
    return Container(
      width: width,
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: AppColors.slate100, width: 1)),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
          fontSize: 11.5,
          fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
          color: text == '–' ? AppColors.textMuted : AppColors.textPrimary,
        ),
      ),
    );
  }
}
