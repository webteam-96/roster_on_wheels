import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../../core/constants/feature_flags.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/file_download_utils.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/dues_kpi_cards.dart';
import '../../../../widgets/common/expandable_record_card.dart';
import '../../../../widgets/common/labeled_stat.dart';
import '../../modules/membership_dues/membership_dues_screen.dart';

/// Full-screen host for the dues management view used by the NORMAL club
/// dashboard (no KPI cards — those stay exclusive to the overview tab). Owns
/// the Rotary-year selector (the overview screen supplies its own global one,
/// so the embedded view never shows a duplicate).
class DuesManagementScreen extends StatefulWidget {
  final int clubId;
  const DuesManagementScreen({super.key, required this.clubId});

  @override
  State<DuesManagementScreen> createState() => _DuesManagementScreenState();
}

class _DuesManagementScreenState extends State<DuesManagementScreen> {
  final ClubAdminDashboardApi _dashApi = ClubAdminDashboardApi();

  List<DashYear> _years = const [];
  int? _selectedYearId;
  int? _currentYearId;
  String _currentYearLabel = '';

  @override
  void initState() {
    super.initState();
    _fetchYears();
  }

  Future<void> _fetchYears() async {
    try {
      final r = await _dashApi.getAvailableYears(widget.clubId);
      if (!mounted) return;
      setState(() {
        _years = r.years;
        _currentYearId = r.currentYearId;
        _currentYearLabel = r.currentYearLabel;
      });
    } catch (_) {
      // Without the year list the page stays on the server-default year.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      // Left-align + smaller title so the year chip doesn't squeeze it into
      // "Membership D…".
      appBar: CustomAppBar(
          title: 'Club Dues',
          centerTitle: false,
          titleStyle: AppTextStyles.h4.copyWith(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Colors.white),
          actions: _yearActions()),
      // Year change → ValueKey swaps the view so it re-fetches for that year.
      body: DuesManagementView(
        key: ValueKey('dues-${_selectedYearId ?? 0}'),
        clubId: widget.clubId,
        yearId: _selectedYearId,
        // Web shows the 4 collection KPIs on every dues entry point — surface
        // them on the normal dashboard host too (was previously overview-only).
        showKpis: true,
      ),
    );
  }

  List<Widget> _yearActions() {
    if (_years.length < 2) return const [];
    final selId = _selectedYearId ?? _currentYearId;
    final selLabel = _years
        .firstWhere((y) => y.id == selId,
            orElse: () =>
                DashYear(id: 0, label: _currentYearLabel, isCurrent: true))
        .label;
    return [
      Padding(
        padding: const EdgeInsets.only(right: 10),
        child: Center(
          child: PopupMenuButton<int>(
            tooltip: 'Rotary year',
            onSelected: (id) => setState(() => _selectedYearId = id),
            itemBuilder: (_) => [
              for (final y in _years)
                PopupMenuItem<int>(
                  value: y.id,
                  child: Text(y.isCurrent ? '${y.label} (Current)' : y.label,
                      style: AppTextStyles.body.copyWith(
                          fontWeight: y.id == selId
                              ? FontWeight.w800
                              : FontWeight.w500)),
                ),
            ],
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.calendar_today_rounded,
                      size: 12, color: Colors.white),
                  const SizedBox(width: 4),
                  Text(selLabel.isEmpty ? 'Year' : selLabel,
                      style: AppTextStyles.caption.copyWith(
                          fontSize: 11,
                          color: Colors.white,
                          fontWeight: FontWeight.w700)),
                  const Icon(Icons.arrow_drop_down_rounded,
                      size: 16, color: Colors.white),
                ],
              ),
            ),
          ),
        ),
      ),
    ];
  }
}

/// Web-style Membership-Dues management surface used on BOTH club dashboards:
/// the OVERVIEW tab (`showKpis: true` — KPI cards on top) and the NORMAL
/// dashboard (`showKpis: false`).
///
/// Mirrors `rotary-frontend/.../club-admin-dashboard/membership-dues/page.tsx`:
/// the KPI cards + member table both come from the dashboard PAYMENTS endpoint
/// (`/api/mobile/club-admin-dashboard/payments`), NOT `/membership-dues/{id}/members`.
/// Per-row actions deep-link to the full member editor (DuesRosterScreen) for
/// the active dues setup — exactly like the web's "open members page". Bulk
/// Email + Export operate on the resolved active dues setup id.
class DuesManagementView extends StatefulWidget {
  final int clubId;
  final int? yearId;
  final bool showKpis;
  const DuesManagementView({
    super.key,
    required this.clubId,
    this.yearId,
    this.showKpis = false,
  });

