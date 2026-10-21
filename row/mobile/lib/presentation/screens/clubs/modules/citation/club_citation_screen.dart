import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';

// Web V2 palette (mirrors rotary-frontend /clubs/[id]/citation/v2).
const Color _kBlue = AppColors.primaryDeep; // ROTARY_BLUE — primary / auto
const Color _kBlueLite = AppColors.accentBlue; // gradient end
const Color _kGold = AppColors.goldPrime; // ROTARY_GOLD — grand total / save
const Color _kEmerald = AppColors.success; // manual / earned
const Color _kEmeraldBg = AppColors.background;
const Color _kRose = AppColors.error; // "No"
const Color _kSlate50 = AppColors.background;
const Color _kSlate200 = AppColors.lightBorder;
const Color _kSlate400 = AppColors.textMuted;
const Color _kSlate500 = AppColors.textSecondary;
const Color _kSlate700 = AppColors.slate700;
const Color _kSlate800 = AppColors.textPrimary;

/// Club Citation — auto + manual points entry.
///
/// Mirrors the web flow at /clubs/[id]/citation:
///   * Loads citation structure + current values via
///     GET /api/clubs/{clubId}/citation?districtId={districtId}
///   * Shows 3 totals (Auto / Manual / Grand) + optional description HTML
///   * Tab 1: read-only auto-calculated entries
///   * Tab 2: per-category manual entries (number / yesno / chooseone)
///   * Refresh Auto button -> POST refresh-auto
///   * Save button -> POST save-manual (array body)
class ClubCitationScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  // When true (e.g. a district admin viewing a club's points from the Club
  // Points tab), manual inputs are disabled and the Save button is hidden —
  // matches the web `?readOnly=true` mode.
  final bool readOnly;
  const ClubCitationScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.readOnly = false,
  });

  @override
  State<ClubCitationScreen> createState() => _ClubCitationScreenState();
}

