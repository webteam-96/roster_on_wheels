import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../ag_reports/ag_report_configs.dart';
import '../../../ag_reports/ag_report_xlsx.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class LiveDocumentsScreen extends StatefulWidget {
  final int clubId;
  final int? initialYearId;
  const LiveDocumentsScreen({super.key, required this.clubId, this.initialYearId});

  @override
  State<LiveDocumentsScreen> createState() => _LiveDocumentsScreenState();
}

class _LiveDocumentsScreenState extends State<LiveDocumentsScreen> {
  final ApiClient _api = ApiClient();
  String _clubName = '';
  List<_RotaryYear> _years = const [];
  int? _selectedYearId;
  bool _loading = true;
  String? _error;
  String? _busyModuleKey;

  bool get _isClubAdmin =>
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  void initState() {
    super.initState();
    if (!_isClubAdmin) {
      _loading = false;
      return;
    }
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        _fetchClubName(),
        _fetchYears(),
      ]);
      final name = results[0] as String;
      final years = results[1] as List<_RotaryYear>;
      int? initial = widget.initialYearId;
      if (initial == null) {
        final current = years.firstWhere(
          (y) => y.isCurrent,
          orElse: () => years.isEmpty ? const _RotaryYear(id: 0, yearLabel: '') : years.first,
        );
        initial = current.id == 0 ? null : current.id;
      }
      if (!mounted) return;
      setState(() {
        _clubName = name;
        _years = years;
        _selectedYearId = initial;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<String> _fetchClubName() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      return (resp.data?['clubName'] ?? '').toString();
    } catch (_) {
      return '';
    }
  }

  Future<List<_RotaryYear>> _fetchYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/monthly-reports/years',
        fromJson: (j) => j as List<dynamic>,
      );
      return (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  Future<void> _download(_LiveDocsModule mod) async {
    final yid = _selectedYearId;
    if (yid == null) {
      _showSnack('Please select a Rotary Year.', isError: true);
      return;
    }
    setState(() => _busyModuleKey = mod.key);
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/live-documents/export',
        queryParams: {'yearId': yid, 'module': mod.key},
        fromJson: (j) => j as List<dynamic>,
      );
      final rows = (resp.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();
      if (rows.isEmpty) {
        _showSnack('No data found for ${mod.label}.', isError: true);
        return;
      }
      final yearLabel = _years.firstWhere(
        (y) => y.id == yid,
        orElse: () => const _RotaryYear(id: 0, yearLabel: ''),
      ).yearLabel;
      final subtitleParts = <String>[
        if (_clubName.isNotEmpty) _clubName,
        if (yearLabel.isNotEmpty) 'Rotary Year: $yearLabel',
      ];
      final result = await exportAgReportToXlsx(
        config: AgReportConfig(
          id: mod.key,
          title: '${mod.label}: $_clubName',
          fileName: '${_clubName.replaceAll(RegExp(r'\s+'), '_')}_${mod.label.replaceAll(RegExp(r'\s+'), '_')}',
          icon: Icons.description_outlined,
          color: AppColors.primary,
          columns: mod.columns,
        ),
        rows: rows,
        subtitle: subtitleParts.isEmpty ? null : subtitleParts.join(' · '),
        fileNameSuffix: yearLabel.isEmpty ? '' : '_${yearLabel.replaceAll('/', '-')}',
      );
      if (!mounted) return;
      await _showShareSheet(result, mod.label);
    } catch (e) {
      _showSnack('Failed to download ${mod.label}: $e', isError: true);
    } finally {
      if (mounted) setState(() => _busyModuleKey = null);
    }
  }

  Future<void> _showShareSheet(AgReportExportResult result, String title) async {
    final box = context.findRenderObject() as RenderBox?;
    final origin = (box != null && box.hasSize)
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 1, 1);
    await Share.shareXFiles(
      [
        XFile(
          result.file.path,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ],
      subject: title,
      text: '$title: ${result.rowCount} record${result.rowCount == 1 ? "" : "s"}',
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
    if (!_isClubAdmin) {
      return const Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: CustomAppBar(title: 'Live Documents'),
        body: EmptyStateWidget(
          icon: Icons.lock_outline,
          title: 'Admin Only',
          subtitle:
              'Live Documents are managed by club and district admins. Members do not have access to these reports.',
        ),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: const CustomAppBar(title: 'Live Documents'),
      body: _loading
          ? const Center(child: LoadingWidget())
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _bootstrap)
              : _buildBody(),
    );
  }

  Widget _buildBody() {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _bootstrap,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        children: [
          _buildHeader(),
          const SizedBox(height: 12),
          _buildYearSelector(),
          const SizedBox(height: 16),
          _buildSection(
            title: 'OCV/GOV Documents',
            icon: Icons.folder_open_rounded,
            modules: _ocvModules,
          ),
          const SizedBox(height: 16),
          _buildSection(
            title: 'Club Modules',
            icon: Icons.people_alt_rounded,
            modules: _clubModules,
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_download_outlined, color: AppColors.primary, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _clubName.isEmpty ? 'Live Documents' : _clubName,
                  style: AppFonts.body(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    color: AppColors.textPrimary,
                  ),
                ),
                Text(
                  'Download Excel reports module-wise',
                  style: AppFonts.body(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildYearSelector() {
    if (_years.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Text(
          'No Rotary years available.',
          style: AppFonts.body(fontSize: 13, color: AppColors.textSecondary),
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.calendar_today_outlined, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Text('Year:',
              style: AppFonts.body(fontSize: 13, color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<int>(
                value: _selectedYearId,
                isExpanded: true,
                items: _years
                    .map((y) => DropdownMenuItem<int>(
                          value: y.id,
                          child: Text(
                            y.isCurrent ? '${y.yearLabel} (Current)' : y.yearLabel,
                            style: AppFonts.body(fontSize: 13),
                          ),
                        ))
                    .toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _selectedYearId = v);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required IconData icon,
    required List<_LiveDocsModule> modules,
  }) {
    final yearLabel = _years.firstWhere(
      (y) => y.id == _selectedYearId,
      orElse: () => const _RotaryYear(id: 0, yearLabel: ''),
    ).yearLabel;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Row(
              children: [
                Icon(icon, size: 18, color: AppColors.primary),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: AppFonts.body(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    color: AppColors.textPrimary,
                  ),
                ),
                const Spacer(),
                if (yearLabel.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      yearLabel,
                      style: AppFonts.body(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          for (var i = 0; i < modules.length; i++) ...[
            _moduleRow(modules[i]),
            if (i < modules.length - 1) const Divider(height: 1, indent: 14, endIndent: 14),
          ],
        ],
      ),
    );
  }

  Widget _moduleRow(_LiveDocsModule mod) {
    final busy = _busyModuleKey == mod.key;
    final disabled = _selectedYearId == null || (_busyModuleKey != null && !busy);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      leading: const Icon(Icons.description_outlined, color: Colors.green, size: 22),
      title: Text(
        mod.label,
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
      ),
      trailing: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                visualDensity: VisualDensity.compact,
                side: const BorderSide(color: AppColors.border),
              ),
              onPressed: disabled ? null : () => _download(mod),
              icon: const Icon(Icons.download_rounded, size: 16),
              label: Text(
                'Download',
                style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
    );
  }
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: j['isCurrent'] == true,
      );
}

class _LiveDocsModule {
  final String key;
  final String label;
  final List<AgReportColumn> columns;
  const _LiveDocsModule(this.key, this.label, this.columns);
}

const List<_LiveDocsModule> _ocvModules = [
  _LiveDocsModule('static_documents', 'Static Documents', [
    AgReportColumn('documentType', 'Document Type', width: 25),
    AgReportColumn('fileName', 'File Name', width: 30),
    AgReportColumn('amount', 'Amount', width: 12),
    AgReportColumn('paidOn', 'Paid On', width: 15),
    AgReportColumn('customType', 'Custom Type', width: 20),
    AgReportColumn('uploadDate', 'Upload Date', width: 18),
  ]),
  _LiveDocsModule('financial_documents', 'Financial Documents', [
    AgReportColumn('documentType', 'Document Type', width: 25),
    AgReportColumn('fileName', 'File Name', width: 30),
    AgReportColumn('amount', 'Amount', width: 12),
    AgReportColumn('paidOn', 'Paid On', width: 15),
    AgReportColumn('uploadDate', 'Upload Date', width: 18),
  ]),
  _LiveDocsModule('trust_documents', 'Trust Documents', [
    AgReportColumn('documentType', 'Document Type', width: 25),
    AgReportColumn('fileName', 'File Name', width: 30),
    AgReportColumn('uploadDate', 'Upload Date', width: 18),
  ]),
  _LiveDocsModule('grants', 'Grants', [
    AgReportColumn('documentType', 'Document Type', width: 25),
    AgReportColumn('fileName', 'File Name', width: 30),
    AgReportColumn('amount', 'Amount', width: 12),
    AgReportColumn('uploadDate', 'Upload Date', width: 18),
  ]),
  _LiveDocsModule('additional_documents', 'Additional Documents', [
    AgReportColumn('documentType', 'Document Type', width: 25),
    AgReportColumn('fileName', 'File Name', width: 30),
    AgReportColumn('uploadDate', 'Upload Date', width: 18),
  ]),
  _LiveDocsModule('dues', 'Dues', [
    AgReportColumn('documentType', 'Document Type', width: 25),
    AgReportColumn('fileName', 'File Name', width: 30),
    AgReportColumn('amount', 'Amount', width: 12),
    AgReportColumn('paidOn', 'Paid On', width: 15),
    AgReportColumn('uploadDate', 'Upload Date', width: 18),
  ]),
];

const List<_LiveDocsModule> _clubModules = [
  _LiveDocsModule('community_service', 'Community Service Projects', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('projectDate', 'Date', width: 15),
    AgReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    AgReportColumn('category', 'Category', width: 18),
    AgReportColumn('subCategory', 'Sub Category', width: 18),
    AgReportColumn('location', 'Location', width: 20),
    AgReportColumn('projectCost', 'Cost', width: 12),
    AgReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    AgReportColumn('manHours', 'Man Hours', width: 12),
    AgReportColumn('funding', 'Funding', width: 15),
    AgReportColumn('approvalStatus', 'Status', width: 12),
  ]),
  _LiveDocsModule('vocational_service', 'Vocational Service', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('projectDate', 'Date', width: 15),
    AgReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    AgReportColumn('category', 'Category', width: 18),
    AgReportColumn('location', 'Location', width: 20),
    AgReportColumn('projectCost', 'Cost', width: 12),
    AgReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    AgReportColumn('manHours', 'Man Hours', width: 12),
  ]),
  _LiveDocsModule('international_service', 'International Service', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('projectDate', 'Date', width: 15),
    AgReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    AgReportColumn('category', 'Category', width: 18),
    AgReportColumn('location', 'Location', width: 20),
    AgReportColumn('projectCost', 'Cost', width: 12),
    AgReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    AgReportColumn('manHours', 'Man Hours', width: 12),
  ]),
  _LiveDocsModule('new_generation_service', 'New Generation Service', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('projectDate', 'Date', width: 15),
    AgReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    AgReportColumn('category', 'Category', width: 18),
    AgReportColumn('location', 'Location', width: 20),
    AgReportColumn('projectCost', 'Cost', width: 12),
    AgReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    AgReportColumn('manHours', 'Man Hours', width: 12),
  ]),
  _LiveDocsModule('public_image_initiative', 'Public Image Initiative', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('projectDate', 'Date', width: 15),
    AgReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    AgReportColumn('category', 'Category', width: 18),
    AgReportColumn('location', 'Location', width: 20),
    AgReportColumn('projectCost', 'Cost', width: 12),
    AgReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    AgReportColumn('manHours', 'Man Hours', width: 12),
  ]),
  _LiveDocsModule('club_service', 'Club Service', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('projectDate', 'Date', width: 15),
    AgReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    AgReportColumn('category', 'Category', width: 18),
    AgReportColumn('location', 'Location', width: 20),
    AgReportColumn('projectCost', 'Cost', width: 12),
    AgReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    AgReportColumn('manHours', 'Man Hours', width: 12),
  ]),
  _LiveDocsModule('announcements', 'Announcements', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('description', 'Description', width: 30),
    AgReportColumn('publishDate', 'Publish Date', width: 18),
    AgReportColumn('expiryDate', 'Expiry Date', width: 18),
    AgReportColumn('status', 'Status', width: 12),
  ]),
  _LiveDocsModule('upcoming_events', 'Upcoming Events', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('eventDate', 'Event Date', width: 18),
    AgReportColumn('eventVenue', 'Venue', width: 20),
    AgReportColumn('publishDate', 'Publish Date', width: 18),
    AgReportColumn('status', 'Status', width: 12),
    AgReportColumn('registrationLink', 'Link', width: 25),
  ]),
  _LiveDocsModule('newsletters', 'Newsletters', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('publishDate', 'Publish Date', width: 18),
    AgReportColumn('expiryDate', 'Expiry Date', width: 18),
    AgReportColumn('attachmentType', 'Type', width: 10),
    AgReportColumn('status', 'Status', width: 12),
  ]),
  _LiveDocsModule('documents', 'Documents', [
    AgReportColumn('title', 'Title', width: 25),
    AgReportColumn('accessType', 'Access Type', width: 15),
    AgReportColumn('publishDate', 'Publish Date', width: 18),
    AgReportColumn('expiryDate', 'Expiry Date', width: 18),
  ]),
  _LiveDocsModule('attendance', 'Attendance', [
    AgReportColumn('eventName', 'Event', width: 25),
    AgReportColumn('eventDateTime', 'Date', width: 18),
    AgReportColumn('membersPresent', 'Members Present', width: 16),
    AgReportColumn('visitors', 'Visitors', width: 10),
    AgReportColumn('rotarians', 'Rotarians', width: 10),
    AgReportColumn('totalMembers', 'Total Active', width: 12),
    AgReportColumn('attendancePercent', 'Attendance %', width: 14),
  ]),
  _LiveDocsModule('board_of_directors', 'Board of Directors', [
    AgReportColumn('designation', 'Designation', width: 25),
    AgReportColumn('memberName', 'Name', width: 25),
    AgReportColumn('mobile', 'Mobile', width: 15),
    AgReportColumn('email', 'Email', width: 25),
  ]),
  _LiveDocsModule('members', 'Members', [
    AgReportColumn('memberName', 'Name', width: 25),
    AgReportColumn('mobile', 'Mobile', width: 15),
    AgReportColumn('email', 'Email', width: 25),
    AgReportColumn('rotaryId', 'Rotary ID', width: 15),
    AgReportColumn('gender', 'Gender', width: 10),
    AgReportColumn('birthDate', 'Birth Date', width: 15),
    AgReportColumn('anniversaryDate', 'Anniversary', width: 15),
    AgReportColumn('bloodGroup', 'Blood Group', width: 12),
    AgReportColumn('joinedDate', 'Joined', width: 15),
    AgReportColumn('isActive', 'Active', width: 8),
  ]),
  _LiveDocsModule('trf_contributions', 'TRF Contributions', [
    AgReportColumn('donorName', 'Donor', width: 25),
    AgReportColumn('fundName', 'Fund Name', width: 20),
    AgReportColumn('fundType', 'Type', width: 15),
    AgReportColumn('amountUsd', 'Amount (USD)', width: 15),
    AgReportColumn('trfDate', 'Date', width: 18),
  ]),
];
