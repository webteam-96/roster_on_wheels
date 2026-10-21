import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';

class ZonalApprovalRequest {
  final int id;
  final String projectTitle;
  final String status;
  final String? approvalToken;
  final String? clubName;
  final String? districtNumber;
  final String? requestedByName;
  final int? requestedBeneficiaries;
  final int? currentLimit;
  final DateTime? createdDate;

  const ZonalApprovalRequest({
    required this.id,
    required this.projectTitle,
    this.status = 'pending',
    this.approvalToken,
    this.clubName,
    this.districtNumber,
    this.requestedByName,
    this.requestedBeneficiaries,
    this.currentLimit,
    this.createdDate,
  });

  factory ZonalApprovalRequest.fromJson(Map<String, dynamic> j) => ZonalApprovalRequest(
        id: j['id'] as int? ?? j['approvalId'] as int? ?? 0,
        projectTitle: (j['projectTitle'] as String?) ?? (j['title'] as String?) ?? '',
        status: j['status'] as String? ?? 'pending',
        approvalToken: j['approvalToken'] as String?,
        clubName: j['clubName'] as String?,
        districtNumber: j['districtNumber'] as String?,
        requestedByName: (j['requestedByName'] as String?)?.trim()
            ?? (j['requestedBy'] as String?)
            ?? (j['memberName'] as String?),
        requestedBeneficiaries: j['requestedBeneficiaries'] as int?,
        currentLimit: j['currentLimit'] as int?,
        createdDate: j['createdDate'] != null
            ? DateTime.tryParse(j['createdDate'].toString())
            : null,
      );
}

// Retained for callers that still want a single status accent color.
Color zonalApprovalStatusColor(String status) => _statusStyle(status).fg;

/// Web-parity status badge colors (matches the frontend getStatusBadge):
/// pending → amber, approved → green, rejected → red, else → slate/gray.
class _StatusStyle {
  final Color bg;
  final Color fg;
  const _StatusStyle(this.bg, this.fg);
}

_StatusStyle _statusStyle(String status) {
  switch (status.toLowerCase()) {
    case 'approved':
      return const _StatusStyle(AppColors.accentGreenSoft, AppColors.accentGreen);
    case 'rejected':
      return const _StatusStyle(AppColors.errorLight, AppColors.error);
    case 'pending':
      return const _StatusStyle(AppColors.accentAmberSoft, AppColors.accentAmber);
    default: // cancelled / canceled / unknown → neutral slate
      return const _StatusStyle(AppColors.slate100, AppColors.slate500);
  }
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _formatDate(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')} ${_months[d.month - 1]} ${d.year}';

/// Flat, dense card styled after the web Zonal dashboard table row:
/// white surface, thin slate border, amber/green/red status chip, and the
/// requested count called out in red against a neutral limit.
class ZonalApprovalCard extends StatelessWidget {
  final ZonalApprovalRequest request;
  final Color statusColor; // kept for API compatibility; badge derives its own
  final VoidCallback? onView;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  // When false the card renders flat (no border/radius) so it can sit inside a
  // shared white panel separated by dividers — the web table-row look.
  final bool bordered;

  const ZonalApprovalCard({
    super.key,
    required this.request,
    required this.statusColor,
    this.onView,
    this.onApprove,
    this.onReject,
    this.bordered = true,
  });

  @override
  Widget build(BuildContext context) {
    final meta = [
      if (request.clubName != null && request.clubName!.isNotEmpty)
        request.clubName!,
      if (request.districtNumber != null && request.districtNumber!.isNotEmpty)
        'D${request.districtNumber}',
    ].join(' · ');
    final hasStats =
        request.requestedBeneficiaries != null && request.currentLimit != null;
    final footer = [
      if (request.requestedByName != null &&
          request.requestedByName!.isNotEmpty)
        request.requestedByName!,
      if (request.createdDate != null) _formatDate(request.createdDate!),
    ].join('  ·  ');

    return Material(
      color: bordered ? AppColors.surface : Colors.transparent,
      borderRadius: bordered ? BorderRadius.circular(12) : null,
      child: InkWell(
        onTap: onView,
        borderRadius: bordered ? BorderRadius.circular(12) : null,
        child: Container(
          decoration: bordered
              ? BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.slate200),
                )
              : null,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title + status chip (top-right)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      request.projectTitle.isEmpty
                          ? 'Project #${request.id}'
                          : request.projectTitle,
                      style: AppTextStyles.bodySemiBold.copyWith(
                        height: 1.3,
                        color: AppColors.slate700,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 10),
                  _StatusPill(status: request.status),
                ],
              ),
              if (meta.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  meta,
                  style: AppTextStyles.caption.copyWith(color: AppColors.slate500),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              // Dense inline Limit / Requested line (Requested called out in red)
              if (hasStats) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    _InlineStat(
                      label: 'Limit',
                      value: '${request.currentLimit}',
                      valueColor: AppColors.slate700,
                    ),
                    const SizedBox(width: 20),
                    _InlineStat(
                      label: 'Requested',
                      value: '${request.requestedBeneficiaries}',
                      valueColor: AppColors.error,
                    ),
                  ],
                ),
              ],
              if (footer.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  footer,
                  style:
                      AppTextStyles.caption.copyWith(color: AppColors.slate400),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              if (onApprove != null || onReject != null) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    if (onApprove != null)
                      Expanded(
                        child: _SoftActionButton(
                          label: 'Approve',
                          icon: Icons.check_circle_outline,
                          bg: AppColors.accentGreenSoft,
                          fg: AppColors.accentGreen,
                          onTap: onApprove!,
                        ),
                      ),
                    if (onApprove != null && onReject != null)
                      const SizedBox(width: 10),
                    if (onReject != null)
                      Expanded(
                        child: _SoftActionButton(
                          label: 'Reject',
                          icon: Icons.cancel_outlined,
                          bg: AppColors.errorLight,
                          fg: AppColors.error,
                          onTap: onReject!,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  const _StatusPill({required this.status});

  @override
  Widget build(BuildContext context) {
    final s = _statusStyle(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: s.bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        status.isEmpty
            ? '–'
            : status[0].toUpperCase() + status.substring(1).toLowerCase(),
        style: AppTextStyles.caption.copyWith(
          color: s.fg,
          fontWeight: FontWeight.w600,
          fontSize: 11,
        ),
      ),
    );
  }
}

/// "Label  Value" inline pair — label muted, value emphasized.
class _InlineStat extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;
  const _InlineStat({
    required this.label,
    required this.value,
    required this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      textBaseline: TextBaseline.alphabetic,
      crossAxisAlignment: CrossAxisAlignment.baseline,
      children: [
        Text(
          label,
          style: AppTextStyles.caption.copyWith(color: AppColors.slate500),
        ),
        const SizedBox(width: 6),
        Text(
          value,
          style: AppTextStyles.bodySemiBold.copyWith(color: valueColor),
        ),
      ],
    );
  }
}

/// Flat, soft-filled action button (no border) — matches the web's tinted
/// ghost action buttons.
class _SoftActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color bg;
  final Color fg;
  final VoidCallback onTap;
  const _SoftActionButton({
    required this.label,
    required this.icon,
    required this.bg,
    required this.fg,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: fg),
              const SizedBox(width: 6),
              Text(
                label,
                style: AppTextStyles.buttonSmall.copyWith(color: fg),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
