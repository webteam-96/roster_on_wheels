import 'package:flutter/material.dart' hide Text;
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import '../../../core/features/feature_controller.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'ag_report_configs.dart';
import 'ag_report_xlsx.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class _MyClub {
  final int clubId;
  final String clubName;
  final String? districtNumber;
  const _MyClub({required this.clubId, required this.clubName, this.districtNumber});
  factory _MyClub.fromJson(Map<String, dynamic> j) => _MyClub(
        clubId: j['clubId'] as int? ?? 0,
        clubName: j['clubName']?.toString() ?? '',
        districtNumber: j['districtNumber']?.toString(),
      );
}

class _RotaryYear {
  final int id;
  final String label;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.label, required this.isCurrent});
  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: j['id'] as int? ?? 0,
        label: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: j['isCurrent'] as bool? ?? false,
      );
}

/// AG "My Reports" — download centre for the clubs this AG manages.
///
/// Presentation mirrors the district-admin report module
/// (`DistrictReportsScreen`): a Club filter, then grouped white panels (My Clubs
/// / Members / Activity) of report rows — each just a title + a Download (Excel)
/// pill. Year-scoped reports use the AG's current Rotary year (no picker — the AG
/// works within a single year). Backed by the AG report API (`/api/ag/reports/*`),
/// already scoped to the AG's own clubs.
class AgReportsScreen extends StatefulWidget {
  /// When true, render body-only (no Scaffold/AppBar) for embedding as a tab in
  /// the AG dashboard shell. When false, it's the standalone `/ag-reports` route.
  final bool embedded;
  const AgReportsScreen({super.key, this.embedded = false});

  @override
  State<AgReportsScreen> createState() => _AgReportsScreenState();
}