class _ClubCitationScreenState extends State<ClubCitationScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiClient();
  late final TabController _tabs;

  bool _loading = true;
  bool _refreshing = false;
  bool _saving = false;
  String? _error;

  // The backend club-citation endpoint honours an optional ?yearId= (added
  // 2026-06-12), defaulting to the current year. The picker scopes the
  // Auto/Manual/Grand totals so a past year reconciles with the Overview.
  int? _selectedYearId;
  List<_CitationYear> _years = [];

  int? _districtId;
  String _yearLabel = '';
  String _descriptionHtml = '';

  List<_AutoEntry> _autoEntries = [];
  List<_ManualCategory> _manualCategories = [];

  double _totalAuto = 0;
  double _totalManual = 0;
  double _grandTotal = 0;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    // Save bar is shown only on the Manual tab (web parity) → rebuild on swap.
    _tabs.addListener(() {
      if (mounted) setState(() {});
    });
    _bootstrap();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Resolve district for this club, then load the (current-year) citation.
      final clubResp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final c = clubResp.data ?? const {};
      _districtId = (c['fkDistrictId'] as num?)?.toInt() ??
          (c['districtId'] as num?)?.toInt();
      if (_districtId == null) {
        setState(() {
          _loading = false;
          _error = 'Could not resolve district for this club.';
        });
        return;
      }
      await _loadYears();
      await _loadCitation();
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Failed to load: $e';
        });
      }
    }
  }

  /// Loads the data-bearing rotary years for this club's district and defaults
  /// the selection to the current year. Best-effort — on failure the picker is
  /// hidden and the citation falls back to the server's current-year default.
  Future<void> _loadYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/district-modules/$_districtId/citation/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (resp.data ?? [])
          .map((e) => _CitationYear.fromJson(e as Map<String, dynamic>))
          .toList();
      if (years.isEmpty) return;
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.first,
      );
      _years = years;
      _selectedYearId = current.id != 0 ? current.id : years.first.id;
    } catch (_) {
      // no picker — _loadCitation falls back to the current year
    }
  }

  void _onYearChanged(int? id) {
    if (id == null || id == _selectedYearId) return;
    setState(() {
      _selectedYearId = id;
      _loading = true;
    });
    _loadCitation();
  }

  Future<void> _loadCitation() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/citation',
        queryParams: {
          'districtId': _districtId,
          if (_selectedYearId != null) 'yearId': _selectedYearId,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? const {};
      _yearLabel = (data['yearLabel'] ?? '').toString();
      _descriptionHtml = (data['descriptionHtml'] ?? '').toString();
      _totalAuto = (data['totalAuto'] as num?)?.toDouble() ?? 0;

      final autoList = (data['autoEntries'] as List?) ?? const [];
      _autoEntries = autoList
          .map((e) => _AutoEntry.fromJson(e as Map<String, dynamic>))
          .toList();

      final manualList = (data['manualQuestions'] ??
              data['manualCategories'] ??
              const []) as List;
      _manualCategories = manualList
          .map((e) => _ManualCategory.fromJson(e as Map<String, dynamic>))
          .toList();

      _recomputeTotals();
      if (mounted) {
        setState(() {
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Failed to load District Awards: $e';
        });
      }
    }
  }

  Future<void> _refreshAuto() async {
    if (_districtId == null) return;
    setState(() => _refreshing = true);
    try {
      await _api.post(
        '/api/clubs/${widget.clubId}/citation/refresh-auto?districtId=$_districtId',
      );
      await _loadCitation();
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Auto points refreshed');
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _saveManual() async {
    if (_districtId == null) return;
    setState(() => _saving = true);
    try {
      final payload = <Map<String, dynamic>>[];
      for (final cat in _manualCategories) {
        for (final sc in cat.subCriteria) {
          payload.add({
            'districtId': _districtId,
            'subCriteriaId': sc.id,
            'answerValue': sc.answerValue ?? '',
            // Backend ClubManualEntryDto.PointsEarned/BonusEarned are `int`;
            // earnedPoints/earnedBonus are doubles → a decimal in JSON (2.0/2.5)
            // can't bind to Int32 (400 "could not be converted to System.Int32").
            // This module uses whole-number points, so round before sending.
            'pointsEarned': sc.earnedPoints.round(),
            'bonusEarned': sc.earnedBonus.round(),
          });
        }
      }
      await _api.post(
        '/api/clubs/${widget.clubId}/citation/save-manual',
        body: payload,
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Saved');
      }
      await _loadCitation();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin =
        context.watch<AuthProvider>().isClubAdminOf(widget.clubId);
    // Read-only when opened from the district club-points view (web parity).
    final canManage = !widget.readOnly && isAdmin;
    final showSave = canManage && _tabs.index == 1;
    return Scaffold(
      backgroundColor: _kSlate50,
      appBar: widget.embedded
          ? null
          : const CustomAppBar(title: 'District Awards'),
      body: _loading
          ? const LoadingWidget()
          : _error != null
              ? EmptyStateWidget(
                  title: 'Could not load District Awards',
                  subtitle: _error,
                )
              : Column(
                  children: [
                    Expanded(
                      child: NestedScrollView(
                        headerSliverBuilder: (ctx, innerBoxIsScrolled) => [
                          SliverToBoxAdapter(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (_years.isNotEmpty) _buildYearPicker(),
                                _buildScoreBand(),
                                _buildKpiRow(),
                                if (_descriptionHtml.trim().isNotEmpty)
                                  _buildDescription(),
                                const SizedBox(height: 4),
                              ],
                            ),
                          ),
                          SliverPersistentHeader(
                            pinned: true,
                            delegate: _CitationTabBarDelegate(
                              _buildPillTabs(),
                            ),
                          ),
                        ],
                        body: TabBarView(
                          controller: _tabs,
                          children: [
                            _buildAutoTab(canManage),
                            _buildManualTab(canManage),
                          ],
                        ),
                      ),
                    ),
                    if (showSave) _buildSaveBar(),
                  ],
                ),
    );
  }

  // ── Pill tab bar (white track, blue rounded indicator — web parity) ────────
  Widget _buildPillTabs() {
    return Container(
      color: _kSlate50,
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _kSlate200),
        ),
        child: TabBar(
          controller: _tabs,
          dividerColor: Colors.transparent,
          indicatorSize: TabBarIndicatorSize.tab,
          indicator: BoxDecoration(
            color: _kBlue,
            borderRadius: BorderRadius.circular(10),
          ),
          labelColor: Colors.white,
          unselectedLabelColor: _kSlate700,
          labelStyle:
              AppFonts.body(fontSize: 13, fontWeight: FontWeight.w700),
          unselectedLabelStyle:
              AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600),
          tabs: const [
            Tab(height: 36, text: 'Auto Points'),
            Tab(height: 36, text: 'Manual Points'),
          ],
        ),
      ),
    );
  }

  // ── Gradient hero score band ───────────────────────────────────────────────
  Widget _buildScoreBand() {
    final ry = _yearLabel.isEmpty ? '' : 'RY $_yearLabel · ';
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: _kBlue,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.emoji_events_rounded,
                        color: Colors.white, size: 15),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        '${ry}District Awards Score',
                        style: AppFonts.body(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.white.withValues(alpha: 0.9),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  _fmtPts(_grandTotal),
                  style: AppFonts.body(
                    fontSize: 32,
                    height: 1.0,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Auto ${_fmtPts(_totalAuto)}   +   Manual ${_fmtPts(_totalManual)}',
                  style: AppFonts.body(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Colors.white.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
          ),
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.workspace_premium_rounded,
                color: Colors.white, size: 28),
          ),
        ],
      ),
    );
  }

  // ── 3 KPI cards (Auto / Manual / Grand Total) ──────────────────────────────
  Widget _buildKpiRow() {
    // IntrinsicHeight gives the stretched Row a bounded cross-axis extent
    // (it lives in a scroll header with unbounded height) so all three cards
    // share one equal height.
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 2),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
          Expanded(
            child: _KpiCard(
              icon: Icons.calculate_rounded,
              accent: _kBlue,
              accentBg: AppColors.muted,
              label: 'AUTO',
              value: _fmtPts(_totalAuto),
              sub: 'System-calculated',
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _KpiCard(
              icon: Icons.emoji_events_rounded,
              accent: _kEmerald,
              accentBg: _kEmeraldBg,
              label: 'MANUAL',
              value: _fmtPts(_totalManual),
              sub: 'Self-declared',
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _KpiCard(
              icon: Icons.flag_rounded,
              accent: AppColors.warningInk,
              accentBg: AppColors.background,
              label: 'TOTAL',
              value: _fmtPts(_grandTotal),
              sub: 'Auto + Manual',
            ),
          ),
          ],
        ),
      ),
    );
  }

  Widget _buildYearPicker() {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kSlate200),
      ),
      child: Row(
        children: [
          const Icon(Icons.calendar_today_rounded,
              size: 15, color: _kSlate500),
          const SizedBox(width: 8),
          Text('Rotary Year',
              style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: _kSlate500)),
          const Spacer(),
          DropdownButton<int>(
            value: _selectedYearId,
            underline: const SizedBox.shrink(),
            isDense: true,
            borderRadius: BorderRadius.circular(12),
            style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: _kSlate800),
            onChanged: (_refreshing || _saving) ? null : _onYearChanged,
            items: [
              for (final y in _years)
                DropdownMenuItem<int>(
                  value: y.id,
                  child: Text(
                    '${y.yearLabel}${y.isCurrent ? ' (Current)' : ''}',
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDescription() {
    // Strip basic HTML tags + decode common entities — keep it lightweight,
    // don't ship flutter_html. (Without entity decoding a literal "&nbsp;"
    // showed through in the description.)
    final stripped = _descriptionHtml
        .replaceAll(RegExp(r'<[^>]+>'), ' ')
        .replaceAll(RegExp(r'&nbsp;', caseSensitive: false), ' ')
        .replaceAll(RegExp(r'&amp;', caseSensitive: false), '&')
        .replaceAll(RegExp(r'&lt;', caseSensitive: false), '<')
        .replaceAll(RegExp(r'&gt;', caseSensitive: false), '>')
        .replaceAll(RegExp(r'&quot;', caseSensitive: false), '"')
        .replaceAll(RegExp(r'&#39;|&apos;', caseSensitive: false), "'")
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    if (stripped.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _kSlate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.muted)),
            ),
            child: Row(
              children: [
                const Icon(Icons.description_outlined,
                    size: 16, color: _kBlue),
                const SizedBox(width: 8),
                Text('About these awards',
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: _kSlate800)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Text(
              stripped,
              style: AppFonts.body(
                  fontSize: 13, height: 1.5, color: _kSlate700),
            ),
          ),
        ],
      ),
    );
  }

  // ── Auto tab: header + per-entry cards + total footer ──────────────────────
  Widget _buildAutoTab(bool canManage) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Auto-calculated Points',
                      style: AppFonts.body(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: _kSlate800)),
                  const SizedBox(height: 2),
                  Text(
                    'Derived from system data (projects, meetings, members…).',
                    style: AppFonts.body(
                        fontSize: 11.5, color: _kSlate500),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (canManage) _refreshButton(),
          ],
        ),
        const SizedBox(height: 12),
        if (_autoEntries.isEmpty)
          _emptyBox(
            icon: Icons.calculate_outlined,
            text: canManage
                ? 'No auto points yet. Tap “Refresh” to compute.'
                : 'No auto points calculated yet.',
          )
        else ...[
          ..._autoEntries.map((e) => _AutoEntryCard(entry: e)),
          const SizedBox(height: 4),
          _autoTotalFooter(),
        ],
      ],
    );
  }

  Widget _refreshButton() {
    return Material(
      color: AppColors.muted,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: _refreshing ? null : _refreshAuto,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _refreshing
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: _kBlue),
                    )
                  : const Icon(Icons.autorenew_rounded, size: 15, color: _kBlue),
              const SizedBox(width: 6),
              Text('Refresh',
                  style: AppFonts.body(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: _kBlue)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _autoTotalFooter() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: _kSlate800,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text('Total Auto Points',
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Colors.white)),
          ),
          Text(
            _fmtPts(_totalAuto),
            style: AppFonts.body(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: _kGold),
          ),
        ],
      ),
    );
  }

  Widget _buildManualTab(bool isAdmin) {
    if (_manualCategories.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(12, 16, 12, 24),
        children: [
          _emptyBox(
            icon: Icons.fact_check_outlined,
            text: 'No manual criteria configured for this year.',
          ),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      itemCount: _manualCategories.length,
      itemBuilder: (_, i) => _ManualCategoryCard(
        category: _manualCategories[i],
        readOnly: !isAdmin,
        onChanged: () => setState(_recomputeTotals),
      ),
    );
  }

  Widget _buildSaveBar() {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _kSlate200)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _saving ? null : _saveManual,
              style: ElevatedButton.styleFrom(
                backgroundColor: _kGold,
                foregroundColor: Colors.white,
                disabledBackgroundColor: _kGold.withValues(alpha: 0.5),
                elevation: 0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              icon: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.save_rounded, size: 18),
              label: Text(
                _saving ? 'Saving…' : 'Save Manual Points',
                style: AppFonts.body(
                    fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _emptyBox({required IconData icon, required String text}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 36),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kSlate200),
      ),
      child: Column(
        children: [
          Icon(icon, size: 34, color: _kSlate400),
          const SizedBox(height: 10),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
                fontSize: 13, color: _kSlate500, height: 1.4),
          ),
        ],
      ),
    );
  }

  void _recomputeTotals() {
    double m = 0;
    for (final c in _manualCategories) {
      for (final sc in c.subCriteria) {
        m += sc.earnedPoints + sc.earnedBonus;
      }
    }
    _totalManual = m;
    _grandTotal = _totalAuto + _totalManual;
  }
}

