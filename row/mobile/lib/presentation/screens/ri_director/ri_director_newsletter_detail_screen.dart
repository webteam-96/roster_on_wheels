import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _NewsletterDetail {
  final int id;
  final String title;
  final DateTime? publishDateTime;
  final DateTime? expiryDateTime;
  final String attachmentType;
  final String? linkUrl;
  final String? filePath;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String status;

  const _NewsletterDetail({
    required this.id,
    required this.title,
    required this.attachmentType,
    required this.status,
    this.publishDateTime,
    this.expiryDateTime,
    this.linkUrl,
    this.filePath,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
  });

  factory _NewsletterDetail.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    return _NewsletterDetail(
      id: j['id'] as int? ?? 0,
      title: j['title']?.toString() ?? '',
      publishDateTime: parse(j['publishDateTime']),
      expiryDateTime: parse(j['expiryDateTime']),
      attachmentType: j['attachmentType']?.toString() ?? 'link',
      linkUrl: j['linkUrl']?.toString(),
      filePath: j['filePath']?.toString(),
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
      status: j['status']?.toString() ?? 'Unpublished',
    );
  }
}

class RiDirectorNewsletterDetailScreen extends StatefulWidget {
  final int newsletterId;
  const RiDirectorNewsletterDetailScreen({super.key, required this.newsletterId});

  @override
  State<RiDirectorNewsletterDetailScreen> createState() => _RiDirectorNewsletterDetailScreenState();
}

class _RiDirectorNewsletterDetailScreenState extends State<RiDirectorNewsletterDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _NewsletterDetail? _detail;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/newsletters/${widget.newsletterId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _NewsletterDetail.fromJson(resp.data ?? const {});
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
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Newsletter', style: AppTextStyles.h3),
        ]),
        content: Text('Delete "${d.title}"?', style: AppTextStyles.body),
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
      await _api.delete('/api/ri-director/newsletters/${widget.newsletterId}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Newsletter deleted'), backgroundColor: AppColors.success));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Future<void> _openAttachment() async {
    final d = _detail;
    if (d == null) return;
    String? url;
    if (d.attachmentType.toLowerCase() == 'link') {
      url = d.linkUrl;
    } else if ((d.filePath ?? '').isNotEmpty) {
      url = ApiConstants.mediaUrl(d.filePath);
    }
    if (url == null || url.isEmpty) return;
    if (!url.startsWith('http')) url = 'https://$url';
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _showEditWebOnly() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('Editing is currently supported only on the web admin.'),
      duration: Duration(seconds: 3),
    ));
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'Published': return AppColors.success;
      case 'Expired': return AppColors.error;
      case 'Unpublished': return AppColors.warning;
      default: return AppColors.textSecondary;
    }
  }

  String _fmtDT(DateTime? d) {
    if (d == null || d.year <= 1) return '–'; // `0001-01-01` zero date => no value
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    final hh = d.hour.toString().padLeft(2, '0');
    final mi = d.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${d.year}  $hh:$mi';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Newsletter',
        actions: _detail == null
            ? null
            : [
                IconButton(icon: const Icon(Icons.edit_outlined), tooltip: 'Edit', onPressed: _showEditWebOnly),
                IconButton(icon: const Icon(Icons.delete_outline, color: AppColors.error), tooltip: 'Delete', onPressed: _delete),
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

  Widget _buildBody(_NewsletterDetail d) {
    final isLink = d.attachmentType.toLowerCase() == 'link';
    final hasAttachment = (isLink ? (d.linkUrl ?? '').isNotEmpty : (d.filePath ?? '').isNotEmpty);
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Text(d.title, style: AppFonts.display(
            fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary,
          )),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: _statusColor(d.status).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _statusColor(d.status).withValues(alpha: 0.3)),
            ),
            child: Text(d.status, style: AppTextStyles.caption.copyWith(
              color: _statusColor(d.status), fontWeight: FontWeight.w700,
            )),
          ),
          const SizedBox(height: 16),
          if (hasAttachment)
            Container(
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
              ),
              padding: const EdgeInsets.all(16),
              child: InkWell(
                onTap: _openAttachment,
                borderRadius: BorderRadius.circular(10),
                child: Row(children: [
                  Icon(isLink ? Icons.link : Icons.picture_as_pdf_outlined,
                      color: AppColors.primary, size: 28),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isLink ? 'External Link' : 'Attachment',
                          style: AppTextStyles.bodyMedium.copyWith(color: AppColors.primary),
                        ),
                        Text(
                          isLink ? (d.linkUrl ?? '') : (d.filePath?.split('/').last ?? ''),
                          style: AppTextStyles.caption.copyWith(color: AppColors.primary),
                          maxLines: 1, overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.open_in_new, color: AppColors.primary, size: 20),
                ]),
              ),
            ),
          const SizedBox(height: 14),
          _SectionCard(
            title: 'Schedule',
            child: Column(children: [
              _DetailRow(label: 'Publish', value: _fmtDT(d.publishDateTime)),
              _DetailRow(label: 'Expires', value: _fmtDT(d.expiryDateTime)),
            ]),
          ),
          const SizedBox(height: 12),
          _SectionCard(
            title: 'Delivery',
            child: Column(children: [
              _ToggleRow(label: 'Send through Email', value: d.isSendEmail),
              _ToggleRow(label: 'Repeat Notification', value: d.isRepeatNotification),
            ]),
          ),
          const SizedBox(height: 24),
        ],
      ),
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
        SizedBox(width: 90,
          child: Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary))),
        Expanded(child: Text(value, style: AppTextStyles.body)),
      ]),
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
      child: Row(children: [
        Expanded(child: Text(label, style: AppTextStyles.body)),
        Icon(value ? Icons.check_circle : Icons.cancel_outlined,
            size: 18, color: value ? AppColors.success : AppColors.textMuted),
        const SizedBox(width: 6),
        Text(value ? 'On' : 'Off', style: AppTextStyles.caption.copyWith(
          color: value ? AppColors.success : AppColors.textMuted,
          fontWeight: FontWeight.w600,
        )),
      ]),
    );
  }
}
