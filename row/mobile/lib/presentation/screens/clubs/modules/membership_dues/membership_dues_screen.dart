import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:flutter_quill/flutter_quill.dart' as quill;
import 'package:flutter_quill_delta_from_html/flutter_quill_delta_from_html.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:vsc_quill_delta_to_html/vsc_quill_delta_to_html.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/constants/feature_flags.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/file_download_utils.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/providers/auth_provider.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/dues_kpi_cards.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

class MembershipDuesScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const MembershipDuesScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<MembershipDuesScreen> createState() => _MembershipDuesScreenState();
}

/// Money KPIs for one Rotary year, rolled up from the dues setups themselves.
///
/// Deliberately NOT the club-dashboard `/payments` aggregate: that one charges
/// every active member the campaign's configured default and only counts money
/// once a member has paid that whole amount in full, which reads as
/// "Collected 0 / 0% / 0 fully paid" for any club still collecting its first
/// half — while the setup card directly below reports those members as paid.
///
/// Definitions here, matching what the Members page shows:
///  * a member's DUE is the campaign's base fee — the Annual fee when that plan
///    is enabled and non-zero, otherwise Semi 1 + Semi 2 (Annual and the two
///    halves are the same money, so they're never added together);
///  * a fee slot counts as COLLECTED at its base amount once any payment has
///    settled it, so paying Semi 1 credits half the year instead of nothing;
///  * paying the Annual slot settles the whole year.
///
/// Base amounts (not the per-member stored rows) are used throughout, per the
/// API's own note that display-only consumers should read `*BaseAmount`. They
/// also keep the online gateway surcharge out of the totals, so Collected can
/// never exceed Total.
class _DuesYearKpis {
  final double totalDue;
  final double totalCollected;
  final int memberCount;
  final int paidCount;
  final int partialCount;
  final int unpaidCount;

  const _DuesYearKpis({
    required this.totalDue,
    required this.totalCollected,
    required this.memberCount,
    required this.paidCount,
    required this.partialCount,
    required this.unpaidCount,
  });

  const _DuesYearKpis.empty()
      : totalDue = 0,
        totalCollected = 0,
        memberCount = 0,
        paidCount = 0,
        partialCount = 0,
        unpaidCount = 0;

  /// Adds a second setup's roll-up onto this one (a year can hold more than one).
  _DuesYearKpis plus(_DuesYearKpis o) => _DuesYearKpis(
        totalDue: totalDue + o.totalDue,
        totalCollected: totalCollected + o.totalCollected,
        memberCount: memberCount + o.memberCount,
        paidCount: paidCount + o.paidCount,
        partialCount: partialCount + o.partialCount,
        unpaidCount: unpaidCount + o.unpaidCount,
      );

  static bool _flag(dynamic v) => v == true || v == 1 || v == '1';
  static double _num(dynamic v) => (v as num?)?.toDouble() ?? 0;

  /// Rolls up one `/api/membership-dues/{id}/members` response.
  factory _DuesYearKpis.fromMembersResponse(Map<String, dynamic> data) {
    final cfg = (data['config'] as Map?)?.cast<String, dynamic>() ?? const {};
    final rows = (data['members'] ?? data['items']) as List<dynamic>? ?? const [];
    // Config absent (older shape) → assume the Annual slot, same fallback the
    // Members page uses.
    final hasAnnual = _flag(cfg['isFees1']) || cfg['isFees1'] == null;
    final hasSemi1 = _flag(cfg['isFees2']);
    final hasSemi2 = _flag(cfg['isFees3']);

    double due = 0, collected = 0;
    int paid = 0, partial = 0, unpaid = 0, members = 0;

    for (final r in rows) {
      if (r is! Map) continue;
      final m = r.cast<String, dynamic>();
      final annual = hasAnnual ? _num(m['annualBaseAmount']) : 0.0;
      final semi1 = hasSemi1 ? _num(m['semi1BaseAmount']) : 0.0;
      final semi2 = hasSemi2 ? _num(m['semi2BaseAmount']) : 0.0;
      // Annual and Semi1+Semi2 are the same money — never both.
      final memberDue = annual > 0 ? annual : semi1 + semi2;
      if (memberDue <= 0) continue; // not allocated a fee — owes nothing yet
      members++;
      due += memberDue;

      double memberPaid;
      if (_num(m['annualPaid']) > 0) {
        memberPaid = memberDue; // the annual slot settles the whole year
      } else {
        memberPaid = (_num(m['semi1Paid']) > 0 ? semi1 : 0) +
            (_num(m['semi2Paid']) > 0 ? semi2 : 0);
        if (memberPaid > memberDue) memberPaid = memberDue;
      }
      collected += memberPaid;

      // 1-paisa tolerance — the same allowance the server makes for amounts
      // reconstructed from a rounded charge.
      if (memberPaid >= memberDue - 0.01) {
        paid++;
      } else if (memberPaid > 0) {
        partial++;
      } else {
        unpaid++;
      }
    }

    return _DuesYearKpis(
      totalDue: due,
      totalCollected: collected,
      memberCount: members,
      paidCount: paid,
      partialCount: partial,
      unpaidCount: unpaid,
    );
  }
}

