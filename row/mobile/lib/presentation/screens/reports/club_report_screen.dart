import 'dart:io';

import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/constants/feature_flags.dart';
import '../../../core/network/api_client.dart';
import '../../../core/services/report_xlsx_export.dart';
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/report_section_table.dart';
import '../../widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Club Report — mobile port of the web "Section Exports" page.
///
/// Each report module is one row: icon + title + record count + an "Excel"
/// button that exports just that section as a styled .xlsx (mirrors the web
/// per-section download). Rows are grouped under MEMBERS / CLUBS / DISTRICT.
///
/// Phase 1: Avenue of Service and District Awards are shown
/// as "Coming Soon" (their exports need extra endpoints / column logic).
class ClubReportScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  const ClubReportScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
  });

  @override
  State<ClubReportScreen> createState() => _ClubReportScreenState();
}

class _ClubReportScreenState extends State<ClubReportScreen> {
  final _api = ApiClient();

  List<_Year> _years = [];
  int? _yearId;
  Map<String, dynamic>? _report;
  bool _loading = true;
  bool _exporting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initYears();
  }

  Future<void> _initYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/club-report/available-years',
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
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load years. $e';
      });
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
        '/api/clubs/${widget.clubId}/club-report',
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

  // ---------------------------------------------------------------------------
  // Data helpers
  // ---------------------------------------------------------------------------

  List<Map<String, dynamic>> _rows(dynamic v) =>
      (v as List?)
          ?.whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList() ??
      const [];

  String _s(dynamic v) => v == null ? '' : v.toString();

  /// Formats an ISO/parseable date. Backend zero-dates (`0001-01-01`) → blank.
  String _date(dynamic v, {bool withYear = true}) {
    if (v == null) return '';
    final s = v.toString();
    if (s.isEmpty) return '';
    final d = DateTime.tryParse(s);
    if (d == null) return s;
    if (d.year <= 1) return '';
    return DateFormat(withYear ? 'dd MMM yyyy' : 'dd MMM').format(d.toLocal());
  }

  String _yn(dynamic v) {
    if (v == null) return '';
    if (v is bool) return v ? 'Yes' : 'No';
    final s = v.toString().toLowerCase();
    if (s == 'true' || s == '1' || s == 'y' || s == 'yes') return 'Yes';
    if (s == 'false' || s == '0' || s == 'n' || s == 'no') return 'No';
    return v.toString();
  }

  String _media(dynamic v) => ApiConstants.mediaUrl(v?.toString());

  String _exportBaseName() {
    final club = (_report?['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final name = (club['clubName']?.toString() ?? 'Club')
        .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_')
        .replaceAll(RegExp(r'_+'), '_');
    return name.isEmpty ? 'Club' : name;
  }

  String _yearLabel() => _years
      .where((y) => y.id == _yearId)
      .map((y) => y.label)
      .firstWhere((_) => true, orElse: () => '');

  String _sanitize(String s) => s
      .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_')
      .replaceAll(RegExp(r'_+'), '_');

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  Future<void> _export({
    required String title,
    required String fileSuffix,
    required List<ReportColumn> columns,
    required List<Map<String, dynamic>> rows,
    String? extraSubtitle,
  }) async {
    if (_exporting) return;
    if (rows.isEmpty) {
      _toast('No data to export for this section.');
      return;
    }
    setState(() => _exporting = true);
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(
      content: Text('Generating Excel…'),
      duration: Duration(seconds: 30),
    ));
    try {
      final year = _yearLabel();
      final subtitle = [
        if (year.isNotEmpty) 'Rotary Year: $year',
        if (extraSubtitle != null && extraSubtitle.isNotEmpty) extraSubtitle,
      ].join('  ·  ');
      final result = await buildReportXlsx(
        fileName: '${_exportBaseName()}_$fileSuffix',
        subtitle: subtitle.isEmpty ? null : subtitle,
        sheets: [ReportSheet(name: title, columns: columns, rows: rows)],
      );
      if (!mounted) return;
      await shareReportXlsx(context, result, title);
      if (!mounted) return;
      messenger.clearSnackBars();
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AppColors.primary,
          content: Text('$title saved (${result.rowCount} rows).',
              style: const TextStyle(color: Colors.white)),
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
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.error,
        content:
            Text('Export failed: $e', style: const TextStyle(color: Colors.white)),
      ));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(msg)));
  }

  // ---------------------------------------------------------------------------
  // Server-generated files (Excel / Word / both) — the report is built on the
  // server; the phone just fetches the bytes and hands them to the Share sheet.
  // Correct-by-construction (same file the web produces).
  // ---------------------------------------------------------------------------

  Future<void> _downloadServerFile({
    required String path,
    Map<String, dynamic>? query,
    required String fileName,
    required String label,
  }) async {
    if (_yearId == null || _exporting) return;
    setState(() => _exporting = true);
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(SnackBar(
      content: Text('Preparing $label…'),
      duration: const Duration(seconds: 90),
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
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _downloadClubAnalytics() => _downloadServerFile(
        path: '/api/club-analytics/excel',
        query: {'yearId': _yearId, 'clubId': widget.clubId},
        fileName: '${_exportBaseName()}_Club_Analytics.xlsx',
        label: 'Club Analytics',
      );

  Future<void> _downloadGoalSetting() => _downloadServerFile(
        path: '/api/goal-setting/goals-excel/clubs',
        query: {'yearId': _yearId, 'clubId': widget.clubId},
        fileName: '${_exportBaseName()}_Goal_Setting.xlsx',
        label: 'Goal Setting',
      );

  Future<void> _downloadAnnualWord() => _downloadServerFile(
        path: '/api/clubs/${widget.clubId}/club-report/annual-report',
        query: {'yearId': _yearId},
        fileName: '${_exportBaseName()}_Annual_Report.docx',
        label: 'Annual Report',
      );

  Future<void> _downloadOcv(String fmt) {
    final isWord = fmt == 'word';
    return _downloadServerFile(
      path:
          '/api/clubs/${widget.clubId}/ocv-gov/report/${isWord ? 'word' : 'excel'}',
      query: {'yearId': _yearId},
      fileName: '${_exportBaseName()}_OCV.${isWord ? 'docx' : 'xlsx'}',
      label: isWord ? 'OCV Word' : 'OCV Excel',
    );
  }

  // ── Blood Group (members + family who have a group on file) ──
  static const _bloodGroupCols = [
    ReportColumn('name', 'Name', width: 26),
    ReportColumn('relation', 'Relation', width: 16),
    ReportColumn('mobile', 'Mobile Number', width: 16),
    ReportColumn('bloodGroup', 'Blood Group', width: 14),
  ];
  List<Map<String, dynamic>> _bloodGroupRows() {
    final out = <Map<String, dynamic>>[];
    for (final m in _rows(_report?['members'])) {
      final bg = _s(m['bloodGroup']);
      if (bg.isEmpty) continue;
      out.add({
        'name': _s(m['memberName']),
        'relation': 'Self',
        'mobile': _s(m['mobile']),
        'bloodGroup': bg,
      });
    }
    for (final f in _rows(_report?['family'])) {
      final bg = _s(f['familyBloodGroup']);
      if (bg.isEmpty) continue;
      out.add({
        'name': _s(f['familyName']),
        'relation': _s(f['familyRelation']),
        'mobile': _s(f['familyMobile']),
        'bloodGroup': bg,
      });
    }
    return out;
  }

  // ── Avenue of Service (flatten every module's projects) ──
  static const _avenueCols = [
    ReportColumn('typeOfProject', 'Type of Project', width: 18),
    ReportColumn('clubRole', 'Your Club Role', width: 16),
    ReportColumn('coHostName', 'Co-host Name', width: 18),
    ReportColumn('areaOfFocus', 'Area of Focus', width: 22),
    ReportColumn('projectDate', 'Date', width: 14),
    ReportColumn('title', 'Title', width: 28),
    ReportColumn('description', 'Description', width: 36),
    ReportColumn('location', 'Project Location', width: 20),
    ReportColumn('projectCost', 'Project Cost', width: 14),
    ReportColumn('funding', 'Funding', width: 16),
    ReportColumn('globalGrantNumber', 'Global Grant Number', width: 18),
    ReportColumn('csrCompanyName', 'Name of the CSR Company', width: 22),
    ReportColumn('amountSanctioned', 'Amount Sanctioned', width: 16),
    ReportColumn('amountReceived', 'Amount Received', width: 16),
    ReportColumn('amountSpent', 'Amount spent till date', width: 18),
    ReportColumn('directBeneficiaries', 'Beneficiaries', width: 14),
    ReportColumn('manHours', 'Man Hours', width: 12),
  ];
  List<Map<String, dynamic>> _avenueRows() {
    final pbm =
        (_report?['projectsByModule'] as Map?)?.cast<String, dynamic>() ?? const {};
    final out = <Map<String, dynamic>>[];
    for (final v in pbm.values) {
      for (final p in _rows(v)) {
        out.add({
          'typeOfProject': _s(p['typeOfProject']),
          'clubRole': _s(p['clubRole']),
          'coHostName': _s(p['coHostName']),
          'areaOfFocus': _s(p['areaOfFocus']),
          'projectDate': _date(p['projectDate']),
          'title': _s(p['title']),
          'description': _s(p['description']),
          'location': _s(p['location']),
          'projectCost': _s(p['projectCost']),
          'funding': _s(p['funding']),
          'globalGrantNumber': _s(p['globalGrantNumber']),
          'csrCompanyName': _s(p['csrCompanyName']),
          'amountSanctioned': _s(p['amountSanctioned']),
          'amountReceived': _s(p['amountReceived']),
          'amountSpent': _s(p['amountSpent']),
          'directBeneficiaries': _s(p['directBeneficiaries']),
          'manHours': _s(p['manHours']),
        });
      }
    }
    return out;
  }

  // ── Club Dues (pivot from duesReportOcv — one row for this club) ──
  List<Map<String, dynamic>> _duesTypesSorted() {
    final list = _rows(_report?['duesReportOcv']);
    list.sort((a, b) {
      final s = ((a['typeSort'] as num?) ?? 0)
          .compareTo((b['typeSort'] as num?) ?? 0);
      return s != 0 ? s : _s(a['documentType']).compareTo(_s(b['documentType']));
    });
    return list;
  }

  List<ReportColumn> _duesCols() {
    final cols = <ReportColumn>[
      const ReportColumn('srNo', 'Sr.No.', width: 8),
      const ReportColumn('districtNumber', 'District Number', width: 16),
      const ReportColumn('clubName', 'Club Name', width: 28),
    ];
    for (final t in _duesTypesSorted()) {
      cols.add(ReportColumn('type_${t['typeId']}', _s(t['documentType']), width: 16));
      cols.add(ReportColumn('date_${t['typeId']}', 'Date', width: 14));
    }
    return cols;
  }

  List<Map<String, dynamic>> _duesRows() {
    final types = _duesTypesSorted();
    if (types.isEmpty) return const [];
    final club = (_report?['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final row = <String, dynamic>{
      'srNo': 1,
      'districtNumber':
          _s(types.first['districtNumber'] ?? club['districtNumber']),
      'clubName': _s(club['clubName']),
    };
    for (final t in types) {
      row['type_${t['typeId']}'] =
          (t['isUploaded'] as num?)?.toInt() == 1 ? 'Yes' : 'No';
      row['date_${t['typeId']}'] = _date(t['paidOn']);
    }
    return [row];
  }

  // ── Terminated / Potential Members (lazy — from the club Rotary Network) ──
  static const _terminatedCols = [
    ReportColumn('srNo', 'Sr. No.', width: 8),
    ReportColumn('memberId', 'Member ID', width: 14),
    ReportColumn('name', 'Name', width: 28),
    ReportColumn('memberType', 'Member Type', width: 16),
    ReportColumn('admissionDate', 'Admission Date', width: 16),
    ReportColumn('terminationDate', 'Termination Date', width: 16),
    ReportColumn('terminationReason', 'Termination Reason', width: 30),
    ReportColumn('mobile', 'Mobile', width: 16),
    ReportColumn('email', 'Email', width: 28),
  ];
  static const _potentialCols = [
    ReportColumn('srNo', 'Sr. No.', width: 8),
    ReportColumn('name', 'Name', width: 28),
    ReportColumn('email', 'Email', width: 28),
    ReportColumn('mobile', 'Mobile', width: 16),
    ReportColumn('referenceDetails', 'Reference Details', width: 40),
  ];
  String _fullName(Map<String, dynamic> m) =>
      [m['firstName'], m['middleName'], m['lastName']]
          .map((e) => _s(e))
          .where((s) => s.isNotEmpty)
          .join(' ');

  Future<Map<String, dynamic>> _fetchRotaryNetwork() async {
    final resp = await _api.get<Map<String, dynamic>>(
      '/api/club-admin-dashboard/dashboard-rotary-network',
      queryParams: {'yearId': _yearId, 'clubId': widget.clubId},
      fromJson: (j) => j as Map<String, dynamic>,
    );
    return resp.data ?? const {};
  }

  Future<List<Map<String, dynamic>>> _fetchTerminated() async {
    final data = await _fetchRotaryNetwork();
    final list = _rows(data['terminatedMembers']);
    final out = <Map<String, dynamic>>[];
    for (var i = 0; i < list.length; i++) {
      final m = list[i];
      out.add({
        'srNo': i + 1,
        'memberId': _s(m['memberId']),
        'name': _fullName(m),
        'memberType': _s(m['memberType']),
        'admissionDate': _date(m['admissionDate']),
        'terminationDate': _date(m['terminationDate']),
        'terminationReason': _s(m['terminationReason']),
        'mobile': _s(m['mobile']),
        'email': _s(m['email']),
      });
    }
    return out;
  }

  Future<List<Map<String, dynamic>>> _fetchPotential() async {
    final data = await _fetchRotaryNetwork();
    final list = _rows(data['potentialMembers']);
    final out = <Map<String, dynamic>>[];
    for (var i = 0; i < list.length; i++) {
      final m = list[i];
      out.add({
        'srNo': i + 1,
        'name': _fullName(m),
        'email': _s(m['email']),
        'mobile': _s(m['mobile']),
        'referenceDetails': _s(m['notes']),
      });
    }
    return out;
  }

  /// Generic lazy export: fetch rows on tap, then hand to the Excel exporter.
  Future<void> _exportRows(
      Future<List<Map<String, dynamic>>> Function() fetchRows,
      List<ReportColumn> cols,
      String title,
      String fileSuffix) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(
        content: Text('Preparing…'), duration: Duration(seconds: 40)));
    try {
      final rows = await fetchRows();
      if (!mounted) return;
      messenger.clearSnackBars();
      if (rows.isEmpty) {
        _toast('No data to export for this section.');
        return;
      }
      await _export(
          title: title, fileSuffix: fileSuffix, columns: cols, rows: rows);
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      _toast('Export failed: $e');
    }
  }

  // ── District Awards (citation matrix for this club, lazy) ──
  int? _clubDistrictId() {
    final club = (_report?['club'] as Map?)?.cast<String, dynamic>();
    final v = club?['fkDistrictId'] ?? club?['districtId'];
    return (v as num?)?.toInt();
  }

  Future<void> _exportCitation(String title, String fileSuffix) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(
        content: Text('Preparing…'), duration: Duration(seconds: 40)));
    try {
      final did = _clubDistrictId();
      if (did == null) {
        if (!mounted) return;
        messenger.clearSnackBars();
        _toast('District not available for this club.');
        return;
      }
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/citation-matrix',
        queryParams: {
          'districtId': did,
          'yearId': _yearId,
          'clubId': widget.clubId,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final m = resp.data ?? const {};
      final columns = (m['columns'] as List?) ?? const [];
      if (!mounted) return;
      messenger.clearSnackBars();
      if (columns.isEmpty) {
        _toast('No citation data for this club / year.');
        return;
      }
      final cols = <ReportColumn>[
        const ReportColumn('clubName', 'Club Name', width: 28),
      ];
      for (final c in columns) {
        if (c is Map) {
          cols.add(ReportColumn(
              '${c['type']}-${c['questionId']}', _s(c['title']),
              width: 18));
        }
      }
      final rows = <Map<String, dynamic>>[];
      for (final r in _rows(m['rows'])) {
        final row = <String, dynamic>{'clubName': _s(r['clubName'])};
        final cells = (r['cells'] as Map?)?.cast<String, dynamic>() ?? const {};
        cells.forEach((k, v) => row[k.toString()] = v);
        rows.add(row);
      }
      if (rows.isEmpty) {
        _toast('No citation data for this club / year.');
        return;
      }
      await _export(
          title: title, fileSuffix: fileSuffix, columns: cols, rows: rows);
    } catch (e) {
      if (!mounted) return;
      messenger.clearSnackBars();
      _toast('Export failed: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Per-section row transforms + columns (field-for-field with the web export)
  // ---------------------------------------------------------------------------

  // 1. Members (Active app users)
  static const _appUserCols = [
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('mobile', 'Mobile Number', width: 16),
    ReportColumn('email', 'Email Id', width: 26),
    ReportColumn('deviceName', 'Device Name', width: 20),
  ];
  List<Map<String, dynamic>> _appUserRows() => _rows(_report?['appUsers'])
      .map((m) => {
            'memberName': _s(m['memberName']),
            'mobile': _s(m['mobile']),
            'email': _s(m['email']),
            'deviceName': _s(m['deviceName']),
          })
      .toList();

  // 2. Board of Directors
  static const _bodCols = [
    ReportColumn('clubName', 'Club Name', width: 22),
    ReportColumn('designation', 'Designation', width: 22),
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('email', 'Email ID', width: 26),
    ReportColumn('mobile', 'Mobile Number', width: 16),
    ReportColumn('autoManual', 'Auto_Manual', width: 14),
  ];
  Map<String, dynamic> _bodRow(Map<String, dynamic> m) => {
        'clubName': _s(m['clubName']),
        'designation': _s(m['designation']),
        'memberName': _s(m['memberName']),
        'email': _s(m['email']),
        'mobile': _s(m['mobile']),
        'autoManual': _s(m['autoManual']),
      };

  Future<void> _exportBod(String? designation) async {
    final raw = _rows(_report?['bod']);
    final filtered = designation == null
        ? raw
        : raw
            .where((r) => _s(r['designation']).trim() == designation)
            .toList();
    await _export(
      title: 'Board of Directors',
      fileSuffix:
          designation == null ? 'Board_of_Directors_All' : 'Board_of_Directors_${_sanitize(designation)}',
      columns: _bodCols,
      rows: filtered.map(_bodRow).toList(),
      extraSubtitle: designation,
    );
  }

  // 3. Members (full list, 20 cols)
  static const _memberCols = [
    ReportColumn('clubName', 'Club Name', width: 22),
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('profilePhoto', 'Profile Photo', width: 14, hyperlink: true),
    ReportColumn('classification', 'Classification', width: 20),
    ReportColumn('clubDesignation', 'Club Designation', width: 20),
    ReportColumn('country', 'Country', width: 14),
    ReportColumn('mobile', 'Mobile', width: 16),
    ReportColumn('email', 'EmailId', width: 26),
    ReportColumn('gender', 'Gender', width: 12),
    ReportColumn('primaryLanguage', 'Primary Language', width: 16),
    ReportColumn('youthFlag', 'Youth Flag', width: 12),
    ReportColumn('dob', 'DOB', width: 12),
    ReportColumn('doa', 'DOA', width: 12),
    ReportColumn('bloodGroup', 'Blood Group', width: 12),
    ReportColumn('deviceName', 'Device Name', width: 18),
    ReportColumn('downloaded', 'Downloaded', width: 12),
    ReportColumn('address', 'Personal Address', width: 32),
    ReportColumn('businessAddress', 'Business Address', width: 32),
    ReportColumn('rotaryId', 'Rotary Id', width: 14),
    ReportColumn('riAdmissionDate', 'RI Admission Date', width: 16),
  ];
  List<Map<String, dynamic>> _memberRows() => _rows(_report?['members'])
      .map((m) => {
            'clubName': _s(m['clubName']),
            'memberName': _s(m['memberName']),
            'profilePhoto': _media(m['profilePhoto']),
            'classification': _s(m['classification']),
            'clubDesignation': _s(m['clubDesignation']),
            'country': _s(m['country']),
            'mobile': _s(m['mobile']),
            'email': _s(m['email']),
            'gender': _s(m['gender']),
            'primaryLanguage': _s(m['primaryLanguage']),
            'youthFlag': _yn(m['youthFlag']),
            // DOB/DOA show day+month only (no birth year) — matches web privacy.
            'dob': _date(m['dob'], withYear: false),
            'doa': _date(m['doa'], withYear: false),
            'bloodGroup': _s(m['bloodGroup']),
            'deviceName': _s(m['deviceName']),
            'downloaded': _yn(m['downloaded']),
            'address': _s(m['address']),
            'rotaryId': _s(m['rotaryId']),
            'riAdmissionDate': _date(m['riAdmissionDate']),
          })
      .toList();

  // 4. Family details (15 cols)
  static const _familyCols = [
    ReportColumn('clubName', 'Club Name', width: 22),
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('mobile', 'Mobile', width: 16),
    ReportColumn('email', 'EmailId', width: 26),
    ReportColumn('dob', 'DOB', width: 12),
    ReportColumn('doa', 'DOA', width: 12),
    ReportColumn('rotaryId', 'Rotary Id', width: 14),
    ReportColumn('address', 'Address', width: 32),
    ReportColumn('familyRelation', 'Family Relation', width: 16),
    ReportColumn('familyName', 'Family Name', width: 22),
    ReportColumn('familyMobile', 'Family Mobile Number', width: 18),
    ReportColumn('familyEmail', 'Family EmailId', width: 24),
    ReportColumn('familyDob', 'Family DOB', width: 12),
    ReportColumn('familyAnniversary', 'Family Anniversary', width: 14),
    ReportColumn('familyBloodGroup', 'Family Blood Group', width: 14),
  ];
  List<Map<String, dynamic>> _familyRows() => _rows(_report?['family'])
      .map((m) => {
            'clubName': _s(m['clubName']),
            'memberName': _s(m['memberName']),
            'mobile': _s(m['mobile']),
            'email': _s(m['email']),
            'dob': _date(m['dob'], withYear: false),
            'doa': _date(m['doa'], withYear: false),
            'rotaryId': _s(m['rotaryId']),
            'address': _s(m['address']),
            'familyRelation': _s(m['familyRelation']),
            'familyName': _s(m['familyName']),
            'familyMobile': _s(m['familyMobile']),
            'familyEmail': _s(m['familyEmail']),
            'familyDob': _date(m['familyDob'], withYear: false),
            'familyAnniversary': _date(m['familyAnniversary'], withYear: false),
            'familyBloodGroup': _s(m['familyBloodGroup']),
          })
      .toList();

  // 8. Attendance (Meeting Wise) — 11 cols
  static const _attMeetingCols = [
    ReportColumn('date', 'Date', width: 16),
    ReportColumn('title', 'Event Name', width: 24),
    ReportColumn('description', 'Description', width: 30),
    ReportColumn('membersPresent', 'Members Present', width: 16),
    ReportColumn('totalMembers', 'Total Members', width: 14),
    ReportColumn('attendancePercent', 'Attendance %', width: 14),
    ReportColumn('anns', 'Anns', width: 10),
    ReportColumn('annets', 'Annets', width: 10),
    ReportColumn('visitors', 'Visitors', width: 10),
    ReportColumn('rotarians', 'Rotarians', width: 10),
    ReportColumn('delegates', 'Delegates', width: 10),
  ];
  List<Map<String, dynamic>> _attMeetingRows() =>
      _rows(_report?['attendanceMeetingWise'])
          .map((m) => {
                'date': _date(m['date']),
                'title': _s(m['title']),
                'description': _s(m['description']),
                'membersPresent': _s(m['membersPresent']),
                'totalMembers': _s(m['totalMembers']),
                'attendancePercent': _s(m['attendancePercent']),
                'anns': _s(m['anns']),
                'annets': _s(m['annets']),
                'visitors': _s(m['visitors']),
                'rotarians': _s(m['rotarians']),
                'delegates': _s(m['delegates']),
              })
          .toList();

  // 9. Attendance (Member Wise) — 6 cols
  static const _attMemberCols = [
    ReportColumn('memberName', 'Member Name', width: 24),
    ReportColumn('mobile', 'Mobile', width: 16),
    ReportColumn('email', 'Email', width: 26),
    ReportColumn('meetingsAttended', 'Meetings Attended', width: 16),
    ReportColumn('totalMeetings', 'Total Meetings', width: 14),
    ReportColumn('attendancePercent', 'Attendance %', width: 14),
  ];
  List<Map<String, dynamic>> _attMemberRows() =>
      _rows(_report?['attendanceMemberWise'])
          .map((m) => {
                'memberName': _s(m['memberName']),
                'mobile': _s(m['mobile']),
                'email': _s(m['email']),
                'meetingsAttended': _s(m['meetingsAttended']),
                'totalMeetings': _s(m['totalMeetings']),
                'attendancePercent': _s(m['attendancePercent']),
              })
          .toList();

  // 11. Club Monthly Report — 9 cols (+ totals row)
  static const _monthlyCols = [
    ReportColumn('month', 'Month', width: 16),
    ReportColumn('meeting', 'Meeting', width: 12),
    ReportColumn('trf', 'TRF', width: 12),
    ReportColumn('projects', 'Projects', width: 12),
    ReportColumn('cost', 'Cost', width: 14),
    ReportColumn('beneficiaries', 'Beneficiaries', width: 14),
    ReportColumn('manHours', 'Man Hours', width: 12),
    ReportColumn('rotariansInvolved', 'Rotarians Involved', width: 16),
    ReportColumn('rotaractors', 'Rotaractors', width: 12),
  ];
  List<Map<String, dynamic>> _monthlyRows() {
    final raw = _rows(_report?['monthlyReport']);
    final rows = raw
        .map((m) => {
              'month': _s(m['month']),
              'meeting': _s(m['meeting']),
              'trf': _s(m['trf']),
              'projects': _s(m['projects']),
              'cost': _s(m['cost']),
              'beneficiaries': _s(m['beneficiaries']),
              'manHours': _s(m['manHours']),
              'rotariansInvolved': _s(m['rotariansInvolved']),
              'rotaractors': _s(m['rotaractors']),
            })
        .toList();
    if (rows.isEmpty) return rows;
    num sum(String k) => raw.fold<num>(
        0, (s, m) => s + (num.tryParse(_s(m[k])) ?? 0));
    String n(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);
    rows.add({
      'month': 'Total',
      'meeting': n(sum('meeting')),
      'trf': n(sum('trf')),
      'projects': n(sum('projects')),
      'cost': n(sum('cost')),
      'beneficiaries': n(sum('beneficiaries')),
      'manHours': n(sum('manHours')),
      'rotariansInvolved': n(sum('rotariansInvolved')),
      'rotaractors': n(sum('rotaractors')),
    });
    return rows;
  }

  // 17. TRF Contributions — 4 cols
  static const _trfCols = [
    ReportColumn('trfDate', 'Date', width: 16),
    ReportColumn('donorName', 'Member Name', width: 26),
    ReportColumn('fundName', 'Fund', width: 24),
    ReportColumn('amountUsd', 'Amount (USD)', width: 16),
  ];
  List<Map<String, dynamic>> _trfRows() => _rows(_report?['trf'])
      .map((m) => {
            'trfDate': _date(m['trfDate']),
            'donorName': _s(m['donorName']),
            'fundName': _s(m['fundName']),
            'amountUsd': _s(m['amountUsd']),
          })
      .toList();

  // 18. Announcements — 6 cols
  static const _announcementCols = [
    ReportColumn('title', 'Title', width: 26),
    ReportColumn('description', 'Description', width: 34),
    ReportColumn('imagePath', 'Image', width: 12, hyperlink: true),
    ReportColumn('publishDate', 'Publish Date', width: 16),
    ReportColumn('expiryDate', 'Expiry Date', width: 16),
    ReportColumn('status', 'Status', width: 12),
  ];
  List<Map<String, dynamic>> _announcementRows() =>
      _rows(_report?['announcements'])
          .map((m) => {
                'title': _s(m['title']),
                'description': _s(m['description']),
                'imagePath': _media(m['imagePath']),
                'publishDate': _date(m['publishDate']),
                'expiryDate': _date(m['expiryDate']),
                'status': _s(m['status']),
              })
          .toList();

  // 19. Upcoming Events — 8 cols
  static const _eventCols = [
    ReportColumn('title', 'Title', width: 26),
    ReportColumn('description', 'Description', width: 34),
    ReportColumn('eventDate', 'Event Date', width: 16),
    ReportColumn('eventVenue', 'Venue', width: 22),
    ReportColumn('imagePath', 'Image', width: 12, hyperlink: true),
    ReportColumn('registrationLink', 'Registration', width: 14, hyperlink: true),
    ReportColumn('publishDate', 'Publish Date', width: 16),
    ReportColumn('status', 'Status', width: 12),
  ];
  List<Map<String, dynamic>> _eventRows() => _rows(_report?['events'])
      .map((m) => {
            'title': _s(m['title']),
            'description': _s(m['description']),
            'eventDate': _date(m['eventDate']),
            'eventVenue': _s(m['eventVenue']),
            'imagePath': _media(m['imagePath']),
            'registrationLink': _media(m['registrationLink']),
            'publishDate': _date(m['publishDate']),
            'status': _s(m['status']),
          })
      .toList();

  // 20. Newsletters — 6 cols
  static const _newsletterCols = [
    ReportColumn('title', 'Title', width: 26),
    ReportColumn('publishDate', 'Publish Date', width: 16),
    ReportColumn('expiryDate', 'Expiry', width: 16),
    ReportColumn('attachmentType', 'Type', width: 12),
    ReportColumn('status', 'Status', width: 12),
    ReportColumn('openUrl', 'Open Newsletter', width: 16, hyperlink: true),
  ];
  List<Map<String, dynamic>> _newsletterRows() => _rows(_report?['newsletters'])
      .map((m) {
        final raw = _s(m['filePath']).isNotEmpty ? m['filePath'] : m['linkUrl'];
        return {
          'title': _s(m['title']),
          'publishDate': _date(m['publishDate']),
          'expiryDate': _date(m['expiryDate']),
          'attachmentType': _s(m['attachmentType']),
          'status': _s(m['status']),
          'openUrl': _media(raw),
        };
      }).toList();

  // 21. Documents — 5 cols
  static const _documentCols = [
    ReportColumn('title', 'Title', width: 26),
    ReportColumn('accessType', 'Access', width: 14),
    ReportColumn('publishDate', 'Publish', width: 16),
    ReportColumn('expiryDate', 'Expiry', width: 16),
    ReportColumn('filePath', 'Open Document', width: 16, hyperlink: true),
  ];
  List<Map<String, dynamic>> _documentRows() => _rows(_report?['documents'])
      .map((m) => {
            'title': _s(m['title']),
            'accessType': _s(m['accessType']),
            'publishDate': _date(m['publishDate']),
            'expiryDate': _date(m['expiryDate']),
            'filePath': _media(m['filePath']),
          })
      .toList();

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : const CustomAppBar(title: 'Club Report'),
      body: Column(
        children: [
          if (_years.isNotEmpty) _yearBar(),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    final r = _report;
    if (r == null) {
      return const EmptyStateWidget(
        title: 'No report data',
        icon: Icons.assessment_outlined,
      );
    }

    final club = (r['club'] as Map?)?.cast<String, dynamic>() ?? const {};
    final hasDistrict = club['fkDistrictId'] != null &&
        _s(club['fkDistrictId']).isNotEmpty &&
        _s(club['fkDistrictId']) != '0';
    final attMeeting = _rows(r['attendanceMeetingWise']);
    final hasAttendance = attMeeting.isNotEmpty;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
        children: [
          _introCard(club),
          const SizedBox(height: 16),

          // ---------------- MEMBERS ----------------
          _groupHeader('Members'),
          // Terminated + Potential Members — from the club's Rotary Network
          // (fetched on tap). Often 0 records, matching the web.
          _serverTile(
            icon: Icons.person_off_rounded,
            group: _Group.members,
            title: 'Terminated Members',
            subtitle: 'Excel',
            onExcel: () => _exportRows(_fetchTerminated, _terminatedCols,
                'Terminated Members', 'Terminated_Members'),
          ),
          _serverTile(
            icon: Icons.person_add_alt_1_rounded,
            group: _Group.members,
            title: 'Potential Members',
            subtitle: 'Excel',
            onExcel: () => _exportRows(_fetchPotential, _potentialCols,
                'Potential Members', 'Potential_Members'),
          ),
          _exportTile(
            icon: Icons.groups_rounded,
            group: _Group.members,
            title: 'Members (Active users in ${Brand.current.productName} App)',
            count: _rows(r['appUsers']).length,
            onExport: () => _export(
              title: 'App Active Users',
              fileSuffix: 'App_Active_Users',
              columns: _appUserCols,
              rows: _appUserRows(),
            ),
            columns: _appUserCols,
            rows: _appUserRows(),
          ),
          _BodTile(
            color: _groupColor(_Group.members),
            bod: _rows(r['bod']),
            disabled: _exporting,
            onExport: _exportBod,
          ),
          _exportTile(
            icon: Icons.people_alt_rounded,
            group: _Group.members,
            title: 'Members',
            count: _rows(r['members']).length,
            onExport: () => _export(
              title: 'Members',
              fileSuffix: 'Members',
              columns: _memberCols,
              rows: _memberRows(),
            ),
            columns: _memberCols,
            rows: _memberRows(),
          ),
          _exportTile(
            icon: Icons.family_restroom_rounded,
            group: _Group.members,
            title: 'Family details',
            count: _rows(r['family']).length,
            onExport: () => _export(
              title: 'Family Details',
              fileSuffix: 'Family_Details',
              columns: _familyCols,
              rows: _familyRows(),
            ),
            columns: _familyCols,
            rows: _familyRows(),
          ),
          _exportTile(
            icon: Icons.bloodtype_rounded,
            group: _Group.members,
            title: 'Blood Group',
            count: _bloodGroupRows().length,
            onExport: () => _export(
              title: 'Blood Group',
              fileSuffix: 'Blood_Group',
              columns: _bloodGroupCols,
              rows: _bloodGroupRows(),
            ),
            columns: _bloodGroupCols,
            rows: _bloodGroupRows(),
          ),

          // ---------------- CLUBS ----------------
          const SizedBox(height: 8),
          _groupHeader('Clubs'),
          // Club Analytics + Goal Setting — server-generated Excel workbooks.
          _serverTile(
            icon: Icons.insights_rounded,
            group: _Group.clubs,
            title: 'Club Analytics',
            subtitle: 'Per-club counts · Excel',
            onExcel: _downloadClubAnalytics,
          ),
          // Goal Setting report hidden while the feature is off for release.
          if (kGoalSettingEnabled)
            _serverTile(
              icon: Icons.flag_rounded,
              group: _Group.clubs,
              title: 'Goal Setting (Month wise & Till date)',
              subtitle: 'Membership / TRF / Youth / Public Image · Excel',
              onExcel: _downloadGoalSetting,
            ),
          if (hasAttendance) ...[
            _exportTile(
              icon: Icons.event_available_rounded,
              group: _Group.clubs,
              title: 'Attendance (Meeting Wise)',
              count: attMeeting.length,
              onExport: () => _export(
                title: 'Attendance (Meeting Wise)',
                fileSuffix: 'Attendance_Meeting_Wise',
                columns: _attMeetingCols,
                rows: _attMeetingRows(),
              ),
            columns: _attMeetingCols,
            rows: _attMeetingRows(),
            ),
            _exportTile(
              icon: Icons.how_to_reg_rounded,
              group: _Group.clubs,
              title: 'Attendance (Member Wise)',
              count: _rows(r['attendanceMemberWise']).length,
              onExport: () => _export(
                title: 'Attendance (Member Wise)',
                fileSuffix: 'Attendance_Member_Wise',
                columns: _attMemberCols,
                rows: _attMemberRows(),
              ),
            columns: _attMemberCols,
            rows: _attMemberRows(),
            ),
          ],
          _exportTile(
            icon: Icons.payments_rounded,
            group: _Group.clubs,
            title: 'Club Dues',
            count: _duesRows().length,
            onExport: () => _export(
              title: 'Club Dues',
              fileSuffix: 'Club_Dues',
              columns: _duesCols(),
              rows: _duesRows(),
            ),
            columns: _duesCols(),
            rows: _duesRows(),
          ),
          _exportTile(
            icon: Icons.bar_chart_rounded,
            group: _Group.clubs,
            title: 'Club Monthly Report',
            count: _rows(r['monthlyReport']).length,
            onExport: () => _export(
              title: 'Club Monthly Report',
              fileSuffix: 'Club_Monthly_Report',
              columns: _monthlyCols,
              rows: _monthlyRows(),
            ),
            columns: _monthlyCols,
            rows: _monthlyRows(),
          ),
          _exportTile(
            icon: Icons.workspace_premium_rounded,
            group: _Group.clubs,
            title: 'Avenue of Service',
            count: _avenueRows().length,
            onExport: () => _export(
              title: 'Avenue of Service',
              fileSuffix: 'Avenue_Of_Service',
              columns: _avenueCols,
              rows: _avenueRows(),
            ),
            columns: _avenueCols,
            rows: _avenueRows(),
          ),
          // Annual Report (Word) — server-generated .docx (membership + club
          // service + all avenues, with photos).
          _serverTile(
            icon: Icons.menu_book_rounded,
            group: _Group.clubs,
            title: 'Annual Report (Word)',
            subtitle: 'Club Service + all avenues + membership · with photos',
            onWord: _downloadAnnualWord,
          ),
          // Governor's Official Visit (OCV/GOV) — this club, BOTH Word + Excel
          // (server-generated: all sub-modules + uploaded documents).
          _serverTile(
            icon: Icons.travel_explore_rounded,
            group: _Group.clubs,
            title: "Governor's Official Visit (OCV/GOV)",
            subtitle: 'All sub-modules + uploaded documents',
            onExcel: () => _downloadOcv('excel'),
            onWord: () => _downloadOcv('word'),
          ),
          _exportTile(
            icon: Icons.volunteer_activism_rounded,
            group: _Group.clubs,
            title: 'TRF Contributions',
            count: _rows(r['trf']).length,
            onExport: () => _export(
              title: 'TRF Contributions',
              fileSuffix: 'TRF_Contributions',
              columns: _trfCols,
              rows: _trfRows(),
            ),
            columns: _trfCols,
            rows: _trfRows(),
          ),
          _exportTile(
            icon: Icons.campaign_rounded,
            group: _Group.clubs,
            title: 'Announcements',
            count: _rows(r['announcements']).length,
            onExport: () => _export(
              title: 'Announcements',
              fileSuffix: 'Announcements',
              columns: _announcementCols,
              rows: _announcementRows(),
            ),
            columns: _announcementCols,
            rows: _announcementRows(),
          ),
          _exportTile(
            icon: Icons.event_rounded,
            group: _Group.clubs,
            title: 'Upcoming Events',
            count: _rows(r['events']).length,
            onExport: () => _export(
              title: 'Upcoming Events',
              fileSuffix: 'Upcoming_Events',
              columns: _eventCols,
              rows: _eventRows(),
            ),
            columns: _eventCols,
            rows: _eventRows(),
          ),
          _exportTile(
            icon: Icons.newspaper_rounded,
            group: _Group.clubs,
            title: 'Newsletters',
            count: _rows(r['newsletters']).length,
            onExport: () => _export(
              title: 'Newsletters',
              fileSuffix: 'Newsletters',
              columns: _newsletterCols,
              rows: _newsletterRows(),
            ),
            columns: _newsletterCols,
            rows: _newsletterRows(),
          ),
          _exportTile(
            icon: Icons.folder_rounded,
            group: _Group.clubs,
            title: 'Documents',
            count: _rows(r['documents']).length,
            onExport: () => _export(
              title: 'Documents',
              fileSuffix: 'Documents',
              columns: _documentCols,
              rows: _documentRows(),
            ),
            columns: _documentCols,
            rows: _documentRows(),
          ),

          // ---------------- DISTRICT ----------------
          if (hasDistrict) ...[
            const SizedBox(height: 8),
            _groupHeader('District'),
            // District Awards + Extended — citation matrix for this club
            // (fetched on tap). Extended = the compact variant, same data.
            _serverTile(
              icon: Icons.emoji_events_rounded,
              group: _Group.district,
              title: 'District Awards',
              subtitle: 'Excel',
              onExcel: () => _exportCitation('District Awards', 'District_Awards'),
            ),
            _serverTile(
              icon: Icons.emoji_events_rounded,
              group: _Group.district,
              title: 'District Awards Extended',
              subtitle: 'Excel',
              onExcel: () => _exportCitation(
                  'District Awards Extended', 'District_Awards_Extended'),
            ),
          ],
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // UI pieces
  // ---------------------------------------------------------------------------

  Widget _yearBar() {
    return RotaryYearBar<int>(
      value: _yearId,
      options: _years
          .map((y) => RotaryYearOption<int>(
                value: y.id,
                label: y.label,
                isCurrent: y.isCurrent,
              ))
          .toList(),
      onChanged: _exporting
          ? null
          : (v) {
              setState(() => _yearId = v);
              _load();
            },
    );
  }

  Widget _introCard(Map<String, dynamic> club) {
    final name = club['clubName']?.toString() ?? 'Club';
    final year = _yearLabel();
    final ryLine = year.isEmpty
        ? 'comprehensive club activity report'
        : 'RY $year: comprehensive club activity report';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primaryPrime.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.primaryPrime.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.assessment_rounded,
                    color: AppColors.primaryPrime, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: AppFonts.display(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      ryLine,
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Divider(height: 1, color: AppColors.primaryPrime.withValues(alpha: 0.15)),
          const SizedBox(height: 12),
          Text(
            'Section Exports',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Download each module as a styled Excel workbook.',
            style: AppFonts.body(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _groupHeader(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 6, 2, 10),
      child: Row(
        children: [
          Text(
            text,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(child: const Divider(height: 1, color: AppColors.border)),
        ],
      ),
    );
  }

  Color _groupColor(_Group g) {
    switch (g) {
      case _Group.members:
        return AppColors.primaryPrime;
      case _Group.clubs:
        return AppColors.accentGreen;
      case _Group.district:
        return AppColors.accentAmber;
    }
  }

  Widget _exportTile({
    required IconData icon,
    required _Group group,
    required String title,
    required int count,
    required VoidCallback onExport,
    required List<ReportColumn> columns,
    required List<Map<String, dynamic>> rows,
  }) {
    final enabled = count > 0 && !_exporting;
    // Collapsible on-screen table (same columns as the export) + the Excel
    // download button as the header trailing.
    return ReportSectionCard(
      title: title,
      columns: columns,
      rows: rows,
      icon: icon,
      accent: _groupColor(group),
      trailing: _ExcelButton(onTap: enabled ? onExport : null),
    );
  }

  Widget _comingSoonTile({required IconData icon, required String title}) {
    return _ReportTile(
      icon: icon,
      iconColor: AppColors.slate400,
      title: title,
      subtitle: 'Coming Soon',
      subtitleColor: AppColors.accentAmber,
      dimmed: true,
      trailing: const _SoonPill(),
    );
  }

  /// A row for a server-generated file download — Excel and/or Word buttons.
  Widget _serverTile({
    required IconData icon,
    required _Group group,
    required String title,
    required String subtitle,
    VoidCallback? onExcel,
    VoidCallback? onWord,
  }) {
    final buttons = <Widget>[];
    if (onExcel != null) {
      buttons.add(_ExcelButton(onTap: _exporting ? null : onExcel));
    }
    if (onWord != null) {
      if (buttons.isNotEmpty) buttons.add(const SizedBox(width: 8));
      buttons.add(_WordButton(onTap: _exporting ? null : onWord));
    }
    return _ReportTile(
      icon: icon,
      iconColor: _groupColor(group),
      title: title,
      subtitle: subtitle,
      trailing: Row(mainAxisSize: MainAxisSize.min, children: buttons),
    );
  }
}

// =============================================================================
// Reusable row tile
// =============================================================================

enum _Group { members, clubs, district }

class _ReportTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final Color? subtitleColor;
  final Widget trailing;
  final Widget? filter;
  final bool dimmed;

  const _ReportTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.trailing,
    this.subtitleColor,
    this.filter,
    this.dimmed = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: dimmed ? 0.06 : 0.12),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, color: iconColor, size: 21),
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
                        color: dimmed
                            ? AppColors.textSecondary
                            : AppColors.textPrimary,
                        height: 1.25,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: subtitleColor ?? AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              trailing,
            ],
          ),
          if (filter != null) ...[
            const SizedBox(height: 12),
            filter!,
          ],
        ],
      ),
    );
  }
}

