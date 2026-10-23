import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../../core/constants/feature_flags.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/report_xlsx_export.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/report_download_sheet.dart';
import '../../../widgets/common/report_section_table.dart';
import '../../../widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// District report — mobile port of the web district-admin-dashboard report page.
///
/// Backed by `GET /api/districts/{districtId}/district-report?yearId=X`. The
/// screen mirrors the web layout: a grouped list (MEMBERS / CLUBS / DISTRICT)
/// where each section is a row showing its record count + a Download button,
/// and tapping the row expands an on-screen table (same columns as the export).
/// Sections mobile can't build yet (citation matrix, OCV, …)
/// show a "Coming Soon" state, exactly like the web.
class DistrictReportsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictReportsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictReportsScreen> createState() => _DistrictReportsScreenState();
}

class _DistrictReportsScreenState extends State<DistrictReportsScreen> {
  final _api = ApiClient();

  List<_Year> _years = [];
  int? _yearId;
  Map<String, dynamic>? _report;
  bool _loading = true;
  String? _error;
  // True while we pre-fetch the lazy "Avenue Of Service" sheets before opening
  // the download sheet (they live on dedicated endpoints, not the main payload).
  bool _preparingDownload = false;

  @override
  void initState() {
    super.initState();
    _initYears();
  }