class _AgReportsScreenState extends State<AgReportsScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_MyClub> _clubs = const [];
  List<_RotaryYear> _years = const [];
  int? _yearId; // the AG's current Rotary year (year-scoped reports); no picker
  int? _clubId; // null = "All My Clubs"
  String? _busyId;

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
      final clubsResp = _api.get<List<dynamic>>(
        '/api/ag/reports/my-clubs',
        fromJson: (j) => j as List<dynamic>,
      );
      // Only the rotary years this AG actually holds an assignment for (data-driven
      // filter), instead of every rotary year. Mirrors the web AG year dropdown.
      final yearsResp = _api.get<List<dynamic>>(
        '/api/ag/reports/my-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final results = await Future.wait([clubsResp, yearsResp]);
      if (!mounted) return;
      final years = (results[1].data ?? const [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      // No year picker — year-scoped reports use the AG's current year (or the
      // only/first year they hold).
      final current = years.where((y) => y.isCurrent);
      final defaultYearId = current.isNotEmpty
          ? current.first.id
          : (years.isNotEmpty ? years.first.id : null);
      setState(() {
        _clubs = (results[0].data ?? const [])
            .map((e) => _MyClub.fromJson(e as Map<String, dynamic>))
            .toList();
        _years = years;
        _yearId = defaultYearId;
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

  Future<void> _download(AgReportConfig item) async {
    setState(() => _busyId = item.id);
    try {
      final params = <String, String>{};
      if (item.yearScoped && _yearId != null) {
        params['yearId'] = _yearId.toString();
      }
      if (_clubId != null) {
        params['clubId'] = _clubId.toString();
      }
      final resp = await _api.get<List<dynamic>>(
        '/api/ag/reports/${item.id}',
        queryParams: params.isEmpty ? null : params,
        fromJson: (j) => j as List<dynamic>,
      );
      final raw = resp.data ?? const [];
      final rows = raw
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (rows.isEmpty) {
        _showSnack('${item.title}: no records found.', isError: true);
        return;
      }

      final yearLabel = item.yearScoped && _yearId != null
          ? _years.firstWhere(
                  (y) => y.id == _yearId,
                  orElse: () => const _RotaryYear(id: 0, label: '', isCurrent: false))
              .label
              .replaceAll('/', '-')
          : null;
      final club = _clubId == null
          ? null
          : _clubs.firstWhere(
              (c) => c.clubId == _clubId,
              orElse: () => const _MyClub(clubId: 0, clubName: ''),
            );
      final suffixParts = <String>[
        if (yearLabel != null && yearLabel.isNotEmpty) yearLabel,
        if (club != null && club.clubName.isNotEmpty) club.clubName,
      ];
      final suffix = suffixParts.isEmpty ? '' : '_${suffixParts.join('_')}';
      final subtitleParts = <String>[
        if (yearLabel != null && yearLabel.isNotEmpty) 'Year: $yearLabel',
        if (club != null && club.clubName.isNotEmpty) 'Club: ${club.clubName}',
      ];

      final result = await exportAgReportToXlsx(
        config: item,
        rows: rows,
        subtitle: subtitleParts.isEmpty ? null : subtitleParts.join(' · '),
        fileNameSuffix: suffix,
      );

      if (!mounted) return;
      await _showShareSheet(result, item.title);
    } catch (e) {
      _showSnack('Failed to download ${item.title}: $e', isError: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _showShareSheet(
      AgReportExportResult result, String title) async {
    // iOS requires a non-zero source rect for the share popover, otherwise
    // shareXFiles throws PlatformException with "sharePositionOrigin
    // argument must be set". Derive it from the screen's render box.
    final box = context.findRenderObject() as RenderBox?;
    final origin = (box != null && box.hasSize)
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 1, 1);
    await Share.shareXFiles(
      [
        XFile(
          result.file.path,
          mimeType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ],
      subject: title,
      text:
          '$title: ${result.rowCount} record${result.rowCount == 1 ? "" : "s"}',
      sharePositionOrigin: origin,
    );
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        backgroundColor: AppColors.primary,
        content: Text(
          '$title saved (${result.rowCount} rows).',
          style: const TextStyle(color: Colors.white),
        ),
        action: SnackBarAction(
          label: 'OPEN',
          textColor: Colors.white,
          onPressed: () => OpenFilex.open(result.file.path),
        ),
        duration: const Duration(seconds: 6),
      ),
    );
  }

  void _showSnack(String msg, {bool isError = false}) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        backgroundColor: isError ? AppColors.error : AppColors.primary,
        content: Text(msg, style: const TextStyle(color: Colors.white)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isAG) {
      final denied = Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.block, size: 48, color: AppColors.error),
              const SizedBox(height: 12),
              Text('Access Denied', style: AppTextStyles.h3),
              const SizedBox(height: 4),
              Text(
                'Only AG (Assistant Governor) can access this page.',
                textAlign: TextAlign.center,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      );
      if (widget.embedded) return denied;
      return Scaffold(
        appBar: const CustomAppBar(title: 'My Reports'),
        body: denied,
      );
    }
    final body = RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: _buildBody(),
    );
    if (widget.embedded) {
      return Container(color: AppColors.background, child: body);
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My Reports'),
      body: body,
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.error.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.error.withValues(alpha: 0.25)),
            ),
            child: Row(children: [
              const Icon(Icons.error_outline, color: AppColors.error),
              const SizedBox(width: 10),
              Expanded(
                child: Text('Failed to load: $_error',
                    style: AppTextStyles.caption),
              ),
            ]),
          ),
        ],
      );
    }
    if (_clubs.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                const Icon(Icons.info_outline, size: 36, color: AppColors.warning),
                const SizedBox(height: 10),
                Text(
                  'You have not been assigned any clubs yet. Please contact your district governor.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.body
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        _clubBar(),
        for (final section in kAgReportSections) ...[
          _groupHeader(section.title),
          // ROW module switches (FeatureController): no report for a skipped or switched-off module
          _groupPanel(section.items.where((r) => !context.watch<FeatureController>().isPathOff('/${r.id}')).toList()),
        ],
      ],
    );
  }

  /// Club filter bar — standard bordered-surface look.
  Widget _clubBar() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            const Icon(Icons.business_outlined,
                size: 15, color: AppColors.textSecondary),
            const SizedBox(width: 8),
            Text(
              'Club',
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: DropdownButton<int?>(
                value: _clubId,
                isExpanded: true,
                alignment: Alignment.centerRight,
                underline: const SizedBox.shrink(),
                isDense: true,
                borderRadius: BorderRadius.circular(12),
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
                onChanged: (v) => setState(() => _clubId = v),
                items: [
                  DropdownMenuItem<int?>(
                    value: null,
                    child: Text('All My Clubs (${_clubs.length})',
                        textAlign: TextAlign.right,
                        overflow: TextOverflow.ellipsis),
                  ),
                  for (final c in _clubs)
                    DropdownMenuItem<int?>(
                      value: c.clubId,
                      child: Text(
                        c.districtNumber != null
                            ? '${c.clubName} (D${c.districtNumber})'
                            : c.clubName,
                        textAlign: TextAlign.right,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _groupHeader(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
      child: Text(
        text.toUpperCase(),
        style: AppFonts.body(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
          color: AppColors.textMuted,
        ),
      ),
    );
  }

  /// One white rounded panel of divider-separated report rows — the district
  /// report-module look. Each row is just a title + a Download button.
  Widget _groupPanel(List<AgReportConfig> items) {
    final children = <Widget>[];
    for (var i = 0; i < items.length; i++) {
      if (i > 0) {
        children.add(const Divider(
          height: 1,
          thickness: 1,
          indent: 14,
          endIndent: 14,
          color: AppColors.border,
        ));
      }
      final item = items[i];
      final busy = _busyId == item.id;
      final disabled = _busyId != null && !busy;
      children.add(_ReportRow(
        item: item,
        busy: busy,
        onDownload: disabled ? null : () => _download(item),
      ));
    }
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    );
  }
}

/// A single report row — icon + title + a trailing Download pill. No expand /
/// on-screen table (download only).
class _ReportRow extends StatelessWidget {
  final AgReportConfig item;
  final bool busy;
  final VoidCallback? onDownload;
  const _ReportRow({
    required this.item,
    required this.busy,
    required this.onDownload,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.slate400.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(item.icon, color: AppColors.slate500, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              item.title,
              style: AppFonts.body(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                height: 1.25,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          _DownloadPill(busy: busy, onTap: onDownload),
        ],
      ),
    );
  }
}

/// Outlined "Download" pill used as a report-row trailing — matches the district
/// report module. Shows a spinner while its own export runs; greyed + disabled
/// while another row is downloading.
class _DownloadPill extends StatelessWidget {
  final VoidCallback? onTap;
  final bool busy;
  const _DownloadPill({required this.onTap, this.busy = false});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;
    final color = enabled ? AppColors.textSecondary : AppColors.slate400;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: enabled
                  ? AppColors.border
                  : AppColors.border.withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                const SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Icon(Icons.download_rounded, size: 15, color: color),
              const SizedBox(width: 5),
              Text(
                'Download',
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
