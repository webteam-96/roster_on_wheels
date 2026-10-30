import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter_quill/flutter_quill.dart' as quill;
import 'package:flutter_quill_delta_from_html/flutter_quill_delta_from_html.dart';
import 'package:image_picker/image_picker.dart';
import 'package:vsc_quill_delta_to_html/vsc_quill_delta_to_html.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/snackbar_utils.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import 'package:intl/intl.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/utils/currency_symbol.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// District admin's **District Dues** management view — mobile port of the web
/// district-admin "District Dues" page. Two tabs:
///  • Clubs & Approvals — 4 KPI tiles (Total via Offline / Total via Online /
///    Collected / Pending (Offline)) + a per-club breakdown showing the
///    independent Offline and Online tracks (each with its amount, amount paid,
///    and per-bank-account Paid/Unpaid breakdown), Total Paid and Payment Type,
///    with Review (approve/reject offline), record-Offline, and per-club / bulk
///    email reminders. Mirrors the rebuilt web District-Dues table.
///  • Content — branding images (purpose logo / background / email header) and
///    the receipt + reminder email editors (subject/body with insertable
///    tokens), plus a test-email sender.
///
/// Endpoints (ClubDuesController): GET /api/club-dues?districtId= (campaigns) →
/// {id}/clubs (per-club) → payments/{id}/offline-details + approve-reject;
/// {id}/offline-payment (record); {id}[/clubs/{clubId}]/reminder;
/// {id}/content (GET + PATCH); test-email.
class DistrictClubDuesScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictClubDuesScreen(
      {super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictClubDuesScreen> createState() => _DistrictClubDuesScreenState();
}

class _DistrictClubDuesScreenState extends State<DistrictClubDuesScreen> {
  final _api = ApiClient();

  List<_Campaign> _campaigns = const [];
  _Campaign? _selected;
  List<_ClubRow> _clubs = const [];
  bool _loading = true;
  bool _loadingClubs = false;
  String? _error;
  String _statusFilter = 'All';
  String _tab = 'clubs'; // 'clubs' | 'content'

  // Bulk / per-row reminder busy flags.
  String? _bulkBusy; // 'email'
  String? _rowBusy; // '{clubId}-email'

  static const _statuses = ['All', 'Pending', 'Fully Paid', 'Partial', 'Unpaid'];

  // ── Content-tab state ─────────────────────────────────────────────────
  bool _contentLoaded = false;
  bool _loadingContent = false;
  bool _savingContent = false;
  String _existingLogo = '';
  String _existingBg = '';
  String _existingEmailLogo = '';
  File? _logoFile;
  File? _bgFile;
  File? _emailLogoFile;
  final _ccCtrl = TextEditingController();
  final _receiptSubjectCtrl = TextEditingController();
  final _reminderSubjectCtrl = TextEditingController();
  // Rich-text (HTML) body editors — mirror the web's Quill editors so stored
  // HTML round-trips. Built on content load.
  quill.QuillController? _receiptBodyQuill;
  quill.QuillController? _reminderBodyQuill;
  // Bank config (carried through to the reminder test-email preview).
  bool _showBank = false;
  String _bankName = '';
  String _accountNumber = '';
  String _ifsc = '';
  final _testEmailCtrl = TextEditingController();
  String? _testBusy; // 'reminder' | 'receipt'

  @override
  void initState() {
    super.initState();
    _loadCampaigns();
  }

  @override
  void dispose() {
    _ccCtrl.dispose();
    _receiptSubjectCtrl.dispose();
    _reminderSubjectCtrl.dispose();
    _receiptBodyQuill?.dispose();
    _reminderBodyQuill?.dispose();
    _testEmailCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadCampaigns() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/club-dues',
        queryParams: {'districtId': widget.districtId},
        fromJson: (j) => j as List<dynamic>,
      );
      final rows = (resp.data ?? const [])
          .whereType<Map>()
          .map((e) => _Campaign.fromJson(e.cast<String, dynamic>()))
          .toList();
      if (!mounted) return;
      // Prefer the active campaign, else the most recent (list is newest-first).
      final pick = rows.where((c) => c.isActive).isNotEmpty
          ? rows.firstWhere((c) => c.isActive)
          : (rows.isNotEmpty ? rows.first : null);
      setState(() {
        _campaigns = rows;
        _selected = pick;
        _loading = false;
      });
      if (pick != null) _loadClubs();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Could not load district dues.';
        _loading = false;
      });
    }
  }

  Future<void> _loadClubs() async {
    final camp = _selected;
    if (camp == null) return;
    setState(() => _loadingClubs = true);
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/club-dues/${camp.id}/clubs',
        queryParams: {'includeNonSynced': true},
        fromJson: (j) => j as List<dynamic>,
      );
      final rows = (resp.data ?? const [])
          .whereType<Map>()
          .map((e) => _ClubRow.fromJson(e.cast<String, dynamic>()))
          .toList();
      if (!mounted) return;
      setState(() {
        _clubs = rows;
        _loadingClubs = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingClubs = false);
      SnackbarUtils.showError(
          context, e is ApiException ? e.message : 'Could not load clubs.');
    }
  }

  // ── Money formatting (brand locale and currency, as the web) ──────────
  String _inr(num v) => formatMoney(v.round(), null);

  // [forceTwo] mirrors the web table (always two decimals); otherwise whole
  // amounts drop decimals. Dues carry cents, so amounts are NOT rounded.
  String _grpDecimal(num v, {required bool forceTwo}) => forceTwo
      ? NumberFormat.simpleCurrency(locale: brandNumberLocale(), name: currencyCodeOr(null), decimalDigits: 2).format(v)
      : formatMoney(v, null);

  /// KPI-tile money — natural decimals (drops trailing zeros).
  String _money(num v) => _grpDecimal(v, forceTwo: false);

  /// Per-club amount — always 2 decimals (matches the web table).
  String _money2(num v) => _grpDecimal(v, forceTwo: true);

  // ── Derived KPIs (base amounts only — online surcharge excluded) ──────
  int get _totalClubs => _clubs.length;
  int get _clubsFullyPaid =>
      _clubs.where((c) => (c.status ?? '') == 'Fully Paid').length;
  int get _pendingApprovals => _clubs.where((c) => c.hasPendingApproval).length;
  int get _membersTotal => _clubs.fold(0, (s, c) => s + c.memberCount);
  int get _membersPaid => _clubs.fold(0, (s, c) => s + c.paidCount);
  // Online and Offline are independent tracks with independent rates, so there
  // is no single honest "Total" — show two parallel totals (mirrors the web
  // summary): Total via Offline, Total via Online, Collected, Pending (Offline).
  double get _offlineTotal => _clubs.fold(0.0, (s, c) => s + c.offlineAmount);
  double get _onlineTotal => _clubs.fold(0.0, (s, c) => s + c.onlineAmount);
  double get _collectedAmount =>
      _clubs.fold(0.0, (s, c) => s + c.offlinePaid + c.onlinePaid);
  double get _pendingOffline => _clubs.fold(
      0.0, (s, c) => s + (c.offlineAmount - c.offlinePaid).clamp(0.0, double.infinity));

  List<_ClubRow> get _filtered {
    switch (_statusFilter) {
      case 'Pending':
        return _clubs.where((c) => c.hasPendingApproval).toList();
      case 'Fully Paid':
        return _clubs.where((c) => (c.status ?? '') == 'Fully Paid').toList();
      case 'Partial':
        return _clubs.where((c) => (c.status ?? '') == 'Partial').toList();
      case 'Unpaid':
        return _clubs.where((c) => (c.status ?? '') == 'Unpaid').toList();
      default:
        return _clubs;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar:
          widget.embedded ? null : const CustomAppBar(title: 'District Dues'),
      body: _loading
          ? const LoadingWidget()
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadCampaigns)
              : _selected == null
                  ? const EmptyStateWidget(
                      title: 'No District Dues',
                      subtitle:
                          'No district dues campaign for this district yet.',
                      icon: Icons.account_balance_wallet_outlined,
                    )
                  : _scaffoldBody(),
    );
  }

  Widget _scaffoldBody() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Track which clubs have paid, approve offline payments, and edit '
                "the branding & email content for your district's dues.",
                style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                    height: 1.35),
              ),
              if (_campaigns.length > 1) ...[
                const SizedBox(height: 12),
                _campaignSelector(),
              ],
            ],
          ),
        ),
        _tabBar(),
        Expanded(
          child: _tab == 'clubs'
              ? RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: _loadClubs,
                  child: _clubsList(),
                )
              : _contentView(),
        ),
      ],
    );
  }

  // ── Tab bar ───────────────────────────────────────────────────────────
  Widget _tabBar() {
    Widget btn(String key, String label) {
      final sel = _tab == key;
      return Expanded(
        child: InkWell(
          onTap: () {
            setState(() => _tab = key);
            if (key == 'content' && !_contentLoaded) _loadContent();
          },
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: sel ? AppColors.primary : Colors.transparent,
                  width: 2,
                ),
              ),
            ),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: sel ? AppColors.primary : AppColors.textSecondary,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: const Border(bottom: const BorderSide(color: AppColors.border)),
      ),
      child: Row(children: [
        btn('clubs', 'Clubs & Approvals'),
        btn('content', 'Content'),
      ]),
    );
  }

  Widget _campaignSelector() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<_Campaign>(
          value: _selected,
          isExpanded: true,
          items: _campaigns
              .map((c) => DropdownMenuItem(
                    value: c,
                    child: Text(c.title,
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                  ))
              .toList(),
          onChanged: (c) {
            if (c == null) return;
            setState(() {
              _selected = c;
              _clubs = const [];
              _contentLoaded = false;
            });
            _loadClubs();
            if (_tab == 'content') _loadContent();
          },
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CLUBS & APPROVALS TAB
  // ═══════════════════════════════════════════════════════════════════════
  Widget _clubsList() {
    final filtered = _filtered;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        _kpiCards(),
        const SizedBox(height: 16),
        _filterRow(),
        const SizedBox(height: 10),
        _bulkRow(),
        const SizedBox(height: 14),
        if (_loadingClubs)
          const Padding(
            padding: EdgeInsets.only(top: 24),
            child: const RowSkeletonList(),
          )
        else if (filtered.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 24),
            child: Center(
              child: Text('No clubs for this filter.',
                  style: AppFonts.body(
                      color: AppColors.textSecondary)),
            ),
          )
        else
          ...filtered.map(_clubCard),
      ],
    );
  }

  // Four KPI tiles (2×2), mirroring the rebuilt web District-Dues header:
  // Total via Offline · Total via Online · Collected · Pending (Offline).
  Widget _kpiCards() {
    final membersLabel =
        '$_membersTotal member${_membersTotal == 1 ? '' : 's'} · '
        '$_clubsFullyPaid/$_totalClubs clubs paid';
    final paidLabel = '$_membersPaid member${_membersPaid == 1 ? '' : 's'} · '
        '$_clubsFullyPaid/$_totalClubs clubs paid';
    return Column(
      children: [
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _kpiTile('Total via Offline', _money(_offlineTotal),
                    membersLabel, AppColors.primary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _kpiTile('Total via Online', _money(_onlineTotal),
                    'across $_totalClubs club${_totalClubs == 1 ? '' : 's'}',
                    AppColors.primary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _kpiTile('Collected', _money(_collectedAmount),
                    paidLabel, AppColors.success),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _kpiTile(
                  'Pending (Offline)',
                  _money(_pendingOffline),
                  _pendingApprovals > 0
                      ? '$_pendingApprovals offline awaiting approval'
                      : null,
                  AppColors.error,
                  subColor: AppColors.warning,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kpiTile(String label, String value, String? sub, Color color,
      {Color? subColor}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value,
                style: AppFonts.body(
                    fontSize: 19, fontWeight: FontWeight.w800, color: color)),
          ),
          const SizedBox(height: 3),
          Text(sub ?? ' ',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppFonts.body(
                  fontSize: 13, color: subColor ?? AppColors.textSecondary)),
        ],
      ),
    );
  }

  Widget _filterRow() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _statuses.map((s) {
          final sel = s == _statusFilter;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: Text(s),
              selected: sel,
              showCheckmark: false,
              onSelected: (_) => setState(() => _statusFilter = s),
              labelStyle: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: sel ? Colors.white : AppColors.textSecondary,
              ),
              selectedColor: AppColors.primaryPrime,
              backgroundColor: AppColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(999),
                side: BorderSide(
                    color: sel ? AppColors.primaryPrime : AppColors.border),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _bulkRow() {
    return Row(
      children: [
        Expanded(
          child: _outlineAction(
            icon: Icons.notifications_none_rounded,
            label: 'Email all',
            busy: _bulkBusy == 'email',
            disabled: _bulkBusy != null,
            onTap: _emailAll,
          ),
        ),
        const SizedBox(width: 10),
      ],
    );
  }

  Widget _outlineAction({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool busy = false,
    bool disabled = false,
  }) {
    return OutlinedButton.icon(
      onPressed: disabled ? null : onTap,
      icon: busy
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(icon, size: 16),
      label: Text(label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppFonts.body(
              fontSize: 13, fontWeight: FontWeight.w600)),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.textPrimary,
        minimumSize: const Size(0, 40),
        side: const BorderSide(color: AppColors.border),
        shape:
            const StadiumBorder(),
      ),
    );
  }

  Widget _clubCard(_ClubRow c) {
    final fullyPaid = (c.status ?? '') == 'Fully Paid';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    Text(c.clubName ?? 'Club ${c.fkClubId}',
                        style: AppFonts.body(
                            fontSize: 15, fontWeight: FontWeight.w700)),
                    if (c.hasPendingApproval)
                      _pill('offline pending', AppColors.info),
                  ],
                ),
              ),
              _statusPill(c),
            ],
          ),
          const SizedBox(height: 10),
          // Members line — "N members · X paid + Y unpaid" (web "paid+unpaid").
          Row(
            children: [
              const Icon(Icons.people_outline,
                  size: 14, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${c.memberCount} member${c.memberCount == 1 ? '' : 's'} · '
                  '${c.paidCount} paid + ${c.unpaidCount} unpaid',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Independent Offline / Online tracks. Once a club has paid via one
          // channel (paidOnline true/false) the OTHER channel is moot for it, so
          // hide that block — matching the web live list, which blanks the
          // losing channel's columns. Both stay while nothing is paid yet
          // (paidOnline == null, neither channel ruled out).
          if (c.paidOnline != true)
            _trackBlock('Offline', c.offlineAmount, c.offlinePaid,
                c.offlineAccountBreakdown, AppColors.primary),
          if (c.paidOnline == null) const SizedBox(height: 8),
          if (c.paidOnline != false)
            _trackBlock('Online', c.onlineAmount, c.onlinePaid,
                c.onlineAccountBreakdown, AppColors.info),
          const SizedBox(height: 10),
          Row(
            children: [
              Text('Total Paid',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.textSecondary)),
              const SizedBox(width: 6),
              Text(_money2(c.totalPaid),
                  style: AppFonts.body(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const Spacer(),
              _typePill(c),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (c.hasPendingApproval && c.pendingPaymentId != null)
                _filledBtn('Review', () => _openReview(c)),
              _outlinedBtn('Offline',
                  disabled: fullyPaid, onTap: () => _openOffline(c)),
              _iconBtn(
                icon: Icons.notifications_none_rounded,
                busy: _rowBusy == '${c.fkClubId}-email',
                tooltip: 'Send email reminder',
                onTap: () => _emailClub(c),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _filledBtn(String label, VoidCallback onTap) {
    return SizedBox(
      height: 36,
      child: ElevatedButton(
        onPressed: onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primaryPrime,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          textStyle: AppFonts.body(
              fontSize: 13, fontWeight: FontWeight.w700),
          shape:
              const StadiumBorder(),
        ),
        child: Text(label),
      ),
    );
  }

  Widget _outlinedBtn(String label,
      {required VoidCallback onTap, bool disabled = false}) {
    return SizedBox(
      height: 36,
      child: OutlinedButton(
        onPressed: disabled ? null : onTap,
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textPrimary,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          side: const BorderSide(color: AppColors.border),
          textStyle: AppFonts.body(
              fontSize: 13, fontWeight: FontWeight.w700),
          shape:
              const StadiumBorder(),
        ),
        child: Text(label),
      ),
    );
  }

  Widget _iconBtn({
    required IconData icon,
    required VoidCallback onTap,
    String? tooltip,
    bool busy = false,
  }) {
    return SizedBox(
      width: 40,
      height: 36,
      child: OutlinedButton(
        onPressed: busy ? null : onTap,
        style: OutlinedButton.styleFrom(
          padding: EdgeInsets.zero,
          foregroundColor: AppColors.textSecondary,
          side: const BorderSide(color: AppColors.border),
          shape:
              const StadiumBorder(),
        ),
        child: busy
            ? const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2))
            : Icon(icon, size: 18),
      ),
    );
  }

  // One payment track (Offline / Online): header with the full track amount, a
  // "Paid" line, and a per-bank-account breakdown (amount + Paid/Unpaid chip).
  Widget _trackBlock(String title, double amount, double paid,
      List<_AccountBreakdown> accounts, Color accent) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration:
                    BoxDecoration(color: accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
              Text(title,
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const Spacer(),
              Text(_money2(amount),
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
            ],
          ),
          const SizedBox(height: 2),
          Align(
            alignment: Alignment.centerRight,
            child: Text('Paid ${_money2(paid)}',
                style: AppFonts.body(
                    fontSize: 13,
                    color:
                        paid > 0 ? AppColors.success : AppColors.textSecondary)),
          ),
          for (final a in accounts) ...[
            const SizedBox(height: 6),
            _acctRow(a),
          ],
        ],
      ),
    );
  }

  Widget _acctRow(_AccountBreakdown a) {
    return Row(
      children: [
        const SizedBox(width: 14),
        const Icon(Icons.account_balance_outlined,
            size: 12, color: AppColors.textSecondary),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            (a.accountLabel?.trim().isNotEmpty ?? false)
                ? a.accountLabel!.trim()
                : 'Account',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
                fontSize: 13, color: AppColors.textSecondary),
          ),
        ),
        const SizedBox(width: 6),
        Text(_money2(a.amount),
            style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
        const SizedBox(width: 6),
        _pill(a.isPaid ? 'Paid' : 'Unpaid',
            a.isPaid ? AppColors.success : AppColors.error),
      ],
    );
  }

  // "Payment Type" — the mode of the latest paid payment (web parity).
  Widget _typePill(_ClubRow c) {
    if (c.paidOnline == null) {
      return Text('Not paid',
          style: AppFonts.body(
              fontSize: 13, color: AppColors.textMuted));
    }
    final online = c.paidOnline!;
    return _pill(online ? 'Online' : 'Offline',
        online ? AppColors.info : AppColors.primary);
  }

  Widget _statusPill(_ClubRow c) {
    final s = (c.status ?? '').trim();
    if (s.isEmpty) return const SizedBox.shrink();
    final color = s == 'Fully Paid'
        ? AppColors.success
        : (s == 'Partial' ? AppColors.warning : AppColors.textMuted);
    return _pill(s, color);
  }

  Widget _pill(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(text,
          style: AppFonts.body(
              fontSize: 13, fontWeight: FontWeight.w700, color: color)),
    );
  }

  // ── Confirmation dialog for reminder sends ────────────────────────────
  Future<bool> _confirm(String title, String message, String confirmLabel) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape:
            const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(20))),
        title: Text(title,
            style: AppFonts.body(
                fontSize: 17, fontWeight: FontWeight.w800)),
        content: Text(message,
            style: AppFonts.body(
                fontSize: 13.5, height: 1.35, color: AppColors.textSecondary)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('Cancel',
                style: AppFonts.body(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primaryPrime,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: const StadiumBorder(),
            ),
            child: Text(confirmLabel,
                style: AppFonts.body(
                    fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
    return ok == true;
  }

  // ── Bulk / per-club reminders ─────────────────────────────────────────
  Future<void> _emailAll() async {
    final id = _selected?.id;
    if (id == null) return;
    if (!await _confirm('Email all unpaid clubs',
        'Send an email dues reminder to every unpaid club in this campaign?',
        'Send')) {
      return;
    }
    setState(() => _bulkBusy = 'email');
    try {
      await _api.post('/api/club-dues/$id/reminder', body: {'remark': null});
      if (mounted) {
        SnackbarUtils.showSuccess(
            context, 'Email reminders sent to all unpaid clubs.');
      }
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context,
            e is ApiException ? e.message : 'Could not send reminders.');
      }
    } finally {
      if (mounted) setState(() => _bulkBusy = null);
    }
  }


  Future<void> _emailClub(_ClubRow c) async {
    final id = _selected?.id;
    if (id == null) return;
    final name = c.clubName ?? 'this club';
    if (!await _confirm('Email reminder',
        'Send an email dues reminder to $name?', 'Send')) {
      return;
    }
    setState(() => _rowBusy = '${c.fkClubId}-email');
    try {
      await _api.post('/api/club-dues/$id/clubs/${c.fkClubId}/reminder',
          body: {'remark': null});
      if (mounted) {
        SnackbarUtils.showSuccess(
            context, 'Email reminder sent to ${c.clubName ?? 'club'}.');
      }
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context,
            e is ApiException ? e.message : 'Could not send reminder.');
      }
    } finally {
      if (mounted) setState(() => _rowBusy = null);
    }
  }


  // ── Record offline payment (marks club paid immediately) ──────────────
  Future<void> _openOffline(_ClubRow c) async {
    final id = _selected?.id;
    if (id == null) return;
    // "Which bank account did this go into?" — independent-track campaigns can
    // split the club's offline dues across accounts; fetch the options so the
    // sheet can offer an Account picker (mirrors the web offline dialog).
    List<_OfflineAccountOption> accounts = const [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/club-dues/$id/clubs/${c.fkClubId}/offline-accounts',
        fromJson: (j) => j as List<dynamic>,
      );
      accounts = (resp.data ?? const [])
          .whereType<Map>()
          .map((e) => _OfflineAccountOption.fromJson(e.cast<String, dynamic>()))
          .toList();
    } catch (_) {
      // Non-fatal — fall back to the flat unpaid×rate amount, no account picker.
    }
    if (!mounted) return;
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => _OfflineRecordSheet(
        club: c,
        amountLabel: _money2(c.amountOwed),
        accounts: accounts,
        money: _money2,
        onSubmit: (type, txnId, remark, accountId) =>
            _recordOffline(id, c, type, txnId, remark, accountId),
      ),
    );
    if (done == true) {
      if (mounted) SnackbarUtils.showSuccess(context, 'Offline payment recorded.');
      await _loadClubs();
    }
  }

  Future<bool> _recordOffline(int duesId, _ClubRow c, String type, String txnId,
      String remark, int? accountId) async {
    try {
      await _api.sendMultipart<Map<String, dynamic>>(
        '/api/club-dues/$duesId/offline-payment',
        method: 'POST',
        fields: {
          'FkClubId': '${c.fkClubId}',
          'TransactionType': type,
          'TransactionId': txnId,
          'Remark': remark,
          'SendReceiptEmail': 'true',
          // Which bank account the money went into (independent-track campaigns).
          if (accountId != null) 'FkRouteAccountId': '$accountId',
        },
        fromJson: (j) => j is Map ? j.cast<String, dynamic>() : {},
      );
      return true;
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context,
            e is ApiException ? e.message : 'Could not record payment.');
      }
      return false;
    }
  }

  // ── Review offline payment (approve / reject) ─────────────────────────
  Future<void> _openReview(_ClubRow c) async {
    final paymentId = c.pendingPaymentId;
    if (paymentId == null) return;
    _OfflineDetail? detail;
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/club-dues/payments/$paymentId/offline-details',
        fromJson: (j) => (j as Map).cast<String, dynamic>(),
      );
      detail = _OfflineDetail.fromJson(resp.data ?? const {});
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context,
            e is ApiException ? e.message : 'Could not load payment.');
      }
      return;
    }
    if (!mounted) return;
    final result = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => _ReviewPage(
        clubName: c.clubName ?? 'Club ${c.fkClubId}',
        detail: detail!,
        inr: _inr,
        onDecision: (approved, reason) =>
            _decide(paymentId, approved, reason),
      ),
    ));
    if (result == true) await _loadClubs();
  }

  Future<bool> _decide(int paymentId, bool approved, String? reason) async {
    try {
      await _api.post<Map<String, dynamic>>(
        '/api/club-dues/payments/$paymentId/approve-reject',
        body: {
          'isApproved': approved,
          if (!approved) 'rejectionReason': reason,
        },
        fromJson: (j) => (j as Map).cast<String, dynamic>(),
      );
      if (mounted) {
        SnackbarUtils.showSuccess(
            context, approved ? 'Payment approved.' : 'Payment rejected.');
      }
      return true;
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(
            context, e is ApiException ? e.message : 'Could not submit.');
      }
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONTENT TAB
  // ═══════════════════════════════════════════════════════════════════════
  String _assetUrl(String? v) {
    final s = (v ?? '').trim();
    if (s.isEmpty) return '';
    if (s.startsWith('http')) return s;
    if (s.startsWith('/')) return '${ApiConstants.baseUrl}$s';
    return '${ApiConstants.baseUrl}/Documents/ClubDues/$s';
  }

  quill.QuillController _makeQuill(String? html) {
    quill.Document doc;
    try {
      final delta = (html != null && html.trim().isNotEmpty)
          ? HtmlToDelta().convert(html)
          : null;
      doc = delta != null ? quill.Document.fromDelta(delta) : quill.Document();
    } catch (_) {
      // Malformed/edge-case HTML must never wedge the editor on a blank screen.
      doc = quill.Document();
    }
    return quill.QuillController(
      document: doc,
      selection: const TextSelection.collapsed(offset: 0),
    );
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

  Future<void> _loadContent() async {
    final id = _selected?.id;
    if (id == null) return;
    setState(() => _loadingContent = true);
    Map<String, dynamic> d = const {};
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/club-dues/$id/content',
        fromJson: (j) => (j as Map).cast<String, dynamic>(),
      );
      d = resp.data ?? const {};
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context,
            e is ApiException ? e.message : 'Could not load content.');
      }
    }
    if (!mounted) return;
    // Build the rich-text editors from the loaded HTML BEFORE setState (always,
    // even on a failed fetch → empty editors) so a parse hiccup can never leave
    // the tab stuck on the loading spinner.
    final receipt = _makeQuill((d['emailBody'] ?? '').toString());
    final reminder = _makeQuill((d['emailReminderBody'] ?? '').toString());
    _receiptBodyQuill?.dispose();
    _reminderBodyQuill?.dispose();
    setState(() {
      _existingLogo = (d['purposeLogo'] ?? '').toString();
      _existingBg = (d['backgroundImage'] ?? '').toString();
      _existingEmailLogo = (d['emailHeaderLogo'] ?? '').toString();
      _ccCtrl.text = (d['emailCC'] ?? '').toString();
      _receiptSubjectCtrl.text = (d['emailSubject'] ?? '').toString();
      _reminderSubjectCtrl.text = (d['emailReminderSubject'] ?? '').toString();
      _receiptBodyQuill = receipt;
      _reminderBodyQuill = reminder;
      _showBank = (d['isShowBankInReceipt'] ?? false) == true;
      _bankName = (d['offlineBankName'] ?? '').toString();
      _accountNumber = (d['offlineAccountNumber'] ?? '').toString();
      _ifsc = (d['offlineIfscCode'] ?? '').toString();
      _logoFile = null;
      _bgFile = null;
      _emailLogoFile = null;
      _loadingContent = false;
      _contentLoaded = true;
    });
  }

  Future<void> _pickImage(void Function(File) assign) async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 92,
      maxWidth: 3000,
      maxHeight: 3000,
    );
    if (picked == null) return;
    setState(() => assign(File(picked.path)));
  }

  Future<void> _saveContent() async {
    final id = _selected?.id;
    if (id == null) return;
    setState(() => _savingContent = true);
    try {
      final files = <String, String>{};
      if (_logoFile != null) files['logo'] = _logoFile!.path;
      if (_bgFile != null) files['bgImage'] = _bgFile!.path;
      if (_emailLogoFile != null) files['emailLogo'] = _emailLogoFile!.path;
      await _api.sendMultipart<Map<String, dynamic>>(
        '/api/club-dues/$id/content',
        method: 'PATCH',
        fields: {
          'EmailCC': _ccCtrl.text.trim(),
          'EmailSubject': _receiptSubjectCtrl.text,
          'EmailBody': _htmlOf(_receiptBodyQuill),
          'EmailReminderSubject': _reminderSubjectCtrl.text,
          'EmailReminderBody': _htmlOf(_reminderBodyQuill),
        },
        files: files,
        fromJson: (j) => j is Map ? j.cast<String, dynamic>() : {},
      );
      if (mounted) SnackbarUtils.showSuccess(context, 'Content updated.');
      await _loadContent(); // re-fetch so saved images show + pickers reset
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(
            context, e is ApiException ? e.message : 'Could not save.');
      }
    } finally {
      if (mounted) setState(() => _savingContent = false);
    }
  }

  Future<void> _sendTest(String type) async {
    final email = _testEmailCtrl.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      SnackbarUtils.showError(context, 'Enter a valid email address.');
      return;
    }
    setState(() => _testBusy = type);
    try {
      final files = <String, String>{};
      if (_emailLogoFile != null) files['emailLogo'] = _emailLogoFile!.path;
      await _api.sendMultipart<Map<String, dynamic>>(
        '/api/club-dues/test-email',
        method: 'POST',
        fields: {
          'Email': email,
          'Type': type,
          'DistrictId': '${widget.districtId}',
          'DuesId': '${_selected?.id ?? 0}',
          'Subject': type == 'reminder'
              ? _reminderSubjectCtrl.text
              : _receiptSubjectCtrl.text,
          'Body': type == 'reminder'
              ? _htmlOf(_reminderBodyQuill)
              : _htmlOf(_receiptBodyQuill),
          'ShowBank': _showBank ? 'true' : 'false',
          'BankName': _bankName,
          'AccountNumber': _accountNumber,
          'Ifsc': _ifsc,
        },
        files: files,
        fromJson: (j) => j is Map ? j.cast<String, dynamic>() : {},
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context,
            'Test ${type == 'reminder' ? 'reminder' : 'thank-you'} sent to $email.');
      }
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context,
            e is ApiException ? e.message : 'Could not send test email.');
      }
    } finally {
      if (mounted) setState(() => _testBusy = null);
    }
  }

  Widget _contentView() {
    if (_loadingContent && !_contentLoaded) {
      return const RowSkeletonList();
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        // Images
        _sectionCard(
          title: 'Images',
          child: Column(
            children: [
              _imageField('Purpose logo', _logoFile, _existingLogo,
                  (f) => _logoFile = f),
              const SizedBox(height: 14),
              _imageField('Background image', _bgFile, _existingBg,
                  (f) => _bgFile = f),
              const SizedBox(height: 14),
              _imageField('Email header logo', _emailLogoFile,
                  _existingEmailLogo, (f) => _emailLogoFile = f),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // Email content
        _sectionCard(
          title: 'Email content',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Tap a chip to insert a value (e.g. club name, amount) into your '
                "text: it's filled in when the email is sent. If you don't add "
                'an amount/members value, a summary is appended for you.',
                style: AppFonts.body(
                    fontSize: 13,
                    height: 1.35,
                    color: AppColors.textSecondary),
              ),
              const SizedBox(height: 12),
              _fieldLabel('Email CC'),
              _textField(_ccCtrl,
                  hint: 'cc@example.com, another@example.com'),
              const SizedBox(height: 16),
              _emailBlock(
                title: 'Receipt (thank-you) email',
                subjectCtrl: _receiptSubjectCtrl,
                bodyQuill: _receiptBodyQuill,
                subjectHint: 'Your District Dues receipt',
                tokens: _receiptTokens,
              ),
              const SizedBox(height: 14),
              _emailBlock(
                title: 'Reminder email',
                subjectCtrl: _reminderSubjectCtrl,
                bodyQuill: _reminderBodyQuill,
                subjectHint: 'District Dues reminder',
                tokens: _reminderTokens,
              ),
              const SizedBox(height: 14),
              _testEmailBlock(),
            ],
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _savingContent ? null : _saveContent,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primaryPrime,
              foregroundColor: Colors.white,
              minimumSize: const Size(0, 50),
              elevation: 0,
              textStyle: AppFonts.body(
                  fontSize: 15, fontWeight: FontWeight.w700),
              shape: const StadiumBorder(),
            ),
            child: _savingContent
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : const Text('Save changes'),
          ),
        ),
      ],
    );
  }

  Widget _sectionCard({required String title, required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: AppFonts.body(
                  fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }

  Widget _imageField(
      String label, File? file, String existing, void Function(File?) assign) {
    Widget thumb;
    if (file != null) {
      thumb = ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.file(file,
            width: 52, height: 52, fit: BoxFit.cover),
      );
    } else if (_assetUrl(existing).isNotEmpty) {
      thumb = ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: CachedNetworkImage(
          imageUrl: _assetUrl(existing),
          width: 52,
          height: 52,
          fit: BoxFit.cover,
          errorWidget: (_, __, ___) => _thumbPlaceholder(),
        ),
      );
    } else {
      thumb = _thumbPlaceholder();
    }

    return Row(
      children: [
        thumb,
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: AppFonts.body(
                      fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _pickImage((f) => assign(f)),
                    icon: const Icon(Icons.upload_rounded, size: 16),
                    label: Text(
                      file != null || _assetUrl(existing).isNotEmpty
                          ? 'Replace'
                          : 'Upload',
                      style: AppFonts.body(
                          fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textPrimary,
                      minimumSize: const Size(0, 36),
                      side: const BorderSide(color: AppColors.border),
                      shape: const StadiumBorder(),
                    ),
                  ),
                  if (file != null) ...[
                    const SizedBox(width: 6),
                    IconButton(
                      onPressed: () => setState(() => assign(null)),
                      icon: const Icon(Icons.close_rounded, size: 18),
                      visualDensity: VisualDensity.compact,
                      color: AppColors.textSecondary,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _thumbPlaceholder() {
    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child:
          const Icon(Icons.image_outlined, size: 22, color: AppColors.textMuted),
    );
  }

  Widget _emailBlock({
    required String title,
    required TextEditingController subjectCtrl,
    required quill.QuillController? bodyQuill,
    required String subjectHint,
    required List<_Token> tokens,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: AppFonts.body(
                  fontSize: 13.5, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          _fieldLabel('Subject'),
          _textField(subjectCtrl, hint: subjectHint),
          const SizedBox(height: 6),
          _tokenChips(tokens, (t) => _insertToken(subjectCtrl, t)),
          const SizedBox(height: 12),
          _fieldLabel('Body'),
          if (bodyQuill != null) _HtmlField(controller: bodyQuill),
          const SizedBox(height: 6),
          _tokenChips(
              tokens,
              (t) => bodyQuill == null
                  ? null
                  : _insertQuillToken(bodyQuill, t)),
        ],
      ),
    );
  }

  void _insertQuillToken(quill.QuillController c, String token) {
    final sel = c.selection;
    final index = sel.isValid && sel.baseOffset >= 0
        ? sel.baseOffset
        : (c.document.length - 1);
    final length = sel.isValid && sel.extentOffset > sel.baseOffset
        ? sel.extentOffset - sel.baseOffset
        : 0;
    c.replaceText(index, length, token,
        TextSelection.collapsed(offset: index + token.length));
  }

  Widget _testEmailBlock() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: AppColors.border,
            style: BorderStyle.solid),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Send a test email',
              style: AppFonts.body(
                  fontSize: 13.5, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text('Uses the text above with sample values.',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 10),
          _textField(_testEmailCtrl,
              hint: 'you@example.com',
              keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _outlineAction(
                  icon: Icons.notifications_none_rounded,
                  label: 'Test reminder',
                  busy: _testBusy == 'reminder',
                  disabled: _testBusy != null,
                  onTap: () => _sendTest('reminder'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _outlineAction(
                  icon: Icons.mark_email_read_outlined,
                  label: 'Test thank-you',
                  busy: _testBusy == 'receipt',
                  disabled: _testBusy != null,
                  onTap: () => _sendTest('receipt'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tokenChips(List<_Token> tokens, void Function(String) onInsert) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text('Insert:',
            style: AppFonts.body(
                fontSize: 13, color: AppColors.textSecondary)),
        ...tokens.map((t) => InkWell(
              onTap: () => onInsert(t.token),
              borderRadius: BorderRadius.circular(999),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                      color: AppColors.primary.withValues(alpha: 0.30)),
                ),
                child: Text(t.label,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.primary)),
              ),
            )),
      ],
    );
  }

  void _insertToken(TextEditingController c, String token) {
    final sel = c.selection;
    final text = c.text;
    if (sel.isValid && sel.start >= 0 && sel.end >= sel.start) {
      final newText = text.replaceRange(sel.start, sel.end, token);
      c.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: sel.start + token.length),
      );
    } else {
      final sep = text.isEmpty || text.endsWith(' ') ? '' : ' ';
      c.text = '$text$sep$token';
      c.selection =
          TextSelection.collapsed(offset: c.text.length);
    }
  }

  Widget _fieldLabel(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 5),
        child: Text(s,
            style: AppFonts.body(
                fontSize: 13, fontWeight: FontWeight.w600)),
      );

  Widget _textField(
    TextEditingController c, {
    String? hint,
    int minLines = 1,
    int maxLines = 1,
    TextInputType? keyboardType,
  }) {
    return TextField(
      controller: c,
      minLines: minLines,
      maxLines: maxLines,
      keyboardType: keyboardType,
      style: AppFonts.body(fontSize: 13.5),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: AppFonts.body(
            fontSize: 13, color: AppColors.textMuted),
        isDense: true,
        filled: true,
        fillColor: AppColors.background,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.border)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.border)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.primary)),
      ),
    );
  }

  // Token lists (mirror EmailTokenChips.tsx).
  static const _receiptTokens = <_Token>[
    _Token('{{officerName}}', 'Officer name'),
    _Token('{{clubName}}', 'Club name'),
    _Token('{{districtNumber}}', 'District'),
    _Token('{{rotaryYear}}', 'Year'),
    _Token('{{purpose}}', 'Purpose'),
    _Token('{{membersCovered}}', 'Members paid'),
    _Token('{{amountPaid}}', 'Amount paid'),
  ];
  static const _reminderTokens = <_Token>[
    _Token('{{officerName}}', 'Officer name'),
    _Token('{{clubName}}', 'Club name'),
    _Token('{{districtNumber}}', 'District'),
    _Token('{{rotaryYear}}', 'Year'),
    _Token('{{purpose}}', 'Purpose'),
    _Token('{{memberCount}}', 'Total members'),
    _Token('{{unpaidCount}}', 'Members pending'),
    _Token('{{perMemberRate}}', 'Rate / member'),
    _Token('{{amountDue}}', 'Amount due'),
  ];
}