class _ExcelButton extends StatelessWidget {
  final VoidCallback? onTap;
  const _ExcelButton({this.onTap});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final fg = enabled ? AppColors.primaryPrime : AppColors.textMuted; // ROW actions are azure, not status green
    return Material(
      color: enabled
          ? AppColors.primaryPrime.withValues(alpha: 0.10)
          : AppColors.muted,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.download_rounded, size: 16, color: fg),
              const SizedBox(width: 6),
              Text(
                'Excel',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WordButton extends StatelessWidget {
  final VoidCallback? onTap;
  const _WordButton({this.onTap});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final fg = enabled ? AppColors.rotaryBlue : AppColors.textMuted;
    return Material(
      color: enabled
          ? AppColors.rotaryBlue.withValues(alpha: 0.10)
          : AppColors.muted,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.description_rounded, size: 16, color: fg),
              const SizedBox(width: 6),
              Text(
                'Word',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SoonPill extends StatelessWidget {
  const _SoonPill();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.accentAmber.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        'Soon',
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: AppColors.accentAmber,
        ),
      ),
    );
  }
}

// =============================================================================
// Board of Directors tile (with designation filter)
// =============================================================================

class _BodTile extends StatefulWidget {
  final Color color;
  final List<Map<String, dynamic>> bod;
  final bool disabled;
  final Future<void> Function(String? designation) onExport;