  Future<void> _initYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/district-report/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .whereType<Map<String, dynamic>>()
          .map(_Year.fromJson)
          .toList();
      if (!mounted) return;
      final current = list.firstWhere(
        (y) => y.isCurrent,
        orElse: () => list.isNotEmpty ? list.first : const _Year(id: 0, label: ''),
      );
      setState(() {
        _years = list;
        _yearId = current.id != 0 ? current.id : null;
      });
      if (_yearId != null) {
        await _load();
      } else {
        setState(() => _loading = false);
      }
    } catch (_) {
      // Fall back to /api/rotary-years
      if (!mounted) return;
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        final list = (resp.data ?? [])
            .whereType<Map<String, dynamic>>()
            .map(_Year.fromJson)
            .toList();
        if (!mounted) return;
        final current = list.firstWhere(
          (y) => y.isCurrent,
          orElse: () => list.isNotEmpty ? list.first : const _Year(id: 0, label: ''),
        );
        setState(() {
          _years = list;
          _yearId = current.id != 0 ? current.id : null;
        });
        if (_yearId != null) await _load();
        else setState(() => _loading = false);
      } catch (e) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = 'Could not load years. $e';
        });
      }
    }
  }

  Future<void> _load() async {
    if (_yearId == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/district-report',
        queryParams: {'yearId': _yearId},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _report = resp.data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasData = _report != null;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : CustomAppBar(
              title: 'Reports',
              actions: [
                if (hasData)
                  IconButton(
                    tooltip: 'Download full report',
                    icon: _preparingDownload
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download_rounded),
                    onPressed: _preparingDownload ? null : _openDownloadSheet,
                  ),
              ],
            ),
      body: Column(
        children: [
          if (_years.isNotEmpty) _yearBar(),
          if (widget.embedded && hasData) _embeddedDownloadBar(),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _embeddedDownloadBar() {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Align(
        alignment: Alignment.centerRight,
        child: OutlinedButton.icon(
          onPressed: _preparingDownload ? null : _openDownloadSheet,
          icon: _preparingDownload
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.download_rounded, size: 18),
          label: const Text('Download full report'),
        ),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data helpers
  // ─────────────────────────────────────────────────────────────────────────

  List<Map<String, dynamic>> _rows(dynamic v) =>
      (v as List?)
          ?.whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList() ??
      const [];

  /// club- vs district-level split (web filters on clubName == "District Level").
  List<Map<String, dynamic>> _scoped(String key, {required bool district}) {
    return _rows(_report?[key]).where((m) {
      final isDistrict =
          (m['clubName'] ?? '').toString().trim().toLowerCase() == 'district level';
      return district ? isDistrict : !isDistrict;
    }).toList();
  }

  /// Every project flattened across all avenue modules (web "Avenue Of Service
  /// (All Clubs)" is one flat list, not per-module).
  List<Map<String, dynamic>> _allProjects() {
    final pbm =
        (_report?['projectsByModule'] as Map?)?.cast<String, dynamic>() ?? const {};
    final out = <Map<String, dynamic>>[];
    pbm.forEach((_, v) => out.addAll(_rows(v)));
    return out;
  }

  /// Client-side "Avenue Of Service (Club Wise Count)" — project count per club,
  /// excluding Club Service (mirrors the web aggregation).
  List<Map<String, dynamic>> _avenueClubCounts() {
    final counts = <String, int>{};
    final districtNo = <String, String>{};
    for (final p in _allProjects()) {
      if ((p['typeOfProject'] ?? '').toString().toLowerCase().contains('club service')) {
        continue;
      }
      final club = (p['clubName'] ?? '').toString();
      if (club.isEmpty) continue;
      counts[club] = (counts[club] ?? 0) + 1;
      districtNo[club] = (p['districtNumber'] ?? districtNo[club] ?? '').toString();
    }
    final entries = counts.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));
    return [
      for (var i = 0; i < entries.length; i++)
        {
          'srNo': i + 1,
          'districtNumber': districtNo[entries[i].key] ?? '',
          'clubName': entries[i].key,
          'projectCount': entries[i].value,
        },
    ];
  }

  /// Fetch a lazy section's rows then hand them to the Excel exporter.
  Future<void> _exportLazy(_Sec s) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(
      content: Text('Preparing…'),
      duration: Duration(seconds: 30),
    ));
    try {
      final rows = await s.loader!();
      if (!mounted) return;
      if (rows.isEmpty) {
        messenger.clearSnackBars();
        messenger.showSnackBar(
          const SnackBar(content: Text('No data to download for this section.')),
        );
        return;
      }
      await _runExport(
        [ReportSheet(name: s.title, columns: s.cols, rows: rows)],
        '${_exportBaseName()}_${_sanitize(s.file)}',
      );
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AppColors.error,
          content: Text('Download failed: $e',
              style: const TextStyle(color: Colors.white)),
        ),
      );
    }
  }

  // ── District Awards — flatten the citation matrix from the payload. ──

  /// Columns for District Awards (Club Wise): Club Name + one column per
  /// citation question. Null when no citation categories are configured (then
  /// the section stays "Coming Soon").
  List<ReportColumn>? _citationCols() {
    final m = (_report?['districtCitationMatrix'] as Map?)?.cast<String, dynamic>();
    final cols = (m?['columns'] as List?) ?? const [];
    if (cols.isEmpty) return null;
    return [
      const ReportColumn('clubName', 'Club Name', width: 28),
      for (final c in cols)
        if (c is Map)
          ReportColumn(
            '${c['type']}-${c['questionId']}',
            (c['title'] ?? '').toString(),
            width: 18,
          ),
    ];
  }

  /// Rows for District Awards: one per club, cells flattened onto the row.
  List<Map<String, dynamic>> _citationRows() {
    final m = (_report?['districtCitationMatrix'] as Map?)?.cast<String, dynamic>();
    final rows = (m?['rows'] as List?) ?? const [];
    return [
      for (final r in rows)
        if (r is Map)
          {
            'clubName': r['clubName'],
            ...?(r['cells'] as Map?)
                ?.map((k, v) => MapEntry(k.toString(), v)),
          },
    ];
  }

  static const _cmrProjectCols = [
    ReportColumn('clubName', 'Club', width: 24),
    ReportColumn('moduleName', 'Avenue', width: 18),
    ReportColumn('title', 'Title', width: 28),
    ReportColumn('projectDate', 'Date', width: 15),
    ReportColumn('projectCost', 'Cost', width: 14),
    ReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    ReportColumn('manHours', 'Man Hours', width: 12),
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Column definitions — shared by the on-screen tables + the Excel export,
  // field-for-field with the web district report.
  // ─────────────────────────────────────────────────────────────────────────

  static const _bodCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('designation', 'Designation', width: 25),
    ReportColumn('memberName', 'Member Name', width: 25),
    ReportColumn('email', 'Email ID', width: 25),
    ReportColumn('mobile', 'Mobile Number', width: 16),
    ReportColumn('autoManual', 'Auto/Manual', width: 14),
  ];
  static const _memberCols = [
    ReportColumn('clubName', 'Club Name', width: 22),
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('profilePhoto', 'Profile Photo', width: 14, hyperlink: true),
    ReportColumn('classification', 'Classification', width: 20),
    ReportColumn('clubDesignation', 'Club Designation', width: 20),
    ReportColumn('country', 'Country', width: 14),
    ReportColumn('mobile', 'Mobile', width: 16),
    ReportColumn('email', 'Email ID', width: 26),
    ReportColumn('gender', 'Gender', width: 12),
    ReportColumn('primaryLanguage', 'Primary Language', width: 16),
    ReportColumn('youthFlag', 'Youth Flag', width: 12),
    ReportColumn('dob', 'DOB', width: 12),
    ReportColumn('doa', 'DOA', width: 12),
    ReportColumn('bloodGroup', 'Blood Group', width: 12),
    ReportColumn('deviceName', 'Device Name', width: 18),
    ReportColumn('downloaded', 'Downloaded', width: 12),
    ReportColumn('address', 'Residence Address', width: 32),
    ReportColumn('rotaryId', 'Rotary ID', width: 14),
    ReportColumn('riAdmissionDate', 'Joining Date', width: 16),
  ];
  static const _appUserCols = [
    ReportColumn('clubName', 'Club Name', width: 24),
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('mobile', 'Mobile Number', width: 16),
    ReportColumn('email', 'Email Id', width: 26),
    ReportColumn('downloaded', 'Downloaded', width: 12),
    ReportColumn('platform', 'Device Name', width: 16),
  ];
  static const _attendanceCols = [
    ReportColumn('clubName', 'Club Name', width: 25),
    ReportColumn('eventName', 'Event Name', width: 25),
    ReportColumn('description', 'Description', width: 28),
    ReportColumn('eventDateTime', 'Event Date & Time', width: 20),
    ReportColumn('membersCount', 'Members Count', width: 14),
    ReportColumn('annsCount', 'Anns Count', width: 12),
    ReportColumn('annetsCount', 'Annets Count', width: 12),
    ReportColumn('visitorsCount', 'Visitors Count', width: 14),
    ReportColumn('rotariansOtherClubsCount', 'Rotarians (Other Clubs) Count', width: 22),
    ReportColumn('districtDelegatesCount', 'District Delegates Count', width: 20),
  ];
  // Web avenueProjectCols (District payload has no `description`).
  static const _avenueProjectCols = [
    ReportColumn('clubName', 'Club Name', width: 22),
    ReportColumn('typeOfProject', 'Type of Project', width: 18),
    ReportColumn('clubRole', 'Club Role', width: 14),
    ReportColumn('coHostName', 'Co-host', width: 18),
    ReportColumn('projectDate', 'Date', width: 15),
    ReportColumn('title', 'Title', width: 25),
    ReportColumn('location', 'Project Location', width: 20),
    ReportColumn('projectCost', 'Project Cost', width: 14),
    ReportColumn('funding', 'Funding', width: 15),
    ReportColumn('globalGrantNumber', 'Global Grant No', width: 16),
    ReportColumn('csrCompanyName', 'CSR Company', width: 18),
    ReportColumn('amountSanctioned', 'Amount Sanctioned', width: 16),
    ReportColumn('amountReceived', 'Amount Received', width: 16),
    ReportColumn('amountSpent', 'Amount Spent', width: 14),
    ReportColumn('hostClubsDistricts', 'Host Clubs', width: 20),
    ReportColumn('globalPartners', 'Global Partner', width: 20),
    ReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    ReportColumn('manHours', 'Man Hours', width: 12),
    ReportColumn('oneTimeOngoing', 'OneTime/Ongoing', width: 16),
    ReportColumn('newExisting', 'New/Existing', width: 14),
    ReportColumn('rotariansInvolved', 'Rotarians Involved', width: 16),
    ReportColumn('publicPhotoUrl', 'Images', width: 14, hyperlink: true),
  ];
  static const _avenueCountCols = [
    ReportColumn('srNo', 'Sr.No.', width: 8),
    ReportColumn('districtNumber', 'District Number', width: 16),
    ReportColumn('clubName', 'Club Name', width: 32),
    ReportColumn('projectCount', 'Project Count', width: 16),
  ];
  static const _monthlyCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('reportMonth', 'Month', width: 8),
    ReportColumn('memberCountLastMonth', 'Last Month', width: 12),
    ReportColumn('membersAdded', 'Added', width: 10),
    ReportColumn('membersDeleted', 'Deleted', width: 10),
    ReportColumn('currentMemberCount', 'Current', width: 10),
    ReportColumn('isUploadedToDistrict', 'Uploaded', width: 10),
  ];
  static const _trfCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('donorName', 'Member Name', width: 25),
    ReportColumn('fundName', 'Fund', width: 20),
    ReportColumn('amountUsd', 'Amount (USD)', width: 15),
    ReportColumn('trfDate', 'Date', width: 18),
  ];
  static const _presidentSecretaryCols = [
    ReportColumn('clubName', 'Club Name', width: 26),
    ReportColumn('districtNumber', 'District Number', width: 16),
    ReportColumn('president', 'President', width: 24),
    ReportColumn('presidentMobile', 'President Mobile', width: 18),
    ReportColumn('presidentEmail', 'President Email', width: 26),
    ReportColumn('secretary', 'Secretary', width: 24),
    ReportColumn('secretaryMobile', 'Secretary Mobile', width: 18),
    ReportColumn('secretaryEmail', 'Secretary Email', width: 26),
  ];
  static const _announcementCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('title', 'Title', width: 25),
    ReportColumn('description', 'Description', width: 30),
    ReportColumn('publishDate', 'Publish Date', width: 18),
    ReportColumn('expiryDate', 'Expiry Date', width: 18),
    ReportColumn('status', 'Status', width: 14),
  ];
  static const _eventCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('title', 'Title', width: 25),
    ReportColumn('description', 'Description', width: 28),
    ReportColumn('eventDate', 'Event Date', width: 18),
    ReportColumn('eventVenue', 'Venue', width: 20),
    ReportColumn('registrationLink', 'Registration Link', width: 24),
    ReportColumn('status', 'Status', width: 14),
  ];
  static const _newsletterCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('title', 'Title', width: 25),
    ReportColumn('publishDate', 'Publish Date', width: 18),
    ReportColumn('expiryDate', 'Expiry', width: 18),
    ReportColumn('attachmentType', 'Type', width: 12),
    ReportColumn('status', 'Status', width: 14),
  ];
  static const _documentCols = [
    ReportColumn('clubName', 'Club', width: 25),
    ReportColumn('title', 'Title', width: 25),
    ReportColumn('accessType', 'Access', width: 14),
    ReportColumn('publishDate', 'Publish', width: 18),
    ReportColumn('expiryDate', 'Expiry', width: 18),
  ];
  static const _districtProjectCols = [
    ReportColumn('areaOfFocus', 'Area of Focus', width: 20),
    ReportColumn('projectDate', 'Date', width: 15),
    ReportColumn('title', 'Title', width: 25),
    ReportColumn('description', 'Description', width: 30),
    ReportColumn('location', 'Project Location', width: 20),
    ReportColumn('projectCost', 'Project Cost', width: 14),
    ReportColumn('funding', 'Funding', width: 15),
    ReportColumn('globalGrantNumber', 'Global Grant Number', width: 18),
    ReportColumn('csrCompanyName', 'Name of the CSR Company', width: 22),
    ReportColumn('amountSanctioned', 'Amount Sanctioned', width: 16),
    ReportColumn('amountReceived', 'Amount Received', width: 16),
    ReportColumn('amountSpent', 'Amount spent till date', width: 18),
    ReportColumn('hostClubsDistricts', 'Host Clubs/Districts', width: 22),
    ReportColumn('globalPartners', 'Global Partner Clubs/Districts', width: 24),
    ReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    ReportColumn('manHours', 'Man Hours', width: 12),
    ReportColumn('rotariansInvolved', 'Rotarians Involved', width: 16),
    ReportColumn('publicPhotoUrl', 'Image', width: 14, hyperlink: true),
  ];
  static const _committeeCols = [
    ReportColumn('section', 'Section', width: 18),
    ReportColumn('groupName', 'Group', width: 22),
    ReportColumn('subGroupName', 'Sub Group', width: 22),
    ReportColumn('memberName', 'Name', width: 25),
    ReportColumn('designation', 'Designation', width: 25),
    ReportColumn('clubName', 'Club', width: 22),
    ReportColumn('mobile', 'Mobile', width: 15),
    ReportColumn('email', 'Email', width: 25),
  ];
  static const _agAllocationCols = [
    ReportColumn('agName', 'AG Name', width: 24),
    ReportColumn('agClubName', 'AG Club Name', width: 24),
    ReportColumn('agMobile', 'AG Mobile', width: 16),
    ReportColumn('agEmail', 'AG Email ID', width: 26),
    ReportColumn('clubName', 'Allocated Club Name', width: 26),
    ReportColumn('clubRotaryId', 'Club Rotary Id', width: 16),
  ];

  /// The full grouped section list (frontend order). Rows resolve from the
  /// loaded report; `comingSoon` sections have no data yet on mobile.
  /// `fromEndpoint` sections are shown from client-side data but excluded from
  /// the combined workbook (the app-bar Download fetches their richer server
  /// versions separately).
  List<_Sec> _specs() {
    // District Awards (Club Wise) — flattened citation matrix from the payload.
    final citCols = _citationCols();

    final members = _rows(_report?['members']);
    final attendance = _rows(_report?['attendance']);
    final projects = _allProjects();
    final citRows = citCols == null ? const <Map<String, dynamic>>[] : _citationRows();

    return [
      // ── MEMBERS ──
      _Sec('MEMBERS', 'Board of Directors (BOD)', Icons.badge_outlined,
          cols: _bodCols, rows: _rows(_report?['bod']), file: 'BOD',
          filters: const ['designation', 'club']),
      _Sec('MEMBERS', 'Members', Icons.people_alt_outlined,
          cols: _memberCols, rows: members, file: 'Members',
          filters: const ['club']),
      _Sec('MEMBERS', 'Members (AG wise)', Icons.groups_3_outlined,
          cols: _memberCols, rows: members, file: 'Members_AG_Wise',
          filters: const ['ag']),
      _Sec('MEMBERS', 'Members (Active app users)', Icons.phone_iphone_outlined,
          cols: _appUserCols, rows: _rows(_report?['appUsers']), file: 'App_Users',
          filters: const ['club']),
      const _Sec.soon('MEMBERS', 'Prospective Members (All Clubs)', Icons.person_add_alt_1_outlined),
      // ── CLUBS ──
      _Sec('CLUBS', 'Attendance (All Clubs)', Icons.event_available_outlined,
          cols: _attendanceCols, rows: attendance, file: 'Attendance',
          filters: const ['club']),
      _Sec('CLUBS', 'Attendance (AG wise)', Icons.event_available_outlined,
          cols: _attendanceCols, rows: attendance, file: 'Attendance_AG_Wise',
          filters: const ['ag']),
      _Sec('CLUBS', 'Avenue Of Service (All Clubs)', Icons.workspace_premium_outlined,
          cols: _avenueProjectCols, rows: projects, file: 'Avenue_Of_Service',
          fromEndpoint: true, filters: const ['club', 'avenue']),
      _Sec('CLUBS', 'Avenue Of Service (AG Wise)', Icons.workspace_premium_outlined,
          cols: _avenueProjectCols, rows: projects, file: 'Avenue_Of_Service_AG_Wise',
          filters: const ['ag']),
      _Sec('CLUBS', 'Avenue Of Service (Club Wise Count)', Icons.leaderboard_outlined,
          cols: _avenueCountCols, rows: _avenueClubCounts(), file: 'Avenue_Club_Count',
          fromEndpoint: true, filters: const ['club']),
      // Club Analytics — a server-generated Excel (per-club counts), matching
      // the web `/api/club-analytics/excel` download.
      _Sec('CLUBS', 'Club Analytics', Icons.insights_outlined,
          custom: (_) => _DownloadRow(
                title: 'Club Analytics',
                icon: Icons.insights_outlined,
                subtitle: 'Per-club counts · Excel',
                onTap: _downloadClubAnalytics,
              )),
      // Club Goal Setting — mirrors web `DistrictGoalReports mode="club"`: pick a
      // club for its own workbook, or leave "All Clubs" for every club of the
      // district stacked in one file (a SEPARATE endpoint, not a loop).
      if (kGoalSettingEnabled)
        _Sec('CLUBS', 'Club Goal Setting', Icons.flag_outlined,
            custom: (_) => _GoalReportRow(
                  title: 'Club Goal Setting',
                  subtitle: 'Month wise & Till date · all categories',
                  clubs: _clubList(),
                  onDownload: _downloadClubGoals,
                )),
      // Club Dues — one row per club, each dues type as Yes/No + Date (Excel),
      // pivoted from the payload's `duesReport`. Club-filterable like the web.
      _Sec('CLUBS', 'Club Dues', Icons.currency_rupee_rounded,
          cols: _duesCols(), rows: _duesRows(), file: 'Club_Dues',
          filters: const ['club']),
      _Sec('CLUBS', 'Club Monthly Report (Project Details)', Icons.assessment_outlined,
          cols: _cmrProjectCols, rows: projects, file: 'CMR_Project_Details',
          filters: const ['club']),
      _Sec('CLUBS', 'Club Monthly Report AG wise (Project Details)', Icons.assessment_outlined,
          cols: _cmrProjectCols, rows: projects, file: 'CMR_Project_Details_AG_Wise',
          filters: const ['ag']),
      _Sec('CLUBS', 'Club Monthly Report (Submission Details)', Icons.assignment_outlined,
          cols: _monthlyCols, rows: _rows(_report?['monthlyReports']), file: 'Monthly_Report'),
      _Sec('CLUBS', 'TRF Contributions', Icons.volunteer_activism_outlined,
          cols: _trfCols, rows: _rows(_report?['trf']), file: 'TRF_Contributions',
          filters: const ['club']),
      _Sec('CLUBS', 'Non Synchronized Clubs', Icons.sync_disabled_outlined,
          cols: _presidentSecretaryCols, rows: _rows(_report?['nonRiSyncedClubs']),
          file: 'Non_Synchronized_Clubs'),
      _Sec('CLUBS', 'Synchronized Clubs', Icons.sync_outlined,
          cols: _presidentSecretaryCols, rows: _rows(_report?['riSyncedClubs']),
          file: 'Synchronized_Clubs'),
      // Club Officers (From RI) — live from Rotary.org for the year; lazily
      // fetched then exported to Excel (same 25 columns as the web).
      _Sec('CLUBS', 'Club Officers (From RI)', Icons.manage_accounts_outlined,
          cols: _officerCols, loader: _fetchClubOfficersRi,
          file: 'Club_Officers_RI'),
      _Sec('CLUBS', 'Announcements', Icons.campaign_outlined,
          cols: _announcementCols, rows: _scoped('announcements', district: false),
          file: 'Announcements', filters: const ['club']),
      _Sec('CLUBS', 'Upcoming Events', Icons.event_outlined,
          cols: _eventCols, rows: _scoped('events', district: false), file: 'Upcoming_Events',
          filters: const ['club']),
      _Sec('CLUBS', 'Newsletters', Icons.newspaper_outlined,
          cols: _newsletterCols, rows: _scoped('newsletters', district: false),
          file: 'Newsletters', filters: const ['club']),
      _Sec('CLUBS', 'Documents', Icons.folder_outlined,
          cols: _documentCols, rows: _scoped('documents', district: false), file: 'Documents',
          filters: const ['club']),

      // ── DISTRICT ──
      // District Goal Setting — mirrors web `DistrictGoalReports mode="district"`,
      // the first row of the District subsection.
      if (kGoalSettingEnabled)
        _Sec('DISTRICT', 'District Goal Setting', Icons.flag_rounded,
            custom: (_) => _DownloadRow(
                  title: 'District Goal Setting',
                  icon: Icons.flag_rounded,
                  subtitle: 'Month wise & Till date · all categories',
                  onTap: _downloadDistrictGoals,
                )),
      _Sec('DISTRICT', 'District Projects', Icons.assignment_turned_in_outlined,
          cols: _districtProjectCols, rows: _rows(_report?['districtProjects']),
          file: 'District_Projects'),
      _Sec('DISTRICT', 'District Events', Icons.event_note_outlined,
          cols: _eventCols, rows: _scoped('events', district: true), file: 'District_Events'),
      _Sec('DISTRICT', 'AG Allocation', Icons.hub_outlined,
          cols: _agAllocationCols, rows: _rows(_report?['agAllocation']), file: 'AG_Allocation'),
      _Sec('DISTRICT', 'District Committee', Icons.groups_outlined,
          cols: _committeeCols, rows: _rows(_report?['committee']), file: 'District_Committee'),
      if (citCols != null) ...[
        _Sec('DISTRICT', 'District Awards (Club Wise)', Icons.emoji_events_outlined,
            cols: citCols, rows: citRows, file: 'District_Awards',
            filters: const ['club']),
        _Sec('DISTRICT', 'District Awards (AG Wise)', Icons.emoji_events_outlined,
            cols: citCols, rows: citRows, file: 'District_Awards_AG_Wise',
            filters: const ['ag']),
        // Extended = the web "compact" citation export (one Total per question).
        // The mobile citation table is already flat (one value per question), so
        // it maps to the same matrix; only the export filename differs.
        _Sec('DISTRICT', 'District Awards Extended (Club Wise)', Icons.emoji_events_outlined,
            cols: citCols, rows: citRows, file: 'District_Awards_Extended',
            filters: const ['club']),
        _Sec('DISTRICT', 'District Awards Extended (AG Wise)', Icons.emoji_events_outlined,
            cols: citCols, rows: citRows, file: 'District_Awards_Extended_AG_Wise',
            filters: const ['ag']),
      ] else ...[
        const _Sec.soon('DISTRICT', 'District Awards (Club Wise)', Icons.emoji_events_outlined),
        const _Sec.soon('DISTRICT', 'District Awards Extended (Club Wise)', Icons.emoji_events_outlined),
      ],
      // Governor's Official Visit — the reports with BOTH formats on web.
      // Club Wise: one club's OCV report as Word or Excel (server-generated).
      _Sec('DISTRICT', "Governor's Official Visit (Club Wise)", Icons.travel_explore_outlined,
          custom: (_) => _OcvReportRow(
                title: "Governor's Official Visit (Club Wise)",
                items: _clubList(),
                entityLabel: 'Club',
                readyText: 'Ready: all sub-modules included',
                onDownload: _downloadOcv,
              )),
      // AG Wise: every club under the AG, one report each, packed into a ZIP.
      _Sec('DISTRICT', "Governor's Official Visit (AG Wise)", Icons.travel_explore_outlined,
          custom: (_) => _OcvReportRow(
                title: "Governor's Official Visit (AG Wise)",
                items: _agList(),
                entityLabel: 'AG',
                readyText: 'Ready: every club under this AG (zipped)',
                onDownload: _downloadOcvAgZip,
              )),
    ];
  }

  /// Active clubs for this district (from the report payload's `clubList`),
  /// used by the OCV/GOV club picker. Each entry is (id, name).
  List<({int id, String name})> _clubList() {
    final raw = _report?['clubList'];
    if (raw is! List) return const [];
    final out = <({int id, String name})>[];
    for (final e in raw) {
      if (e is Map) {
        final id = (e['clubId'] as num?)?.toInt();
        final name = (e['clubName'] ?? '').toString();
        if (id != null && id > 0 && name.isNotEmpty) out.add((id: id, name: name));
      }
    }
    return out;
  }

  /// The district's own goals — all four categories, 2 sheets (Till Date +
  /// Month wise). Same builder as the web "District Goal Setting" card.
  Future<void> _downloadDistrictGoals() => _downloadServerFile(
        path: '/api/mobile/goal-setting/goals-excel/districts',
        query: {'yearId': _yearId, 'districtId': widget.districtId},
        fileName: '${_exportBaseName()}_District_Goal_Setting.xlsx',
        label: 'District Goal Setting',
      );

  /// One club's goals, or — when [clubId] is null ("All Clubs") — every club of
  /// the district in a single workbook. Web uses two different endpoints here
  /// for exactly the same reason, so do not fold them into one.
  Future<void> _downloadClubGoals(int? clubId) => _downloadServerFile(
        path: clubId != null
            ? '/api/mobile/goal-setting/goals-excel/clubs'
            : '/api/mobile/goal-setting/goals-excel/clubs-all',
        query: clubId != null
            ? {'yearId': _yearId, 'clubId': clubId}
            : {'yearId': _yearId, 'districtId': widget.districtId},
        fileName: '${_exportBaseName()}_Club_Goal_Setting'
            '${clubId != null ? '_$clubId' : '_All'}.xlsx',
        label: 'Club Goal Setting',
      );

  Future<void> _downloadClubAnalytics() => _downloadServerFile(
        path: '/api/club-analytics/excel',
        query: {'yearId': _yearId, 'districtId': widget.districtId},
        fileName: '${_exportBaseName()}_Club_Analytics.xlsx',
        label: 'Club Analytics',
      );

  /// OCV/GOV report for one club, in the requested format ('word' | 'excel').
  Future<void> _downloadOcv(int clubId, String fmt) {
    final isWord = fmt == 'word';
    return _downloadServerFile(
      path: '/api/clubs/$clubId/ocv-gov/report/${isWord ? 'word' : 'excel'}',
      query: {'yearId': _yearId},
      fileName: '${_exportBaseName()}_OCV_$clubId.${isWord ? 'docx' : 'xlsx'}',
      label: isWord ? 'OCV Word' : 'OCV Excel',
    );
  }

  /// Fetches a server-generated report file (bytes) and hands it to the OS
  /// share sheet so the user can save or send it. Used for the sections whose
  /// file is built on the server (Club Analytics Excel, OCV Word/Excel) rather
  /// than assembled client-side from payload rows.
  Future<void> _downloadServerFile({
    required String path,
    Map<String, dynamic>? query,
    required String fileName,
    String label = 'Report',
  }) async {
    if (_yearId == null) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(SnackBar(
      content: Text('Preparing $label…'),
      duration: const Duration(seconds: 30),
    ));
    final cleanQuery = <String, dynamic>{
      for (final e in (query ?? const {}).entries)
        if (e.value != null) e.key: e.value,
    };
    try {
      final bytes = await _api.downloadBytes(path, queryParams: cleanQuery);
      if (!mounted) return;
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(bytes, flush: true);
      if (!mounted) return;
      messenger.clearSnackBars();
      await Share.shareXFiles([XFile(file.path)], subject: fileName);
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.error,
        content: Text('Download failed: $e',
            style: const TextStyle(color: Colors.white)),
      ));
    }
  }

  /// Sheets for the combined workbook (app-bar Download): every real, non-empty
  /// section except the `fromEndpoint` ones (added via their richer endpoints)
  /// and the AG-wise variants (filtered duplicates of a base section).
  List<ReportSheet> _buildSections() => [
        for (final s in _specs())
          if (!s.comingSoon &&
              !s.fromEndpoint &&
              !s.filters.contains('ag') &&
              s.rows.isNotEmpty)
            ReportSheet(name: s.title, columns: s.cols, rows: s.rows),
      ];

  /// AG name → set of its allocated club names (for AG-wise filtering).
  Map<String, Set<String>> _agClubMap() {
    final map = <String, Set<String>>{};
    for (final a in _rows(_report?['agAllocation'])) {
      final ag = (a['agName'] ?? '').toString().trim();
      final club = (a['clubName'] ?? '').toString().trim();
      if (ag.isEmpty || club.isEmpty) continue;
      (map[ag] ??= <String>{}).add(club);
    }
    return map;
  }

  String _exportBaseName() {
    final district =
        (_report?['district'] as Map?)?.cast<String, dynamic>() ?? const {};
    final number = (district['districtNumber']?.toString() ?? '')
        .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '');
    return number.isEmpty ? 'District' : 'District_$number';
  }

  String? _exportSubtitle() {
    for (final y in _years) {
      if (y.id == _yearId) {
        return y.label.isEmpty ? null : 'Rotary Year: ${y.label}';
      }
    }
    return null;
  }

  Future<void> _openDownloadSheet() async {
    if (_preparingDownload) return;
    final messenger = ScaffoldMessenger.of(context);
    final sections = _buildSections();

    // Lazily pull the two "Avenue Of Service" sheets — they live on dedicated
    // endpoints (richer than the flattened on-screen version), so the workbook
    // gets the full financial/partner/CSR columns. Best-effort.
    setState(() => _preparingDownload = true);
    try {
      final fetched = await Future.wait([
        _fetchAvenueAllClubsSheet(),
        _fetchAvenueClubCountSheet(),
      ]);
      sections.addAll(fetched.whereType<ReportSheet>());
    } catch (_) {
      // Ignore — fall through with whatever sections we have.
    } finally {
      if (mounted) setState(() => _preparingDownload = false);
    }
    if (!mounted) return;

    if (sections.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('No data to download for this year.')),
      );
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetCtx) => ReportDownloadSheet(
        title: 'Download District Report',
        sections: sections,
        onExportAll: () => _runExport(sections, '${_exportBaseName()}_Report'),
        onExportOne: (s) => _runExport([s], '${_exportBaseName()}_${s.name}'),
      ),
    );
  }

  // ── Avenue Of Service (All Clubs) — richer server version for the workbook. ──
  static const List<ReportColumn> _avenueAllClubsColumns = [
    ReportColumn('districtNumber', 'District Number', width: 14),
    ReportColumn('clubName', 'Club Name', width: 28),
    ReportColumn('typeOfProject', 'Type of Project', width: 18),
    ReportColumn('clubRole', 'Your Club Role', width: 16),
    ReportColumn('coHostName', 'Co-host Name', width: 18),
    ReportColumn('areaOfFocus', 'Area of Focus', width: 22),
    ReportColumn('projectDate', 'Date', width: 14),
    ReportColumn('title', 'Title', width: 28),
    ReportColumn('description', 'Description', width: 40),
    ReportColumn('location', 'Project Location', width: 20),
    ReportColumn('projectCost', 'Project Cost', width: 14),
    ReportColumn('funding', 'Funding', width: 16),
    ReportColumn('globalGrantNumber', 'Global Grant Number', width: 18),
    ReportColumn('csrCompanyName', 'Name of the CSR Company', width: 22),
    ReportColumn('amountSanctioned', 'Amount Sanctioned', width: 16),
    ReportColumn('amountReceived', 'Amount Received', width: 16),
    ReportColumn('amountSpent', 'Amount spent till date', width: 18),
    ReportColumn('hostClubsDistricts', 'Host Clubs/Districts', width: 22),
    ReportColumn('globalPartners', 'Global Partner Clubs/Districts', width: 22),
    ReportColumn('beneficiaries', 'Beneficiaries', width: 14),
    ReportColumn('manHours', 'Man Hours', width: 12),
    ReportColumn('rotariansInvolved', 'Rotarians Involved', width: 18),
    ReportColumn('publicPhotoUrl', 'Image', width: 14, hyperlink: true),
  ];

  Future<ReportSheet?> _fetchAvenueAllClubsSheet() async {
    final yearId = _yearId;
    if (yearId == null) return null;
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/district-report/avenue-of-service-all-clubs',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final rows = _rows(resp.data);
      if (rows.isEmpty) return null;
      return ReportSheet(
        name: 'Avenue Of Service (All Clubs)',
        rows: rows,
        columns: _avenueAllClubsColumns,
      );
    } catch (_) {
      return null;
    }
  }

  Future<ReportSheet?> _fetchAvenueClubCountSheet() async {
    final yearId = _yearId;
    if (yearId == null) return null;
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/district-report/avenue-of-service-club-count',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final rows = _rows(resp.data);
      if (rows.isEmpty) return null;
      final numbered = <Map<String, dynamic>>[
        for (var i = 0; i < rows.length; i++) {'srNo': i + 1, ...rows[i]},
      ];
      return ReportSheet(
        name: 'Avenue Of Service (Club Wise Count)',
        rows: numbered,
        columns: _avenueCountCols,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _runExport(List<ReportSheet> sections, String fileName) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(
      content: Text('Generating Excel…'),
      duration: Duration(seconds: 30),
    ));
    try {
      final result = await buildReportXlsx(
        fileName: fileName,
        subtitle: _exportSubtitle(),
        sheets: sections,
      );
      if (!mounted) return;
      await shareReportXlsx(context, result, 'District Report');
      if (!mounted) return;
      messenger.clearSnackBars();
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AppColors.primary,
          content: Text(
            'Report saved (${result.rowCount} rows).',
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
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AppColors.error,
          content: Text('Download failed: $e',
              style: const TextStyle(color: Colors.white)),
        ),
      );
    }
  }

  // ── District Dues — pivot of payload `duesReport` (one row per club, each
  //    dues type → Yes/No + latest paid date), mirroring the web DuesReportRow. ──
  List<Map<String, dynamic>> _duesRaw() => _rows(_report?['duesReport']);

  List<({int id, String name})> _duesTypes() {
    final map = <int, ({int id, String name, num sort})>{};
    for (final r in _duesRaw()) {
      final id = (r['typeId'] as num?)?.toInt();
      if (id == null) continue;
      map.putIfAbsent(
          id,
          () => (
                id: id,
                name: (r['documentType'] ?? '').toString(),
                sort: (r['typeSort'] as num?) ?? 0,
              ));
    }
    final list = map.values.toList()
      ..sort((a, b) {
        final s = a.sort.compareTo(b.sort);
        return s != 0 ? s : a.name.compareTo(b.name);
      });
    return [for (final t in list) (id: t.id, name: t.name)];
  }

  List<ReportColumn> _duesCols() {
    final cols = <ReportColumn>[
      const ReportColumn('srNo', 'Sr.No.', width: 8),
      const ReportColumn('districtNumber', 'District Number', width: 16),
      const ReportColumn('clubName', 'Club Name', width: 28),
    ];
    for (final t in _duesTypes()) {
      cols.add(ReportColumn('type_${t.id}', t.name, width: 16));
      cols.add(ReportColumn('date_${t.id}', 'Date', width: 14));
    }
    return cols;
  }

  List<Map<String, dynamic>> _duesRows() {
    final types = _duesTypes();
    final order = <int>[];
    final meta = <int, Map<String, dynamic>>{};
    final cells = <int, Map<int, ({bool up, DateTime? date})>>{};
    for (final r in _duesRaw()) {
      final cid = (r['clubId'] as num?)?.toInt();
      if (cid == null) continue;
      if (!meta.containsKey(cid)) {
        order.add(cid);
        meta[cid] = {
          'districtNumber': (r['districtNumber'] ?? '').toString(),
          'clubName': (r['clubName'] ?? '').toString(),
        };
        cells[cid] = {};
      }
      final tid = (r['typeId'] as num?)?.toInt();
      if (tid == null) continue;
      final prev = cells[cid]![tid] ?? (up: false, date: null);
      final up = prev.up || (r['isUploaded'] as num?)?.toInt() == 1;
      var date = prev.date;
      final paid = _parseDate(r['paidOn']);
      if (paid != null && (date == null || paid.isAfter(date))) date = paid;
      cells[cid]![tid] = (up: up, date: date);
    }
    final out = <Map<String, dynamic>>[];
    var sr = 1;
    for (final cid in order) {
      final row = <String, dynamic>{
        'srNo': sr++,
        'districtNumber': meta[cid]!['districtNumber'],
        'clubName': meta[cid]!['clubName'],
      };
      for (final t in types) {
        final cell = cells[cid]![t.id] ?? (up: false, date: null);
        row['type_${t.id}'] = cell.up ? 'Yes' : 'No';
        row['date_${t.id}'] = cell.date == null ? '' : _ddmmyyyy(cell.date!);
      }
      out.add(row);
    }
    return out;
  }

  static DateTime? _parseDate(dynamic v) =>
      v == null ? null : DateTime.tryParse(v.toString());

  static String _ddmmyyyy(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  // ── Club Officers (From RI) — lazy fetch of live Rotary.org officers. ──
  static const _officerCols = [
    ReportColumn('clubName', 'Club Name', width: 26),
    ReportColumn('presidentName', 'President Name', width: 24),
    ReportColumn('presidentEmail', 'President EmailID', width: 28),
    ReportColumn('presidentMobile', 'President MobileNumber', width: 18),
    ReportColumn('secretaryName', 'Secretary Name', width: 24),
    ReportColumn('secretaryEmail', 'Secretary Email ID', width: 28),
    ReportColumn('secretaryMobile', 'Secretary Mobile Number', width: 18),
    ReportColumn('execSecretaryName', 'Club Executive Secretary Name', width: 26),
    ReportColumn('execSecretaryMobile', 'Club Executive Secretary Number', width: 18),
    ReportColumn('execSecretaryEmail', 'Club Executive Secretary Email', width: 28),
    ReportColumn('treasurerName', 'Club Treasurer', width: 24),
    ReportColumn('treasurerEmail', 'Club Treasurer EmailID', width: 28),
    ReportColumn('treasurerMobile', 'Club Treasurer MobileNumber', width: 18),
    ReportColumn('foundationChairName', 'Club Foundation Chair', width: 24),
    ReportColumn('foundationChairEmail', 'Club Foundation Chair EmailID', width: 28),
    ReportColumn('foundationChairMobile', 'Club Foundation Chair MobileNumber', width: 18),
    ReportColumn('membershipChairName', 'Club Membership Chair', width: 24),
    ReportColumn('membershipChairEmail', 'Club Membership Chair EmailID', width: 28),
    ReportColumn('membershipChairMobile', 'Club Membership Chair MobileNumber', width: 18),
    ReportColumn('publicImageChairName', 'Club Public Image Chair', width: 24),
    ReportColumn('publicImageChairEmail', 'Club Public Image Chair EmailID', width: 28),
    ReportColumn('publicImageChairMobile', 'Club Public Image Chair MobileNumber', width: 18),
    ReportColumn('serviceProjectsChairName', 'Club Service Projects Chair', width: 24),
    ReportColumn('serviceProjectsChairEmail', 'Club Service Projects Chair EmailID', width: 28),
    ReportColumn('serviceProjectsChairMobile', 'Club Service Projects Chair MobileNumber', width: 18),
  ];

  Future<List<Map<String, dynamic>>> _fetchClubOfficersRi() async {
    final resp = await _api.get<List<dynamic>>(
      '/api/districts/${widget.districtId}/district-report/club-officers-ri',
      queryParams: {'yearId': _yearId},
      fromJson: (j) => j as List<dynamic>,
    );
    return _rows(resp.data);
  }

  // ── OCV/GOV (AG Wise) — one report per club under the AG, packed into a ZIP
  //    client-side (mirrors the web downloadAgOcvZip). ──
  List<({int id, String name})> _agList() {
    final seen = <int>{};
    final out = <({int id, String name})>[];
    for (final a in _rows(_report?['agAllocation'])) {
      final id = (a['agMemberId'] as num?)?.toInt();
      final name = (a['agName'] ?? '').toString();
      if (id == null || id <= 0 || name.isEmpty || !seen.add(id)) continue;
      out.add((id: id, name: name));
    }
    out.sort((a, b) => a.name.compareTo(b.name));
    return out;
  }

  Future<void> _downloadOcvAgZip(int agMemberId, String fmt) async {
    if (_yearId == null) return;
    final isWord = fmt == 'word';
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(SnackBar(
      content: Text('Preparing OCV ${isWord ? 'Word' : 'Excel'} (zip)…'),
      duration: const Duration(seconds: 90),
    ));
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/district-report/ocv-gov',
        queryParams: {'yearId': _yearId, 'agMemberId': agMemberId},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final clubs = _rows(resp.data?['clubs']);
      if (clubs.isEmpty) {
        if (!mounted) return;
        messenger.clearSnackBars();
        messenger.showSnackBar(const SnackBar(
            content: Text('No clubs found under this AG for the year.')));
        return;
      }
      final archive = Archive();
      final ext = isWord ? 'docx' : 'xlsx';
      var added = 0;
      for (final c in clubs) {
        final cid = (c['clubId'] as num?)?.toInt();
        if (cid == null) continue;
        try {
          final bytes = await _api.downloadBytes(
            '/api/clubs/$cid/ocv-gov/report/${isWord ? 'word' : 'excel'}',
            queryParams: {'yearId': _yearId},
          );
          final name = _sanitize((c['clubName'] ?? 'Club_$cid').toString());
          archive.addFile(ArchiveFile('${name}_OCV.$ext', bytes.length, bytes));
          added++;
        } catch (_) {/* skip a club whose report fails to generate */}
      }
      if (added == 0) {
        if (!mounted) return;
        messenger.clearSnackBars();
        messenger.showSnackBar(const SnackBar(
            content: Text('Could not generate any club report for this AG.')));
        return;
      }
      final zipBytes = ZipEncoder().encode(archive);
      if (zipBytes == null) throw Exception('Failed to build the ZIP file.');
      final dir = await getTemporaryDirectory();
      final agName = _agList()
          .firstWhere((a) => a.id == agMemberId, orElse: () => (id: 0, name: 'AG'))
          .name;
      final fileName =
          '${_exportBaseName()}_${_sanitize(agName)}_OCV_${isWord ? 'Word' : 'Excel'}.zip';
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(zipBytes, flush: true);
      if (!mounted) return;
      messenger.clearSnackBars();
      await Share.shareXFiles([XFile(file.path)], subject: fileName);
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.error,
        content: Text('Download failed: $e',
            style: const TextStyle(color: Colors.white)),
      ));
    }
  }

  String _sanitize(String s) => s
      .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_')
      .replaceAll(RegExp(r'_+'), '_');

  Widget _yearBar() {
    return RotaryYearBar<int>(
      value: _yearId,
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      options: [
        for (final y in _years)
          RotaryYearOption(value: y.id, label: y.label, isCurrent: y.isCurrent),
      ],
      onChanged: (v) {
        setState(() => _yearId = v);
        _load();
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Body — grouped section list (MEMBERS / CLUBS / DISTRICT), like the web.
  // ─────────────────────────────────────────────────────────────────────────

  Widget _body() {
    if (_loading) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    if (_report == null) {
      return const EmptyStateWidget(
        title: 'No report data',
        icon: Icons.assessment_outlined,
      );
    }
    final specs = _specs();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 4, 14, 28),
        children: [
          for (final group in const ['MEMBERS', 'CLUBS', 'DISTRICT']) ...[
            _groupHeader(group),
            _groupPanel(specs.where((s) => s.group == group).toList()),
          ],
        ],
      ),
    );
  }

  /// One white rounded panel holding all of a group's rows, divider-separated —
  /// the web report list look.
  Widget _groupPanel(List<_Sec> secs) {
    final children = <Widget>[];
    for (var i = 0; i < secs.length; i++) {
      if (i > 0) {
        children.add(const Divider(
          height: 1,
          thickness: 1,
          indent: 14,
          endIndent: 14,
          color: AppColors.border,
        ));
      }
      final s = secs[i];
      if (s.custom != null) {
        children.add(s.custom!(context));
      } else if (s.comingSoon) {
        children.add(_ComingSoonRow(title: s.title, icon: s.icon));
      } else if (s.loader != null) {
        // Lazy (config-gated) section — rows fetched on first expand.
        children.add(ReportSectionCard(
          flat: true,
          title: s.title,
          icon: s.icon,
          columns: s.cols,
          rows: const [],
          rowsLoader: s.loader,
          trailing: _DownloadPill(onTap: () => _exportLazy(s)),
        ));
      } else if (s.filters.isNotEmpty) {
        // Section with inline filter dropdown(s), mirroring the web report rows.
        children.add(_FilterableSection(
          title: s.title,
          file: s.file,
          icon: s.icon,
          cols: s.cols,
          rows: s.rows,
          filters: s.filters,
          agClubs: _agClubMap(),
          onExport: (rows, file) => _runExport(
            [ReportSheet(name: s.title, columns: s.cols, rows: rows)],
            '${_exportBaseName()}_${_sanitize(file)}',
          ),
        ));
      } else {
        children.add(ReportSectionCard(
          flat: true,
          title: s.title,
          icon: s.icon,
          columns: s.cols,
          rows: s.rows,
          trailing: _DownloadPill(
            onTap: s.rows.isEmpty
                ? null
                : () => _runExport(
                      [ReportSheet(name: s.title, columns: s.cols, rows: s.rows)],
                      '${_exportBaseName()}_${_sanitize(s.file)}',
                    ),
          ),
        ));
      }
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

  Widget _groupHeader(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 14, 4, 8),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
          color: AppColors.textMuted,
        ),
      ),
    );
  }
}

