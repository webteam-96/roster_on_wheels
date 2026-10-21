import 'package:flutter/material.dart';
import 'package:flutter_html/flutter_html.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _Recipient {
  final int memberId;
  final String memberName;
  final String? email;
  final String status;
  final DateTime? sentDate;

  const _Recipient({
    required this.memberId,
    required this.memberName,
    this.email,
    this.status = 'Pending',
    this.sentDate,
  });

  factory _Recipient.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    return _Recipient(
      memberId: j['memberId'] as int? ?? 0,
      memberName: j['memberName']?.toString() ?? '',
      email: j['email']?.toString(),
      status: j['status']?.toString() ?? 'Pending',
      sentDate: parse(j['sentDate']),
    );
  }
}

class _EmailDetail {
  final int id;
  final String subject;
  final String status;
  final String? fromName;
  final String? replyEmail;
  final String? replyName;
  final String? emailBody;
  final int totalRecipients;
  final int sentCount;
  final int failedCount;
  final List<_Recipient> recipients;

  const _EmailDetail({
    required this.id,
    required this.subject,
    required this.status,
    required this.totalRecipients,
    required this.sentCount,
    required this.failedCount,
    required this.recipients,
    this.fromName,
    this.replyEmail,
    this.replyName,
    this.emailBody,
  });

  factory _EmailDetail.fromJson(Map<String, dynamic> j) {
    final raw = (j['recipients'] as List<dynamic>? ?? const []);
    return _EmailDetail(
      id: j['id'] as int? ?? 0,
      subject: j['subject']?.toString() ?? '',
      status: j['status']?.toString() ?? 'Draft',
      fromName: j['fromName']?.toString(),
      replyEmail: j['replyEmail']?.toString(),
      replyName: j['replyName']?.toString(),
      emailBody: j['emailBody']?.toString(),
      totalRecipients: j['totalRecipients'] as int? ?? 0,
      sentCount: j['sentCount'] as int? ?? 0,
      failedCount: j['failedCount'] as int? ?? 0,
      recipients: raw.map((r) => _Recipient.fromJson(r as Map<String, dynamic>)).toList(),
    );
  }
}

class RiDirectorMassEmailDetailScreen extends StatefulWidget {
  final int emailId;
  const RiDirectorMassEmailDetailScreen({super.key, required this.emailId});

  @override
  State<RiDirectorMassEmailDetailScreen> createState() => _RiDirectorMassEmailDetailScreenState();
}

