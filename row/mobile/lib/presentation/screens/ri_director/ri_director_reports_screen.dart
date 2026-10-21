import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/file_download_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _ReportKind {
  final String kind;
  final String title;
  final String description;
  final IconData icon;
  final Color color;
  const _ReportKind({
    required this.kind,
    required this.title,
    required this.description,
    required this.icon,
    required this.color,
  });
}

const _reports = [
  _ReportKind(
    kind: 'zones',
    title: 'Zones Summary',
    description: 'All zones with district, club, and member counts',
    icon: Icons.public,
    color: AppColors.accentBlue,
  ),
  _ReportKind(
    kind: 'districts',
    title: 'Districts Summary',
    description: 'All districts with zone, club, and member counts',
    icon: Icons.location_on_outlined,
    color: AppColors.success,
  ),
  _ReportKind(
    kind: 'clubs',
    title: 'Clubs Master',
    description: 'Nationwide club list with district, zone, city, members',
    icon: Icons.business_outlined,
    color: AppColors.goldDark,
  ),
  _ReportKind(
    kind: 'members',
    title: 'Members Master',
    description: 'All members with club / district / zone + contact info',
    icon: Icons.people_outline,
    color: AppColors.error,
  ),
  _ReportKind(
    kind: 'communications',
    title: 'Communications Log',
    description: 'All RI announcements, events, emails, newsletters',
    icon: Icons.forum_outlined,
    color: AppColors.accentBlue,
  ),
];

class RiDirectorReportsScreen extends StatefulWidget {
  const RiDirectorReportsScreen({super.key});

  @override
  State<RiDirectorReportsScreen> createState() =>
      _RiDirectorReportsScreenState();
}

class _RiDirectorReportsScreenState extends State<RiDirectorReportsScreen> {
  final _api = ApiClient();
  String? _downloadingKind;

  String _isoToday() {
    final now = DateTime.now();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${now.year}-${two(now.month)}-${two(now.day)}';
  }

  Future<void> _download(_ReportKind r) async {
    if (_downloadingKind != null) return;
    setState(() => _downloadingKind = r.kind);
    try {
      final bytes = await _api.downloadBytes(
        '/api/ri-director/reports/${r.kind}',
      );
      await saveAndOpenBytes(bytes, 'ri_${r.kind}_${_isoToday()}.xlsx');
    } catch (e) {
      if (!mounted) return;
      final msg = e is ApiException ? e.message : 'Could not download report';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${r.title}: $msg')),
      );
    } finally {
      if (mounted) setState(() => _downloadingKind = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Reports'),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(12),
              border:
                  Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
            ),
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              const Icon(Icons.info_outline, color: AppColors.primary, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Tap a report to download the Excel file.',
                  style:
                      AppTextStyles.caption.copyWith(color: AppColors.primary),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          for (final r in _reports)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _ReportCard(
                report: r,
                isDownloading: _downloadingKind == r.kind,
                disabled:
                    _downloadingKind != null && _downloadingKind != r.kind,
                onTap: () => _download(r),
              ),
            ),
        ],
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  final _ReportKind report;
  final bool isDownloading;
  final bool disabled;
  final VoidCallback onTap;
  const _ReportCard({
    required this.report,
    required this.isDownloading,
    required this.disabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        onTap: (isDownloading || disabled) ? null : onTap,
        borderRadius: BorderRadius.circular(12),
        child: Opacity(
          opacity: disabled ? 0.5 : 1.0,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: report.color,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(report.icon, color: Colors.white, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      report.title,
                      style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(report.description, style: AppTextStyles.caption),
                  ],
                ),
              ),
              if (isDownloading)
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                )
              else
                const Icon(Icons.file_download_outlined,
                    color: AppColors.textSecondary, size: 22),
            ]),
          ),
        ),
      ),
    );
  }
}