/// A report section with inline filter dropdowns (Club / Designation / Avenue /
/// AG), mirroring the web report rows. Filtering is client-side on the already-
/// loaded rows; the Download button exports the current filtered slice. When an
/// AG filter is present the selection is mandatory (Download stays disabled with
/// a "Please select an AG" hint), exactly like the web.
class _FilterableSection extends StatefulWidget {
  final String title;
  final String file;
  final IconData icon;
  final List<ReportColumn> cols;
  final List<Map<String, dynamic>> rows;
  final List<String> filters;
  final Map<String, Set<String>> agClubs;
  final void Function(List<Map<String, dynamic>> rows, String file) onExport;

  const _FilterableSection({
    required this.title,
    required this.file,
    required this.icon,
    required this.cols,
    required this.rows,
    required this.filters,
    required this.agClubs,
    required this.onExport,
  });

  @override
  State<_FilterableSection> createState() => _FilterableSectionState();
}

class _FilterableSectionState extends State<_FilterableSection> {
  final Map<String, String> _sel = {};

  String _get(String f) => _sel[f] ?? (f == 'ag' ? '' : 'all');

  List<String> _distinct(String Function(Map<String, dynamic>) pick) {
    final s = <String>{};
    for (final r in widget.rows) {
      final v = pick(r).trim();
      if (v.isNotEmpty && v.toLowerCase() != 'district level') s.add(v);
    }
    return s.toList()..sort();
  }