class _RiDirectorMassEmailDetailScreenState extends State<RiDirectorMassEmailDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _EmailDetail? _detail;
  bool _actionInProgress = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/mass-emails/${widget.emailId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _EmailDetail.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _send() async {
    final d = _detail;
    if (d == null) return;
    // Fetch credit balance for confirmation message
    int? emailBalance;
    try {
      final balResp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/credits/balance',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      emailBalance = balResp.data?['emailBalance'] as int?;
    } catch (_) { emailBalance = null; }
    if (!mounted) return;
    final insufficient = emailBalance != null && d.totalRecipients > emailBalance;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          Icon(Icons.send, color: insufficient ? AppColors.error : AppColors.primary),
          const SizedBox(width: 8),
          Text('Send Mass Email', style: AppTextStyles.h3),
        ]),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Send to ${d.totalRecipients} recipient(s)?', style: AppTextStyles.body),
            const SizedBox(height: 8),
            Text('Required credits: ${d.totalRecipients}', style: AppTextStyles.caption),
            Text(
              'Available balance: ${emailBalance ?? ": "}',
              style: AppTextStyles.caption.copyWith(
                color: insufficient ? AppColors.error : AppColors.success,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (insufficient) ...[
              const SizedBox(height: 4),
              Text('⚠️ Insufficient credits. Send blocked.',
                  style: AppTextStyles.caption.copyWith(color: AppColors.error, fontWeight: FontWeight.w600)),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: insufficient ? null : () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
            ),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() => _actionInProgress = true);
    try {
      await _api.post('/api/ri-director/mass-emails/${widget.emailId}/send');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sending started'), backgroundColor: AppColors.success));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to send: $e'), backgroundColor: AppColors.error));
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  Future<void> _delete() async {
    final d = _detail;
    if (d == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Email', style: AppTextStyles.h3),
        ]),
        content: Text('Delete "${d.subject}"?', style: AppTextStyles.body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: Colors.white),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await _api.delete('/api/ri-director/mass-emails/${widget.emailId}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Email deleted'), backgroundColor: AppColors.success));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'Sent': return AppColors.success;
      case 'Failed': return AppColors.error;
      case 'Partial': return AppColors.warning;
      case 'Sending': return AppColors.primary;
      case 'Pending': return AppColors.warning;
      default: return AppColors.textSecondary;
    }
  }

  bool _canSend(String status) =>
      status == 'Draft' || status == 'Failed' || status == 'Partial' || status == 'Sending';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Mass Email',
        actions: _detail == null
            ? null
            : [
                if (_canSend(_detail!.status))
                  IconButton(
                    icon: const Icon(Icons.send),
                    tooltip: _detail!.status == 'Draft' ? 'Send' : 'Resume / Retry',
                    onPressed: _actionInProgress ? null : _send,
                  ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: AppColors.error),
                  tooltip: 'Delete',
                  onPressed: _actionInProgress ? null : _delete,
                ),
              ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : _detail == null
                  ? const Center(child: Text('No data'))
                  : _buildBody(_detail!),
    );
  }

  Widget _buildBody(_EmailDetail d) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(d.subject, style: AppFonts.display(
              fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary,
            )),
            const SizedBox(height: 8),
            _StatusBadge(label: d.status, color: _statusColor(d.status)),
            const SizedBox(height: 16),
            _StatsRow(
              total: d.totalRecipients,
              sent: d.sentCount,
              failed: d.failedCount,
            ),
            const SizedBox(height: 14),
            _SectionCard(
              title: 'Email Info',
              child: Column(children: [
                _DetailRow(label: 'From', value: d.fromName ?? '–'),
                if ((d.replyEmail ?? '').isNotEmpty)
                  _DetailRow(
                    label: 'Reply To',
                    value: '${d.replyName ?? ''} <${d.replyEmail}>'.trim(),
                  ),
                _DetailRow(label: 'Subject', value: d.subject),
              ]),
            ),
            if ((d.emailBody ?? '').isNotEmpty) ...[
              const SizedBox(height: 12),
              _SectionCard(
                title: 'Body',
                child: Html(
                  data: d.emailBody!,
                  style: {
                    'body': Style(
                      margin: Margins.zero,
                      padding: HtmlPaddings.zero,
                      fontFamily: AppFonts.bodyFamily,
                      fontSize: FontSize(14),
                      color: AppColors.textPrimary,
                    ),
                    'p': Style(margin: Margins.only(bottom: 8)),
                  },
                ),
              ),
            ],
            const SizedBox(height: 14),
            Text('Recipients (${d.recipients.length})', style: AppTextStyles.h4),
            const SizedBox(height: 8),
            if (d.recipients.isEmpty)
              Container(
                padding: const EdgeInsets.all(16),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Text('No recipients yet.', style: AppTextStyles.caption),
              )
            else
              Column(
                children: [
                  for (int i = 0; i < d.recipients.length; i++)
                    _RecipientRow(
                      index: i + 1,
                      r: d.recipients[i],
                      color: _statusColor(d.recipients[i].status),
                    ),
                ],
              ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String label;
  final Color color;
  const _StatusBadge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(label, style: AppTextStyles.caption.copyWith(
        color: color, fontWeight: FontWeight.w700,
      )),
    );
  }
}

class _StatsRow extends StatelessWidget {
  final int total;
  final int sent;
  final int failed;
  const _StatsRow({required this.total, required this.sent, required this.failed});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(child: _StatBox(label: 'Total', value: '$total', color: AppColors.primary)),
      const SizedBox(width: 8),
      Expanded(child: _StatBox(label: 'Sent', value: '$sent', color: AppColors.success)),
      const SizedBox(width: 8),
      Expanded(child: _StatBox(label: 'Failed', value: '$failed', color: AppColors.error)),
    ]);
  }
}

class _StatBox extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatBox({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(children: [
        Text(value, style: AppFonts.display(
          fontSize: 20, fontWeight: FontWeight.w700, color: color,
        )),
        Text(label, style: AppTextStyles.caption.copyWith(color: color)),
      ]),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _SectionCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: AppTextStyles.h4),
        const SizedBox(height: 8),
        child,
      ]),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 80,
          child: Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary))),
        Expanded(child: Text(value, style: AppTextStyles.body)),
      ]),
    );
  }
}

class _RecipientRow extends StatelessWidget {
  final int index;
  final _Recipient r;
  final Color color;
  const _RecipientRow({required this.index, required this.r, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: [
        SizedBox(width: 24, child: Text('$index.', style: AppTextStyles.caption.copyWith(color: AppColors.textMuted))),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(r.memberName, style: AppTextStyles.bodyMedium, overflow: TextOverflow.ellipsis),
              if ((r.email ?? '').isNotEmpty)
                Text(r.email!, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                    overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(r.status, style: AppFonts.body(
            fontSize: 10, color: color, fontWeight: FontWeight.w600,
          )),
        ),
      ]),
    );
  }
}