class _MembershipDuesScreenState extends State<MembershipDuesScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  // Money KPI cards (Total/Collected/Pending/Collection-Rate) for the selected
  // year. Rolled up from the SETUPS THIS SCREEN IS SHOWING — one
  // `/api/membership-dues/{id}/members` read per setup — instead of the club
  // dashboard's `/payments` aggregate. The dashboard aggregate assumes every
  // active member owes the campaign's configured default and counts a member
  // only once they've paid that WHOLE amount, so a club collecting in halves
  // reads "Collected 0" while the setup card right below it says "Paid: 13".
  // Rolling up the same member rows the Members page shows keeps every number
  // on this screen telling the same story. Null = no concrete year selected
  // (e.g. "All Years") or the fetch failed → cards are hidden.
  _DuesYearKpis? _payments;

  /// Web frontend origin (the brand's admin origin, else the API base minus its
  /// `/API` suffix) — used to build the public pay/report page links the web table exposes.
  String get _webOrigin => Brand.current.adminOrigin.isNotEmpty
      ? Brand.current.adminOrigin
      : ApiConstants.baseUrl.replaceFirst(RegExp(r'/API/?$', caseSensitive: false), '');

  // ALL setups for the club (every year) — one fetch drives both the list and
  // the year dropdown, so the dropdown can only ever show years that actually
  // have a setup, and can never disagree with what's displayed.
  List<dynamic> _allDues = [];
  bool _loading = true;

  List<dynamic> _years = []; // synthesized: only years that have ≥1 setup
  String? _selectedYear; // null = "All Years"
  bool _yearInitialized = false; // default the year only on the first load

  /// The setups shown right now: [_allDues] filtered by the selected year and
  /// the search box, entirely client-side.
  List<dynamic> get _visibleDues {
    final q = _searchCtrl.text.trim().toLowerCase();
    return _allDues.where((d) {
      if (d is! Map) return false;
      if (_selectedYear != null && _selectedYear!.isNotEmpty) {
        if ((d['rotaryYear']?.toString().trim() ?? '') != _selectedYear) {
          return false;
        }
      }
      if (q.isNotEmpty) {
        final hay = [d['purpose'], d['name'], d['clubName'], d['districtNumber']]
            .where((e) => e != null)
            .map((e) => e.toString().toLowerCase())
            .join(' ');
        if (!hay.contains(q)) return false;
      }
      return true;
    }).toList();
  }

  bool get _canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  /// Backend `GET /api/membership-dues` returns 403 unless the caller has
  /// the SuperAdmin or Admin role (`MembershipDuesController.cs:43`). Plain
  /// Members opening this module from the unified club view would otherwise
  /// see a misleading "Failed to load" snackbar.
  bool get _isAdminRole =>
      Provider.of<AuthProvider>(context, listen: false).isAdmin;

  @override
  void initState() {
    super.initState();
    if (!_isAdminRole) {
      _loading = false;
      return;
    }
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Load EVERY dues setup for the club in one shot (the list endpoint returns
  /// all years when no `year` filter is passed — `GetListAsync` only adds the
  /// year clause when one is supplied). The year dropdown is then derived from
  /// the distinct `rotaryYear` values actually present, and the list is filtered
  /// client-side ([_visibleDues]) — so the dropdown only ever shows years that
  /// truly have a setup. `/api/rotary-years` is used only to flag the current
  /// year (for the "(Current)" tag + the initial default).
  Future<void> _load() async {
    setState(() => _loading = true);
    final dataYears = <String>{};
    String? currentYearLabel;
    try {
      final resp = await _api.get(
        '/api/membership-dues',
        queryParams: {'clubId': widget.clubId},
        fromJson: (j) => j,
      );
      final raw = resp.data;
      final list = raw is List
          ? raw
          : (raw is Map<String, dynamic>
              ? (raw['items'] as List<dynamic>? ?? const [])
              : const []);
      _allDues = list;
      for (final d in list) {
        if (d is Map<String, dynamic>) {
          final y = d['rotaryYear']?.toString().trim();
          if (y != null && y.isNotEmpty) dataYears.add(y);
        }
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load club dues');
    }
    try {
      final yrResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      for (final y in (yrResp.data ?? const [])) {
        if (y['isCurrent'] == true || y['isCurrent'] == 1) {
          currentYearLabel = y['yearLabel']?.toString();
        }
      }
    } catch (_) {
      // Current-year flag unavailable -- default to the newest data year.
    }

    if (!mounted) return;
    final sorted = dataYears.toList()..sort((a, b) => b.compareTo(a)); // newest first
    setState(() {
      _years = sorted
          .map((label) => {
                'yearLabel': label,
                'isCurrent': label == currentYearLabel,
              })
          .toList();
      if (!_yearInitialized) {
        _yearInitialized = true;
        _selectedYear =
            (currentYearLabel != null && dataYears.contains(currentYearLabel))
                ? currentYearLabel
                : (sorted.isNotEmpty ? sorted.first : null);
      } else if (_selectedYear != null && !dataYears.contains(_selectedYear)) {
        _selectedYear = null; // previously-selected year no longer has a setup
      }
      _loading = false;
    });
    _loadPayments();
  }

  /// Roll the money KPIs up from every dues setup in the selected year, reading
  /// the same member rows the Members page does. Best-effort: when no concrete
  /// year is selected ("All Years") or every call fails, the cards are simply
  /// hidden — the setups list still renders.
  ///
  /// Scoped to the YEAR, not to the search box, so typing in search doesn't make
  /// the totals jump around.
  Future<void> _loadPayments() async {
    final label = _selectedYear;
    if (label == null || label.isEmpty) {
      if (mounted) setState(() => _payments = null);
      return;
    }
    final ids = _allDues
        .whereType<Map>()
        .where((d) => (d['rotaryYear']?.toString().trim() ?? '') == label)
        .map((d) => (d['id'] as num?)?.toInt())
        .whereType<int>()
        .toList();
    if (ids.isEmpty) {
      if (mounted) setState(() => _payments = null);
      return;
    }

    var totals = const _DuesYearKpis.empty();
    var anyOk = false;
    for (final id in ids) {
      try {
        final resp =
            await _api.get('/api/membership-dues/$id/members', fromJson: (j) => j);
        final data = resp.data;
        // `{ config, members: [...] }` is the current shape; older builds
        // returned a bare list or `{ items }` (see DuesRosterScreen._load).
        final Map<String, dynamic> body = data is Map
            ? data.cast<String, dynamic>()
            : data is List
                ? {'members': data}
                : const {};
        if (body.isEmpty) continue;
        totals = totals.plus(_DuesYearKpis.fromMembersResponse(body));
        anyOk = true;
      } catch (_) {
        // One unreadable setup shouldn't blank the whole strip.
      }
    }
    if (!mounted) return;
    setState(() => _payments = anyOk ? totals : null);
  }

  void _openForm({Map<String, dynamic>? due}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _DueFormScreen(
          clubId: widget.clubId,
          due: due,
          onSaved: () => _load(),
        ),
      ),
    );
  }

  void _openRoster(Map<String, dynamic> due) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DuesRosterScreen(
          clubId: widget.clubId,
          duesId: due['id'] as int,
          duesName: (due['purpose'] ?? due['name'])?.toString() ?? 'Club Due',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canManage = _canManage;
    final visibleDues = _visibleDues;
    if (!_isAdminRole) {
      return Scaffold(
        appBar:
            widget.embedded ? null : const CustomAppBar(title: 'Club Dues'),
        body: const EmptyStateWidget(
          icon: Icons.lock_outline,
          title: 'Admin Only',
          subtitle:
              'Club Dues are managed by club and district admins. '
              'Members do not have access to this module.',
        ),
      );
    }
    return Scaffold(
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Club Dues'),
      // No create FAB: dues setups are seeded by SuperAdmin, not club admins
      // (mirrors the web list, which has no Add button). Club admins only
      // edit existing setups.
      body: _loading
          ? const LoadingWidget()
          : Column(
              children: [
                // Year picker — same white rounded box as the District Awards
                // screen (calendar + "Rotary Year" + underline-less dropdown).
                if (_years.isNotEmpty) _yearPickerBox(),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () => _load(),
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        // Money KPI cards for the selected year (hidden on
                        // "All Years" / fetch failure) — web-parity header.
                        if (_payments != null) ...[
                          DuesKpiCards(
                            totalDue: _payments!.totalDue,
                            totalCollected: _payments!.totalCollected,
                            memberCount: _payments!.memberCount,
                            paidCount: _payments!.paidCount,
                            partialCount: _payments!.partialCount,
                            unpaidCount: _payments!.unpaidCount,
                          ),
                          const SizedBox(height: 16),
                        ],
                        if (visibleDues.isEmpty)
                          _duesEmptyState()
                        else
                          for (var i = 0; i < visibleDues.length; i++) ...[
                            _buildDueCard(visibleDues[i], canManage),
                            if (i != visibleDues.length - 1)
                              const SizedBox(height: 8),
                          ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  // ── Per-setup row actions (mirror the web table's View|Copy URL / Report /
  // Report Link / GoogleSheet columns) ──

  Future<void> _launch(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Could not open the link.');
    }
  }

  void _copy(String text, String message) {

    Clipboard.setData(ClipboardData(text: text));
    if (mounted) SnackbarUtils.showSuccess(context, message);
  }

  Future<void> _downloadReport(int id) async {
    // The API generates an auth-gated XLSX workbook (switched from CSV on
    // 2026-06-24 — colored Status cells + Settled/Mode/Date columns); fetch the
    // bytes and hand to the share sheet. The shared file MUST carry the .xlsx
    // extension or Excel/Sheets mis-detect the workbook.
    await shareServerFile(
      context,
      filePath: '/api/membership-dues/$id/export',
      fileName: 'membership-dues-$id.xlsx',
    );
  }

  // Rotary-year picker — replicates the District Awards screen's
  // `_buildYearPicker`: white rounded box, calendar + "Rotary Year" label, then
  // an underline-less DropdownButton. '' = All Years (value always matches).
  Widget _yearPickerBox() {
    // '' = All Years (dropdown value always matches); map it back to null so the
    // existing filter semantics (null/'' = All Years) are preserved.
    return RotaryYearBar<String>(
      value: _selectedYear ?? '',
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      options: [
        const RotaryYearOption(value: '', label: 'All Years'),
        for (final y in _years)
          RotaryYearOption(
            value: (y['yearLabel']?.toString() ?? ''),
            label: (y['yearLabel']?.toString() ?? ''),
            isCurrent: y['isCurrent'] == true || y['isCurrent'] == 1,
          ),
      ],
      onChanged: (v) {
        setState(() => _selectedYear = (v == null || v.isEmpty) ? null : v);
        _loadPayments();
      },
    );
  }

  // Per-setup overflow menu — Edit (when manageable) + secondary actions
  // (View / Copy URL / Report / Report Link / Google Sheet). Primary Members
  // stays a button; Edit lives here alongside the other management actions.
  Widget _cardMenu(Map<String, dynamic> due, bool canManage) {
    final id = due['id'] as int?;
    if (id == null) return const SizedBox.shrink();
    final sheetId = (due['googleSheetId']?.toString() ?? '').trim();
    final payUrl = '$_webOrigin/pay/dues/$id';
    final reportUrl = '$_webOrigin/report/dues/$id';
    final sheetUrl = 'https://docs.google.com/spreadsheets/d/$sheetId';
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
      tooltip: 'More',
      onSelected: (v) {
        switch (v) {
          case 'edit':
            _openForm(due: due);
            break;
          case 'copy':
            _copy(payUrl, 'Payment URL copied.');
            break;
          case 'report':
            _downloadReport(id);
            break;
          case 'reportlink':
            _copy(reportUrl, 'Report link copied.');
            break;
          case 'sheet':
            _launch(sheetUrl);
            break;
          case 'sheetcopy':
            _copy(sheetUrl, 'Google Sheet URL copied.');
            break;
        }
      },
      itemBuilder: (_) => [
        if (canManage) _menuItem('edit', Icons.edit_outlined, 'Edit'),
        _menuItem('copy', Icons.link, 'Copy payment URL'),
        _menuItem('report', Icons.grid_on, 'Download report (Excel)'),
        _menuItem('reportlink', Icons.insert_link, 'Copy report link'),
        if (sheetId.isNotEmpty) ...[
          _menuItem('sheet', Icons.table_chart_outlined, 'Open Google Sheet'),
          _menuItem(
              'sheetcopy', Icons.copy_all_outlined, 'Copy Google Sheet URL'),
        ],
      ],
    );
  }

  PopupMenuItem<String> _menuItem(String value, IconData icon, String label) {
    return PopupMenuItem<String>(
      value: value,
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: 10),
          Text(label),
        ],
      ),
    );
  }

  Widget _countPill(String label, int n, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text('$label: $n',
          style: AppTextStyles.caption
              .copyWith(color: color, fontWeight: FontWeight.w700)),
    );
  }

  /// Compact, screen-local empty state for the dues list.
  ///
  /// Deliberately NOT the shared [EmptyStateWidget] here: that one uses the
  /// Geist heading family and a large hero icon, which clashes with this
  /// screen's compact Plus Jakarta Sans cards/KPIs. This matches the dues-card
  /// look — small tinted chip + PJS text via [AppTextStyles].
  Widget _duesEmptyState() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.primaryPrime.withOpacity(0.08),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.receipt_long_rounded,
                size: 28, color: AppColors.primaryPrime),
          ),
          const SizedBox(height: 14),
          Text(
            'No club dues configured',
            textAlign: TextAlign.center,
            style: AppTextStyles.bodyLarge.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            'Club dues for this year haven\'t been set up yet.',
            textAlign: TextAlign.center,
            style:
                AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  /// Primary card action button — matches the app design language
  /// (flat, radius 12, Plus Jakarta Sans w700, white-on-primary, h44),
  /// mirroring `club_citation_screen`'s save button rather than the default
  /// pill-shaped FilledButton.
  Widget _cardAction({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
  }) {
    return FilledButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 18),
      label: Text(
        label,
        style:
            AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w700),
      ),
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        minimumSize: const Size.fromHeight(44),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        shape: const StadiumBorder(),
      ),
    );
  }

  Widget _buildDueCard(Map<String, dynamic> due, bool canManage) {
    final isActive = due['isActive'] as bool? ?? false;
    final purpose = (due['purpose'] ?? due['name'])?.toString() ?? '';
    final rotaryYear = due['rotaryYear']?.toString() ?? '';
    final paidCount = due['paidCount'] as int? ?? 0;
    final unpaidCount = due['unpaidCount'] as int? ?? 0;
    final statusColor = isActive ? AppColors.success : AppColors.textMuted;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: icon · title + year + status · overflow
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.receipt_long,
                    color: AppColors.primary, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(purpose,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.body
                            .copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        if (rotaryYear.isNotEmpty) ...[
                          Text(rotaryYear,
                              style: AppTextStyles.caption.copyWith(
                                  color: AppColors.textSecondary,
                                  fontWeight: FontWeight.w600)),
                          const SizedBox(width: 8),
                        ],
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: statusColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(isActive ? 'Active' : 'Inactive',
                              style: AppTextStyles.caption.copyWith(
                                  fontSize: 13,
                                  color: statusColor,
                                  fontWeight: FontWeight.w700)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              _cardMenu(due, canManage),
            ],
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(left: 2),
            child: Row(
              children: [
                _countPill('Paid', paidCount, AppColors.success),
                const SizedBox(width: 8),
                _countPill('Unpaid', unpaidCount, AppColors.error),
              ],
            ),
          ),
          const SizedBox(height: 12),
          // Primary actions: Members + Pay Now (opens the public payment page).
          // Edit + secondary actions live in the ⋮ menu. Both buttons match the
          // app design language (radius 12, PJS w700, flat) — see
          // club_citation_screen's save button.
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Row(
              children: [
                Expanded(
                  child: _cardAction(
                    icon: Icons.groups_outlined,
                    label: 'Members',
                    onPressed: () => _openRoster(due),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _cardAction(
                    icon: Icons.payments_outlined,
                    label: 'Pay Now',
                    onPressed: () =>
                        _launch('$_webOrigin/pay/dues/${due['id']}'),
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

// -- Form BottomSheet ---------------------------------------------------------

// Read-only previews of the template the backend wraps around the admin-authored
// body — shown above the Email Body / Reminder Email Body editors (web parity).
const String _kReceiptTemplate = 'Dear *****,\n'
    'District Number : ****\n'
    'Club Name : **** **** **** ****\n'
    'Purpose of the payment : ****\n'
    'Amount received : ****/-\n'
    'Date and time : ****\n'
    'Method of payment : ****\n'
    'Transaction ID : ****';

const String _kReminderTemplate = 'Dear *****,\n'
    'District Number : ****\n'
    'Club Name : **** **** **** ****\n'
    'Purpose of the payment : ****\n'
    'Outstanding amount : ****/-\n'
    'Status : ****\n'
    'Click on the link : ****';

class _DueFormScreen extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? due;
  final VoidCallback onSaved;

  const _DueFormScreen({required this.clubId, required this.onSaved, this.due});

  @override
  State<_DueFormScreen> createState() => _DueFormScreenState();
}

/// Edit Membership Dues form — mirrors the web v2 edit page:
/// Section 1 Basic Information (Title + rich-text Description),
/// Section 2 Images (Logo / Background / Email Logo with previews),
/// Section 3 Email Settings (CC, Subject, rich-text Body, Reminder Subject,
/// rich-text Reminder Body). Saves via PATCH /api/membership-dues/{id}/basic.
class _DueFormScreenState extends State<_DueFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  // Plain-text fields.
  final _purposeCtrl = TextEditingController();
  final _emailCcCtrl = TextEditingController();
  final _emailSubjectCtrl = TextEditingController();
  final _emailReminderSubjectCtrl = TextEditingController();

  // Rich-text (HTML) editors — built after the detail loads.
  quill.QuillController? _descCtrl;
  quill.QuillController? _emailBodyCtrl;
  quill.QuillController? _emailReminderBodyCtrl;

  // Images: existing server paths (for preview) + newly picked local files.
  String? _logoUrl, _bgImageUrl, _emailLogoUrl;
  String? _logoPath, _bgImagePath, _emailLogoPath;

  bool _loading = false;
  bool _saving = false;

  bool get _isEdit => widget.due != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _loadDetail();
    } else {
      // Create path is unreachable (Add button removed), kept safe.
      _descCtrl = _makeQuill(null);
      _emailBodyCtrl = _makeQuill(null);
      _emailReminderBodyCtrl = _makeQuill(null);
      _emailSubjectCtrl.text = 'Payment received successfully!';
      _emailReminderSubjectCtrl.text = 'Payment Reminder';
    }
  }

  quill.QuillController _makeQuill(String? html) {
    final delta = (html != null && html.trim().isNotEmpty)
        ? HtmlToDelta().convert(html)
        : null;
    return quill.QuillController(
      document:
          delta != null ? quill.Document.fromDelta(delta) : quill.Document(),
      selection: const TextSelection.collapsed(offset: 0),
    );
  }

  /// Pull the FULL setup from GET /api/membership-dues/{id} (the web's
  /// getMembershipDuesDetail) and build the controllers from it.
  Future<void> _loadDetail() async {
    final id = widget.due!['id'];
    setState(() => _loading = true);
    Map<String, dynamic> d = Map<String, dynamic>.from(widget.due!);
    try {
      final resp =
          await _api.get('/api/membership-dues/$id', fromJson: (j) => j);
      if (resp.data is Map<String, dynamic>) {
        d = resp.data as Map<String, dynamic>;
      }
    } catch (_) {
      // Fall back to the list item.
    }
    if (!mounted) return;
    String? s(dynamic v) => v?.toString();
    _purposeCtrl.text = s(d['purpose'] ?? d['name']) ?? '';
    _emailCcCtrl.text = s(d['emailCC'] ?? d['emailCc']) ?? '';
    _emailSubjectCtrl.text =
        s(d['emailSubject']) ?? 'Payment received successfully!';
    _emailReminderSubjectCtrl.text =
        s(d['emailReminderSubject']) ?? 'Payment Reminder';
    _logoUrl = s(d['purposeLogo']);
    _bgImageUrl = s(d['backgroundImage']);
    _emailLogoUrl = s(d['emailHeaderLogo']);
    _descCtrl = _makeQuill(s(d['purposeDescription'] ?? d['description']));
    _emailBodyCtrl = _makeQuill(s(d['emailBody']));
    _emailReminderBodyCtrl = _makeQuill(s(d['emailReminderBody']));
    setState(() => _loading = false);
  }

  @override
  void dispose() {
    _purposeCtrl.dispose();
    _emailCcCtrl.dispose();
    _emailSubjectCtrl.dispose();
    _emailReminderSubjectCtrl.dispose();
    _descCtrl?.dispose();
    _emailBodyCtrl?.dispose();
    _emailReminderBodyCtrl?.dispose();
    super.dispose();
  }

  String _htmlOf(quill.QuillController? c) {
    if (c == null) return '';
    final delta = c.document.toDelta();
    final converter = QuillDeltaToHtmlConverter(
      List<Map<String, dynamic>>.from(delta.toJson()),
      ConverterOptions.forEmail(),
    );
    return converter.convert();
  }

  Future<void> _pickImage(void Function(String) onPicked) async {
    try {
      final result = await FilePicker.platform.pickFiles(type: FileType.image);
      if (result == null || result.files.isEmpty) return;
      final p = result.files.first.path;
      if (p != null) setState(() => onPicked(p));
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to pick image');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final fields = <String, String>{
        'purpose': _purposeCtrl.text.trim(),
        'purposeDescription': _htmlOf(_descCtrl),
        'emailCC': _emailCcCtrl.text.trim(),
        'emailSubject': _emailSubjectCtrl.text.trim(),
        'emailBody': _htmlOf(_emailBodyCtrl),
        'emailReminderSubject': _emailReminderSubjectCtrl.text.trim(),
        'emailReminderBody': _htmlOf(_emailReminderBodyCtrl),
      };
      final files = <String, String>{
        if (_logoPath != null) 'logo': _logoPath!,
        if (_bgImagePath != null) 'bgImage': _bgImagePath!,
        if (_emailLogoPath != null) 'emailLogo': _emailLogoPath!,
      };
      await _api.sendMultipart(
        '/api/membership-dues/${widget.due!['id']}/basic',
        method: 'PATCH',
        fields: fields,
        files: files.isNotEmpty ? files : null,
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Updated');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = !_loading && _descCtrl != null;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Edit Club Dues'),
      body: !ready
          ? const RowSkeletonList()
          : Form(
              key: _formKey,
              autovalidateMode: AutovalidateMode.onUserInteraction,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                children: [
                  _sectionCard(1, Icons.info_outline, 'Basic Information',
                      AppColors.accentBlue, [
                    _label('Purpose / Title', required: true),
                    const SizedBox(height: 6),
                    TextFormField(
                      controller: _purposeCtrl,
                      decoration: _dec('Enter title'),
                      validator: (v) => v == null || v.trim().isEmpty
                          ? 'Purpose is required'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    _label('Description'),
                    const SizedBox(height: 6),
                    _HtmlField(controller: _descCtrl!),
                  ]),
                  const SizedBox(height: 14),
                  _sectionCard(2, Icons.image_outlined, 'Images',
                      AppColors.accentPurple, [
                    _imageField('Logo', _logoUrl, _logoPath,
                        () => _pickImage((p) => _logoPath = p)),
                    const SizedBox(height: 14),
                    _imageField('Background Image', _bgImageUrl, _bgImagePath,
                        () => _pickImage((p) => _bgImagePath = p)),
                    const SizedBox(height: 14),
                    _imageField('Email Logo', _emailLogoUrl, _emailLogoPath,
                        () => _pickImage((p) => _emailLogoPath = p)),
                  ]),
                  const SizedBox(height: 14),
                  _sectionCard(3, Icons.email_outlined, 'Email Settings',
                      AppColors.success, [
                    _label('Email CC'),
                    const SizedBox(height: 6),
                    TextFormField(
                        controller: _emailCcCtrl,
                        decoration: _dec('email@example.com')),
                    const SizedBox(height: 14),
                    _label('Email Subject'),
                    const SizedBox(height: 6),
                    TextFormField(
                        controller: _emailSubjectCtrl, decoration: _dec('')),
                    const SizedBox(height: 14),
                    _label('Email Body'),
                    const SizedBox(height: 6),
                    _templateHint(_kReceiptTemplate),
                    const SizedBox(height: 8),
                    _HtmlField(controller: _emailBodyCtrl!),
                    const SizedBox(height: 14),
                    _label('Reminder Email Subject'),
                    const SizedBox(height: 6),
                    TextFormField(
                        controller: _emailReminderSubjectCtrl,
                        decoration: _dec('')),
                    const SizedBox(height: 14),
                    _label('Reminder Email Body'),
                    const SizedBox(height: 6),
                    _templateHint(_kReminderTemplate),
                    const SizedBox(height: 8),
                    _HtmlField(controller: _emailReminderBodyCtrl!),
                  ]),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed:
                              _saving ? null : () => Navigator.pop(context),
                          style: OutlinedButton.styleFrom(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 12)),
                          child: const Text('Cancel'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          onPressed: _saving ? null : _save,
                          style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              padding:
                                  const EdgeInsets.symmetric(vertical: 12)),
                          child: _saving
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Text('Save Changes'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }

  // ── Section card + field helpers ──
  Widget _sectionCard(
      int n, IconData icon, String title, Color accent, List<Widget> kids) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      padding: const EdgeInsets.all(16),
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
                    color: accent, borderRadius: BorderRadius.circular(8)),
                child: Text('$n',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 13)),
              ),
              const SizedBox(width: 10),
              Icon(icon, size: 18, color: accent),
              const SizedBox(width: 6),
              Text(title,
                  style: AppTextStyles.body
                      .copyWith(fontWeight: FontWeight.w800, fontSize: 15)),
            ],
          ),
          const SizedBox(height: 14),
          ...kids,
        ],
      ),
    );
  }

  Widget _label(String text, {bool required = false}) {
    return RichText(
      text: TextSpan(
        text: text,
        style: AppTextStyles.caption.copyWith(
            fontWeight: FontWeight.w700, color: AppColors.textSecondary),
        children: required
            ? [const TextSpan(text: ' *', style: const TextStyle(color: AppColors.error))]
            : null,
      ),
    );
  }

  InputDecoration _dec(String hint) => InputDecoration(
        hintText: hint,
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      );

  // Read-only hint of the template the system auto-wraps around the admin's
  // body (mirrors the web edit page's "Default template (auto-included):" card).
  Widget _templateHint(String template) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.muted.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Default template (auto-included):',
              style: AppTextStyles.caption.copyWith(
                  fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          const SizedBox(height: 6),
          Text(template,
              style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  height: 1.4,
                  color: AppColors.textSecondary)),
        ],
      ),
    );
  }

  Widget _imageField(
      String label, String? existingUrl, String? newPath, VoidCallback onPick) {
    Widget preview;
    if (newPath != null) {
      preview = Image.file(File(newPath),
          height: 96, width: double.infinity, fit: BoxFit.contain);
    } else if (existingUrl != null && existingUrl.trim().isNotEmpty) {
      // Dues images live under /Documents/ which is auth-gated — fetch the bytes
      // with the JWT (Image.network sends none) and show via Image.memory.
      preview = _AuthImage(path: existingUrl.trim());
    } else {
      preview = _imgPlaceholder();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label),
        const SizedBox(height: 6),
        ClipRRect(borderRadius: BorderRadius.circular(10), child: preview),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: onPick,
            icon: const Icon(Icons.upload_outlined, size: 16),
            label: Text(newPath != null ? 'Change selected image' : 'Change image'),
            style: TextButton.styleFrom(
                padding: const EdgeInsets.only(top: 4),
                minimumSize: const Size(0, 0),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap),
          ),
        ),
      ],
    );
  }

  Widget _imgPlaceholder() => Container(
        height: 96,
        width: double.infinity,
        color: AppColors.muted,
        alignment: Alignment.center,
        child: const Icon(Icons.image_outlined, color: AppColors.textMuted, size: 28),
      );
}

