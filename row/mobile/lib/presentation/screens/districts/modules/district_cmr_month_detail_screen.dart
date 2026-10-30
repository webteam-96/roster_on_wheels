import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/services/monthly_report_pdf.dart';
import '../../../../core/services/monthly_report_word.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../../core/utils/snackbar_utils.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

// ── Models ────────────────────────────────────────────────────────────────────

class _ClubItem {
  final int clubId;
  final String clubName;
  final String? clubRotaryId;
  final String? submittedDate;
  final String? presidentName;
  final String? presidentEmail;
  final String? presidentMobile;
  final String? secretaryName;
  final String? secretaryEmail;
  final String? secretaryMobile;
  final String? emailStatus;
  final String? lastReminderDate;
  final bool isUploadedToDistrict;

  const _ClubItem({
    required this.clubId,
    required this.clubName,
    this.clubRotaryId,
    this.submittedDate,
    this.presidentName,
    this.presidentEmail,
    this.presidentMobile,
    this.secretaryName,
    this.secretaryEmail,
    this.secretaryMobile,
    this.emailStatus,
    this.lastReminderDate,
    this.isUploadedToDistrict = false,
  });

  factory _ClubItem.fromJson(Map<String, dynamic> j) => _ClubItem(
        clubId: j['clubId'] as int? ?? 0,
        clubName: j['clubName']?.toString() ?? '',
        clubRotaryId: j['clubRotaryId']?.toString(),
        submittedDate: j['submittedDate']?.toString(),
        presidentName: j['presidentName']?.toString(),
        presidentEmail: j['presidentEmail']?.toString(),
        presidentMobile: j['presidentMobile']?.toString(),
        secretaryName: j['secretaryName']?.toString(),
        secretaryEmail: j['secretaryEmail']?.toString(),
        secretaryMobile: j['secretaryMobile']?.toString(),
        // Backend sends lastEmailStatus + lastReminderDate on the
        // not-submitted rows (the reminder log). Read those exact keys.
        emailStatus: j['lastEmailStatus']?.toString(),
        lastReminderDate: j['lastReminderDate']?.toString(),
        isUploadedToDistrict:
            (j['isUploadedToDistrict'] == true) || (j['isUploadedToDistrict'] == 1),
      );
}

class _MonthDetail {
  final List<_ClubItem> submitted;
  final List<_ClubItem> notSubmitted;
  const _MonthDetail({required this.submitted, required this.notSubmitted});

  factory _MonthDetail.fromJson(Map<String, dynamic> j) {
    final sub = (j['submitted'] as List<dynamic>? ?? [])
        .map((e) => _ClubItem.fromJson(e as Map<String, dynamic>))
        .toList();
    final not = (j['notSubmitted'] as List<dynamic>? ?? [])
        .map((e) => _ClubItem.fromJson(e as Map<String, dynamic>))
        .toList();
    return _MonthDetail(submitted: sub, notSubmitted: not);
  }
}

class _CreditBalance {
  final int emailRemaining;
  const _CreditBalance({required this.emailRemaining});

  factory _CreditBalance.fromJson(Map<String, dynamic> j) => _CreditBalance(
        emailRemaining: j['emailRemaining'] as int? ?? 0,
      );
}

// ── Screen ────────────────────────────────────────────────────────────────────

class DistrictCmrMonthDetailScreen extends StatefulWidget {
  final int districtId;
  final int yearId;
  final int month;
  final String monthName;
  final bool viewOnly;
  const DistrictCmrMonthDetailScreen({
    super.key,
    required this.districtId,
    required this.yearId,
    required this.month,
    required this.monthName,
    this.viewOnly = false,
  });

  @override
  State<DistrictCmrMonthDetailScreen> createState() =>
      _DistrictCmrMonthDetailScreenState();
}

