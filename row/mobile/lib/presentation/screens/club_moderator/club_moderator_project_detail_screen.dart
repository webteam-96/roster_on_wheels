import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/services/project_share_service.dart';
import '../../../core/utils/currency_symbol.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'approval_status_utils.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Detail view for a single Club Moderator project pending review.
/// Pushed from [ClubModeratorScreen]. Returns `true` from `Navigator.pop`
/// after a successful approve/reject so the caller can refresh.
class ClubModeratorProjectDetailScreen extends StatefulWidget {
  final int projectId;

  /// Rotary year of the project. Sent as `?yearId=` so the backend resolves the
  /// correct year-wise table (a `pk_project_id` can repeat across years).
  final int? yearId;
  const ClubModeratorProjectDetailScreen({
    super.key,
    required this.projectId,
    this.yearId,
  });

  @override
  State<ClubModeratorProjectDetailScreen> createState() => _ClubModeratorProjectDetailScreenState();
}

class _ClubModeratorProjectDetailScreenState extends State<ClubModeratorProjectDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _ProjectDetail? _detail;
  bool? _pendingApprove;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/project-approval/moderator/${widget.projectId}/detail',
        queryParams: {
          if (widget.yearId != null && widget.yearId! > 0)
            'yearId': widget.yearId,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _ProjectDetail.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _showActionDialog({required bool isApprove}) async {
    final detail = _detail;
    if (detail == null) return;
    final remarkCtrl = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(
          children: [
            Icon(
              isApprove ? Icons.check_circle_outline : Icons.cancel_outlined,
              color: isApprove ? AppColors.success : AppColors.error,
            ),
            const SizedBox(width: 8),
            Text(isApprove ? 'Approve Project' : 'Reject Project', style: AppTextStyles.h3),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(detail.title, style: AppTextStyles.bodyMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                  if (detail.clubName != null)
                    Text('${detail.clubName} · ${detail.moduleName ?? ''}',
                        style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              isApprove ? 'Remark (optional)' : 'Remark *',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 4),
            TextField(
              controller: remarkCtrl,
              maxLines: 3,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'Enter your remark...',
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
              if (!isApprove && value.isEmpty) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(content: Text('Remark is required when rejecting.')),
                );
                return;
              }
              Navigator.of(ctx).pop(value);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: isApprove ? AppColors.success : AppColors.error,
              foregroundColor: Colors.white,
            ),
            child: Text(isApprove ? 'Approve' : 'Reject'),
          ),
        ],
      ),
    );
    Future.delayed(const Duration(milliseconds: 400), () => remarkCtrl.dispose());
    if (result == null || !mounted) return;
    await _submitAction(isApprove: isApprove, remark: result);
  }

  Future<void> _submitAction({required bool isApprove, required String remark}) async {
    setState(() => _pendingApprove = isApprove);
    try {
      // ApiClient.post takes no queryParams → append yearId to the path.
      final yq = (widget.yearId != null && widget.yearId! > 0)
          ? '?yearId=${widget.yearId}'
          : '';
      final endpoint = isApprove
          ? '/api/project-approval/moderator/${widget.projectId}/approve$yq'
          : '/api/project-approval/moderator/${widget.projectId}/reject$yq';
      await _api.post(endpoint, body: {if (remark.isNotEmpty) 'remark': remark});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(isApprove ? 'Project approved' : 'Project rejected'),
          backgroundColor: AppColors.success,
        ),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _pendingApprove = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed: $e'),
          backgroundColor: AppColors.error,
        ),
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
      appBar: CustomAppBar(
        title: 'Project Details',
        actions: [
          if (_detail != null)
            IconButton(
              tooltip: 'Share',
              icon: const Icon(Icons.share_outlined),
              onPressed: () => shareProject(context,
                  projectId: widget.projectId, yearId: widget.yearId),
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

  Widget _buildBody(_ProjectDetail d) {
    final canAct = d.approvalStatus.toLowerCase() == 'pending';
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Title + status
            Text(
              d.title.isEmpty ? 'Project #${d.projectId}' : d.title,
              style: AppFonts.display(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            _StatusBadge(label: d.approvalStatus.toUpperCase(), color: _statusColor(d.approvalStatus)),
            const SizedBox(height: 18),

            // Project Info
            _SectionCard(
              title: 'Project Info',
              child: Column(
                children: [
                  _DetailRow(label: 'Club', value: d.clubName ?? '–'),
                  _DetailRow(label: 'District', value: d.districtNumber ?? '–'),
                  _DetailRow(label: 'Module', value: d.moduleName ?? '–'),
                  _DetailRow(
                    label: 'Type',
                    value: d.projectType == 'ongoing_repeat'
                        ? 'Ongoing/Repeat'
                        : d.projectType == 'one_time'
                            ? 'One Time'
                            : (d.projectType ?? '–'),
                  ),
                  _DetailRow(label: 'Date', value: d.projectDate != null ? _formatDate(d.projectDate!) : '–'),
                  _DetailRow(label: 'Cost', value: d.projectCost != null ? '${currencySymbolFor(d.currency)}${_formatNumber(d.projectCost!)}' : '–'),
                  _DetailRow(label: 'Beneficiaries', value: d.directBeneficiaries?.toString() ?? '–'),
                  _DetailRow(label: 'Man Hours', value: d.manHours?.toString() ?? '–'),
                  _DetailRow(label: 'Rotarians', value: d.rotariansInvolved?.toString() ?? '–'),
                  _DetailRow(label: 'Rotaractors', value: d.rotaractorsInvolved?.toString() ?? '–'),
                  if ((d.location ?? '').isNotEmpty) _DetailRow(label: 'Location', value: d.location!),
                  if ((d.areaOfFocusName ?? '').isNotEmpty) _DetailRow(label: 'Area of Focus', value: d.areaOfFocusName!),
                  if ((d.categoryName ?? '').isNotEmpty) _DetailRow(label: 'Category', value: d.categoryName!),
                  if ((d.subCategoryName ?? '').isNotEmpty) _DetailRow(label: 'Sub Category', value: d.subCategoryName!),
                  if ((d.fundingName ?? '').isNotEmpty) _DetailRow(label: 'Funding', value: d.fundingName!),
                  if (d.isJointProject == true && (d.coHostName ?? '').isNotEmpty)
                    _DetailRow(label: 'Co-host', value: '${d.coHostName}${d.clubRole != null ? " (${d.clubRole})" : ""}'),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // Description
            if ((d.description ?? '').isNotEmpty) ...[
              _SectionCard(
                title: 'Description',
                child: Text(d.description!, style: AppTextStyles.body),
              ),
              const SizedBox(height: 14),
            ],

            // Photos
            if (d.photos.isNotEmpty) ...[
              Text('Photos (${d.photos.length})', style: AppTextStyles.h4),
              const SizedBox(height: 8),
              SizedBox(
                height: 110,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: d.photos.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final url = ApiConstants.mediaUrl(d.photos[i]);
                    return ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: CachedNetworkImage(
                        imageUrl: url,
                        width: 140,
                        height: 110,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => Container(
                          width: 140,
                          color: AppColors.primaryLight,
                          child: const Center(
                            child: const CircularProgressIndicator(color: AppColors.primary, strokeWidth: 2),
                          ),
                        ),
                        errorWidget: (_, __, ___) => Container(
                          width: 140,
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

            // Submitted By
            _SectionCard(
              title: 'Submitted By',
              backgroundColor: AppColors.primaryLight.withValues(alpha: 0.4),
              borderColor: AppColors.primaryLight,
              child: Column(
                children: [
                  _DetailRow(label: 'Name', value: d.adminName ?? '–'),
                  _DetailRow(
                    label: 'Mobile',
                    value: d.adminMobile ?? '–',
                    onTap: (d.adminMobile ?? '').isNotEmpty ? () => _openTel(d.adminMobile) : null,
                    actionIcon: (d.adminMobile ?? '').isNotEmpty ? Icons.phone : null,
                  ),
                  _DetailRow(
                    label: 'Email',
                    value: d.adminEmail ?? '–',
                    onTap: (d.adminEmail ?? '').isNotEmpty ? () => _openMail(d.adminEmail) : null,
                    actionIcon: (d.adminEmail ?? '').isNotEmpty ? Icons.mail_outline : null,
                  ),
                  _DetailRow(
                    label: 'Submitted',
                    value: d.createdDate != null ? _formatDate(d.createdDate!) : '–',
                  ),
                ],
              ),
            ),

            // Approval remark (if any)
            if ((d.approvalRemark ?? '').isNotEmpty) ...[
              const SizedBox(height: 14),
              _SectionCard(
                title: 'Moderator Remark',
                backgroundColor: _statusColor(d.approvalStatus).withValues(alpha: 0.06),
                borderColor: _statusColor(d.approvalStatus).withValues(alpha: 0.25),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(d.approvalRemark!, style: AppTextStyles.body),
                    if (d.approvalDate != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        'on ${_formatDate(d.approvalDate!)}',
                        style: AppTextStyles.caption.copyWith(color: AppColors.textMuted),
                      ),
                    ],
                  ],
                ),
              ),
            ],

            // Action buttons
            if (canAct) ...[
              const SizedBox(height: 22),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _pendingApprove != null ? null : () => _showActionDialog(isApprove: false),
                      icon: _pendingApprove == false
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
                      onPressed: _pendingApprove != null ? null : () => _showActionDialog(isApprove: true),
                      icon: _pendingApprove == true
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
class _ProjectDetail {
  final int projectId;
  final String title;
  final String? description;
  final String? clubName;
  final String? districtNumber;
  final String? moduleName;
  final String? projectType;
  final DateTime? projectDate;
  final num? projectCost;
  final String? currency;
  final int? directBeneficiaries;
  final int? manHours;
  final int? rotariansInvolved;
  final int? rotaractorsInvolved;
  final String? location;
  final String? areaOfFocusName;
  final String? categoryName;
  final String? subCategoryName;
  final String? fundingName;
  final bool? isJointProject;
  final String? coHostName;
  final String? clubRole;
  final List<String> photos;
  final String approvalStatus;
  final String? approvalRemark;
  final DateTime? approvalDate;
  final DateTime? createdDate;
  final String? adminName;
  final String? adminEmail;
  final String? adminMobile;
  final String? adminPhoto;

  const _ProjectDetail({
    required this.projectId,
    required this.title,
    required this.photos,
    this.description,
    this.clubName,
    this.districtNumber,
    this.moduleName,
    this.projectType,
    this.projectDate,
    this.projectCost,
    this.currency,
    this.directBeneficiaries,
    this.manHours,
    this.rotariansInvolved,
    this.rotaractorsInvolved,
    this.location,
    this.areaOfFocusName,
    this.categoryName,
    this.subCategoryName,
    this.fundingName,
    this.isJointProject,
    this.coHostName,
    this.clubRole,
    this.approvalStatus = 'pending',
    this.approvalRemark,
    this.approvalDate,
    this.createdDate,
    this.adminName,
    this.adminEmail,
    this.adminMobile,
    this.adminPhoto,
  });

  factory _ProjectDetail.fromJson(Map<String, dynamic> j) {
    DateTime? parseDate(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    final rawPhotos = (j['photos'] as List<dynamic>? ?? const []);
    final photoPaths = rawPhotos
        .map((p) {
          if (p is Map<String, dynamic>) return p['imagePath']?.toString() ?? '';
          return p?.toString() ?? '';
        })
        .where((s) => s.isNotEmpty)
        .toList();
    return _ProjectDetail(
      projectId: j['projectId'] as int? ?? 0,
      title: j['title']?.toString() ?? '',
      description: j['description']?.toString(),
      clubName: j['clubName']?.toString(),
      districtNumber: j['districtNumber']?.toString(),
      moduleName: j['moduleName']?.toString(),
      projectType: j['projectType']?.toString(),
      projectDate: parseDate(j['projectDate']),
      projectCost: j['projectCost'] as num?,
      currency: j['currency']?.toString(),
      directBeneficiaries: j['directBeneficiaries'] as int?,
      manHours: j['manHours'] as int?,
      rotariansInvolved: j['rotariansInvolved'] as int?,
      rotaractorsInvolved: j['rotaractorsInvolved'] as int?,
      location: j['location']?.toString(),
      areaOfFocusName: j['areaOfFocusName']?.toString(),
      categoryName: j['categoryName']?.toString(),
      subCategoryName: j['subCategoryName']?.toString(),
      fundingName: j['fundingName']?.toString(),
      isJointProject: j['isJointProject'] as bool?,
      coHostName: j['coHostName']?.toString(),
      clubRole: j['clubRole']?.toString(),
      photos: photoPaths,
      approvalStatus: normalizeApprovalStatus(j['approvalStatus']?.toString()),
      approvalRemark: j['approvalRemark']?.toString(),
      approvalDate: parseDate(j['approvalDate']),
      createdDate: parseDate(j['createdDate']),
      adminName: j['adminName']?.toString(),
      adminEmail: j['adminEmail']?.toString(),
      adminMobile: j['adminMobile']?.toString(),
      adminPhoto: j['adminPhoto']?.toString(),
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
            width: 110,
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
