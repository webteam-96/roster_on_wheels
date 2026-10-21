import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/currency_symbol.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Detail view for a single zonal beneficiary-over-limit approval request.
/// Pushed from [ZonalDashboardScreen]. Returns `true` from `Navigator.pop` after
/// a successful approve/reject so the caller can refresh its list.
class ZonalApprovalDetailScreen extends StatefulWidget {
  final String approvalToken;
  const ZonalApprovalDetailScreen({super.key, required this.approvalToken});

  @override
  State<ZonalApprovalDetailScreen> createState() => _ZonalApprovalDetailScreenState();
}

class _ZonalApprovalDetailScreenState extends State<ZonalApprovalDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _ApprovalDetail? _detail;
  bool _approving = false;
  bool _rejecting = false;
  bool get _actionInProgress => _approving || _rejecting;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/zonal-dashboard/approval-requests/${widget.approvalToken}/detail',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _ApprovalDetail.fromJson(resp.data ?? {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _approve() async {
    final detail = _detail;
    if (detail == null) return;
    setState(() => _approving = true);
    try {
      await _api.post('/api/zonal-dashboard/approve', body: {'approvalId': detail.id});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Request approved'), backgroundColor: AppColors.success),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _approving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to approve: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _showRejectDialog() async {
    final detail = _detail;
    if (detail == null) return;
    final remarkCtrl = TextEditingController();
    final remark = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('Reject Request', style: AppTextStyles.h3),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Enter reason for rejection:', style: AppTextStyles.body),
            const SizedBox(height: 10),
            TextField(
              controller: remarkCtrl,
              maxLines: 3,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'Remark...',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                contentPadding: const EdgeInsets.all(12),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final value = remarkCtrl.text.trim();
              if (value.isEmpty) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(content: Text('Remark is required when rejecting.')),
                );
                return;
              }
              Navigator.of(ctx).pop(value);
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Reject', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    Future.delayed(const Duration(milliseconds: 400), () => remarkCtrl.dispose());
    if (remark == null || !mounted) return;
    await _reject(detail.id, remark);
  }

  Future<void> _reject(int approvalId, String remark) async {
    setState(() => _rejecting = true);
    try {
      await _api.post('/api/zonal-dashboard/reject', body: {
        'approvalId': approvalId,
        'remark': remark,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Request rejected'), backgroundColor: AppColors.success),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _rejecting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to reject: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _openTel(String? raw) async {
    if (raw == null || raw.trim().isEmpty) return;
    final uri = Uri(scheme: 'tel', path: raw.trim());
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> _openMail(String? raw) async {
    if (raw == null || raw.trim().isEmpty) return;
    final uri = Uri(scheme: 'mailto', path: raw.trim());
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'approved': return AppColors.success;
      case 'rejected': return AppColors.error;
      default: return AppColors.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Approval Request'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : _detail == null
                  ? const Center(child: Text('No data'))
                  : _buildBody(_detail!),
    );
  }

  Widget _buildBody(_ApprovalDetail d) {
    final status = d.status.toLowerCase();
    final canAct = status == 'pending';
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Title + status badge
            Text(
              d.projectTitle.isEmpty ? 'Project #${d.id}' : d.projectTitle,
              style: AppFonts.display(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _StatusBadge(label: d.status.toUpperCase(), color: _statusColor(d.status)),
                if (d.zoneName != null) ...[
                  const SizedBox(width: 8),
                  Text(d.zoneName!, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                ],
              ],
            ),
            const SizedBox(height: 18),

            // Beneficiary section (highlighted — this is the reason it needs approval)
            _SectionCard(
              title: 'Beneficiary Details',
              backgroundColor: AppColors.error.withValues(alpha: 0.06),
              borderColor: AppColors.error.withValues(alpha: 0.25),
              child: Row(
                children: [
                  Expanded(child: _Stat(label: 'Set Limit', value: '${d.currentLimit ?? ": "}')),
                  Container(width: 1, height: 36, color: AppColors.border),
                  Expanded(
                    child: _Stat(
                      label: 'Requested',
                      value: '${d.requestedBeneficiaries ?? ": "}',
                      valueColor: AppColors.error,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // Project Details
            _SectionCard(
              title: 'Project Details',
              child: Column(
                children: [
                  _DetailRow(label: 'Title', value: d.projectTitle),
                  _DetailRow(label: 'Date', value: d.projectDate != null ? _formatDate(d.projectDate!) : '–'),
                  if ((d.projectDescription ?? '').isNotEmpty)
                    _DetailRow(label: 'Description', value: d.projectDescription!),
                  _DetailRow(label: 'Cost', value: d.projectCost != null ? '${currencySymbolFor(d.currency)}${_formatNumber(d.projectCost!)}' : '–'),
                  _DetailRow(label: 'Man Hours', value: d.manHours?.toString() ?? '–'),
                  _DetailRow(label: 'Rotarians', value: d.rotariansInvolved?.toString() ?? '–'),
                  _DetailRow(label: 'Rotaractors', value: d.rotaractorsInvolved?.toString() ?? '–'),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // Remark (if any)
            if ((d.remark ?? '').isNotEmpty) ...[
              _SectionCard(
                title: 'Remark',
                child: Text(d.remark!, style: AppTextStyles.body),
              ),
              const SizedBox(height: 14),
            ],

            // Photos
            if (d.photoUrls.isNotEmpty) ...[
              Text('Project Photos', style: AppTextStyles.h4),
              const SizedBox(height: 8),
              SizedBox(
                height: 120,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: d.photoUrls.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final url = ApiConstants.mediaUrl(d.photoUrls[i]);
                    return ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: CachedNetworkImage(
                        imageUrl: url,
                        width: 160,
                        height: 120,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => Container(
                          width: 160,
                          color: AppColors.primaryLight,
                          child: const Center(
                            child: const CircularProgressIndicator(color: AppColors.primary, strokeWidth: 2),
                          ),
                        ),
                        errorWidget: (_, __, ___) => Container(
                          width: 160,
                          color: AppColors.surface,
                          child: const Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 14),
            ],

            // Club & Admin Details
            _SectionCard(
              title: 'Club & Admin Details',
              child: Column(
                children: [
                  _DetailRow(label: 'District', value: d.districtNumber ?? '–'),
                  _DetailRow(label: 'Club', value: d.clubName ?? '–'),
                  _DetailRow(label: 'Admin', value: d.requestedByName ?? '–'),
                  _DetailRow(
                    label: 'Mobile',
                    value: d.requestedByMobile ?? '–',
                    onTap: (d.requestedByMobile ?? '').isNotEmpty
                        ? () => _openTel(d.requestedByMobile)
                        : null,
                    actionIcon: (d.requestedByMobile ?? '').isNotEmpty ? Icons.phone : null,
                  ),
                  _DetailRow(
                    label: 'Email',
                    value: d.requestedByEmail ?? '–',
                    onTap: (d.requestedByEmail ?? '').isNotEmpty
                        ? () => _openMail(d.requestedByEmail)
                        : null,
                    actionIcon: (d.requestedByEmail ?? '').isNotEmpty ? Icons.mail_outline : null,
                  ),
                ],
              ),
            ),

            if (canAct) ...[
              const SizedBox(height: 22),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _actionInProgress ? null : _showRejectDialog,
                      icon: _rejecting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(AppColors.error),
                              ),
                            )
                          : const Icon(Icons.cancel_outlined),
                      label: const Text('Reject'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.error,
                        side: const BorderSide(color: AppColors.error),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: _actionInProgress ? null : _approve,
                      icon: _approving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(Colors.white),
                              ),
                            )
                          : const Icon(Icons.check_circle_outline),
                      label: const Text('Approve'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.success,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  String _formatNumber(num n) {
    final str = n.toStringAsFixed(n is int || n == n.toInt() ? 0 : 2);
    final parts = str.split('.');
    final intPart = parts[0];
    final buf = StringBuffer();
    for (int i = 0; i < intPart.length; i++) {
      if (i > 0 && (intPart.length - i) % 3 == 0) buf.write(',');
      buf.write(intPart[i]);
    }
    return parts.length > 1 ? '${buf.toString()}.${parts[1]}' : buf.toString();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────
class _ApprovalDetail {
  final int id;
  final int? projectId;
  final String approvalToken;
  final String status;
  final String? remark;
  final DateTime? createdDate;
  final String projectTitle;
  final String? projectDescription;
  final DateTime? projectDate;
  final num? projectCost;
  final String? currency;
  final int? currentBeneficiaries;
  final int? manHours;
  final int? rotariansInvolved;
  final int? rotaractorsInvolved;
  final int? requestedBeneficiaries;
  final int? currentLimit;
  final String? clubName;
  final String? districtNumber;
  final String? zoneName;
  final String? requestedByName;
  final String? requestedByEmail;
  final String? requestedByMobile;
  final List<String> photoUrls;

  const _ApprovalDetail({
    required this.id,
    required this.approvalToken,
    required this.projectTitle,
    required this.status,
    required this.photoUrls,
    this.projectId,
    this.remark,
    this.createdDate,
    this.projectDescription,
    this.projectDate,
    this.projectCost,
    this.currency,
    this.currentBeneficiaries,
    this.manHours,
    this.rotariansInvolved,
    this.rotaractorsInvolved,
    this.requestedBeneficiaries,
    this.currentLimit,
    this.clubName,
    this.districtNumber,
    this.zoneName,
    this.requestedByName,
    this.requestedByEmail,
    this.requestedByMobile,
  });

  factory _ApprovalDetail.fromJson(Map<String, dynamic> j) {
    DateTime? parseDate(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    final photos = (j['photoUrls'] as List<dynamic>? ?? const [])
        .map((e) => e?.toString() ?? '')
        .where((s) => s.isNotEmpty)
        .toList();
    return _ApprovalDetail(
      id: j['id'] as int? ?? j['approvalId'] as int? ?? 0,
      projectId: j['projectId'] as int?,
      approvalToken: j['approvalToken']?.toString() ?? '',
      status: j['status']?.toString() ?? 'pending',
      remark: j['remark']?.toString(),
      createdDate: parseDate(j['createdDate']),
      projectTitle: j['projectTitle']?.toString() ?? '',
      projectDescription: j['projectDescription']?.toString(),
      projectDate: parseDate(j['projectDate']),
      projectCost: j['projectCost'] as num?,
      currency: j['currency']?.toString(),
      currentBeneficiaries: j['currentBeneficiaries'] as int?,
      manHours: j['manHours'] as int?,
      rotariansInvolved: j['rotariansInvolved'] as int?,
      rotaractorsInvolved: j['rotaractorsInvolved'] as int?,
      requestedBeneficiaries: j['requestedBeneficiaries'] as int?,
      currentLimit: j['currentLimit'] as int?,
      clubName: j['clubName']?.toString(),
      districtNumber: j['districtNumber']?.toString(),
      zoneName: j['zoneName']?.toString(),
      requestedByName: j['requestedByName']?.toString().trim(),
      requestedByEmail: j['requestedByEmail']?.toString(),
      requestedByMobile: j['requestedByMobile']?.toString(),
      photoUrls: photos,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Components
// ─────────────────────────────────────────────────────────────────────────────
class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;
  final Color? backgroundColor;
  final Color? borderColor;
  const _SectionCard({
    required this.title,
    required this.child,
    this.backgroundColor,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: backgroundColor ?? AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor ?? AppColors.border),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.h4),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback? onTap;
  final IconData? actionIcon;
  const _DetailRow({
    required this.label,
    required this.value,
    this.onTap,
    this.actionIcon,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          ),
          Expanded(
            child: GestureDetector(
              onTap: onTap,
              behavior: HitTestBehavior.opaque,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      value,
                      style: AppTextStyles.body.copyWith(
                        color: onTap != null ? AppColors.primary : AppColors.textPrimary,
                        fontWeight: onTap != null ? FontWeight.w500 : FontWeight.w400,
                      ),
                    ),
                  ),
                  if (actionIcon != null) ...[
                    const SizedBox(width: 6),
                    Icon(actionIcon, size: 16, color: AppColors.primary),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  const _Stat({required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: AppFonts.display(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: valueColor ?? AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 2),
        Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
      ],
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
      child: Text(
        label,
        style: AppTextStyles.caption.copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}