  List<String> _optionsFor(String f) {
    switch (f) {
      case 'designation':
        return _distinct((r) => (r['designation'] ?? '').toString());
      case 'avenue':
        return _distinct((r) => (r['moduleName'] ?? '').toString());
      case 'ag':
        return widget.agClubs.keys.toList()..sort();
      case 'club':
      default:
        return _distinct((r) => (r['clubName'] ?? '').toString());
    }
  }

  bool _matches(Map<String, dynamic> r, String f, String val) {
    switch (f) {
      case 'designation':
        return (r['designation'] ?? '').toString().trim() == val;
      case 'avenue':
        return (r['moduleName'] ?? '').toString().trim() == val;
      case 'ag':
        return widget.agClubs[val]
                ?.contains((r['clubName'] ?? '').toString().trim()) ??
            false;
      case 'club':
      default:
        return (r['clubName'] ?? '').toString().trim() == val;
    }
  }

  static String _placeholder(String f) {
    switch (f) {
      case 'designation':
        return 'All Designations';
      case 'avenue':
        return 'All Avenues';
      case 'ag':
        return 'Select AG';
      case 'club':
      default:
        return 'All Clubs';
    }
  }

  @override
  Widget build(BuildContext context) {
    final mandatoryUnset = widget.filters.contains('ag') && _get('ag').isEmpty;
    final filtered = mandatoryUnset
        ? const <Map<String, dynamic>>[]
        : widget.rows.where((r) {
            for (final f in widget.filters) {
              final v = _get(f);
              if (v == 'all' || v.isEmpty) continue;
              if (!_matches(r, f, v)) return false;
            }
            return true;
          }).toList();

    final anyActive = widget.filters.any((f) {
      final v = _get(f);
      return v != 'all' && v.isNotEmpty;
    });

    final subtitle = mandatoryUnset
        ? 'Please select an AG to download'
        : '${filtered.length} record${filtered.length == 1 ? '' : 's'}'
            '${anyActive ? ' · filtered' : ''}';

    return ReportSectionCard(
      flat: true,
      title: widget.title,
      icon: widget.icon,
      columns: widget.cols,
      rows: filtered,
      subtitleOverride: subtitle,
      subtitleColor: mandatoryUnset ? AppColors.accentAmber : null,
      belowHeader: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final f in widget.filters)
            _FilterChip(
              value: _get(f),
              placeholder: _placeholder(f),
              allLabel: _placeholder(f),
              hasAll: f != 'ag',
              options: _optionsFor(f),
              onChanged: (v) => setState(() => _sel[f] = v),
            ),
        ],
      ),
      trailing: _DownloadPill(
        onTap: filtered.isEmpty
            ? null
            : () => widget.onExport(filtered, widget.file),
      ),
    );
  }
}