/// Loads an auth-gated server image (e.g. under /Documents/) through the
/// authenticated [ApiClient] and renders it with [Image.memory]. Plain
/// [Image.network] can't fetch these — it sends no JWT.
class _AuthImage extends StatefulWidget {
  final String path;
  const _AuthImage({required this.path});

  @override
  State<_AuthImage> createState() => _AuthImageState();
}

class _AuthImageState extends State<_AuthImage> {
  // Session caches so scrolling away and back doesn't re-download / re-decode
  // these (the dues images can be several MB each). Reusing the SAME bytes
  // object also lets Flutter's image cache reuse the decoded bitmap.
  static final Map<String, Uint8List> _cache = {};
  static final Map<String, Future<Uint8List>> _inflight = {};

  late final Future<Uint8List> _future = _load();

  Future<Uint8List> _load() {
    var rel = widget.path;
    if (rel.startsWith('http://') || rel.startsWith('https://')) {
      rel = rel.startsWith(ApiConstants.baseUrl)
          ? rel.substring(ApiConstants.baseUrl.length)
          : Uri.parse(rel).path;
    }
    if (!rel.startsWith('/')) rel = '/$rel';

    final cached = _cache[rel];
    if (cached != null) return Future.value(cached);
    final pending = _inflight[rel];
    if (pending != null) return pending;

    final f = ApiClient().downloadBytes(rel).then((b) {
      _cache[rel] = b;
      _inflight.remove(rel);
      return b;
    }).catchError((Object e) {
      _inflight.remove(rel);
      throw e;
    });
    _inflight[rel] = f;
    return f;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: _future,
      builder: (_, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return Container(
            height: 96,
            width: double.infinity,
            color: AppColors.muted,
            alignment: Alignment.center,
            child: const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2)),
          );
        }
        if (snap.hasError || snap.data == null) {
          return Container(
            height: 96,
            width: double.infinity,
            color: AppColors.muted,
            alignment: Alignment.center,
            child: const Icon(Icons.broken_image_outlined,
                color: AppColors.textMuted, size: 28),
          );
        }
        return Image.memory(snap.data!,
            height: 96,
            width: double.infinity,
            fit: BoxFit.contain,
            // Decode at preview size, not the original multi-MB resolution.
            cacheWidth: 800,
            gaplessPlayback: true);
      },
    );
  }
}

