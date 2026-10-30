import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/my_dues_model.dart';
import 'dues_receipt_screen.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class MyMembershipDuesScreen extends StatefulWidget {
  /// When embedded (e.g. inside the unified module-detail host that supplies
  /// its own Scaffold + AppBar), render the body only.
  final bool embedded;

  /// When set, scope the view to a single club: `/api/mobile/my-membership-dues`
  /// is keyed by MEMBER (returns every club where the member has active dues),
  /// so without this an entry point on club B's dashboard would leak club A's
  /// dues. With it set we filter to this club and, when empty, show a
  /// "not set up for {club}" state instead of other clubs' cards.
  final int? clubId;

  /// Club name for the scoped empty-state message (falls back to "this club").
  final String? clubName;

  const MyMembershipDuesScreen({
    super.key,
    this.embedded = false,
    this.clubId,
    this.clubName,
  });

  @override
  State<MyMembershipDuesScreen> createState() => _MyMembershipDuesScreenState();
}

class _MyMembershipDuesScreenState extends State<MyMembershipDuesScreen> {
  final _api = ApiClient();

  List<MyDues> _dues = [];
  bool _loading = true;
  String? _error;

  /// null = "All Years".
  String? _selectedYear;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/mobile/my-membership-dues',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess) {
        var items = (resp.data ?? const [])
            .map((e) => MyDues.fromJson(e as Map<String, dynamic>))
            .toList();
        // Scope to a single club when an entry point asked for it, so another
        // club's dashboard can't surface this club's dues (and vice-versa).
        if (widget.clubId != null) {
          items = items.where((d) => d.clubId == widget.clubId).toList();
        }
        setState(() {
          _dues = items;
          _loading = false;
          // Drop a stale year selection if that year is gone after a refresh.
          if (_selectedYear != null &&
              !items.any((d) => d.rotaryYear == _selectedYear)) {
            _selectedYear = null;
          }
        });
      } else {
        setState(() {
          _error = resp.error ?? 'Failed to load dues';
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // Distinct rotary years present in the data, newest first.
  List<String> get _years {
    final set = <String>{};
    for (final d in _dues) {
      if (d.rotaryYear.trim().isNotEmpty) set.add(d.rotaryYear);
    }
    final list = set.toList()..sort((a, b) => b.compareTo(a));
    return list;
  }

  List<MyDues> get _visibleDues {
    if (_selectedYear == null) return _dues;
    return _dues.where((d) => d.rotaryYear == _selectedYear).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.embedded) return _buildBody();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My Dues'),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    if (_dues.isEmpty) {
      // Scoped to a club that simply hasn't set up dues → say so explicitly,
      // rather than the generic "no dues assigned to you anywhere". (The
      // "contact for subscription" popup is surfaced on the dashboard tile tap
      // before opening this screen, so members never land here with no dues.)
      if (widget.clubId != null) {
        final club = (widget.clubName ?? '').trim();
        return EmptyStateWidget(
          icon: Icons.receipt_long_rounded,
          title: 'No Club Dues',
          subtitle: club.isEmpty
              ? 'Club dues haven\'t been set up for this club yet.'
              : 'Club dues haven\'t been set up for $club yet.',
        );
      }
      return const EmptyStateWidget(
        icon: Icons.receipt_long_rounded,
        title: 'No Dues Assigned',
        subtitle: "You don't have any club dues to pay right now.",
      );
    }

    final years = _years;
    final visible = _visibleDues;

    return Column(
      children: [
        _filterBar(years, visible.length),
        Expanded(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 28),
              children: [
                _summaryCard(visible),
                const SizedBox(height: 16),
                if (visible.isEmpty)
                  _emptyForYear()
                else
                  ..._duesWidgets(visible),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ---- Year filter bar -----------------------------------------------------
  Widget _filterBar(List<String> years, int count) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 2),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.18)),
      ),
      child: Row(
        children: [
          const Icon(Icons.event_rounded, size: 18, color: AppColors.primary),
          const SizedBox(width: 8),
          Text(
            'Rotary Year',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const Spacer(),
          DropdownButtonHideUnderline(
            child: DropdownButton<String?>(
              value: _selectedYear,
              isDense: true,
              borderRadius: BorderRadius.circular(12),
              icon: const Icon(Icons.keyboard_arrow_down_rounded,
                  color: AppColors.primary),
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
              items: [
                DropdownMenuItem<String?>(
                  value: null,
                  child: Text('All Years',
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary)),
                ),
                ...years.map((y) => DropdownMenuItem<String?>(
                      value: y,
                      child: Text(y,
                          style: AppFonts.body(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primary)),
                    )),
              ],
              onChanged: (v) => setState(() => _selectedYear = v),
            ),
          ),
        ],
      ),
    );
  }

  // ---- Summary hero --------------------------------------------------------
  Widget _summaryCard(List<MyDues> visible) {
    double due = 0, paid = 0;
    for (final d in visible) {
      due += d.effectiveTotal;
      paid += d.effectivePaid;
    }
    final outstanding = due - paid;
    final pending = outstanding < 0 ? 0.0 : outstanding;
    final allClear = pending <= 0 && due > 0;

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
      decoration: BoxDecoration(
        color: AppColors.primaryDeep,
        borderRadius: BorderRadius.circular(18),

      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.account_balance_wallet_rounded,
                  color: Colors.white, size: 18),
              const SizedBox(width: 8),
              Text(
                _selectedYear ?? 'All Years',
                style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              const Spacer(),
              if (allClear)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.verified_rounded,
                          size: 13, color: Colors.white),
                      const SizedBox(width: 4),
                      Text(
                        'All cleared',
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _stat('Total', due, Colors.white),
              _heroDivider(),
              _stat('Paid', paid, Colors.white),
              _heroDivider(),
              _stat('Outstanding', pending,
                  pending > 0 ? AppColors.goldLight : Colors.white),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, double value, Color color) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Colors.white.withValues(alpha: 0.75),
            ),
          ),
          const SizedBox(height: 5),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              _formatCurrency(value),
              style: AppFonts.body(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _heroDivider() => Container(
        width: 1,
        height: 34,
        margin: const EdgeInsets.symmetric(horizontal: 12),
        color: Colors.white.withValues(alpha: 0.18),
      );

  // ---- Dues list -----------------------------------------------------------
  List<Widget> _duesWidgets(List<MyDues> visible) {
    // A specific year is selected → flat list.
    if (_selectedYear != null) {
      final out = <Widget>[];
      for (var i = 0; i < visible.length; i++) {
        if (i > 0) out.add(const SizedBox(height: 12));
        out.add(_DuesCard(dues: visible[i], onPaid: _load));
      }
      return out;
    }
    // All years → group with year headers.
    final grouped = _groupByYear(visible);
    final yrs = grouped.keys.toList()..sort((a, b) => b.compareTo(a));
    final out = <Widget>[];
    for (var yi = 0; yi < yrs.length; yi++) {
      final y = yrs[yi];
      final items = grouped[y]!;
      if (yi > 0) out.add(const SizedBox(height: 20));
      out.add(_yearHeader(y, items.length));
      out.add(const SizedBox(height: 12));
      for (var i = 0; i < items.length; i++) {
        if (i > 0) out.add(const SizedBox(height: 12));
        out.add(_DuesCard(dues: items[i], onPaid: _load));
      }
    }
    return out;
  }

  Widget _emptyForYear() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
      alignment: Alignment.center,
      child: Column(
        children: [
          const Icon(Icons.event_busy_rounded,
              size: 40, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text(
            'No dues for $_selectedYear',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _yearHeader(String year, int count) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            year,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.primary,
              letterSpacing: 0.3,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          count == 1 ? '1 dues' : '$count dues',
          style: AppFonts.body(
            fontSize: 13,
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 10),
        const Expanded(child: const Divider(height: 1, color: AppColors.divider)),
      ],
    );
  }

  Map<String, List<MyDues>> _groupByYear(List<MyDues> list) {
    final map = <String, List<MyDues>>{};
    for (final d in list) {
      map.putIfAbsent(d.rotaryYear, () => []).add(d);
    }
    return map;
  }
}

class _DuesCard extends StatelessWidget {
  final MyDues dues;
  final Future<void> Function() onPaid;
  const _DuesCard({required this.dues, required this.onPaid});

  @override
  Widget build(BuildContext context) {
    final outstanding = dues.effectiveOutstanding;

    // Which fee rows to show, and the Semi-2 "opens 1 Jan" note. Annual and the
    // two Semis are mutually exclusive plans: once one path is paid the others
    // are hidden, and unpaid Semi 2 only becomes payable from 1 Jan of the
    // year the rotary year rolls into.
    final annual = dues.feeOf(1);
    final semi1 = dues.feeOf(2);
    final semi2 = dues.feeOf(3);
    final semi2Open = _semi2Open(dues.rotaryYear);

    final rows = <MyDuesFee>[];
    String? semi2Note;
    if (!dues.anyPlanPaid) {
      // Member hasn't committed to a path yet → show everything, as before.
      rows.addAll(dues.fees.toList()..sort((a, b) => a.feeType - b.feeType));
    } else if (dues.annualPaid) {
      if (annual != null) rows.add(annual); // whole year paid → hide both Semis
    } else {
      // A Semi has been paid → hide Annual.
      if (semi1 != null) rows.add(semi1);
      if (semi2 != null) {
        if (semi2.isPaid || semi2Open) {
          rows.add(semi2);
        } else {
          semi2Note =
              '${semi2.label} will be available from 1 Jan ${_secondYear(dues.rotaryYear)}.';
        }
      }
    }

    // Is anything payable RIGHT NOW (drives the Pay Now footer)? A gated,
    // not-yet-open Semi 2 is owed but not payable yet, so it doesn't count.
    final hasPayableNow = rows.any(
        (f) => !f.isPaid && (f.feeType != 3 || semi2Open));
    final showPay = hasPayableNow && (dues.payUrl ?? '').isNotEmpty;
    final hasDue = !dues.planFullyPaid && dues.effectiveOutstanding > 0;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.lightBorder),

      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _logo(dues.purposeLogo),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (dues.purpose ?? '').isNotEmpty
                            ? dues.purpose!
                            : 'Club Dues',
                        style: AppFonts.body(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        dues.clubName,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 7),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          // COG is a special club — hide its district chip
                          // (matches Welcome / My Connections / calendars).
                          if (dues.clubName.trim().toLowerCase() != 'cog')
                            _chip(dues.districtNumber, AppColors.primary),
                          _chip(dues.categoryType, AppColors.accentPurple),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                _headerStatus(hasDue, outstanding),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ...rows.map((f) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: _feeRow(context, f),
                    )),
                if (semi2Note != null) _semi2NoteRow(semi2Note),
              ],
            ),
          ),
          // Footer: Pay Now only. The "Total / Due" summary line was removed per
          // request — the per-fee amounts above + the header Paid/Due chip still
          // convey the status, so the footer only renders when there's a payable
          // outstanding amount (a gated, not-yet-open Semi 2 is excluded).
          if (showPay)
            Container(
              decoration: BoxDecoration(
                color: AppColors.muted.withValues(alpha: 0.45),
                borderRadius: const BorderRadius.only(
                  bottomLeft: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                ),
              ),
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  icon: const Icon(Icons.payments_rounded, size: 18),
                  label: Text(
                    'Pay Now',
                    style: AppFonts.body(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: const StadiumBorder(),
                  ),
                  onPressed: () => _pay(context),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _headerStatus(bool hasDue, double outstanding) {
    if (!hasDue) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: AppColors.successLight,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle_rounded,
                size: 13, color: AppColors.success),
            const SizedBox(width: 4),
            Text(
              'Paid',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.success,
              ),
            ),
          ],
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.errorLight,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        'Due',
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: AppColors.error,
        ),
      ),
    );
  }

  Widget _feeRow(BuildContext context, MyDuesFee f) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                f.label,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Text(
              _formatCurrency(f.amount),
              style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(width: 8),
            _statusChip(f),
          ],
        ),
        if (f.isPaid) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              if (f.paymentDate != null) ...[
                const Icon(Icons.check_circle_rounded,
                    size: 12, color: AppColors.success),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    _paidLine(f),
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ] else
                const Spacer(),
              const SizedBox(width: 8),
              _receiptButton(context, f),
            ],
          ),
        ],
      ],
    );
  }

  Widget _receiptButton(BuildContext context, MyDuesFee f) {
    return OutlinedButton.icon(
      onPressed: () => _openReceipt(context, f),
      icon: const Icon(Icons.receipt_long_rounded, size: 15),
      label: Text(
        'Receipt',
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
      ),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        side: BorderSide(color: AppColors.primary.withValues(alpha: 0.4)),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
        minimumSize: const Size(0, 30),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: const StadiumBorder(),
      ),
    );
  }

  // Note shown in place of the Semi-2 row while it is paid-plan-relevant but not
  // yet payable (member paid Semi 1, Semi 2 opens 1 Jan).
  Widget _semi2NoteRow(String note) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.schedule_rounded,
              size: 14, color: AppColors.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              note,
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // Opens the member's own receipt for this paid fee. The receipt endpoints
  // (`/my-membership-dues/payments/{paymentId}/receipt[/data]`) are keyed by the
  // payment row id, which the app only has once the dues fee JSON carries
  // `paymentId` (see MyDuesFee.hasReceipt). Until then, tell the member it isn't
  // ready yet rather than opening a screen that would 404.
  Future<void> _openReceipt(BuildContext context, MyDuesFee f) async {
    if (!f.hasReceipt) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Receipt isn\'t available yet.')),
      );
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => DuesReceiptScreen(
          paymentId: f.paymentId!,
          feeLabel: f.label,
        ),
      ),
    );
  }

  // Second calendar year of a "2026-27" rotary year → 2027. Falls back to the
  // current year if the label can't be parsed.
  int _secondYear(String rotaryYear) {
    final m = RegExp(r'^(\d{4})').firstMatch(rotaryYear.trim());
    if (m != null) return int.parse(m.group(1)!) + 1;
    return DateTime.now().year;
  }

  // Semi 2 becomes payable from 1 Jan of the rotary year's second calendar year
  // (2026-27 → 1 Jan 2027). If the label can't be parsed, don't gate it.
  bool _semi2Open(String rotaryYear) {
    final m = RegExp(r'^(\d{4})').firstMatch(rotaryYear.trim());
    if (m == null) return true;
    final opensOn = DateTime(int.parse(m.group(1)!) + 1, 1, 1);
    return !DateTime.now().isBefore(opensOn);
  }

  String _paidLine(MyDuesFee f) {
    final date =
        f.paymentDate != null ? DateFormat('d MMM yyyy').format(f.paymentDate!) : '';
    final txn = (f.transactionId ?? '').isNotEmpty ? ' · ${f.transactionId}' : '';
    return 'Paid on $date$txn';
  }

  Widget _statusChip(MyDuesFee f) {
    final (bg, fg) = _statusColors(f.paymentStatus, f.isPaid);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        f.paymentStatus,
        style: AppFonts.body(
          fontSize: 13,
          color: fg,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  (Color, Color) _statusColors(String status, bool isPaid) {
    final s = status.toLowerCase();
    if (isPaid || s == 'completed' || s == 'success') {
      return (AppColors.successLight, AppColors.success);
    }
    if (s == 'pending' || s == 'processing') {
      return (AppColors.warningLight, AppColors.warning);
    }
    if (s == 'failed' || s == 'failure') {
      return (AppColors.errorLight, AppColors.error);
    }
    // Unpaid / Offline / other
    return (AppColors.errorLight, AppColors.error);
  }

  Widget _logo(String? path) {
    final url = _photoUrl(path);
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 52,
        height: 52,
        color: AppColors.primaryLight,
        child: url == null
            ? const Icon(Icons.receipt_long_rounded, color: AppColors.primary)
            : CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(color: AppColors.primaryLight),
                errorWidget: (_, __, ___) =>
                    const Icon(Icons.receipt_long_rounded, color: AppColors.primary),
              ),
      ),
    );
  }

  Widget _chip(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          fontSize: 13,
          color: color,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Future<void> _pay(BuildContext context) async {
    final raw = dues.payUrl;
    if (raw == null || raw.isEmpty) return;
    var url = raw.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      // Refresh after user returns
      await onPaid();
    }
  }
}

String _formatCurrency(double amount) {
  return formatMoney(amount.round(), null);
}

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}