/// A compact dropdown "pill" for a single filter (opens a popup menu of options).
class _FilterChip extends StatelessWidget {
  final String value;
  final String placeholder;
  final String allLabel;
  final bool hasAll;
  final List<String> options;
  final ValueChanged<String> onChanged;

  const _FilterChip({
    required this.value,
    required this.placeholder,
    required this.allLabel,
    required this.hasAll,
    required this.options,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final isDefault = value == 'all' || value.isEmpty;
    final display = isDefault ? placeholder : value;
    const accent = AppColors.primary;
    final menuStyle = AppFonts.body(
        fontSize: 13, color: AppColors.textPrimary);
    return PopupMenuButton<String>(
      onSelected: onChanged,
      initialValue: value.isEmpty ? null : value,
      constraints: const BoxConstraints(maxWidth: 340, maxHeight: 440),
      itemBuilder: (_) => [
        if (hasAll)
          PopupMenuItem<String>(value: 'all', child: Text(allLabel, style: menuStyle)),
        for (final o in options)
          PopupMenuItem<String>(value: o, child: Text(o, style: menuStyle)),
      ],
      child: Container(
        padding: const EdgeInsets.fromLTRB(11, 7, 7, 7),
        decoration: BoxDecoration(
          color: isDefault ? Colors.transparent : accent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(9),
          border: Border.all(
            color: isDefault ? AppColors.border : accent.withValues(alpha: 0.4),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 140),
              child: Text(
                display,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: isDefault ? AppColors.textSecondary : accent,
                ),
              ),
            ),
            Icon(Icons.arrow_drop_down_rounded,
                size: 18, color: isDefault ? AppColors.textMuted : accent),
          ],
        ),
      ),
    );
  }
}

