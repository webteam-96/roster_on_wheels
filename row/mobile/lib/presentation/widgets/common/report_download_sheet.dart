import 'package:flutter/material.dart';

import '../../../core/services/report_xlsx_export.dart';
import '../../../core/theme/app_colors.dart';

/// Bottom sheet that lists every non-empty report section with a per-section
/// download, plus a "Full Report" option. Mirrors the web report pages where
/// each section has its own Download button (here they're all in one sheet,
/// and a single XLSX can bundle every section as separate worksheets).
class ReportDownloadSheet extends StatefulWidget {
  final String title;
  final List<ReportSheet> sections;
  final Future<void> Function() onExportAll;
  final Future<void> Function(ReportSheet section) onExportOne;

  const ReportDownloadSheet({
    super.key,
    required this.title,
    required this.sections,
    required this.onExportAll,
    required this.onExportOne,
  });

  @override
  State<ReportDownloadSheet> createState() => _ReportDownloadSheetState();
}

class _ReportDownloadSheetState extends State<ReportDownloadSheet> {
  // null = idle; '*' = exporting all; otherwise the busy section name.
  String? _busy;

  Future<void> _run(String tag, Future<void> Function() action) async {
    if (_busy != null) return;
    setState(() => _busy = tag);
    try {
      await action();
      if (mounted) Navigator.of(context).maybePop();
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _busy != null;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Text(
              widget.title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Exports a styled Excel (.xlsx) file you can share or open.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed:
                  busy ? null : () => _run('*', widget.onExportAll),
              icon: _busy == '*'
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.download_rounded, size: 18),
              label: Text(
                'Full Report (${widget.sections.length} '
                'section${widget.sections.length == 1 ? "" : "s"})',
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Row(children: [
                Expanded(child: Divider()),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Text('or a single section',
                      style: TextStyle(fontSize: 11)),
                ),
                Expanded(child: Divider()),
              ]),
            ),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: widget.sections.length,
                separatorBuilder: (_, __) =>
                    const Divider(height: 1, color: AppColors.border),
                itemBuilder: (_, i) {
                  final s = widget.sections[i];
                  final isBusy = _busy == s.name;
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(s.name,
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      '${s.rows.length} record${s.rows.length == 1 ? "" : "s"}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.textSecondary),
                    ),
                    trailing: isBusy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child:
                                CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download_rounded,
                            color: AppColors.primary),
                    onTap: busy
                        ? null
                        : () => _run(s.name, () => widget.onExportOne(s)),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