/// A bordered rich-text (HTML) field: a Quill toolbar over a fixed-height
/// editor. Owns its own focus + scroll controllers; the parent owns the
/// [quill.QuillController] (so it can read the HTML on save).
class _HtmlField extends StatefulWidget {
  final quill.QuillController controller;
  const _HtmlField({required this.controller});

  @override
  State<_HtmlField> createState() => _HtmlFieldState();
}

class _HtmlFieldState extends State<_HtmlField> {
  final _focus = FocusNode();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          quill.QuillSimpleToolbar(
            controller: widget.controller,
            config: const quill.QuillSimpleToolbarConfig(
              multiRowsDisplay: false,
              showFontFamily: false,
              showFontSize: false,
              showSmallButton: false,
              showStrikeThrough: false,
              showInlineCode: false,
              showCodeBlock: false,
              showQuote: false,
              showIndent: false,
              showSearchButton: false,
              showSubscript: false,
              showSuperscript: false,
              showDirection: false,
              showBackgroundColorButton: false,
              showListCheck: false,
              showLineHeightButton: false,
              showAlignmentButtons: true,
              showHeaderStyle: true,
              showListNumbers: true,
              showListBullets: true,
              showBoldButton: true,
              showItalicButton: true,
              showUnderLineButton: true,
              showColorButton: true,
              showClearFormat: true,
              showLink: true,
              showUndo: true,
              showRedo: true,
              embedButtons: null,
            ),
          ),
          const Divider(height: 1, color: AppColors.border),
          SizedBox(
            height: 150,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: quill.QuillEditor(
                controller: widget.controller,
                focusNode: _focus,
                scrollController: _scroll,
                config: const quill.QuillEditorConfig(
                  placeholder: 'Write here…',
                  expands: false,
                  scrollable: true,
                  autoFocus: false,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Roster screen -- list of members assigned to a specific membership due.
// =============================================================================

class DuesRosterScreen extends StatefulWidget {
  final int clubId;
  final int duesId;
  final String duesName;

  const DuesRosterScreen({
    super.key,
    required this.clubId,
    required this.duesId,
    required this.duesName,
  });

  @override
  State<DuesRosterScreen> createState() => DuesRosterScreenState();
}

class DuesRosterScreenState extends State<DuesRosterScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  List<dynamic> _members = [];
  // `config` block from `/members` — carries which fee slots are enabled
  // (isFees1/2/3) and their labels (fees1Text…). Drives the per-fee columns.
  Map<String, dynamic> _config = {};
  bool _loading = true;
  String _filter = 'all'; // all|paid|unpaid|pending

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final q = <String, dynamic>{
        if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
        if (_filter != 'all') 'filter': _filter,
      };
      final resp = await _api.get(
        '/api/membership-dues/${widget.duesId}/members',
        queryParams: q.isEmpty ? null : q,
        fromJson: (j) => j,
      );
      final data = resp.data;
      // The endpoint returns `{ config, members: [...] }` (per-fee columns); older
      // shapes used a bare list or `{ items }`. Try all three.
      setState(() {
        if (data is List) {
          _members = data;
        } else if (data is Map<String, dynamic>) {
          _members = (data['members'] ?? data['items']) as List<dynamic>? ?? [];
          final cfg = data['config'];
          if (cfg is Map<String, dynamic>) _config = cfg;
        } else {
          _members = [];
        }
      });
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load roster');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendReminder(int memberFeeId, String channel, {int? feeType}) async {
    if (channel == 'email') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Send Email Reminder'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Only show the fee-type line for a real named fee (Annual /
              // Semi Annual 1 / Semi Annual 2). Unnamed slots render as
              // "Fee 0" etc., which is noise — hide them.
              if (feeType != null && const [1, 2, 3].contains(feeType))
                Text('Fee Type: ${_feeTypeLabel(feeType)}',
                    style: AppTextStyles.caption),
              const SizedBox(height: 8),
              const Text('Send an email reminder to this member?'),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Send'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      try {
        await _api.post(
          '/api/membership-dues/${widget.duesId}/members/$memberFeeId/reminder-email',
          body: {
            'feeType': feeType ?? 0,
          },
        );
        if (mounted) SnackbarUtils.showSuccess(context, 'Email reminder sent');
      } catch (e) {
        if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
      }
    }
  }