// ----------------------------------------------------------------------------
// Summary / header / category widgets
// ----------------------------------------------------------------------------

class _CitationYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _CitationYear(
      {required this.id, required this.yearLabel, this.isCurrent = false});

  factory _CitationYear.fromJson(Map<String, dynamic> j) => _CitationYear(
        id: (j['id'] as num?)?.toInt() ?? 0,
        yearLabel:
            j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: j['isCurrent'] == true,
      );
}

/// Points as whole numbers with thousands separators (e.g. 1234.5 → "1,235").
/// Web parity: District Awards points are integers, no decimals, no "pts" suffix.
String _fmtPts(double v) {
  final neg = v < 0;
  final intPart = v.abs().round().toString();
  final b = StringBuffer();
  for (var i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 == 0) b.write(',');
    b.write(intPart[i]);
  }
  return '${neg ? '-' : ''}$b';
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final Color accent;
  final Color accentBg;
  final String label;
  final String value;
  final String sub;
  const _KpiCard({
    required this.icon,
    required this.accent,
    required this.accentBg,
    required this.label,
    required this.value,
    required this.sub,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _kSlate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: accentBg,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 17, color: accent),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
              color: _kSlate400,
            ),
          ),
          const SizedBox(height: 1),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: AppFonts.body(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: _kSlate800,
              ),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            sub,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
                fontSize: 9.5, color: _kSlate400),
          ),
        ],
      ),
    );
  }
}

