import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _AnnouncementDetail {
  final int id;
  final String title;
  final String? description;
  final String? imagePath;
  final DateTime? publishDateTime;
  final DateTime? expiryDateTime;
  final bool isDisplayOnBanner;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String status;
  final List<DateTime> reminders;

  const _AnnouncementDetail({
    required this.id,
    required this.title,
    required this.status,
    required this.reminders,
    this.description,
    this.imagePath,
    this.publishDateTime,
    this.expiryDateTime,
    this.isDisplayOnBanner = false,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
  });

  factory _AnnouncementDetail.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    final rawReminders = (j['reminders'] as List<dynamic>? ?? const []);
    final reminders = rawReminders
        .map((r) {
          if (r is Map<String, dynamic>) return parse(r['reminderDateTime']);
          return parse(r);
        })
        .whereType<DateTime>()
        .toList();
    return _AnnouncementDetail(
      id: j['id'] as int? ?? 0,
      title: j['title']?.toString() ?? '',
      description: j['description']?.toString(),
      imagePath: j['imagePath']?.toString(),
      publishDateTime: parse(j['publishDateTime']),
      expiryDateTime: parse(j['expiryDateTime']),
      isDisplayOnBanner: j['isDisplayOnBanner'] as bool? ?? false,
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
      status: j['status']?.toString() ?? 'Unpublished',
      reminders: reminders,
    );
  }
}

class RiDirectorAnnouncementDetailScreen extends StatefulWidget {
  final int announcementId;
  const RiDirectorAnnouncementDetailScreen({super.key, required this.announcementId});

  @override
  State<RiDirectorAnnouncementDetailScreen> createState() =>
      _RiDirectorAnnouncementDetailScreenState();
}

class _RiDirectorAnnouncementDetailScreenState
    extends State<RiDirectorAnnouncementDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _AnnouncementDetail? _detail;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/announcements/${widget.announcementId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _AnnouncementDetail.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _delete() async {
    final d = _detail;
    if (d == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.error),
            const SizedBox(width: 8),
            Text('Delete Announcement', style: AppTextStyles.h3),
          ],
        ),
        content: Text(
          'Are you sure you want to delete "${d.title}"?',
          style: AppTextStyles.body,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: Colors.white,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() => _deleting = true);
    try {
      await _api.delete('/api/ri-director/announcements/${widget.announcementId}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Announcement deleted'), backgroundColor: AppColors.success),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _deleting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _openEdit() async {
    final changed = await context.push<bool>(
      RouteNames.riDirectorAnnouncementEdit(widget.announcementId),
    );
    if (changed == true) _load();
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'Published': return AppColors.success;
      case 'Expired': return AppColors.error;
      case 'Unpublished': return AppColors.warning;
      default: return AppColors.textSecondary;
    }
  }

  String _formatDT(DateTime? d) {
    if (d == null || d.year <= 1) return '–'; // `0001-01-01` zero date => no value
    final l = d.isUtc ? d.toLocal() : d;
    final dd = l.day.toString().padLeft(2, '0');
    final mm = l.month.toString().padLeft(2, '0');
    final ampm = l.hour >= 12 ? 'PM' : 'AM';
    var h12 = l.hour % 12;
    if (h12 == 0) h12 = 12;
    final hh = h12.toString().padLeft(2, '0');
    final mi = l.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${l.year}  $hh:$mi $ampm';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Announcement',
        actions: _detail == null
            ? null
            : [
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  tooltip: 'Edit',
                  onPressed: _openEdit,
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: AppColors.error),
                  tooltip: 'Delete',
                  onPressed: _deleting ? null : _delete,
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

  Widget _buildBody(_AnnouncementDetail d) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              d.title,
              style: AppFonts.display(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: _statusColor(d.status).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _statusColor(d.status).withValues(alpha: 0.3)),
              ),
              child: Text(
                d.status,
                style: AppTextStyles.caption.copyWith(
                  color: _statusColor(d.status),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (d.imagePath != null && d.imagePath!.isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: CachedNetworkImage(
                  imageUrl: ApiConstants.mediaUrl(d.imagePath),
                  width: double.infinity,
                  fit: BoxFit.cover,
                  placeholder: (_, __) => Container(
                    height: 180,
                    color: AppColors.primaryLight,
                    child: const Center(
                      child: const CircularProgressIndicator(color: AppColors.primary, strokeWidth: 2),
                    ),
                  ),
                  errorWidget: (_, __, ___) => Container(
                    height: 180,
                    color: AppColors.surface,
                    alignment: Alignment.center,
                    child: const Icon(Icons.broken_image_outlined, color: AppColors.textMuted),
                  ),
                ),
              ),
              const SizedBox(height: 14),
            ],
            _SectionCard(
              title: 'Schedule',
              child: Column(
                children: [
                  _DetailRow(label: 'Publish', value: _formatDT(d.publishDateTime)),
                  _DetailRow(label: 'Expires', value: _formatDT(d.expiryDateTime)),
                ],
              ),
            ),
            if ((d.description ?? '').isNotEmpty) ...[
              const SizedBox(height: 12),
              _SectionCard(
                title: 'Description',
                child: Text(d.description!, style: AppTextStyles.body),
              ),
            ],
            const SizedBox(height: 12),
            _SectionCard(
              title: 'Delivery',
              child: Column(
                children: [
                  _ToggleRow(label: 'Display on Banner', value: d.isDisplayOnBanner),
                  _ToggleRow(label: 'Send through Email', value: d.isSendEmail),
                  _ToggleRow(label: 'Repeat Notification', value: d.isRepeatNotification),
                ],
              ),
            ),
            if (d.isRepeatNotification && d.reminders.isNotEmpty) ...[
              const SizedBox(height: 12),
              _SectionCard(
                title: 'Reminders (${d.reminders.length})',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final r in d.reminders)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            const Icon(Icons.notifications_active_outlined, size: 14, color: AppColors.primary),
                            const SizedBox(width: 6),
                            Text(_formatDT(r), style: AppTextStyles.body),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
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
  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
            child: Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          ),
          Expanded(child: Text(value, style: AppTextStyles.body)),
        ],
      ),
    );
  }
}

class _ToggleRow extends StatelessWidget {
  final String label;
  final bool value;
  const _ToggleRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppTextStyles.body)),
          Icon(
            value ? Icons.check_circle : Icons.cancel_outlined,
            size: 18,
            color: value ? AppColors.success : AppColors.textMuted,
          ),
          const SizedBox(width: 6),
          Text(
            value ? 'On' : 'Off',
            style: AppTextStyles.caption.copyWith(
              color: value ? AppColors.success : AppColors.textMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