  Future<void> _bulkReminder(String channel) async {
    if (channel == 'email') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Bulk Email Reminder'),
          content: const Text('Send email reminder to all unpaid members?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Send'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      try {
        await _api.post(
          '/api/membership-dues/${widget.duesId}/bulk-reminder-email',
        );
        if (mounted) SnackbarUtils.showSuccess(context, 'Bulk email reminders sent');
      } catch (e) {
        if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
      }
    }
  }

  Future<void> _openOfflinePayment(Map<String, dynamic> member) async {
    final memberFeeId = (member['memberFeeId'] ?? member['id']) as int?;
    if (memberFeeId == null) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => DuesOfflinePaymentDialog(
          duesId: widget.duesId,
          memberFeeId: memberFeeId,
          memberName: (member['memberName'] ?? member['name'])?.toString() ?? '',
          member: member,
        ),
      ),
    );
    if (saved == true) await _load();
  }

  Future<void> _approveReject(int paymentId, bool approve) async {
    String? reason;
    if (!approve) {
      final ctrl = TextEditingController();
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Reject Payment'),
          content: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Rejection Reason (optional)',
              border: OutlineInputBorder(),
            ),
            maxLines: 3,
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Reject'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      reason = ctrl.text.trim();
    }
    try {
      await _api.post(
        '/api/membership-dues/payments/$paymentId/approve-reject',
        body: {
          'isApproved': approve,
          if (!approve && reason != null && reason.isNotEmpty) 'rejectionReason': reason,
        },
      );
      if (mounted) {
        SnackbarUtils.showSuccess(
            context, approve ? 'Payment approved' : 'Payment rejected');
      }
      await _load();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    }
  }

  /// Re-send the receipt email. Passes the **memberFeeId** (a
  /// `membership_dues_member_fees.pk_id`) to the fee-id receipt endpoint, which
  /// resolves the latest paid payment for that fee and dispatches the receipt.
  /// MUST use `member-fees/{feeId}/send-receipt` — the older
  /// `payments/{id}/receipt` route treats the id as a payment pk and, since fee
  /// ids and payment ids come from different tables, would 404 or misroute the
  /// receipt to an unrelated member on a numeric collision.
  Future<void> _sendReceipt(int memberFeeId) async {
    // Confirm before sending — mirrors the web members listing's window.confirm
    // (parity with the reminder actions, which already confirm).
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send Receipt'),
        content: const Text('Re-send the payment receipt email to this member?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _api.post('/api/membership-dues/member-fees/$memberFeeId/send-receipt');
      if (mounted) SnackbarUtils.showSuccess(context, 'Receipt sent');
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    }
  }

  String _feeTypeLabel(int t) {
    switch (t) {
      case 1: return 'Annual';
      case 2: return 'Semi Annual 1';
      case 3: return 'Semi Annual 2';
      default: return 'Fee $t';
    }
  }

  // ===========================================================================
  // Fee-type resolution — mirrors the web v2 members page EXACTLY
  // (rotary-frontend/.../membership-dues/v2/[duesId]/members/page.tsx).
  // Each member carries three fee slots: annual / semi1 / semi2, with *Amount,
  // *Paid and *Status fields. `config` says which slots are enabled + labels.
  // ===========================================================================

  bool _flag(dynamic v) => v == true || v == 1 || v == '1';

  String _cfgLabel(String key, String fallback) {
    final v = _config[key]?.toString();
    return (v != null && v.trim().isNotEmpty) ? v.trim() : fallback;
  }

  List<({int type, String label})> _enabledFeeTypes() {
    final out = <({int type, String label})>[];
    if (_flag(_config['isFees1'])) out.add((type: 1, label: _cfgLabel('fees1Text', 'Annual')));
    if (_flag(_config['isFees2'])) out.add((type: 2, label: _cfgLabel('fees2Text', 'Semi Annual 1')));
    if (_flag(_config['isFees3'])) out.add((type: 3, label: _cfgLabel('fees3Text', 'Semi Annual 2')));
    // Config absent (older shape / failed fetch) → assume the Annual slot so the
    // card still renders one fee row instead of nothing.
    if (out.isEmpty) out.add((type: 1, label: 'Annual'));
    return out;
  }

  num _feeAmount(Map<String, dynamic> m, int ft) =>
      (ft == 1 ? m['annualBaseAmount'] : ft == 2 ? m['semi1BaseAmount'] : m['semi2BaseAmount']) as num? ?? 0;
  num _feePaid(Map<String, dynamic> m, int ft) =>
      (ft == 1 ? m['annualPaid'] : ft == 2 ? m['semi1Paid'] : m['semi2Paid']) as num? ?? 0;

  /// A member with zero amounts on every enabled fee — not yet allocated, so the
  /// row actions stay hidden (web gates everything on `!isNotAllocated`).
  bool _isNotAllocated(Map<String, dynamic> m) =>
      _enabledFeeTypes().every((ft) => _feeAmount(m, ft.type) == 0);

  bool _isPendingMember(Map<String, dynamic> m) => m['hasPendingApproval'] == true;

  /// 'N/A' | 'Paid' | 'Pending' | 'Unpaid' for one fee slot (web getEditFeeStatus).
  String _feeStatus(Map<String, dynamic> m, int ft) {
    if (_isNotAllocated(m)) return 'N/A';
    // Paying Annual settles the semis (and vice-versa) → the others read N/A.
    if ((ft == 2 || ft == 3) && _feePaid(m, 1) > 0) return 'N/A';
    if (ft == 1 && _feePaid(m, 2) > 0) return 'N/A';
    if (ft == 1 && _feePaid(m, 3) > 0) return 'N/A';
    if (_feePaid(m, ft) > 0) return 'Paid';
    final s = (ft == 1 ? m['annualStatus'] : ft == 2 ? m['semi1Status'] : m['semi2Status'])?.toString();
    if (s == 'PendingApproval' || s == 'Pending') return 'Pending';
    if (m['hasPendingApproval'] == true && (m['pendingFeeType'] as num?)?.toInt() == ft) return 'Pending';
    return 'Unpaid';
  }

  List<({int type, String label})> _unpaidFeeTypes(Map<String, dynamic> m) =>
      _enabledFeeTypes().where((ft) {
        final s = _feeStatus(m, ft.type);
        return s == 'Unpaid' || s == 'Pending';
      }).toList();

  bool _hasAnyPaidFee(Map<String, dynamic> m) =>
      _enabledFeeTypes().any((ft) => _feeStatus(m, ft.type) == 'Paid');

  // ── KPI aggregates over the (filtered) member set — web definitions ──
  int get _kpiTotal => _members.length;
  int get _kpiPaid =>
      _members.where((m) => _hasAnyPaidFee(m as Map<String, dynamic>)).length;
  int get _kpiPending =>
      _members.where((m) => _isPendingMember(m as Map<String, dynamic>)).length;
  int get _kpiUnpaid => _members.where((m) {
        final mm = m as Map<String, dynamic>;
        return !_isNotAllocated(mm) && !_hasAnyPaidFee(mm) && !_isPendingMember(mm);
      }).length;

  @override
  Widget build(BuildContext context) {
    final isClubAdmin = context.watch<AuthProvider>().isClubAdminOf(widget.clubId);
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: CustomAppBar(title: widget.duesName),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
          children: [
            _kpiStrip(),
            const SizedBox(height: 10),
            _toolbar(isClubAdmin),
            const SizedBox(height: 10),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: LoadingWidget(),
              )
            else if (_members.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: EmptyStateWidget(title: 'No members found'),
              )
            else
              for (var i = 0; i < _members.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _memberCard(
                      _members[i] as Map<String, dynamic>, i + 1, isClubAdmin),
                ),
          ],
        ),
      ),
    );
  }

  // ── Thin KPI strip: 4 compact tiles in one row (Total/Paid/Pending/Unpaid) ──
  Widget _kpiStrip() {
    final items = <(String, int, Color)>[
      ('Total', _kpiTotal, AppColors.accentBlue),
      ('Paid', _kpiPaid, AppColors.success),
      ('Pending', _kpiPending, AppColors.warning),
      ('Unpaid', _kpiUnpaid, AppColors.error),
    ];
    return Row(
      children: [
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: _kpiTile(items[i].$1, items[i].$2, items[i].$3)),
        ],
      ],
    );
  }

  Widget _kpiTile(String label, int value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
              Text('$value',
                  style: AppTextStyles.body.copyWith(
                      fontSize: 18, fontWeight: FontWeight.w800, color: color)),
            ],
          ),
          const SizedBox(height: 2),
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.caption.copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary)),
        ],
      ),
    );
  }

  // ── Slim toolbar: search + filter inline, bulk reminders, legend + count ──
  Widget _toolbar(bool isClubAdmin) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  decoration: InputDecoration(
                    hintText: 'Search by name…',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    suffixIcon: _searchCtrl.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              _searchCtrl.clear();
                              _load();
                            },
                          )
                        : null,
                  ),
                  onSubmitted: (_) => _load(),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 124,
                child: DropdownButtonFormField<String>(
                  value: _filter,
                  isDense: true,
                  isExpanded: true,
                  decoration: InputDecoration(
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 10),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'all', child: Text('All')),
                    DropdownMenuItem(value: 'paid', child: Text('Paid')),
                    DropdownMenuItem(value: 'unpaid', child: Text('Unpaid')),
                    DropdownMenuItem(value: 'pending', child: Text('Pending')),
                  ],
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _filter = v);
                    _load();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _legendDot(AppColors.warningLight, AppColors.warning),
              const SizedBox(width: 6),
              Text('Pending',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary)),
              const SizedBox(width: 14),
              _legendDot(AppColors.successLight, AppColors.success),
              const SizedBox(width: 6),
              Text('New',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary)),
              const Spacer(),
              if (isClubAdmin) ...[
                _bulkIconBtn(
                    const Icon(Icons.mail_outline_rounded, size: 18),
                    AppColors.accentBlue,
                    'Bulk email reminder',
                    () => _bulkReminder('email')),
              ] else
                Text(
                    '${_members.length} member${_members.length == 1 ? '' : 's'}',
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textMuted)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _legendDot(Color fill, Color border) => Container(
        width: 12,
        height: 12,
        decoration: BoxDecoration(
          color: fill,
          border: Border.all(color: border.withValues(alpha: 0.5)),
          borderRadius: BorderRadius.circular(3),
        ),
      );

  Widget _bulkIconBtn(
      Widget icon, Color color, String tooltip, VoidCallback onTap) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          margin: const EdgeInsets.only(left: 8),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
          ),
          child: icon,
        ),
      ),
    );
  }

  // ── One member = one card with per-fee rows + actions ──
  Widget _memberCard(Map<String, dynamic> m, int sr, bool isClubAdmin) {
    final name = (m['memberName'] ?? m['name'])?.toString() ?? '–';
    final category = m['categoryType']?.toString() ?? '';
    final memberFeeId = (m['memberFeeId'] ?? m['id']) as int?;
    final isNewMember = m['isNewMember'] == true;
    final isPending = _isPendingMember(m);
    final notAllocated = _isNotAllocated(m);
    final fees = _enabledFeeTypes();

    // Row tint mirrors the web: amber for pending approval, emerald for new.
    Color cardBg = AppColors.card;
    if (isPending) {
      cardBg = AppColors.warningLight.withValues(alpha: 0.5);
    } else if (isNewMember) {
      cardBg = AppColors.successLight.withValues(alpha: 0.5);
    }

    final showActions =
        isClubAdmin && memberFeeId != null && !notAllocated;
    final unpaid = _unpaidFeeTypes(m);
    final canPayOrRemind = showActions && unpaid.isNotEmpty;
    final canReceipt = showActions && _hasAnyPaidFee(m);
    final pendingPaymentId =
        (m['pendingPaymentId'] ?? memberFeeId) as int?;

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: SR + avatar + name/category + badges
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 12, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                  child: Text(
                    name.isNotEmpty ? name[0].toUpperCase() : '?',
                    style: const TextStyle(
                        color: AppColors.primary, fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppTextStyles.body
                                    .copyWith(fontWeight: FontWeight.w700)),
                          ),
                          if (isNewMember) ...[
                            const SizedBox(width: 6),
                            _miniBadge('New', AppColors.success,
                                AppColors.successLight),
                          ],
                          if (isPending) ...[
                            const SizedBox(width: 6),
                            _miniBadge('Pending', AppColors.warning,
                                AppColors.warningLight),
                          ],
                        ],
                      ),
                      if (category.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(category,
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textSecondary)),
                        ),
                    ],
                  ),
                ),
                Text('#$sr',
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textMuted)),
              ],
            ),
          ),
          const Divider(height: 1),
          // Fee rows
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            child: Column(
              children: [for (final ft in fees) _feeRow(m, ft.type, ft.label)],
            ),
          ),
          // Actions. The offline-payment pieces (Update/View Offline +
          // Approve/Reject) are gated by kOfflinePaymentsEnabled for launch.
          if (canPayOrRemind ||
              canReceipt ||
              (showActions && isPending && kOfflinePaymentsEnabled)) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (canPayOrRemind && kOfflinePaymentsEnabled)
                    _actionBtn(
                        const Icon(Icons.edit_note_rounded,
                            size: 16, color: AppColors.accentBlue),
                        isPending ? 'View Offline' : 'Update Offline',
                        AppColors.accentBlue,
                        () => _openOfflinePayment(m)),
                  if (canPayOrRemind) ...[
                    _actionIconBtn(
                        const Icon(Icons.mail_outline_rounded,
                            size: 18, color: AppColors.warning),
                        AppColors.warning,
                        'Email reminder',
                        () => _sendReminder(memberFeeId, 'email')),
                  ],
                  if (canReceipt)
                    _actionIconBtn(
                        const Icon(Icons.receipt_long_rounded,
                            size: 18, color: AppColors.accentPurple),
                        AppColors.accentPurple,
                        'Send receipt',
                        () => _sendReceipt(memberFeeId)),
                  if (showActions &&
                      isPending &&
                      pendingPaymentId != null &&
                      kOfflinePaymentsEnabled) ...[
                    _actionBtn(
                        const Icon(Icons.check_rounded,
                            size: 16, color: AppColors.success),
                        'Approve',
                        AppColors.success,
                        () => _approveReject(pendingPaymentId, true)),
                    _actionBtn(
                        const Icon(Icons.close_rounded,
                            size: 16, color: AppColors.error),
                        'Reject',
                        AppColors.error,
                        () => _approveReject(pendingPaymentId, false)),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// One fee line: label · amount · status pill (web columns, stacked).
  Widget _feeRow(Map<String, dynamic> m, int ft, String label) {
    final status = _feeStatus(m, ft);
    final isNa = status == 'N/A';
    final amount = _feeAmount(m, ft);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            flex: 4,
            child: Text(label,
                style: AppTextStyles.body.copyWith(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary)),
          ),
          Expanded(
            flex: 2,
            child: Text(
              isNa ? 'N/A' : formatMoney(amount.round(), null),
              textAlign: TextAlign.right,
              style: AppTextStyles.body.copyWith(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  color: isNa ? AppColors.textMuted : AppColors.textPrimary),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(width: 78, child: Align(
              alignment: Alignment.centerRight, child: _feePill(status))),
        ],
      ),
    );
  }

  Widget _feePill(String status) {
    if (status == 'N/A') {
      return Text('N/A',
          style: AppTextStyles.caption.copyWith(color: AppColors.textMuted));
    }
    late Color fg;
    late Color bg;
    switch (status) {
      case 'Paid':
        fg = AppColors.success;
        bg = AppColors.successLight;
        break;
      case 'Pending':
        fg = AppColors.warning;
        bg = AppColors.warningLight;
        break;
      default: // Unpaid
        fg = AppColors.error;
        bg = AppColors.errorLight;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: fg.withValues(alpha: 0.35)),
      ),
      child: Text(status,
          style: TextStyle(
              fontSize: 13, fontWeight: FontWeight.w700, color: fg)),
    );
  }

  Widget _miniBadge(String text, Color fg, Color bg) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: fg.withValues(alpha: 0.4)),
        ),
        child: Text(text,
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w700, color: fg)),
      );

  /// A visible tinted action button (icon + label) for the per-member row
  /// actions — Update Offline / email / Receipt / Approve / Reject.
  Widget _actionBtn(
      Widget icon, String label, Color color, VoidCallback onTap) {
    return Material(
      color: color.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: color.withValues(alpha: 0.28)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              icon,
              const SizedBox(width: 6),
              Text(label,
                  style: AppTextStyles.caption.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: color)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _actionIconBtn(
      Widget icon, Color color, String tooltip, VoidCallback onTap) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(9),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(9),
          child: Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: color.withValues(alpha: 0.28)),
            ),
            child: icon,
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// Offline Payment Dialog for Membership Dues.
// Spec fields: feeType, transactionType (NEFT/IMPS/RTGS, Cash, Cheque),
// transactionId (NEFT only), givenTo (Cash/Cheque), paymentDate, remark,
// attachment, sendReceiptEmail.
// =============================================================================