/// One auto-calculated entry as a mobile card (replaces the web's wide table
/// row): category title + activity/sub-item path + labelled Count/Bonus stats
/// and the total points chip.
class _AutoEntryCard extends StatelessWidget {
  final _AutoEntry entry;
  const _AutoEntryCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final path = [entry.activity, entry.subItem]
        .where((s) => s.isNotEmpty)
        .join('  ·  ');
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _kSlate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _showAutoEntryDetail(context, entry),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      entry.category.isEmpty ? 'Entry' : entry.category,
                      style: AppFonts.body(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: _kSlate800),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.muted,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _fmtPts(entry.total),
                      style: AppFonts.body(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: _kBlue),
                    ),
                  ),
                ],
              ),
              if (path.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(path,
                    style: AppFonts.body(
                        fontSize: 12, color: _kSlate500, height: 1.35)),
              ],
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.touch_app_rounded,
                      size: 13, color: _kSlate400),
                  const SizedBox(width: 4),
                  Text('Tap for breakdown',
                      style: AppFonts.body(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: _kSlate400)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Read-only breakdown of a single system-calculated (auto) entry, shown as a
/// bottom sheet when its card is tapped. All data is already loaded — no fetch.
void _showAutoEntryDetail(BuildContext context, _AutoEntry e) {
  final hasBonus = e.isBonus || e.bonus != 0 || e.bonusPoints != 0;
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (ctx) {
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: _kSlate200,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              // Gradient header: category + grand total for this entry.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  color: _kBlue,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      e.category.isEmpty ? 'Entry' : e.category,
                      style: AppFonts.body(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: Colors.white),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _fmtPts(e.total),
                      style: AppFonts.body(
                          fontSize: 30,
                          fontWeight: FontWeight.w900,
                          color: Colors.white,
                          height: 1),
                    ),
                    Text('Total points',
                        style: AppFonts.body(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: Colors.white.withValues(alpha: 0.85))),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              if (e.activity.isNotEmpty)
                _AutoDetailRow('Avenue', e.activity),
              if (e.subItemDisplay.isNotEmpty)
                _AutoDetailRow('Area of focus', e.subItemDisplay)
              else if (e.subItem.isNotEmpty)
                _AutoDetailRow('Sub-item', e.subItem),
              if (e.answerValue.isNotEmpty)
                _AutoDetailRow('Count / value', e.answerValue),
              if (e.basePoints != 0)
                _AutoDetailRow('Base points', _fmtPts(e.basePoints)),
              const Divider(height: 22, color: _kSlate200),
              _AutoDetailRow('Points earned', _fmtPts(e.points),
                  valueColor: _kBlue, strong: true),
              if (hasBonus) ...[
                _AutoDetailRow('Bonus earned', _fmtPts(e.bonus),
                    valueColor: _kEmerald, strong: true),
                if (e.minBonus != 0 || e.maxBonus != 0)
                  _AutoDetailRow(
                    'Bonus range',
                    'min ${_fmtPts(e.minBonus)} · max ${_fmtPts(e.maxBonus)}',
                  ),
              ],
              const Divider(height: 22, color: _kSlate200),
              _AutoDetailRow('Total', _fmtPts(e.total),
                  valueColor: _kSlate800, strong: true),
            ],
          ),
        ),
      );
    },
  );
}