  @override
  State<DuesManagementView> createState() => _DuesManagementViewState();
}

class _DuesManagementViewState extends State<DuesManagementView> {
  final ApiClient _api = ApiClient();
  final ClubAdminDashboardApi _dashApi = ClubAdminDashboardApi();

  bool _loading = true;
  String? _error;
  ClubAdminPayments? _payments; // KPI + member-table source (/payments)
  int? _activeDuesId; // for bulk / export / deep-link
  String _activeDuesName = 'Club Dues';

  String _search = '';
  String _filter = 'all'; // all | paid | partial | unpaid
  bool _busyExport = false;
  int _shown = 20; // client-side pagination cap

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  bool get _canManage =>
      context.read<AuthProvider>().isClubAdminOf(widget.clubId);

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // KPIs + member table — same endpoint the web membership-dues page uses.
      final payments =
          await _dashApi.getPayments(widget.clubId, yearId: widget.yearId);
      // Resolve the active dues setup id (for bulk reminders / export / the
      // per-row deep-link), exactly like the web's getMembershipDuesList.
      int? duesId;
      String duesName = 'Club Dues';
      try {
        final resp = await _api.get(
          '/api/membership-dues',
          queryParams: {'clubId': widget.clubId},
          fromJson: (j) => j,
        );
        final data = resp.data;
        final setups = data is List
            ? data
            : (data as Map<String, dynamic>?)?['items'] as List<dynamic>? ??
                const [];
        final active = _pickActiveSetup(setups, payments.yearLabel);
        if (active != null) {
          duesId = active['id'] as int?;
          duesName = (active['purpose'] ?? active['name'])?.toString() ??
              'Club Dues';
        } else if (payments.yearLabel.isNotEmpty) {
          // No active setup for the selected year — label the (empty) register
          // by that year so it never mislabels as another year's dues.
          duesName = '${payments.yearLabel} Club Dues';
        }
      } catch (_) {
        // Active-setup is best-effort; the table still renders from /payments.
      }
      if (!mounted) return;
      setState(() {
        _payments = payments;
        _activeDuesId = duesId;
        _activeDuesName = duesName;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load club dues.';
        _loading = false;
      });
    }
  }

  Map<String, dynamic>? _pickActiveSetup(List<dynamic> setups, String yl) {
    // When a year is known (it always is — the payments endpoint echoes the
    // selected year's label), mirror the backend GetPaymentsAsync EXACTLY:
    // only an ACTIVE dues setup for THAT year counts. Do NOT fall back to
    // another year's active setup — that's what made the title keep showing
    // "25/26 membership dues" after switching to a year with no setup.
    if (yl.isNotEmpty) {
      for (final s in setups) {
        final m = s as Map<String, dynamic>;
        if (m['rotaryYear']?.toString() == yl && m['isActive'] == true) {
          return m;
        }
      }
      return null;
    }
    // No year label at all (defensive) → first active, else first.
    for (final s in setups) {
      final m = s as Map<String, dynamic>;
      if (m['isActive'] == true) return m;
    }
    return setups.isNotEmpty ? setups.first as Map<String, dynamic> : null;
  }

  List<ClubAdminDuesMember> _filtered() {
    final p = _payments;
    if (p == null) return const [];
    final q = _search.trim().toLowerCase();
    return p.members.where((m) {
      if (q.isNotEmpty && !m.memberName.toLowerCase().contains(q)) return false;
      switch (_filter) {
        case 'paid':
          return m.status == PaymentStatus.paid;
        case 'partial':
          return m.status == PaymentStatus.partial;
        case 'unpaid':
          return m.status == PaymentStatus.unpaid;
        default:
          return true;
      }
    }).toList();
  }

  /// Per-filter count for the chip badges (over the full member set).
  int _countFor(String f) {
    final p = _payments;
    if (p == null) return 0;
    switch (f) {
      case 'paid':
        return p.members.where((m) => m.status == PaymentStatus.paid).length;
      case 'partial':
        return p.members.where((m) => m.status == PaymentStatus.partial).length;
      case 'unpaid':
        return p.members.where((m) => m.status == PaymentStatus.unpaid).length;
      default:
        return p.members.length;
    }
  }

  // ── actions (web-style: per-row deep-links to the full editor) ───────────
  void _openEditor() {
    final id = _activeDuesId;
    if (id == null) {
      // No active dues setup for this year. Creating/configuring setups is
      // SuperAdmin-only (web rule: club admins can only view/edit existing
      // dues, never create/delete), so there's nothing to open here.
      SnackbarUtils.showError(
          context, 'No active dues setup found for this year.');
      return;
    }
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => DuesRosterScreen(
          clubId: widget.clubId, duesId: id, duesName: _activeDuesName),
    ));
  }

  Future<void> _bulkReminder(String channel) async {
    final id = _activeDuesId;
    if (id == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Bulk Email Reminder'),
        content: const Text('Send a reminder to all unpaid members?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Send')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.post('/api/membership-dues/$id/bulk-reminder-email');
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Bulk email reminders sent');
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    }
  }

  Future<void> _export() async {
    final id = _activeDuesId;
    if (id == null || _busyExport) return;
    setState(() => _busyExport = true);
    try {
      // API returns an XLSX workbook (switched from CSV 2026-06-24); the saved
      // file must be .xlsx so it opens correctly in Excel/Sheets.
      final bytes = await _api.downloadBytes('/api/membership-dues/$id/export');
      await saveAndOpenBytes(bytes, 'membership-dues-$id.xlsx');
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Export failed: $e');
    } finally {
      if (mounted) setState(() => _busyExport = false);
    }
  }

  // ── build ────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 36),
          child: CircularProgressIndicator(),
        ),
      );
    }
    if (_error != null) {
      return _message(Icons.error_outline_rounded, _error!, onRetry: _bootstrap);
    }
    final p = _payments;
    if (p == null) {
      return _message(
          Icons.receipt_long_outlined, 'No club dues data.',
          onRetry: _bootstrap);
    }

    final members = _filtered();
    // No active dues setup for the selected year → don't render the register
    // card (search / filter chips / "No members…"); show a clear empty state.
    final noSetup = _activeDuesId == null;
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _bootstrap,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 28),
        children: noSetup
            ? [_noSetupCard()]
            : [
                if (widget.showKpis) ...[
                  DuesKpiCards.fromPayments(p),
                  const SizedBox(height: 12),
                ],
                _registerCard(p, members),
              ],
      ),
    );
  }

  // Shown when the selected Rotary year has no active dues setup at all.
  Widget _noSetupCard() {
    final yl = _payments?.yearLabel ?? '';
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
      ),
      padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 24),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.event_busy_rounded,
                size: 30, color: AppColors.primary),
          ),
          const SizedBox(height: 14),
          Text(
            'No active dues setup found for this year',
            textAlign: TextAlign.center,
            style: AppTextStyles.bodyMedium
                .copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            yl.isNotEmpty
                ? 'There are no club dues configured for $yl.'
                : 'There are no club dues configured for the selected year.',
            textAlign: TextAlign.center,
            style: AppTextStyles.caption
                .copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  // ── The member register, wrapped in one card ──
  Widget _registerCard(ClubAdminPayments p, List<ClubAdminDuesMember> members) {
    final visible = members.take(_shown).toList();
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 10, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_activeDuesName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.bodyMedium
                              .copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 2),
                      Text('Member Dues · ${p.members.length} total',
                          style: AppTextStyles.caption
                              .copyWith(color: AppColors.textSecondary)),
                    ],
                  ),
                ),
                if (_canManage && _activeDuesId != null) _iconCluster(),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 0),
            child: _openEditorButton(),
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 0),
            child: _searchField(),
          ),
          const SizedBox(height: 10),
          _filterChips(),
          const SizedBox(height: 8),
          _statusLegend(),
          const SizedBox(height: 6),
          const Divider(height: 1),
          if (members.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
              child: Center(
                child: Text(
                  p.members.isEmpty
                      ? 'No members in this dues register.'
                      : 'No members match.',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textMuted),
                ),
              ),
            )
          else ...[
            for (var i = 0; i < visible.length; i++) ...[
              if (i > 0)
                const Divider(height: 1, indent: 14, endIndent: 14),
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                child: _memberCard(visible[i]),
              ),
            ],
            if (_shown < members.length)
              Center(
                child: TextButton(
                  onPressed: () => setState(() => _shown += 20),
                  child: const Text('Show more'),
                ),
              ),
          ],
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Text(
                'Showing ${visible.length} of ${p.members.length} members',
                style:
                    AppTextStyles.caption.copyWith(color: AppColors.textMuted)),
          ),
        ],
      ),
    );
  }

  /// Primary CTA — a clean full-width button into the member editor.
  Widget _openEditorButton() {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: _openEditor,
        icon: const Icon(Icons.open_in_new_rounded, size: 16),
        label: const Text('Open in full editor'),
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primary,
          backgroundColor: AppColors.primary.withValues(alpha: 0.06),
          side: BorderSide(color: AppColors.primary.withValues(alpha: 0.25)),
          padding: const EdgeInsets.symmetric(vertical: 11),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10)),
          textStyle: AppTextStyles.body.copyWith(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  /// Bulk Email / Export as a tidy tinted icon cluster (top-right).
  /// "Manage dues setups" is intentionally absent — creating/deleting setups
  /// is SuperAdmin-only (web rule). Shown only with a resolved active dues id.
  Widget _iconCluster() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _iconBtn(const Icon(Icons.mail_outline_rounded, size: 18),
            AppColors.accentBlue, 'Bulk email reminder',
            () => _bulkReminder('email')),
        _iconBtn(
            _busyExport
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download_rounded, size: 18),
            AppColors.textSecondary, 'Export Excel',
            _busyExport ? null : _export),
      ],
    );
  }

  Widget _iconBtn(
      Widget icon, Color color, String tooltip, VoidCallback? onTap) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          margin: const EdgeInsets.only(left: 6),
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

  Widget _searchField() {
    return TextField(
      decoration: InputDecoration(
        hintText: 'Search member…',
        prefixIcon: const Icon(Icons.search, size: 20),
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      ),
      onChanged: (v) => setState(() {
        _search = v;
        _shown = 20;
      }),
    );
  }

  Widget _filterChips() {
    // Labels mirror the web's status pills (All / Paid / Pending / Partially
    // Paid); internal keys stay paid|unpaid|partial for filtering.
    const filters = [
      (key: 'all', label: 'All'),
      (key: 'paid', label: 'Paid'),
      (key: 'unpaid', label: 'Pending'),
      (key: 'partial', label: 'Partially Paid'),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Row(
        children: [
          for (final f in filters)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                label: Text('${f.label} ${_countFor(f.key)}'),
                labelStyle: AppTextStyles.caption.copyWith(
                    fontWeight: FontWeight.w700,
                    color: _filter == f.key
                        ? Colors.white
                        : AppColors.textSecondary),
                selected: _filter == f.key,
                selectedColor: AppColors.primary,
                backgroundColor: AppColors.muted,
                showCheckmark: false,
                side: BorderSide.none,
                onSelected: (_) => setState(() {
                  _filter = f.key;
                  _shown = 20;
                }),
              ),
            ),
        ],
      ),
    );
  }

  /// (color, label) for a payment status — labels mirror the web row pills.
  (Color, String) _statusStyle(PaymentStatus s) {
    switch (s) {
      case PaymentStatus.paid:
        return (AppColors.statusDone, 'Full Paid');
      case PaymentStatus.partial:
        return (AppColors.warningDark, 'Partly Paid');
      case PaymentStatus.exempt:
        return (AppColors.slate500, 'Exempt');
      case PaymentStatus.unpaid:
        return (AppColors.statusNone, 'Not Paid');
    }
  }

  /// Small colour legend decoding the status pills (shown once above the list).
  Widget _statusLegend() {
    Widget dot(Color c, String t) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
            const SizedBox(width: 4),
            Text(t,
                style: AppTextStyles.caption.copyWith(
                    fontSize: 10, color: AppColors.textSecondary)),
          ],
        );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Wrap(
        spacing: 12,
        runSpacing: 6,
        children: [
          dot(AppColors.statusDone, 'Full Paid'),
          dot(AppColors.warningDark, 'Partly Paid'),
          dot(AppColors.statusNone, 'Not Paid'),
          dot(AppColors.slate500, 'Exempt'),
        ],
      ),
    );
  }

  /// One member as an expandable card: collapsed = avatar + name + status pill;
  /// expanded = labeled Amount Due / Paid / Balance grid + context-sensitive
  /// actions (Mark Paid / Remind / Receipt) that deep-link to the full editor,
  /// matching the web's per-row buttons.
  Widget _memberCard(ClubAdminDuesMember m) {
    final balance =
        (m.amountDueInr - m.amountPaidInr).clamp(0.0, double.infinity);
    final isExempt = m.status == PaymentStatus.exempt;
    final (color, label) = _statusStyle(m.status);

    final title = Row(
      children: [
        CircleAvatar(
          radius: 16,
          backgroundColor: Color(m.colorArgb).withValues(alpha: 0.15),
          child: Text(m.initials,
              style: TextStyle(
                  color: Color(m.colorArgb),
                  fontWeight: FontWeight.w700,
                  fontSize: 11)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(m.memberName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w700)),
        ),
      ],
    );
    final trailing = Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10, fontWeight: FontWeight.w800, color: color)),
    );
    final expanded = Padding(
      padding: const EdgeInsets.only(left: 42),
      child: isExempt
          ? Text('Exempt: no dues payable.',
              style:
                  AppTextStyles.caption.copyWith(color: AppColors.textMuted))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                StatGrid(stats: [
                  LabeledStat(
                      label: 'Amount Due', value: fmtInrFull(m.amountDueInr)),
                  LabeledStat(
                      label: 'Paid',
                      value: fmtInrFull(m.amountPaidInr),
                      valueColor: AppColors.success),
                  LabeledStat(
                      label: 'Balance',
                      value: fmtInrFull(balance),
                      valueColor:
                          balance > 0 ? AppColors.error : AppColors.success),
                ]),
                const SizedBox(height: 10),
                _memberActions(m),
              ],
            ),
    );
    return ExpandableRecordCard(
      key: ValueKey(m.memberId),
      collapsedTitle: title,
      collapsedTrailing: trailing,
      expandedChild: expanded,
    );
  }

  /// Context-sensitive per-row actions (web parity): Paid → Receipt; Partial /
  /// Unpaid → Mark Paid + Remind. All deep-link to the full editor.
  Widget _memberActions(ClubAdminDuesMember m) {
    final btns = <Widget>[];
    if (m.status == PaymentStatus.paid) {
      btns.add(_rowAction(
          'Receipt', Icons.receipt_long_rounded, AppColors.primary));
    } else if (m.status == PaymentStatus.partial ||
        m.status == PaymentStatus.unpaid) {
      // "Mark Paid" is the offline-payment entry (deep-links to the editor's
      // offline dialog) — hidden for launch with the rest of that flow.
      if (kOfflinePaymentsEnabled) {
        btns.add(
            _rowAction('Mark Paid', Icons.payments_rounded, AppColors.success));
      }
      btns.add(_rowAction(
          'Remind', Icons.notifications_active_rounded, AppColors.accentBlue));
    }
    if (btns.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: 8, runSpacing: 8, children: btns);
  }

  Widget _rowAction(String label, IconData icon, Color color) {
    return OutlinedButton.icon(
      onPressed: _openEditor,
      icon: Icon(icon, size: 15),
      label: Text(label,
          style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w700)),
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: 0.4)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        minimumSize: const Size(0, 0),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  Widget _message(IconData icon, String text, {VoidCallback? onRetry}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
      child: Column(
        children: [
          Icon(icon, size: 34, color: AppColors.slate400),
          const SizedBox(height: 8),
          Text(text,
              textAlign: TextAlign.center,
              style:
                  AppTextStyles.caption.copyWith(color: AppColors.slate500)),
          if (onRetry != null) ...[
            const SizedBox(height: 8),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ],
      ),
    );
  }
}