class _DistrictCmrMonthDetailScreenState
    extends State<DistrictCmrMonthDetailScreen> {
  final ApiClient _api = ApiClient();

  bool _loading = true;
  String? _error;
  _MonthDetail? _detail;
  _CreditBalance? _balance;

  // Which segmented view is showing: 'submitted' | 'notSubmitted'.
  String _tab = 'submitted';

  // Which report download is in-flight, keyed '<clubId>_<pdf|word>'.
  String? _downloadingKey;

  static const Color _orange = AppColors.warningDark;
  static const Color _emailBlue = AppColors.primaryDeep;

  @override
  void initState() {
    super.initState();
    _fetchAll();
  }

  Future<void> _fetchAll() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Main payload. If this fails the screen genuinely can't render.
      final detailResp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/club-monthly-report/month-detail/${widget.yearId}/${widget.month}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      // Credit balance is only consumed by the admin-only Send-Reminder
      // dialog. Members get 403/access-denied on /credit-management/...,
      // which previously rejected Future.wait and blanked the whole
      // screen. Make this call best-effort so the read-only view of the
      // month detail still renders for members.
      _CreditBalance? balance;
      try {
        final balanceResp = await _api.get<Map<String, dynamic>>(
          '/api/credit-management/district/${widget.districtId}/balance',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        final balanceData = balanceResp.data;
        if (balanceData != null) {
          balance = _CreditBalance.fromJson(balanceData);
        }
      } catch (_) {
        balance = null;
      }
      final detailData = detailResp.data;
      setState(() {
        _detail = detailData != null ? _MonthDetail.fromJson(detailData) : null;
        _balance = balance;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  /// Date + time, e.g. "06 Jul 2026, 12:52 pm" — mirrors the web detail view.
  String _formatDateTime(String? iso) {
    if (iso == null || iso.isEmpty) return '-';
    final dt = DateTime.tryParse(iso);
    if (dt == null || dt.year <= 1) return '-';
    return DateFormat('dd MMM yyyy, hh:mm a').format(dt).replaceAll('AM', 'am').replaceAll('PM', 'pm');
  }

  /// Generate + open a submitted club's monthly report as PDF or Word. Both are
  /// built on-device from /api/clubs/{clubId}/monthly-reports/preview/{yr}/{mo}
  /// (the same services the club-side Monthly Report module uses). `widget.month`
  /// is already the calendar ReportMonth the preview endpoint expects.
  Future<void> _downloadReport(int clubId, String format) async {
    final key = '${clubId}_$format';
    if (_downloadingKey != null) return;
    setState(() => _downloadingKey = key);
    try {
      if (format == 'pdf') {
        final svc = MonthlyReportPdfService();
        final path = await svc.generateAndSavePdf(
          clubId: clubId,
          yearId: widget.yearId,
          month: widget.month,
        );
        if (mounted) SnackbarUtils.showSuccess(context, 'PDF saved: opening…');
        await svc.openFile(path);
      } else {
        final svc = MonthlyReportWordService();
        final path = await svc.generateAndSaveDocx(
          clubId: clubId,
          yearId: widget.yearId,
          month: widget.month,
        );
        if (mounted) {
          SnackbarUtils.showSuccess(context, 'Word file saved: opening…');
        }
        await svc.openFile(path);
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException && e.message.isNotEmpty
            ? 'Failed to generate report: ${e.message}'
            : 'Failed to generate report';
        SnackbarUtils.showError(context, msg);
      }
    } finally {
      if (mounted) setState(() => _downloadingKey = null);
    }
  }

  int _countEmails(List<_ClubItem> clubs) {
    var count = 0;
    for (final c in clubs) {
      if ((c.presidentEmail ?? '').trim().isNotEmpty) count++;
      if ((c.secretaryEmail ?? '').trim().isNotEmpty) count++;
    }
    return count;
  }

  Future<void> _showSendReminderDialog() async {
    final detail = _detail;
    if (detail == null || detail.notSubmitted.isEmpty) return;

    final emailCount = _countEmails(detail.notSubmitted);
    final emailBalance = _balance?.emailRemaining ?? 0;

    bool sendEmail = emailBalance > 0;
    bool sending = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogCtx) {
        return StatefulBuilder(
          builder: (ctx, setLocal) {
            final insufficient = emailBalance < emailCount;
            final canSend = sendEmail && !sending;
            return AlertDialog(
              title: Text('Send Reminder', style: AppTextStyles.h4),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'You are about to send reminders to ${detail.notSubmitted.length} clubs.',
                      style: AppTextStyles.body,
                    ),
                    const SizedBox(height: 12),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: sendEmail,
                      onChanged: emailBalance <= 0
                          ? null
                          : (v) => setLocal(() => sendEmail = v ?? false),
                      title: Text(
                        'Email ($emailCount): $emailBalance credits remaining',
                        style: AppTextStyles.body,
                      ),
                    ),
                    if (insufficient) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Insufficient credits for some messages',
                        style: AppTextStyles.caption.copyWith(
                          color: _orange,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: sending ? null : () => Navigator.of(dialogCtx).pop(),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _orange,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: !canSend
                      ? null
                      : () async {
                          setLocal(() => sending = true);
                          try {
                            final res = await _api.post<Map<String, dynamic>>(
                              '/api/districts/${widget.districtId}/club-monthly-report/send-reminder/${widget.yearId}/${widget.month}',
                              body: {
                                'sendEmail': sendEmail,
                              },
                              fromJson: (j) => j as Map<String, dynamic>,
                            );
                            final msg = res.data?['message']?.toString() ??
                                'Reminders sent.';
                            if (dialogCtx.mounted) {
                              Navigator.of(dialogCtx).pop();
                            }
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(msg)),
                              );
                              await _fetchAll();
                            }
                          } catch (e) {
                            setLocal(() => sending = false);
                            if (dialogCtx.mounted) {
                              ScaffoldMessenger.of(dialogCtx).showSnackBar(
                                SnackBar(
                                  content: Text('Failed: $e'),
                                  backgroundColor: AppColors.error,
                                ),
                              );
                            }
                          }
                        },
                  child: sending
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor:
                                AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : const Text('Send'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Per-level gating: only district admins of THIS district can manage.
    final isAdmin =
        !widget.viewOnly && auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: widget.monthName,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh, color: AppColors.primaryPrime),
            onPressed: _loading ? null : _fetchAll,
          ),
        ],
      ),
      body: _buildBody(isAdmin),
    );
  }

  Widget _buildBody(bool isAdmin) {
    if (_loading) {
      return const RowSkeletonList();
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline,
                  size: 48, color: AppColors.error),
              const SizedBox(height: 12),
              Text(_error!,
                  style: AppTextStyles.body, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _fetchAll,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }
    final detail = _detail;
    if (detail == null) {
      return Center(child: Text('No data', style: AppTextStyles.body));
    }

    final isSubmittedTab = _tab == 'submitted';
    final list = isSubmittedTab ? detail.submitted : detail.notSubmitted;
    final showReminder =
        isAdmin && !isSubmittedTab && detail.notSubmitted.isNotEmpty;

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _fetchAll,
      child: ListView(
        padding: const EdgeInsets.all(16),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          // Segmented Submitted / Not Submitted toggle (only one list shows).
          _segmentedToggle(detail),
          const SizedBox(height: 14),
          if (showReminder) ...[
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _orange,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: const StadiumBorder(),
                ),
                icon: const Icon(Icons.send_rounded, size: 18),
                label: Text(
                  'Send Reminder (${detail.notSubmitted.length} Clubs)',
                  style: AppTextStyles.button.copyWith(color: Colors.white),
                ),
                onPressed: _showSendReminderDialog,
              ),
            ),
            const SizedBox(height: 14),
          ],
          const SizedBox(height: 10),
          if (list.isEmpty)
            _emptyNote(isSubmittedTab
                ? 'No clubs have submitted yet.'
                : 'All clubs have submitted. 🎉')
          else
            ...List.generate(
              list.length,
              (i) => isSubmittedTab
                  ? _buildSubmittedCard(i + 1, list[i])
                  : _buildNotSubmittedCard(i + 1, list[i]),
            ),
        ],
      ),
    );
  }

  // ── Segmented toggle ──────────────────────────────────────────────────────

  Widget _segmentedToggle(_MonthDetail d) {
    return Row(
      children: [
        Expanded(
          child: _togglePill(
            label: 'Submitted',
            count: d.submitted.length,
            active: _tab == 'submitted',
            color: AppColors.success,
            onTap: () => setState(() => _tab = 'submitted'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _togglePill(
            label: 'Not Submitted',
            count: d.notSubmitted.length,
            active: _tab == 'notSubmitted',
            color: AppColors.error,
            onTap: () => setState(() => _tab = 'notSubmitted'),
          ),
        ),
      ],
    );
  }

  Widget _togglePill({
    required String label,
    required int count,
    required bool active,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: active ? color : AppColors.surface,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: active ? color : AppColors.border),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                active
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                size: 16,
                color: active ? Colors.white : AppColors.textMuted,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  '$label ($count)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.captionMedium.copyWith(
                    color: active ? Colors.white : AppColors.textSecondary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _emptyNote(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        text,
        style: AppTextStyles.body.copyWith(color: AppColors.textSecondary),
        textAlign: TextAlign.center,
      ),
    );
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  Widget _indexBadge(int index, Color color) {
    return Container(
      width: 26,
      height: 26,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        shape: BoxShape.circle,
      ),
      child: Text(
        '$index',
        style: AppTextStyles.caption
            .copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }

  Widget _buildSubmittedCard(int index, _ClubItem c) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _indexBadge(index, AppColors.success),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(c.clubName, style: AppTextStyles.bodySemiBold),
                    ),
                    if ((c.clubRotaryId ?? '').isNotEmpty)
                      Text(
                        c.clubRotaryId!,
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textMuted),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.schedule_rounded,
                        size: 13, color: AppColors.textMuted),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        _formatDateTime(c.submittedDate),
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    ),
                    _uploadBadge(c.isUploadedToDistrict),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _reportButton(
                        clubId: c.clubId,
                        format: 'pdf',
                        label: 'PDF',
                        icon: Icons.picture_as_pdf_outlined,
                        color: AppColors.error,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _reportButton(
                        clubId: c.clubId,
                        format: 'word',
                        label: 'Word',
                        icon: Icons.description_outlined,
                        color: _emailBlue,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _reportButton({
    required int clubId,
    required String format,
    required String label,
    required IconData icon,
    required Color color,
  }) {
    final busy = _downloadingKey == '${clubId}_$format';
    final anyBusy = _downloadingKey != null;
    return OutlinedButton.icon(
      onPressed: anyBusy ? null : () => _downloadReport(clubId, format),
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: 0.4)),
        padding: const EdgeInsets.symmetric(vertical: 9),
        shape:
            const StadiumBorder(),
        textStyle: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w700),
      ),
      icon: busy
          ? SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                  strokeWidth: 2, valueColor: AlwaysStoppedAnimation(color)),
            )
          : Icon(icon, size: 16),
      label: Text(label),
    );
  }

  Widget _uploadBadge(bool uploaded) {
    final color = uploaded ? AppColors.success : AppColors.textMuted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        uploaded ? 'Uploaded' : 'Pending',
        style: AppTextStyles.caption
            .copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _buildNotSubmittedCard(int index, _ClubItem c) {
    final chips = <Widget>[];
    // if (c.emailStatus == 'sent') {
    //   chips.add(_statusChip('Email Sent', _emailBlue, Icons.mail_outline));
    // } else if (c.emailStatus == 'failed') {
    //   chips.add(_statusChip('Email Failed', AppColors.error, Icons.mail_outline));
    // }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _indexBadge(index, AppColors.error),
              const SizedBox(width: 12),
              Expanded(
                child: Text(c.clubName, style: AppTextStyles.bodySemiBold),
              ),
              if ((c.clubRotaryId ?? '').isNotEmpty)
                Text(
                  c.clubRotaryId!,
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textMuted),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _contactBlock('President', c.presidentName,
                    c.presidentMobile, c.presidentEmail),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _contactBlock('Secretary', c.secretaryName,
                    c.secretaryMobile, c.secretaryEmail),
              ),
            ],
          ),
          const Divider(height: 20),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Reminder',
                style: AppTextStyles.caption.copyWith(
                    color: AppColors.textMuted, fontWeight: FontWeight.w600),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: chips.isEmpty
                    ? Text('Not Sent',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textMuted))
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Wrap(
                            alignment: WrapAlignment.end,
                            spacing: 6,
                            runSpacing: 4,
                            children: chips,
                          ),
                          if ((c.lastReminderDate ?? '').isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              _formatDateTime(c.lastReminderDate),
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textMuted),
                            ),
                          ],
                        ],
                      ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _contactBlock(
      String label, String? name, String? mobile, String? email) {
    final hasName = (name ?? '').trim().isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.caption.copyWith(
            color: AppColors.textMuted,
            fontWeight: FontWeight.w700,
            fontSize: 13,
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 2),
        if (!hasName)
          Text('-',
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textMuted))
        else ...[
          Text(
            name!.trim(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.bodySemiBold.copyWith(fontSize: 13),
          ),
          if ((mobile ?? '').trim().isNotEmpty)
            Text(
              mobile!.trim(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
          if ((email ?? '').trim().isNotEmpty)
            Text(
              email!.trim(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
        ],
      ],
    );
  }

  Widget _statusChip(String text, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            text,
            style: AppTextStyles.caption.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