class _AutoDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool strong;
  const _AutoDetailRow(this.label, this.value,
      {this.valueColor, this.strong = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(label,
                style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: _kSlate500)),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: AppFonts.body(
                  fontSize: strong ? 14.5 : 13,
                  fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
                  color: valueColor ?? _kSlate700),
            ),
          ),
        ],
      ),
    );
  }
}

class _ManualCategoryCard extends StatelessWidget {
  final _ManualCategory category;
  final bool readOnly;
  final VoidCallback onChanged;
  const _ManualCategoryCard({
    required this.category,
    required this.readOnly,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kSlate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Gradient header: icon badge + category name + earned subtotal.
          Container(
            padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
            decoration: const BoxDecoration(
              borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              color: AppColors.muted,
              border: Border(bottom: BorderSide(color: AppColors.muted)),
            ),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: AppColors.lightBorder,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.emoji_events_rounded,
                      size: 16, color: _kBlue),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    category.name,
                    style: AppFonts.body(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: _kSlate800),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: _kEmeraldBg,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.successLight),
                  ),
                  child: Text(
                    _fmtPts(category.totalEarned),
                    style: AppFonts.body(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.successDark),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: Column(
              children: [
                ...category.subCriteria.map(
                  (sc) => _SubCriteriaRow(
                    sub: sc,
                    readOnly: readOnly,
                    onChanged: onChanged,
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

class _SubCriteriaRow extends StatefulWidget {
  final _SubCriteria sub;
  final bool readOnly;
  final VoidCallback onChanged;
  const _SubCriteriaRow({
    required this.sub,
    required this.readOnly,
    required this.onChanged,
  });

  @override
  State<_SubCriteriaRow> createState() => _SubCriteriaRowState();
}

class _SubCriteriaRowState extends State<_SubCriteriaRow> {
  late final TextEditingController _numCtrl;

  @override
  void initState() {
    super.initState();
    _numCtrl = TextEditingController(text: widget.sub.answerValue ?? '');
  }

  @override
  void dispose() {
    _numCtrl.dispose();
    super.dispose();
  }

  void _setAnswer(String? v) {
    widget.sub.answerValue = v;
    widget.sub.recalculate();
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final sub = widget.sub;
    final earned = sub.earnedPoints + sub.earnedBonus;
    final hasEarned = earned > 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kSlate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(sub.label,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: _kSlate800,
                        height: 1.3)),
              ),
              const SizedBox(width: 8),
              // Earned-points pill: emerald when scored, neutral when zero.
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(
                  color: hasEarned ? _kEmeraldBg : AppColors.muted,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                      color: hasEarned
                          ? AppColors.successLight
                          : _kSlate200),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (hasEarned) ...[
                      const Icon(Icons.check_circle_rounded,
                          size: 12, color: AppColors.successDark),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      _fmtPts(earned),
                      style: AppFonts.body(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: hasEarned
                              ? AppColors.successDark
                              : _kSlate500),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (sub.remark != null && sub.remark!.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(sub.remark!,
                style: AppFonts.body(
                    fontSize: 11.5, color: _kSlate500, height: 1.35)),
          ],
          const SizedBox(height: 10),
          _inputFor(sub),
        ],
      ),
    );
  }

  Widget _inputFor(_SubCriteria sub) {
    switch (sub.answerType) {
      case 'yesno':
        return Row(
          children: [
            _YesNoToggle(
              value: sub.answerValue,
              readOnly: widget.readOnly,
              onChanged: (v) => setState(() => _setAnswer(v)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text('${sub.points.round()} pts if Yes',
                  style: AppFonts.body(
                      fontSize: 11.5, color: _kSlate500)),
            ),
          ],
        );
      case 'choose_one':
        final opts = sub.options;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final o in opts)
              _OptionTile(
                label: o.label,
                points: o.optionPoints.round(),
                selected: sub.answerValue == o.value,
                readOnly: widget.readOnly,
                onTap: () => setState(() => _setAnswer(o.value)),
              ),
          ],
        );
      case 'number':
      default:
        final hint = sub.isBonus
            ? '× ${sub.points.round()}  ·  bonus ${sub.bonusPoints.round()}'
            : '× ${sub.points.round()} per unit';
        return Row(
          children: [
            SizedBox(
              width: 96,
              child: TextField(
                controller: _numCtrl,
                enabled: !widget.readOnly,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: AppFonts.body(
                    fontSize: 14, fontWeight: FontWeight.w700),
                decoration: InputDecoration(
                  isDense: true,
                  filled: true,
                  fillColor: widget.readOnly ? _kSlate50 : Colors.white,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 10),
                  hintText: '0',
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _kSlate200),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _kBlue, width: 1.5),
                  ),
                  disabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _kSlate200),
                  ),
                ),
                onChanged: (v) => setState(() => _setAnswer(v)),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(hint,
                  style: AppFonts.body(
                      fontSize: 11.5, color: _kSlate500)),
            ),
          ],
        );
    }
  }
}