class DuesOfflinePaymentDialog extends StatefulWidget {
  final int duesId;
  final int memberFeeId;
  final String memberName;
  final Map<String, dynamic> member;

  const DuesOfflinePaymentDialog({
    super.key,
    required this.duesId,
    required this.memberFeeId,
    required this.memberName,
    required this.member,
  });

  @override
  State<DuesOfflinePaymentDialog> createState() =>
      DuesOfflinePaymentDialogState();
}

class DuesOfflinePaymentDialogState extends State<DuesOfflinePaymentDialog> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _transactionIdCtrl = TextEditingController();
  final _givenToCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();

  int _feeType = 1;
  String _transactionType = 'Cash';
  static const _txTypes = ['NEFT/IMPS/RTGS', 'Cash', 'Cheque'];

  DateTime _paymentDate = DateTime.now();
  bool _sendReceiptEmail = false;
  bool _saving = false;
  String? _attachmentPath;
  String? _attachmentName;

  bool get _hasPending => widget.member['hasPendingApproval'] == true;

  @override
  void initState() {
    super.initState();
    // Default to first fee type with outstanding balance.
    final annualDue = (widget.member['annualBalance'] ?? widget.member['annualBaseAmount']) as num? ?? 0;
    final semi1Due = (widget.member['semi1Balance'] ?? widget.member['semi1BaseAmount']) as num? ?? 0;
    final semi2Due = (widget.member['semi2Balance'] ?? widget.member['semi2BaseAmount']) as num? ?? 0;
    if (annualDue > 0) {
      _feeType = 1;
    } else if (semi1Due > 0) {
      _feeType = 2;
    } else if (semi2Due > 0) {
      _feeType = 3;
    }
  }

  @override
  void dispose() {
    _transactionIdCtrl.dispose();
    _givenToCtrl.dispose();
    _remarkCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickAttachment() async {
    // Server allowlist is images + PDF only — restrict the picker to match
    // (anything else is rejected with a 400 on upload).
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const [
        'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
      ],
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.first;
    if (f.path == null) return;
    setState(() {
      _attachmentPath = f.path;
      _attachmentName = f.name;
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final fields = <String, String>{
        'feeType': _feeType.toString(),
        'transactionType': _transactionType,
        'paymentDate': DateFormat('yyyy-MM-dd').format(_paymentDate),
        'remark': _remarkCtrl.text.trim(),
        'sendReceiptEmail': _sendReceiptEmail.toString(),
      };
      // Conditional fields per spec
      if (_transactionType == 'NEFT/IMPS/RTGS') {
        fields['transactionId'] = _transactionIdCtrl.text.trim();
      }
      if (_transactionType == 'Cash' || _transactionType == 'Cheque') {
        fields['givenTo'] = _givenToCtrl.text.trim();
      }
      await _api.sendMultipart(
        '/api/membership-dues/${widget.duesId}/members/${widget.memberFeeId}/offline-payment',
        method: 'POST',
        fields: fields,
        files: _attachmentPath != null ? {'attachment': _attachmentPath!} : null,
        fromJson: (j) => j,
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        SnackbarUtils.showSuccess(context, 'Offline payment recorded');
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Fee slots worth showing in the picker: a disabled slot reports a 0 amount
  /// and a fully-paid slot reports a 0 balance, so `due > 0` is the same signal
  /// that drives the default selection in [initState] — this just hides the
  /// bogus "Semi 1 ($0)" rows for clubs that don't use that slot (or already
  /// paid it). Falls back to all three if none qualify so the dropdown is never
  /// empty. Design is unchanged — only which options appear.
  List<int> get _payableFeeTypes {
    final m = widget.member;
    num due(String balance, String amount) =>
        (m[balance] ?? m[amount]) as num? ?? 0;
    final out = <int>[
      if (due('annualBalance', 'annualBaseAmount') > 0) 1,
      if (due('semi1Balance', 'semi1BaseAmount') > 0) 2,
      if (due('semi2Balance', 'semi2BaseAmount') > 0) 3,
    ];
    return out.isEmpty ? const [1, 2, 3] : out;
  }

  // Offline amount = the base fee itself. Per the backend, the base
  // (annualBaseAmount / *Balance) IS "the ONE true (base) amount — what an
  // offline payment charges"; the ONLINE amount is this PLUS the ~2.95% gateway
  // surcharge, not minus it. So the offline label is just the base balance, no
  // discount (a prior *0.9705 double-discounted it). The actual recorded amount
  // is still computed server-side from feeType on submit.
  int _offlineAmount(num base) => base.round();

  String _feeLabel(int t) {
    final m = widget.member;
    final annualDue = (m['annualBalance'] ?? m['annualBaseAmount']) as num?;
    final semi1Due = (m['semi1Balance'] ?? m['semi1BaseAmount']) as num?;
    final semi2Due = (m['semi2Balance'] ?? m['semi2BaseAmount']) as num?;
    switch (t) {
      case 1:
        return 'Annual${annualDue != null ? ' (${formatMoney(_offlineAmount(annualDue), null)})' : ''}';
      case 2:
        return 'Semi 1${semi1Due != null ? ' (${formatMoney(_offlineAmount(semi1Due), null)})' : ''}';
      case 3:
        return 'Semi 2${semi2Due != null ? ' (${formatMoney(_offlineAmount(semi2Due), null)})' : ''}';
      default:
        return 'Fee $t';
    }
  }

  @override
  Widget build(BuildContext context) {
    final showTransactionId = _transactionType == 'NEFT/IMPS/RTGS';
    final showGivenTo = _transactionType == 'Cash' || _transactionType == 'Cheque';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: widget.memberName.trim().isEmpty
            ? 'Offline Payment'
            : 'Offline Payment - ${widget.memberName}',
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Pending payment info box
                if (_hasPending) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                      color: Colors.yellow[50],
                      border: Border.all(color: Colors.orange[200]!),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Pending Payment',
                            style: AppTextStyles.caption.copyWith(
                              fontWeight: FontWeight.w700,
                              color: Colors.orange[800],
                            )),
                        const SizedBox(height: 4),
                        if (widget.member['pendingTransactionType'] != null)
                          _pendingInfoRow('Mode', widget.member['pendingTransactionType'].toString()),
                        if (widget.member['pendingAmount'] != null)
                          _pendingInfoRow('Amount', formatMoney(num.tryParse('${widget.member['pendingAmount']}'), null)),
                        if (widget.member['pendingTransactionId'] != null &&
                            widget.member['pendingTransactionId'].toString().isNotEmpty)
                          _pendingInfoRow('Txn ID', widget.member['pendingTransactionId'].toString()),
                        if (widget.member['pendingGivenTo'] != null &&
                            widget.member['pendingGivenTo'].toString().isNotEmpty)
                          _pendingInfoRow('Given To', widget.member['pendingGivenTo'].toString()),
                        if (widget.member['pendingPaymentDate'] != null)
                          _pendingInfoRow('Date', widget.member['pendingPaymentDate'].toString()),
                        if (widget.member['pendingRemark'] != null &&
                            widget.member['pendingRemark'].toString().isNotEmpty)
                          _pendingInfoRow('Remark', widget.member['pendingRemark'].toString()),
                      ],
                    ),
                  ),
                ],
                DropdownButtonFormField<int>(
                  value: _feeType,
                  decoration: const InputDecoration(
                    labelText: 'Fee Type *',
                    isDense: true,
                  ),
                  validator: (v) => v == null ? 'Select fee type' : null,
                  items: _payableFeeTypes
                      .map((t) =>
                          DropdownMenuItem(value: t, child: Text(_feeLabel(t))))
                      .toList(),
                  onChanged: (v) => setState(() => _feeType = v ?? _feeType),
                ),
                const SizedBox(height: 10),
                // Transaction type as radio buttons per spec
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Payment Mode *',
                      style: AppTextStyles.caption.copyWith(color: Colors.grey[700])),
                ),
                ...List.generate(_txTypes.length, (i) => RadioListTile<String>(
                  value: _txTypes[i],
                  groupValue: _transactionType,
                  title: Text(_txTypes[i], style: AppTextStyles.caption),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  onChanged: (v) => setState(() => _transactionType = v ?? _transactionType),
                )),
                // Transaction ID - only for NEFT/IMPS/RTGS
                if (showTransactionId) ...[
                  const SizedBox(height: 6),
                  CustomTextField(
                    controller: _transactionIdCtrl,
                    label: 'Transaction ID',
                  ),
                ],
                // Given To - required for Cash and Cheque
                if (showGivenTo) ...[
                  const SizedBox(height: 6),
                  CustomTextField(
                    controller: _givenToCtrl,
                    label: 'Given To *',
                    validator: (v) => v == null || v.trim().isEmpty
                        ? 'Given To is required'
                        : null,
                  ),
                ],
                const SizedBox(height: 10),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _paymentDate,
                      firstDate: DateTime(2000),
                      lastDate: DateTime.now(),
                    );
                    if (picked != null) setState(() => _paymentDate = picked);
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Payment Date *',
                      isDense: true,
                    ),
                    child: Text(
                      DateFormat('dd MMM yyyy').format(_paymentDate),
                      style: AppTextStyles.body,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                CustomTextField(
                  controller: _remarkCtrl,
                  label: 'Remark',
                  maxLines: 2,
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  icon: const Icon(Icons.attach_file, size: 16),
                  label: Text(
                      _attachmentName ??
                          'Attach receipt / proof: image or PDF (optional)',
                      overflow: TextOverflow.ellipsis),
                  onPressed: _pickAttachment,
                ),
                // Show existing attachment link if pending has one
                if (_hasPending &&
                    widget.member['pendingAttachment'] != null &&
                    widget.member['pendingAttachment'].toString().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'View existing attachment',
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.primary,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                SwitchListTile(
                  value: _sendReceiptEmail,
                  onChanged: (v) => setState(() => _sendReceiptEmail = v),
                  title: const Text('Send Email Receipt'),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: const Border(top: const BorderSide(color: AppColors.lightBorder)),
          ),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _saving ? null : () => Navigator.pop(context, false),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: CustomButton(
                  label: 'Save',
                  onPressed: _saving ? null : _submit,
                  isLoading: _saving,
                  height: 46,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pendingInfoRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: Row(
          children: [
            SizedBox(
              width: 70,
              child: Text(label,
                  style: AppTextStyles.caption.copyWith(
                    color: Colors.orange[700],
                    fontSize: 13,
                  )),
            ),
            Expanded(
              child: Text(value,
                  style: AppTextStyles.caption.copyWith(fontSize: 13)),
            ),
          ],
        ),
      );
}