  const _BodTile({
    required this.color,
    required this.bod,
    required this.disabled,
    required this.onExport,
  });

  @override
  State<_BodTile> createState() => _BodTileState();
}

class _BodTileState extends State<_BodTile> {
  static const _all = '__all__';
  String _selected = _all;

  List<String> get _designations {
    final set = <String>{};
    for (final r in widget.bod) {
      final d = (r['designation'] ?? '').toString().trim();
      if (d.isNotEmpty) set.add(d);
    }
    final list = set.toList()..sort();
    return list;
  }

  int get _count => _selected == _all
      ? widget.bod.length
      : widget.bod
          .where((r) => (r['designation'] ?? '').toString().trim() == _selected)
          .length;

  @override
  Widget build(BuildContext context) {
    final enabled = _count > 0 && !widget.disabled;
    final designations = _designations;
    return _ReportTile(
      icon: Icons.account_circle_rounded,
      iconColor: widget.color,
      title: 'Board of Directors (BOD)',
      subtitle: '$_count record${_count == 1 ? '' : 's'}'
          '${_selected == _all ? '' : ' · filtered'}',
      trailing: _ExcelButton(
        onTap: enabled
            ? () => widget.onExport(_selected == _all ? null : _selected)
            : null,
      ),
      filter: designations.isEmpty
          ? null
          : Row(
              children: [
                const Icon(Icons.filter_list_rounded,
                    size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _selected,
                    isDense: true,
                    isExpanded: true,
                    decoration: InputDecoration(
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                    ),
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                    items: [
                      const DropdownMenuItem(
                          value: _all, child: Text('All Designations')),
                      ...designations.map(
                          (d) => DropdownMenuItem(value: d, child: Text(d))),
                    ],
                    onChanged: widget.disabled
                        ? null
                        : (v) => setState(() => _selected = v ?? _all),
                  ),
                ),
              ],
            ),
    );
  }
}

// =============================================================================

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