/// Yes / No segmented control — green Yes, rose No (web parity).
class _YesNoToggle extends StatelessWidget {
  final String? value;
  final bool readOnly;
  final ValueChanged<String> onChanged;
  const _YesNoToggle({
    required this.value,
    required this.readOnly,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final isYes = value == 'yes';
    final isNo = value == 'no';
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: _kSlate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _kSlate200),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _seg('Yes', isYes, _kEmerald,
              () => readOnly ? null : onChanged('yes')),
          _seg('No', isNo, _kRose, () => readOnly ? null : onChanged('no')),
        ],
      ),
    );
  }

  Widget _seg(String text, bool selected, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: readOnly ? null : onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? color : Colors.transparent,
          borderRadius: BorderRadius.circular(7),
        ),
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : _kSlate500,
          ),
        ),
      ),
    );
  }
}

/// A choose-one option as a tappable bordered tile (radio + label + points).
class _OptionTile extends StatelessWidget {
  final String label;
  final int points;
  final bool selected;
  final bool readOnly;
  final VoidCallback onTap;
  const _OptionTile({
    required this.label,
    required this.points,
    required this.selected,
    required this.readOnly,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: readOnly ? null : onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: selected ? AppColors.muted : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? _kBlue : _kSlate200,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_unchecked_rounded,
              size: 18,
              color: selected ? _kBlue : _kSlate400,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? AppColors.primaryDeep : _kSlate700,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '$points',
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: selected ? _kBlue : _kSlate400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ----------------------------------------------------------------------------
// Models
// ----------------------------------------------------------------------------

class _AutoEntry {
  final String category;
  final String activity;
  final String subItem;
  final String subItemDisplay;
  final String answerValue;
  final double points;
  final double bonus;
  // Breakdown fields (shown on the tap-through detail sheet).
  final double basePoints;
  final double bonusPoints;
  final double minBonus;
  final double maxBonus;
  final bool isBonus;

  const _AutoEntry({
    required this.category,
    required this.activity,
    required this.subItem,
    required this.subItemDisplay,
    required this.answerValue,
    required this.points,
    required this.bonus,
    this.basePoints = 0,
    this.bonusPoints = 0,
    this.minBonus = 0,
    this.maxBonus = 0,
    this.isBonus = false,
  });

  double get total => points + bonus;

  static double _num(dynamic v) =>
      (v is num) ? v.toDouble() : (double.tryParse(v?.toString() ?? '') ?? 0);

  factory _AutoEntry.fromJson(Map<String, dynamic> j) {
    final pRaw = j['pointsEarned'] ?? j['points'];
    final bRaw = j['bonusEarned'] ?? j['bonus'] ?? j['bonusPoints'];
    return _AutoEntry(
      category: (j['categoryName'] ?? j['category'] ?? '').toString(),
      activity: (j['activityName'] ?? j['activity'] ?? '').toString(),
      subItem: (j['subItemName'] ?? j['subItemType'] ?? j['subItem'] ?? '').toString(),
      subItemDisplay: (j['subItemDisplay'] ?? '').toString(),
      answerValue: (j['answerValue'] ?? j['count'] ?? '').toString(),
      points: (pRaw is num) ? pRaw.toDouble() : (double.tryParse(pRaw?.toString() ?? '') ?? 0),
      bonus: (bRaw is num) ? bRaw.toDouble() : (double.tryParse(bRaw?.toString() ?? '') ?? 0),
      basePoints: _num(j['subBasePoints'] ?? j['basePoints']),
      bonusPoints: _num(j['subBonusPoints'] ?? j['bonusPoints']),
      minBonus: _num(j['minBonus']),
      maxBonus: _num(j['maxBonus']),
      isBonus: j['subIsBonus'] == true || j['isBonus'] == true,
    );
  }
}

class _ManualCategory {
  final int id;
  final String name;
  final List<_SubCriteria> subCriteria;

  _ManualCategory({
    required this.id,
    required this.name,
    required this.subCriteria,
  });

  double get totalEarned =>
      subCriteria.fold(0.0, (s, c) => s + c.earnedPoints + c.earnedBonus);

  factory _ManualCategory.fromJson(Map<String, dynamic> j) {
    final subs = (j['subCriteria'] ?? j['items'] ?? const []) as List;
    return _ManualCategory(
      id: (j['criteriaId'] as num?)?.toInt() ??
          (j['id'] as num?)?.toInt() ??
          (j['categoryId'] as num?)?.toInt() ??
          0,
      name: (j['categoryName'] ?? j['name'] ?? '').toString(),
      subCriteria: subs
          .map((s) => _SubCriteria.fromJson(s as Map<String, dynamic>))
          .toList(),
    );
  }
}

class _SubCriteria {
  final int id;
  final String title;
  final String? remark;
  final String answerType; // 'number' | 'yesno' | 'choose_one'
  final double points;
  final bool isBonus;
  final double bonusPoints;
  final double minBonus;
  final double maxBonus;
  final List<_Option> options;

  String? answerValue;
  double earnedPoints;
  double earnedBonus;

  _SubCriteria({
    required this.id,
    required this.title,
    this.remark,
    required this.answerType,
    required this.points,
    this.isBonus = false,
    this.bonusPoints = 0,
    this.minBonus = 0,
    this.maxBonus = 0,
    required this.options,
    this.answerValue,
    this.earnedPoints = 0,
    this.earnedBonus = 0,
  });

  // For backwards compat, expose label
  String get label => title;
  // For backwards compat, expose inputType mapped
  String get inputType {
    switch (answerType) {
      case 'choose_one': return 'chooseone';
      case 'yesno': return 'yesno';
      default: return 'number';
    }
  }

  void recalculate() {
    if (answerType == 'choose_one') {
      final opt = options.firstWhere(
        (o) => o.value == answerValue,
        orElse: () => const _Option(value: '', label: '', optionPoints: 0),
      );
      earnedPoints = opt.optionPoints;
      earnedBonus = 0;
      return;
    }
    if (answerType == 'yesno') {
      final yes = answerValue == 'yes';
      earnedPoints = yes ? points : 0;
      earnedBonus = 0;
      return;
    }
    // number
    final numVal = double.tryParse(answerValue ?? '') ?? 0;
    if (numVal == 0) {
      earnedPoints = 0;
      earnedBonus = 0;
      return;
    }
    earnedPoints = numVal * points;
    double bonus = 0;
    if (isBonus) {
      if (minBonus == 0 && maxBonus == 0) {
        // flat bonus
        bonus = bonusPoints;
      } else {
        if (numVal >= minBonus && minBonus > 0) {
          bonus = bonusPoints;
        }
      }
      if (maxBonus > 0 && numVal > maxBonus) {
        earnedPoints = maxBonus * points;
      }
    }
    earnedBonus = bonus;
  }

  /// Canonicalises a server `answerType` to 'number' | 'yesno' | 'choose_one'.
  /// Mirrors the web `normalizeAnswerType` so legacy/migrated casing ("Yes/No",
  /// "Boolean", "radio", "Choose One"…) still renders the correct input instead
  /// of silently falling through to a number field.
  static String _normalizeAnswerType(String raw, List<_Option> options) {
    final r = raw.toLowerCase().trim().replaceAll(RegExp(r'[\s_-]'), '');
    if (r == 'yesno' || r == 'yn' || r == 'boolean' || r == 'bool' ||
        r == 'yes' || r == 'no') {
      return 'yesno';
    }
    if (r == 'chooseone' || r == 'choose' || r == 'select' || r == 'option' ||
        r == 'options' || r == 'radio' || options.isNotEmpty) {
      return 'choose_one';
    }
    return 'number';
  }

  factory _SubCriteria.fromJson(Map<String, dynamic> j) {
    final options = ((j['options'] as List?) ?? const [])
        .map((o) => _Option.fromJson(o as Map<String, dynamic>))
        .toList();
    final rawType =
        (j['answerType'] ?? j['inputType'] ?? j['type'] ?? 'number').toString();
    final sc = _SubCriteria(
      id: (j['id'] as num?)?.toInt() ??
          (j['subCriteriaId'] as num?)?.toInt() ??
          0,
      title: (j['title'] ?? j['label'] ?? j['name'] ?? j['subCriteriaName'] ?? '')
          .toString(),
      remark: j['remark']?.toString(),
      answerType: _normalizeAnswerType(rawType, options),
      points: (j['points'] as num?)?.toDouble() ??
          (j['pointsPerUnit'] as num?)?.toDouble() ?? 0,
      isBonus: j['isBonus'] as bool? ?? false,
      bonusPoints: (j['bonusPoints'] as num?)?.toDouble() ??
          (j['bonusPerUnit'] as num?)?.toDouble() ?? 0,
      minBonus: (j['minBonus'] as num?)?.toDouble() ?? 0,
      maxBonus: (j['maxBonus'] as num?)?.toDouble() ?? 0,
      options: options,
      answerValue: (j['answerValue'] ?? j['currentAnswer'])?.toString(),
      earnedPoints: (j['pointsEarned'] ?? j['earnedPoints'] as num?)?.toDouble() ?? 0,
      earnedBonus: (j['bonusEarned'] ?? j['earnedBonus'] as num?)?.toDouble() ?? 0,
    );
    // If points weren't pre-computed but answerValue exists, compute once.
    if (sc.earnedPoints == 0 && sc.earnedBonus == 0 && sc.answerValue != null) {
      sc.recalculate();
    }
    return sc;
  }
}

class _Option {
  final String value;
  final String label;
  final double optionPoints;
  const _Option({
    required this.value,
    required this.label,
    required this.optionPoints,
  });

  factory _Option.fromJson(Map<String, dynamic> j) => _Option(
        value: (j['id'] ?? j['value'] ?? '').toString(),
        label: (j['optionText'] ?? j['label'] ?? j['name'] ?? '').toString(),
        optionPoints: (j['optionPoints'] ?? j['points'] as num?)?.toDouble() ?? 0,
      );
}

class _CitationTabBarDelegate extends SliverPersistentHeaderDelegate {
  final Widget child;
  // Pill track: Tab(36) + inner padding(10) + outer padding(12) ≈ 58.
  static const double _height = 58;
  _CitationTabBarDelegate(this.child);

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Material(color: _kSlate50, child: child);
  }

  @override
  bool shouldRebuild(covariant _CitationTabBarDelegate oldDelegate) =>
      oldDelegate.child != child;
}