// ── Record offline payment — bottom sheet ───────────────────────────────
class _OfflineRecordSheet extends StatefulWidget {
  final _ClubRow club;
  final String amountLabel;
  final List<_OfflineAccountOption> accounts;
  final String Function(num) money;
  final Future<bool> Function(
      String type, String txnId, String remark, int? accountId) onSubmit;

  const _OfflineRecordSheet({
    required this.club,
    required this.amountLabel,
    required this.accounts,
    required this.money,
    required this.onSubmit,
  });

  @override
  State<_OfflineRecordSheet> createState() => _OfflineRecordSheetState();
}

class _OfflineRecordSheetState extends State<_OfflineRecordSheet> {
  String _type = '1';
  int? _accountId; // which bank account this offline payment went into
  final _txnCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();
  bool _busy = false;

  _OfflineAccountOption? get _selectedAccount {
    for (final a in widget.accounts) {
      if (a.fkRouteAccountId == _accountId) return a;
    }
    return null;
  }

  static const _modes = {
    '1': 'Cash',
    '2': 'Cheque',
    '3': 'NEFT',
    '4': 'UPI',
    '5': 'Other',
  };

  @override
  void dispose() {
    _txnCtrl.dispose();
    _remarkCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final ok = await widget.onSubmit(
        _type, _txnCtrl.text.trim(), _remarkCtrl.text.trim(), _accountId);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    // When the campaign splits across bank accounts, the amount is the selected
    // account's share; otherwise it's the flat unpaid×rate figure. (web parity)
    final amountText = widget.accounts.isEmpty
        ? widget.amountLabel
        : (_selectedAccount != null
            ? widget.money(_selectedAccount!.amount)
            : 'select an account');
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, 16 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 14),
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          Text('Record offline payment',
              style: AppFonts.body(
                  fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(widget.club.clubName ?? 'Club ${widget.club.fkClubId}',
              style: AppFonts.body(
                  fontSize: 13, fontWeight: FontWeight.w600,
                  color: AppColors.primary)),
          const SizedBox(height: 12),
          // Account picker — "Which bank account did this go into?" — shown only
          // when the campaign exposes offline accounts (independent tracks).
          if (widget.accounts.isNotEmpty) ...[
            Text('Account',
                style: AppFonts.body(
                    fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<int?>(
                  value: _accountId,
                  isExpanded: true,
                  hint: Text('Which bank account did this go into?',
                      style: AppFonts.body(
                          fontSize: 13, color: AppColors.textSecondary)),
                  items: [
                    for (final a in widget.accounts)
                      DropdownMenuItem<int?>(
                        value: a.fkRouteAccountId,
                        child: Text(
                          (a.accountLabel?.trim().isNotEmpty ?? false)
                              ? a.accountLabel!.trim()
                              : 'Account ${a.fkRouteAccountId}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (v) => setState(() => _accountId = v),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          Text(
            'Covers ${widget.club.unpaidCount} member(s). '
            'Amount: $amountText. This marks the club as paid immediately.',
            style: AppFonts.body(
                fontSize: 13,
                height: 1.35,
                color: AppColors.textSecondary),
          ),
          const SizedBox(height: 16),
          Text('Mode',
              style: AppFonts.body(
                  fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.border),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _type,
                isExpanded: true,
                items: _modes.entries
                    .map((e) => DropdownMenuItem(
                        value: e.key, child: Text(e.value)))
                    .toList(),
                onChanged: (v) => setState(() => _type = v ?? '1'),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text('Transaction / reference',
              style: AppFonts.body(
                  fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          _sheetField(_txnCtrl),
          const SizedBox(height: 12),
          Text('Remark',
              style: AppFonts.body(
                  fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          _sheetField(_remarkCtrl),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : () => Navigator.of(context).pop(),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    side: const BorderSide(color: AppColors.border),
                    shape: const StadiumBorder(),
                  ),
                  child: Text('Cancel',
                      style: AppFonts.body(
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: _busy ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryPrime,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 48),
                    elevation: 0,
                    shape: const StadiumBorder(),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : Text('Record as paid',
                          style: AppFonts.body(
                              fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _sheetField(TextEditingController c) {
    return TextField(
      controller: c,
      style: AppFonts.body(fontSize: 13.5),
      decoration: InputDecoration(
        isDense: true,
        filled: true,
        fillColor: AppColors.background,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.border)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.border)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppColors.primary)),
      ),
    );
  }
}

// ── Review offline payment — full page ──────────────────────────────────
class _ReviewPage extends StatefulWidget {
  final String clubName;
  final _OfflineDetail detail;
  final String Function(num) inr;
  final Future<bool> Function(bool approved, String? reason) onDecision;

  const _ReviewPage({
    required this.clubName,
    required this.detail,
    required this.inr,
    required this.onDecision,
  });

  @override
  State<_ReviewPage> createState() => _ReviewPageState();
}

class _ReviewPageState extends State<_ReviewPage> {
  final _reasonCtrl = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit(bool approved) async {
    final reason = _reasonCtrl.text.trim();
    if (!approved && reason.isEmpty) {
      SnackbarUtils.showError(context, 'Enter a reason to reject.');
      return;
    }
    setState(() => _busy = true);
    final ok = await widget.onDecision(approved, approved ? null : reason);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.detail;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Review Offline Payment'),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                children: [
                  Text(widget.clubName,
                      style: AppFonts.body(
                          fontSize: 20, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text('Offline payment awaiting your approval',
                      style: AppFonts.body(
                          fontSize: 13, color: AppColors.textSecondary)),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      children: [
                        _row('Members covered', '${d.memberCountCovered}'),
                        _row('Mode', d.transactionType ?? '–'),
                        if ((d.transactionId ?? '').isNotEmpty)
                          _row('Reference', d.transactionId!),
                        if ((d.bankName ?? '').isNotEmpty)
                          _row('Bank', d.bankName!),
                        if ((d.chequeNumber ?? '').isNotEmpty)
                          _row('Cheque', d.chequeNumber!),
                        if ((d.givenTo ?? '').isNotEmpty)
                          _row('Given to', d.givenTo!),
                        if ((d.remark ?? '').isNotEmpty)
                          _row('Remark', d.remark!),
                        _row('Amount', widget.inr(d.amount), bold: true),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text('Rejection reason  (required only to reject)',
                      style: AppFonts.body(
                          fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _reasonCtrl,
                    minLines: 2,
                    maxLines: 4,
                    decoration: InputDecoration(
                      hintText: 'Why is this being rejected?',
                      isDense: true,
                      filled: true,
                      fillColor: AppColors.surface,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 12),
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(color: AppColors.border)),
                      enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(color: AppColors.border)),
                    ),
                  ),
                ],
              ),
            ),
            Container(
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: const Border(top: const BorderSide(color: AppColors.border)),
              ),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              child: Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _busy ? null : () => _submit(false),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.error,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 52),
                        elevation: 0,
                        textStyle: AppFonts.body(
                            fontSize: 15, fontWeight: FontWeight.w700),
                        shape: const StadiumBorder(),
                      ),
                      child: const Text('Reject'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _busy ? null : () => _submit(true),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primaryPrime,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 52),
                        elevation: 0,
                        textStyle: AppFonts.body(
                            fontSize: 15, fontWeight: FontWeight.w700),
                        shape: const StadiumBorder(),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : const Text('Approve'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String k, String v, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(k,
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.textSecondary)),
          ),
          Expanded(
            child: Text(v,
                textAlign: TextAlign.right,
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

// ── Rich-text (HTML) body field — Quill toolbar over a fixed-height editor ─
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

// ── Models ──────────────────────────────────────────────────────────────
int _asInt(dynamic v) =>
    v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);
double _asDouble(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0;
String? _asStr(dynamic v) => v?.toString();

class _Token {
  final String token;
  final String label;
  const _Token(this.token, this.label);
}

class _Campaign {
  final int id;
  final String? purpose;
  final String? rotaryYear;
  final bool isActive;
  const _Campaign(
      {required this.id, this.purpose, this.rotaryYear, required this.isActive});

  String get title {
    final p = (purpose ?? '').trim();
    final y = (rotaryYear ?? '').trim();
    if (p.isNotEmpty && y.isNotEmpty) return '$p · $y';
    if (p.isNotEmpty) return p;
    return y.isNotEmpty ? 'District Dues $y' : 'District Dues';
  }

  factory _Campaign.fromJson(Map<String, dynamic> j) => _Campaign(
        id: _asInt(j['id'] ?? j['Id']),
        purpose: _asStr(j['purpose'] ?? j['Purpose']),
        rotaryYear: _asStr(j['rotaryYear'] ?? j['RotaryYear']),
        isActive: (j['isActive'] ?? j['IsActive']) == true,
      );
}

class _ClubRow {
  final int clubDuesClubId;
  final int fkClubId;
  final String? clubName;
  final double perMemberRate; // legacy base rate (fallback)
  // Effective OFFLINE (base) rate per member. The backend sets this for legacy
  // campaigns too (= the old PerMemberRate), so the base maths below works for
  // both legacy and independent online/offline campaigns.
  final double offlinePerMemberRate;
  final int memberCount;
  final int paidCount;
  final int unpaidCount;
  final double amountPaid;
  // Independent Online / Offline tracks (backend split). Each track carries its
  // full amount, the amount paid on it, and a per-bank-account breakdown.
  final double offlineAmount;
  final double offlinePaid;
  final List<_AccountBreakdown> offlineAccountBreakdown;
  final double onlineAmount;
  final double onlinePaid;
  final List<_AccountBreakdown> onlineAccountBreakdown;
  final double totalPaid; // onlinePaid + offlinePaid
  final bool? paidOnline; // latest paid payment mode: true=Online, false=Offline, null=none
  final String? status;
  final bool hasPendingApproval;
  final int? pendingPaymentId;

  const _ClubRow({
    required this.clubDuesClubId,
    required this.fkClubId,
    this.clubName,
    required this.perMemberRate,
    required this.offlinePerMemberRate,
    required this.memberCount,
    required this.paidCount,
    required this.unpaidCount,
    required this.amountPaid,
    required this.offlineAmount,
    required this.offlinePaid,
    required this.offlineAccountBreakdown,
    required this.onlineAmount,
    required this.onlinePaid,
    required this.onlineAccountBreakdown,
    required this.totalPaid,
    required this.paidOnline,
    this.status,
    required this.hasPendingApproval,
    this.pendingPaymentId,
  });

  // The backend dropped the flat `AmountOwed` field when club dues split into
  // independent online/offline tracks. It equalled unpaid × the effective
  // OFFLINE (base) rate, so recompute it here for the offline-record prefill —
  // reproduces the old figure for legacy campaigns and is the offline-track
  // outstanding for independent ones. (Dues stay in INR.)
  double get amountOwed => unpaidCount * offlinePerMemberRate;

  static List<_AccountBreakdown> _accts(dynamic v) => v is List
      ? v
          .whereType<Map>()
          .map((e) => _AccountBreakdown.fromJson(e.cast<String, dynamic>()))
          .toList()
      : const <_AccountBreakdown>[];

  factory _ClubRow.fromJson(Map<String, dynamic> j) {
    final base = _asDouble(j['perMemberRate'] ?? j['PerMemberRate']);
    final offline =
        _asDouble(j['offlinePerMemberRate'] ?? j['OfflinePerMemberRate']);
    final po = j['paidOnline'] ?? j['PaidOnline'];
    return _ClubRow(
      clubDuesClubId: _asInt(j['clubDuesClubId'] ?? j['ClubDuesClubId']),
      fkClubId: _asInt(j['fkClubId'] ?? j['FkClubId']),
      clubName: _asStr(j['clubName'] ?? j['ClubName']),
      perMemberRate: base,
      // Fall back to the legacy base rate if an older response omits/zeros the
      // offline rate (pre-split responses).
      offlinePerMemberRate: offline > 0 ? offline : base,
      memberCount: _asInt(j['memberCount'] ?? j['MemberCount']),
      paidCount: _asInt(j['paidCount'] ?? j['PaidCount']),
      unpaidCount: _asInt(j['unpaidCount'] ?? j['UnpaidCount']),
      amountPaid: _asDouble(j['amountPaid'] ?? j['AmountPaid']),
      offlineAmount: _asDouble(j['offlineAmount'] ?? j['OfflineAmount']),
      offlinePaid: _asDouble(j['offlinePaid'] ?? j['OfflinePaid']),
      offlineAccountBreakdown:
          _accts(j['offlineAccountBreakdown'] ?? j['OfflineAccountBreakdown']),
      onlineAmount: _asDouble(j['onlineAmount'] ?? j['OnlineAmount']),
      onlinePaid: _asDouble(j['onlinePaid'] ?? j['OnlinePaid']),
      onlineAccountBreakdown:
          _accts(j['onlineAccountBreakdown'] ?? j['OnlineAccountBreakdown']),
      totalPaid: _asDouble(j['totalPaid'] ?? j['TotalPaid']),
      paidOnline: po is bool ? po : null,
      status: _asStr(j['status'] ?? j['Status']),
      hasPendingApproval:
          (j['hasPendingApproval'] ?? j['HasPendingApproval']) == true,
      pendingPaymentId:
          (j['pendingPaymentId'] ?? j['PendingPaymentId']) == null
              ? null
              : _asInt(j['pendingPaymentId'] ?? j['PendingPaymentId']),
    );
  }
}

/// One bank-account slice of a club's Offline or Online dues track — its target
/// amount and whether that account's cut has been collected. Mirrors the web
/// `AccountBreakdown` (ClubDuesAccountBreakdownDto).
class _AccountBreakdown {
  final String? accountLabel;
  final double amount;
  final bool isPaid;
  const _AccountBreakdown(
      {this.accountLabel, required this.amount, required this.isPaid});
  factory _AccountBreakdown.fromJson(Map<String, dynamic> j) =>
      _AccountBreakdown(
        accountLabel: _asStr(j['accountLabel'] ?? j['AccountLabel']),
        amount: _asDouble(j['amount'] ?? j['Amount']),
        isPaid: (j['isPaid'] ?? j['IsPaid']) == true,
      );
}

/// A selectable offline bank account for recording an offline payment — the
/// effective per-club account (override else campaign default) and this account's
/// share of the club's currently-owed total. Mirrors the web
/// `ClubDuesOfflineAccountOption` (ClubDuesOfflineAccountOptionDto). Fetched from
/// GET /api/club-dues/{id}/clubs/{clubId}/offline-accounts.
class _OfflineAccountOption {
  final int fkRouteAccountId;
  final String? accountLabel;
  final double amount;
  const _OfflineAccountOption({
    required this.fkRouteAccountId,
    this.accountLabel,
    required this.amount,
  });
  factory _OfflineAccountOption.fromJson(Map<String, dynamic> j) =>
      _OfflineAccountOption(
        fkRouteAccountId: _asInt(j['fkRouteAccountId'] ?? j['FkRouteAccountId']),
        accountLabel: _asStr(j['accountLabel'] ?? j['AccountLabel']),
        amount: _asDouble(j['amount'] ?? j['Amount']),
      );
}

class _OfflineDetail {
  final int paymentId;
  final double amount;
  final int memberCountCovered;
  final String? transactionType;
  final String? transactionId;
  final String? givenTo;
  final String? bankName;
  final String? chequeNumber;
  final String? remark;

  const _OfflineDetail({
    required this.paymentId,
    required this.amount,
    required this.memberCountCovered,
    this.transactionType,
    this.transactionId,
    this.givenTo,
    this.bankName,
    this.chequeNumber,
    this.remark,
  });

  factory _OfflineDetail.fromJson(Map<String, dynamic> j) => _OfflineDetail(
        paymentId: _asInt(j['paymentId'] ?? j['PaymentId']),
        amount: _asDouble(j['amount'] ?? j['Amount']),
        memberCountCovered:
            _asInt(j['memberCountCovered'] ?? j['MemberCountCovered']),
        transactionType: _asStr(j['transactionType'] ?? j['TransactionType']),
        transactionId: _asStr(j['transactionId'] ?? j['TransactionId']),
        givenTo: _asStr(j['givenTo'] ?? j['GivenTo']),
        bankName: _asStr(j['bankName'] ?? j['BankName']),
        chequeNumber: _asStr(j['chequeNumber'] ?? j['ChequeNumber']),
        remark: _asStr(j['remark'] ?? j['Remark']),
      );
}