/// A dimmed "Coming Soon" row for sections mobile can't build yet (matches the
/// web's Coming-Soon states). Flat — the enclosing group panel draws the border.
class _ComingSoonRow extends StatelessWidget {
  final String title;
  final IconData icon;
  const _ComingSoonRow({required this.title, required this.icon});

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
              color: AppColors.slate400.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: AppColors.slate400, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate400,
                    height: 1.25,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                Text(
                  'Coming Soon',
                  style: AppFonts.body(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.accentAmber,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const _DownloadPill(onTap: null),
        ],
      ),
    );
  }
}

/// Outlined "Download" pill used as a section-row trailing — matches the web
/// report list button. Greyed + non-interactive when [onTap] is null.
class _DownloadPill extends StatelessWidget {
  final VoidCallback? onTap;
  const _DownloadPill({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final color = enabled ? AppColors.textSecondary : AppColors.slate400;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: enabled ? AppColors.border : AppColors.border.withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
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

/// A section row that triggers a direct (server-generated) file download — a
/// title + subtitle + an enabled "Download" pill. Used for Club Analytics.
class _DownloadRow extends StatelessWidget {
  final String title;
  final IconData icon;
  final String subtitle;
  final Future<void> Function() onTap;
  const _DownloadRow({
    required this.title,
    required this.icon,
    required this.subtitle,
    required this.onTap,
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
              color: AppColors.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: AppColors.primary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    height: 1.25,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: AppFonts.body(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _DownloadPill(onTap: () => onTap()),
        ],
      ),
    );
  }
}

/// The Club Goal Setting row — a club picker plus one Download. Leaving the
/// picker on "All Clubs" downloads EVERY club of the district in a single
/// workbook (`goals-excel/clubs-all`), which is what the web card's "All"
/// option does; picking a club downloads just that club (`goals-excel/clubs`).
/// Unlike the OCV row there is nothing to select before you can download, so
/// the button is live from the start.
class _GoalReportRow extends StatefulWidget {
  final String title;
  final String subtitle;
  final List<({int id, String name})> clubs;

  /// Null id ⇒ "All Clubs".
  final Future<void> Function(int? clubId) onDownload;

  const _GoalReportRow({
    required this.title,
    required this.subtitle,
    required this.clubs,
    required this.onDownload,
  });

  @override
  State<_GoalReportRow> createState() => _GoalReportRowState();
}

class _GoalReportRowState extends State<_GoalReportRow> {
  int? _clubId; // null = All Clubs
  bool _busy = false;

  static const String _allLabel = 'All Clubs';

  String get _selName {
    final id = _clubId;
    if (id == null) return _allLabel;
    for (final c in widget.clubs) {
      if (c.id == id) return c.name;
    }
    return _allLabel;
  }

  Future<void> _run() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onDownload(_clubId);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.flag_outlined, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.title,
                      style: AppFonts.body(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                        height: 1.25,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      widget.subtitle,
                      style: AppFonts.body(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _dropdown()),
              const SizedBox(width: 8),
              if (_busy)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                  child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2)),
                )
              else
                _DownloadPill(onTap: _run),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dropdown() {
    return PopupMenuButton<int>(
      onSelected: (v) => setState(() => _clubId = v == 0 ? null : v),
      constraints: const BoxConstraints(maxWidth: 340, maxHeight: 440),
      itemBuilder: (_) => [
        PopupMenuItem<int>(
          value: 0,
          child: Text(_allLabel,
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
        ),
        for (final c in widget.clubs)
          PopupMenuItem<int>(
            value: c.id,
            child: Text(c.name,
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.textPrimary)),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.fromLTRB(11, 9, 7, 9),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(9),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _selName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const Icon(Icons.arrow_drop_down_rounded,
                size: 18, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}

/// The OCV/GOV report row — the reports with BOTH formats on web. Pick an entity
/// (a club, or an AG), then download the report as Word or Excel. For AG the
/// download is a ZIP of one report per club; for a club it's a single file.
class _OcvReportRow extends StatefulWidget {
  final String title;
  final List<({int id, String name})> items;
  final String entityLabel; // 'Club' | 'AG'
  final String readyText;
  final Future<void> Function(int id, String fmt) onDownload;
  const _OcvReportRow({
    required this.title,
    required this.items,
    required this.entityLabel,
    required this.readyText,
    required this.onDownload,
  });

  @override
  State<_OcvReportRow> createState() => _OcvReportRowState();
}

class _OcvReportRowState extends State<_OcvReportRow> {
  int? _selId;
  String? _busyFmt; // 'word' | 'excel' while that format is downloading

  Future<void> _run(String fmt) async {
    final id = _selId;
    if (id == null || _busyFmt != null) return;
    setState(() => _busyFmt = fmt);
    try {
      await widget.onDownload(id, fmt);
    } finally {
      if (mounted) setState(() => _busyFmt = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasSel = _selId != null;
    final selName = hasSel
        ? widget.items
            .firstWhere((c) => c.id == _selId,
                orElse: () => (id: 0, name: ''))
            .name
        : '';
    final busy = _busyFmt != null;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.travel_explore_outlined,
                    color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.title,
                      style: AppFonts.body(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                        height: 1.25,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      hasSel
                          ? widget.readyText
                          : 'Select ${widget.entityLabel == 'AG' ? 'an' : 'a'} ${widget.entityLabel} to download',
                      style: AppFonts.body(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: hasSel
                            ? AppColors.textSecondary
                            : AppColors.accentAmber,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _dropdown(selName)),
              const SizedBox(width: 8),
              _FormatPill(
                label: 'Word',
                icon: Icons.description_outlined,
                color: AppColors.rotaryBlue,
                enabled: hasSel && !busy,
                busy: _busyFmt == 'word',
                onTap: () => _run('word'),
              ),
              const SizedBox(width: 6),
              _FormatPill(
                label: 'Excel',
                icon: Icons.grid_on_outlined,
                color: AppColors.success,
                enabled: hasSel && !busy,
                busy: _busyFmt == 'excel',
                onTap: () => _run('excel'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dropdown(String selName) {
    return PopupMenuButton<int>(
      enabled: widget.items.isNotEmpty,
      onSelected: (v) => setState(() => _selId = v),
      constraints: const BoxConstraints(maxWidth: 340, maxHeight: 440),
      itemBuilder: (_) => [
        for (final c in widget.items)
          PopupMenuItem<int>(
            value: c.id,
            child: Text(c.name,
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.textPrimary)),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.fromLTRB(11, 9, 7, 9),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(9),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                selName.isEmpty ? 'Select ${widget.entityLabel}' : selName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: selName.isEmpty
                      ? AppColors.textSecondary
                      : AppColors.textPrimary,
                ),
              ),
            ),
            const Icon(Icons.arrow_drop_down_rounded,
                size: 18, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}

/// A compact format pill (Word / Excel) with a per-format busy spinner.
class _FormatPill extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final bool enabled;
  final bool busy;
  final VoidCallback onTap;
  const _FormatPill({
    required this.label,
    required this.icon,
    required this.color,
    required this.enabled,
    required this.busy,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = enabled ? color : AppColors.slate400;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: enabled
                  ? color.withValues(alpha: 0.4)
                  : AppColors.border.withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              busy
                  ? SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(c),
                      ),
                    )
                  : Icon(icon, size: 15, color: c),
              const SizedBox(width: 5),
              Text(
                label,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: c,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One grouped report section spec.
class _Sec {
  final String group;
  final String title;
  final IconData icon;
  final List<ReportColumn> cols;
  final List<Map<String, dynamic>> rows;
  final String file;
  final bool comingSoon;
  final bool fromEndpoint;

  /// When set, rows are fetched lazily on first expand (heavy/config-gated
  /// sections like Club Officers from RI). Excluded from the combined workbook.
  final Future<List<Map<String, dynamic>>> Function()? loader;

  /// Per-section filter dropdowns (mirrors the web report rows). Ordered keys:
  /// 'designation', 'club', 'avenue', 'ag' (AG selection is mandatory).
  final List<String> filters;

  /// Fully custom row builder — used for sections whose download isn't the
  /// standard "flatten payload rows → Excel" (e.g. Club Analytics = a
  /// server-generated Excel blob, OCV/GOV = a club picker with Word + Excel).
  /// When set it wholly replaces the row (comingSoon / table logic is skipped).
  final WidgetBuilder? custom;

  const _Sec(
    this.group,
    this.title,
    this.icon, {
    this.cols = const [],
    this.rows = const [],
    this.file = '',
    this.fromEndpoint = false,
    this.loader,
    this.filters = const [],
    this.custom,
  }) : comingSoon = false;

  const _Sec.soon(this.group, this.title, this.icon)
      : cols = const [],
        rows = const [],
        file = '',
        comingSoon = true,
        fromEndpoint = false,
        loader = null,
        filters = const [],
        custom = null;
}

class _Year {
  final int id;
  final String label;
  final bool isCurrent;
  const _Year({required this.id, required this.label, this.isCurrent = false});

  factory _Year.fromJson(Map<String, dynamic> j) => _Year(
        id: (j['id'] as int?) ?? (j['yearId'] as int?) ?? 0,
        label: j['yearLabel']?.toString() ??
            j['label']?.toString() ??
            j['yearName']?.toString() ??
            '',
        isCurrent: j['isCurrent'] == true,
      );
}
