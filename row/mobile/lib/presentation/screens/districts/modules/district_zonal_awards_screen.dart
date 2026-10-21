import 'dart:convert';
import 'dart:io';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:provider/provider.dart';

import '../../../../core/constants/api_constants.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../../core/utils/file_download_utils.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/rotary_year_bar.dart';

// ============================================================================
// Helpers
// ============================================================================

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse(v?.toString() ?? '') ?? 0;
}

num _asNum(dynamic v) {
  if (v is num) return v;
  return num.tryParse(v?.toString() ?? '') ?? 0;
}

String _ptsStr(num v) =>
    v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

// ============================================================================
// Models — keys match GetDistrictZonalAwards (DistrictModulesController).
// ============================================================================

class _Year {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _Year(
      {required this.id, required this.yearLabel, this.isCurrent = false});

  factory _Year.fromJson(Map<String, dynamic> j) => _Year(
        id: _asInt(j['id']),
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _Goal {
  final int id;
  final String title;
  final num maxPoints;
  final int sortOrder;
  const _Goal(
      {required this.id,
      required this.title,
      this.maxPoints = 0,
      this.sortOrder = 0});

  factory _Goal.fromJson(Map<String, dynamic> j) => _Goal(
        id: _asInt(j['id']),
        title: j['title']?.toString() ?? j['name']?.toString() ?? '',
        maxPoints: _asNum(j['maxPoints']),
        sortOrder: _asInt(j['sortOrder']),
      );
}

class _Question {
  final int id;
  final int goalId;
  final String autoOrManual; // 'Auto' | 'Manual'
  final String questionLevel; // 'Zone' | 'District'
  final String srNo;
  final String subTitle;
  final String category;
  final int sortOrder;

  const _Question({
    required this.id,
    required this.goalId,
    required this.autoOrManual,
    this.questionLevel = 'District',
    this.srNo = '',
    this.subTitle = '',
    this.category = '',
    this.sortOrder = 0,
  });

  factory _Question.fromJson(Map<String, dynamic> j) => _Question(
        id: _asInt(j['id']),
        goalId: _asInt(j['goalId']),
        autoOrManual: j['autoOrManual']?.toString() ?? 'Manual',
        questionLevel: j['questionLevel']?.toString() ?? 'District',
        srNo: j['srNo']?.toString() ?? '',
        subTitle: j['subTitle']?.toString() ?? '',
        category:
            j['category']?.toString() ?? j['questionText']?.toString() ?? '',
        sortOrder: _asInt(j['sortOrder']),
      );
}

class _Option {
  final int id;
  final int questionId;
  final String label;
  final String pointsLabel;
  final num mini;
  final num maxi;
  final num points;
  final num atleast;
  final int subtype;
  final String inputType; // 'Option1' | 'Option2' | ''
  final String importType;
  final int sortOrder;

  const _Option({
    required this.id,
    required this.questionId,
    this.label = '',
    this.pointsLabel = '',
    this.mini = 0,
    this.maxi = 0,
    this.points = 0,
    this.atleast = 0,
    this.subtype = 0,
    this.inputType = '',
    this.importType = '',
    this.sortOrder = 0,
  });

  factory _Option.fromJson(Map<String, dynamic> j) => _Option(
        id: _asInt(j['id']),
        questionId: _asInt(j['questionId']),
        label: j['label']?.toString() ?? j['optionText']?.toString() ?? '',
        pointsLabel: j['pointsLabel']?.toString() ?? '',
        mini: _asNum(j['mini']),
        maxi: _asNum(j['maxi']),
        points: _asNum(j['points']),
        atleast: _asNum(j['atleast']),
        subtype: _asInt(j['subtype']),
        inputType: j['inputType']?.toString() ?? '',
        importType: j['importType']?.toString() ?? '',
        sortOrder: _asInt(j['sortOrder']),
      );

  bool get isNo => label == 'No' || label.contains('- No');
}

class _Entry {
  num enteredCounts;
  num receivedPoints;
  _Entry({this.enteredCounts = 0, this.receivedPoints = 0});
}

// ============================================================================
// Screen
// ============================================================================

class DistrictZonalAwardsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictZonalAwardsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictZonalAwardsScreen> createState() =>
      _DistrictZonalAwardsScreenState();
}

class _DistrictZonalAwardsScreenState extends State<DistrictZonalAwardsScreen> {
  final _api = ApiClient();

  bool _loading = true;
  bool _saving = false;
  bool _downloadingYearly = false;
  bool _downloadingMonthly = false;
  String? _error;

  List<_Year> _years = [];
  int? _selectedYearId;
  int? _currentYearId;

  List<_Goal> _goals = [];
  List<_Question> _questions = [];
  List<_Option> _options = [];
  final Map<int, _Entry> _entries = {};

  // Web parity: all sections are open by default (auto/manual expanded, zone
  // always shown) so auto-generated points like "A1. Number of New Rotary
  // Clubs" are visible without first tapping the section header.
  bool _zoneExpanded = true;
  bool _autoExpanded = true;
  bool _manualExpanded = true;

  @override
  void initState() {
    super.initState();
    _loadYears();
  }

  // ---------------- data loading ----------------

  Future<void> _loadYears() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      List<_Year> years = [];
      int? currentId;

      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/zonal-awards/available-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (resp.data ?? [])
            .map((e) => _Year.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {
        years = [];
      }

      if (years.isEmpty) {
        try {
          final resp = await _api.get<List<dynamic>>(
            '/api/rotary-years',
            fromJson: (j) => j as List<dynamic>,
          );
          final all = (resp.data ?? [])
              .map((e) => _Year.fromJson(e as Map<String, dynamic>))
              .toList();
          final cur = all.where((y) => y.isCurrent).toList();
          years = cur.isNotEmpty ? cur : (all.isNotEmpty ? [all.first] : []);
        } catch (_) {}
      }

      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        final all = (resp.data ?? [])
            .map((e) => _Year.fromJson(e as Map<String, dynamic>))
            .toList();
        final cur = all.firstWhere(
          (y) => y.isCurrent,
          orElse: () => const _Year(id: 0, yearLabel: ''),
        );
        if (cur.id != 0) currentId = cur.id;
      } catch (_) {}

      int? selected;
      if (years.isNotEmpty) {
        final cur = years.firstWhere(
          (y) => y.isCurrent,
          orElse: () => years.first,
        );
        selected = cur.id;
      }

      setState(() {
        _years = years;
        _selectedYearId = selected;
        _currentYearId = currentId ??
            years
                .firstWhere((y) => y.isCurrent,
                    orElse: () => const _Year(id: 0, yearLabel: ''))
                .id;
      });

      if (_selectedYearId != null) {
        await _loadData();
      } else {
        setState(() => _loading = false);
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadData() async {
    if (_selectedYearId == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/zonal-awards',
        queryParams: {'yearId': _selectedYearId},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? {};

      final goals = ((data['goals'] as List?) ?? [])
          .map((e) => _Goal.fromJson(e as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

      final questions = ((data['questions'] as List?) ?? [])
          .map((e) => _Question.fromJson(e as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

      final options = ((data['options'] as List?) ?? [])
          .map((e) => _Option.fromJson(e as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

      final entries = <int, _Entry>{};
      final rawEntries = data['entries'];
      if (rawEntries is Map) {
        rawEntries.forEach((k, v) {
          final optId = int.tryParse(k.toString()) ?? 0;
          if (optId == 0 || v is! Map) return;
          entries[optId] = _Entry(
            enteredCounts: _asNum(v['enteredCounts']),
            receivedPoints: _asNum(v['receivedPoints']),
          );
        });
      }

      setState(() {
        _goals = goals;
        _questions = questions;
        _options = options;
        _entries
          ..clear()
          ..addAll(entries);
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // ---------------- helpers ----------------

  List<_Option> _optionsFor(int qId) =>
      _options.where((o) => o.questionId == qId).toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

  bool _isZoneQuestion(_Question q) => q.questionLevel == 'Zone';

  num _optionCounts(int optId) => _entries[optId]?.enteredCounts ?? 0;
  num _optionPoints(int optId) => _entries[optId]?.receivedPoints ?? 0;

  /// Mirrors the web `getInputMode`.
  String _inputMode(List<_Option> opts) {
    final subtypes = opts.map((o) => o.subtype).where((s) => s != 0).toSet();
    if (subtypes.isNotEmpty) return 'multi-subtype';
    if (opts.any((o) => o.importType.isNotEmpty)) return 'independent-number';
    if (opts.every((o) => o.mini == 0 && o.maxi == 0 && o.inputType.isEmpty)) {
      return 'radio';
    }
    return 'range-or-number';
  }

  void _selectRadio(List<_Option> opts, int selectedOptId) {
    setState(() {
      for (final o in opts) {
        _entries[o.id] = o.id == selectedOptId
            ? _Entry(enteredCounts: 1, receivedPoints: o.points)
            : _Entry(enteredCounts: 0, receivedPoints: 0);
      }
    });
  }

  /// Independent per-option number (points = count × points).
  void _setIndependentNumber(_Option opt, String value) {
    final n = num.tryParse(value.trim()) ?? 0;
    setState(() {
      _entries[opt.id] =
          _Entry(enteredCounts: n, receivedPoints: n > 0 ? n * opt.points : 0);
    });
  }

  /// Range-matched number across a group of options. The entered count selects
  /// the option whose [mini, maxi] band it falls in; points = count × points.
  void _setRangeNumber(List<_Option> opts, String value) {
    final val = num.tryParse(value.trim()) ?? 0;
    _Option matched = opts.first;
    for (final o in opts) {
      if (val > o.mini && val <= o.maxi) {
        matched = o;
        break;
      }
      if (o.maxi > 0 && val >= o.maxi) matched = o;
    }
    setState(() {
      for (final o in opts) {
        _entries[o.id] = _Entry(enteredCounts: 0, receivedPoints: 0);
      }
      _entries[matched.id] =
          _Entry(enteredCounts: val, receivedPoints: val * matched.points);
    });
  }

  num _rangeCounts(List<_Option> opts) =>
      opts.fold<num>(0, (s, o) => s + _optionCounts(o.id));
  num _rangePoints(List<_Option> opts) =>
      opts.fold<num>(0, (s, o) => s + _optionPoints(o.id));

  /// Yes/No toggle for a subtype that may control the next subtype's radios.
  void _setYesNoPair(
      Map<int, List<_Option>> groups, int subtype, bool isYes) {
    final stOpts = groups[subtype];
    if (stOpts == null) return;
    final yesOpt = stOpts.firstWhere((o) => !o.isNo, orElse: () => stOpts.first);
    final noOpt = stOpts.firstWhere((o) => o.isNo, orElse: () => stOpts.last);
    setState(() {
      if (isYes) {
        _entries[yesOpt.id] =
            _Entry(enteredCounts: 1, receivedPoints: yesOpt.points);
        _entries[noOpt.id] = _Entry(enteredCounts: 0, receivedPoints: 0);
      } else {
        _entries[yesOpt.id] = _Entry(enteredCounts: 0, receivedPoints: 0);
        _entries[noOpt.id] = _Entry(enteredCounts: 1, receivedPoints: 0);
        final next = groups[subtype + 1];
        if (next != null) {
          for (final o in next) {
            _entries[o.id] = _Entry(enteredCounts: 0, receivedPoints: 0);
          }
        }
      }
    });
  }

  bool _isYesNoSubtype(List<_Option> stOpts) =>
      stOpts.length == 2 && stOpts.any((o) => o.isNo);

  bool _yesNoState(List<_Option> stOpts) {
    final yesOpt =
        stOpts.firstWhere((o) => !o.isNo, orElse: () => stOpts.first);
    return _optionCounts(yesOpt.id) == 1;
  }

  // ---------------- totals ----------------

  num _autoTotal() {
    num t = 0;
    for (final q in _questions
        .where((q) => q.autoOrManual == 'Auto' && !_isZoneQuestion(q))) {
      for (final o in _optionsFor(q.id)) {
        t += _optionPoints(o.id);
      }
    }
    return t;
  }

  num _manualTotal() {
    num t = 0;
    for (final q in _questions
        .where((q) => q.autoOrManual == 'Manual' && !_isZoneQuestion(q))) {
      for (final o in _optionsFor(q.id)) {
        t += _optionPoints(o.id);
      }
    }
    return t;
  }

  num _zoneTotal() {
    num t = 0;
    for (final q in _questions.where(_isZoneQuestion)) {
      for (final o in _optionsFor(q.id)) {
        t += _optionPoints(o.id);
      }
    }
    return t;
  }

  // ---------------- save ----------------

  Future<void> _saveManual() async {
    if (_selectedYearId == null) return;
    setState(() => _saving = true);
    try {
      final manualQIds = _questions
          .where((q) => q.autoOrManual == 'Manual' && !_isZoneQuestion(q))
          .map((q) => q.id)
          .toSet();

      final payload = <Map<String, dynamic>>[];
      _entries.forEach((optId, entry) {
        final opt = _options.firstWhere(
          (o) => o.id == optId,
          orElse: () => const _Option(id: 0, questionId: 0),
        );
        if (opt.id == 0) return;
        if (!manualQIds.contains(opt.questionId)) return;
        payload.add({
          'optionId': optId,
          'enteredCounts': entry.enteredCounts,
          'receivedPoints': entry.receivedPoints,
        });
      });

      if (payload.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content: Text(
                    'Please enter values for at least one manual question.')),
          );
        }
        return;
      }

      // resetOnError:false so a transient keystore hiccup can't silently DELETE
      // the auth token (see AuthProvider). Guarded read: a failure degrades to
      // an unauth attempt instead of throwing; the token is left intact.
      const storage = FlutterSecureStorage(
        aOptions: AndroidOptions(resetOnError: false),
        iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
      );
      String? token;
      try {
        token = await storage.read(key: AppConstants.tokenKey);
      } catch (_) {
        token = null;
      }
      final uri = Uri.parse(
        '${ApiConstants.baseUrl}/api/districts/${widget.districtId}/zonal-awards/save-manual',
      ).replace(queryParameters: {'yearId': _selectedYearId.toString()});
      final http.Client client;
      if (Platform.isIOS && !kDebugMode) {
        client = CupertinoClient.defaultSessionConfiguration();
      } else {
        final httpClient = HttpClient();
        if (kDebugMode) {
          httpClient.badCertificateCallback = (_, __, ___) => true;
        }
        client = IOClient(httpClient);
      }
      final resp = await client.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode(payload),
      );
      client.close();

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        String msg = 'Manual entries saved.';
        try {
          final decoded = jsonDecode(resp.body);
          if (decoded is Map && decoded['message'] is String) {
            msg = decoded['message'] as String;
          }
        } catch (_) {}
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(msg)));
        }
        await _loadData();
      } else {
        String errMsg = 'Failed to save manual entries.';
        try {
          final decoded = jsonDecode(resp.body);
          if (decoded is Map && decoded['message'] is String) {
            errMsg = decoded['message'] as String;
          }
        } catch (_) {}
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(errMsg)),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ---------------- build ----------------

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isDistAdmin = auth.isDistrictAdminOf(widget.districtId);
    final isCurrent =
        _currentYearId != null && _selectedYearId == _currentYearId;
    final canEdit = isDistAdmin && isCurrent;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar:
          widget.embedded ? null : const CustomAppBar(title: 'Zonal Awards'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadYears)
              : Column(
                  children: [
                    _buildYearSelector(),
                    if (_selectedYearId != null) _buildReportsRow(),
                    Expanded(
                      child: _selectedYearId == null
                          ? const EmptyStateWidget(
                              title: 'No rotary year available',
                              subtitle: 'Configure a rotary year first.',
                              icon: Icons.calendar_month_outlined,
                            )
                          : _buildBody(canEdit, isCurrent),
                    ),
                  ],
                ),
    );
  }

  Widget _buildYearSelector() {
    if (_years.isEmpty) return const SizedBox.shrink();
    return RotaryYearBar<int>(
      value: _selectedYearId,
      options: _years
          .map((y) => RotaryYearOption<int>(
                value: y.id,
                label: y.yearLabel,
                isCurrent: y.isCurrent,
              ))
          .toList(),
      onChanged: (v) {
        if (v == null) return;
        setState(() => _selectedYearId = v);
        _loadData();
      },
    );
  }

  Widget _buildReportsRow() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          OutlinedButton.icon(
            onPressed: _downloadingYearly ? null : _downloadYearlyReport,
            icon: _downloadingYearly
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_outlined, size: 18),
            label: Text(
                _downloadingYearly ? 'Downloading...' : 'Year-wise Report'),
          ),
          OutlinedButton.icon(
            onPressed: _downloadingMonthly ? null : _downloadMonthlyReport,
            icon: _downloadingMonthly
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_outlined, size: 18),
            label: Text(
                _downloadingMonthly ? 'Downloading...' : 'Month-wise Report'),
          ),
        ],
      ),
    );
  }

  Future<void> _downloadYearlyReport() async {
    if (_selectedYearId == null) return;
    setState(() => _downloadingYearly = true);
    try {
      final bytes = await _api.downloadBytes(
        '/api/zonal-awards/report/yearly/excel',
        queryParams: {'yearId': _selectedYearId},
      );
      await saveAndOpenBytes(bytes, 'zonal_awards_yearly_report.xlsx');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to download report: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloadingYearly = false);
    }
  }

  Future<void> _downloadMonthlyReport() async {
    if (_selectedYearId == null) return;
    setState(() => _downloadingMonthly = true);
    try {
      final bytes = await _api.downloadBytes(
        '/api/zonal-awards/report/monthly/excel',
        queryParams: {'yearId': _selectedYearId},
      );
      await saveAndOpenBytes(bytes, 'zonal_awards_monthly_report.xlsx');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to download report: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloadingMonthly = false);
    }
  }

  Widget _buildBody(bool canEdit, bool isCurrent) {
    final zoneQs = _questions.where(_isZoneQuestion).toList();
    final autoGoals = _goals
        .where((g) => _questions.any((q) =>
            q.goalId == g.id &&
            q.autoOrManual == 'Auto' &&
            !_isZoneQuestion(q)))
        .toList();
    final manualGoals = _goals
        .where((g) => _questions.any((q) =>
            q.goalId == g.id &&
            q.autoOrManual == 'Manual' &&
            !_isZoneQuestion(q)))
        .toList();

    if (_goals.isEmpty && _questions.isEmpty) {
      return const EmptyStateWidget(
        title: 'No Zonal Awards configured',
        subtitle: 'No goals or questions found for this year.',
        icon: Icons.military_tech_outlined,
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        children: [
          _buildStatsStrip(),
          const SizedBox(height: 12),
          if (autoGoals.isNotEmpty)
            _buildSection(
              title: 'Auto Generated Points',
              icon: Icons.auto_awesome_outlined,
              total: _autoTotal(),
              color: AppColors.accentBlue,
              expanded: _autoExpanded,
              onToggle: () => setState(() => _autoExpanded = !_autoExpanded),
              goals: autoGoals,
              auto: true,
              canEdit: false,
            ),
          if (zoneQs.isNotEmpty) _buildZoneSection(zoneQs),
          if (manualGoals.isNotEmpty)
            _buildSection(
              title: 'Manual Points',
              icon: Icons.edit_note_outlined,
              total: _manualTotal(),
              color: AppColors.success,
              expanded: _manualExpanded,
              onToggle: () => setState(() => _manualExpanded = !_manualExpanded),
              goals: manualGoals,
              auto: false,
              canEdit: canEdit,
            ),
          if (canEdit && manualGoals.isNotEmpty) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _saving ? null : _saveManual,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.save),
                label: Text(_saving ? 'Saving...' : 'Save Manual'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ],
          if (!canEdit && !isCurrent)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Viewing past-year data (read-only). Editing past years is '
                'restricted to SuperAdmin.',
                textAlign: TextAlign.center,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary),
              ),
            ),
        ],
      ),
    );
  }

  // ---------------- stats strip ----------------

  Widget _buildStatsStrip() {
    final zone = _zoneTotal();
    final auto = _autoTotal();
    final manual = _manualTotal();
    final grand = zone + auto + manual;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: _statCard(
              label: 'Auto Generated Points',
              value: auto,
              border: AppColors.primaryLight,
              background: AppColors.muted,
              labelColor: AppColors.accentBlue,
              valueColor: AppColors.primaryPrime,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _statCard(
              label: 'Manual Points',
              value: manual,
              border: AppColors.successLight,
              background: AppColors.successTint,
              labelColor: AppColors.success,
              valueColor: AppColors.successDark,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _statCard(
              label: 'Total Points',
              value: grand,
              border: AppColors.warningLight,
              background: AppColors.background,
              labelColor: AppColors.warningDark,
              valueColor: AppColors.warningInk,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statCard({
    required String label,
    required num value,
    required Color border,
    required Color background,
    required Color labelColor,
    required Color valueColor,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      decoration: BoxDecoration(
        color: background,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.caption.copyWith(
              color: labelColor,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value.toStringAsFixed(0),
            style: TextStyle(
              color: valueColor,
              fontSize: 24,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  // ---------------- sections ----------------

  Widget _buildSection({
    required String title,
    required IconData icon,
    required num total,
    required Color color,
    required bool expanded,
    required VoidCallback onToggle,
    required List<_Goal> goals,
    required bool auto,
    required bool canEdit,
  }) {
    return _sectionShell(
      title: '$title: ${total.toStringAsFixed(0)}',
      icon: icon,
      color: color,
      expanded: expanded,
      onToggle: onToggle,
      children:
          goals.map((g) => _buildGoalBlock(g, auto: auto, canEdit: canEdit)).toList(),
    );
  }

  Widget _buildZoneSection(List<_Question> zoneQs) {
    return _sectionShell(
      title: 'Zone-Level Awards: ${_zoneTotal().toStringAsFixed(0)}',
      icon: Icons.emoji_events_outlined,
      color: AppColors.accentBlue,
      expanded: _zoneExpanded,
      onToggle: () => setState(() => _zoneExpanded = !_zoneExpanded),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text('Yearly · Set by Zone',
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary)),
        ),
        ...zoneQs.map((q) => _buildQuestionBlock(q, auto: true, canEdit: false)),
      ],
    );
  }

  Widget _buildGoalBlock(_Goal g, {required bool auto, required bool canEdit}) {
    final qs = _questions
        .where((q) =>
            q.goalId == g.id &&
            !_isZoneQuestion(q) &&
            (auto ? q.autoOrManual == 'Auto' : q.autoOrManual == 'Manual'))
        .toList();
    if (qs.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.muted,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    g.title.trim().isEmpty ? 'Goal' : g.title,
                    style: AppTextStyles.bodyMedium.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
                if (g.maxPoints > 0)
                  Text(
                    'Max: ${_ptsStr(g.maxPoints)} pts',
                    style: AppTextStyles.caption.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary,
                    ),
                  ),
              ],
            ),
          ),
          ...qs.map((q) => _buildQuestionBlock(q, auto: auto, canEdit: canEdit)),
        ],
      ),
    );
  }

  Widget _buildQuestionBlock(_Question q,
      {required bool auto, required bool canEdit}) {
    final opts = _optionsFor(q.id);

    final header = [
      if (q.srNo.isNotEmpty) '${q.srNo}.',
      if (q.category.isNotEmpty) q.category,
    ].join(' ');

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 4),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (header.trim().isNotEmpty)
            Text(header,
                style: AppTextStyles.bodyMedium
                    .copyWith(fontWeight: FontWeight.w700)),
          if (q.subTitle.trim().isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(q.subTitle,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary)),
          ],
          // The criteria line (srNo + category) always shows — matching the
          // web. Options/score rows render only when the question has them.
          if (opts.isNotEmpty) ...[
            const SizedBox(height: 6),
            const Divider(color: AppColors.divider, height: 1),
            const SizedBox(height: 6),
            ..._buildOptions(q, opts, editable: !auto && canEdit),
          ],
        ],
      ),
    );
  }

  // ---------------- option rendering (mirrors web renderQuestionOptions) ----

  List<Widget> _buildOptions(_Question q, List<_Option> opts,
      {required bool editable}) {
    final mode = _inputMode(opts);

    if (mode == 'independent-number') {
      return opts
          .map((o) => editable
              ? _editNumberRow(o, perUnit: true)
              : _readOnlyRow(o))
          .toList();
    }

    if (mode == 'multi-subtype') {
      final groups = <int, List<_Option>>{};
      for (final o in opts) {
        groups.putIfAbsent(o.subtype, () => []).add(o);
      }
      final subtypes = groups.keys.toList()..sort();
      final widgets = <Widget>[];
      for (final st in subtypes) {
        final stOpts = groups[st]!;
        if (_isYesNoSubtype(stOpts)) {
          widgets.add(_yesNoRow(q, st, groups, editable: editable));
          continue;
        }
        final controlledBy = st - 1;
        final isControlled = groups.containsKey(controlledBy) &&
            _isYesNoSubtype(groups[controlledBy]!);
        final enabled =
            !isControlled || _yesNoState(groups[controlledBy]!);
        final isNumber = stOpts.first.inputType == 'Option1' ||
            stOpts.first.inputType == 'Option2';
        if (isNumber) {
          widgets.add(_rangeRow(stOpts, editable: editable && enabled));
        } else {
          widgets.addAll(stOpts.map((o) =>
              _radioRow(stOpts, o, editable: editable && enabled)));
        }
      }
      return widgets;
    }

    if (mode == 'radio') {
      return opts.map((o) => _radioRow(opts, o, editable: editable)).toList();
    }

    // range-or-number
    if (!editable) {
      return [_readOnlyRangeRow(opts)];
    }
    return [_rangeRow(opts, editable: true)];
  }

  // ---- read-only rows ----

  Widget _readOnlyRow(_Option o) {
    final counts = _optionCounts(o.id);
    final pts = _optionPoints(o.id);
    return _optionRow(
      label: o.label.isEmpty ? '–' : o.label,
      pointsLabel: o.pointsLabel,
      trailing: 'count ${_ptsStr(counts)} · pts ${_ptsStr(pts)}',
      highlight: pts > 0,
    );
  }

  Widget _readOnlyRangeRow(List<_Option> opts) {
    final counts = _rangeCounts(opts);
    final pts = _rangePoints(opts);
    final label = opts.map((o) => o.label).where((l) => l.isNotEmpty).join(' / ');
    final ptsLabel =
        opts.map((o) => o.pointsLabel).where((l) => l.isNotEmpty).join(' / ');
    return _optionRow(
      label: label.isEmpty ? '–' : label,
      pointsLabel: ptsLabel,
      trailing: 'count ${_ptsStr(counts)} · pts ${_ptsStr(pts)}',
      highlight: pts > 0,
    );
  }

  Widget _optionRow({
    required String label,
    String pointsLabel = '',
    required String trailing,
    bool highlight = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textPrimary)),
                if (pointsLabel.trim().isNotEmpty)
                  Text(pointsLabel,
                      style: AppTextStyles.caption.copyWith(
                          color: AppColors.textSecondary, fontSize: 11)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            trailing,
            style: AppTextStyles.caption.copyWith(
              color: highlight ? AppColors.primary : AppColors.textSecondary,
              fontWeight: highlight ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  // ---- editable rows ----

  Widget _radioRow(List<_Option> groupOpts, _Option o,
      {required bool editable}) {
    final selected = _optionCounts(o.id) == 1;
    if (!editable) {
      return _optionRow(
        label: o.label.isEmpty ? '–' : o.label,
        pointsLabel: o.pointsLabel,
        trailing: selected ? 'Selected · ${_ptsStr(o.points)}' : '–',
        highlight: selected,
      );
    }
    return RadioListTile<int>(
      dense: true,
      visualDensity: const VisualDensity(horizontal: -2, vertical: -2),
      contentPadding: EdgeInsets.zero,
      value: o.id,
      // ignore: deprecated_member_use
      groupValue: selected ? o.id : -1,
      title: Text(o.label.isEmpty ? '–' : o.label,
          style: AppTextStyles.caption.copyWith(color: AppColors.textPrimary)),
      subtitle: Text(
        o.pointsLabel.isNotEmpty ? o.pointsLabel : '${_ptsStr(o.points)} pts',
        style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
      ),
      activeColor: AppColors.primary,
      // ignore: deprecated_member_use
      onChanged: (_) => _selectRadio(groupOpts, o.id),
    );
  }

  Widget _yesNoRow(_Question q, int subtype, Map<int, List<_Option>> groups,
      {required bool editable}) {
    final stOpts = groups[subtype]!;
    final yesOpt =
        stOpts.firstWhere((o) => !o.isNo, orElse: () => stOpts.first);
    final hasEntry = _entries.containsKey(yesOpt.id);
    final isYes = _optionCounts(yesOpt.id) == 1;
    final earned = _optionPoints(yesOpt.id);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(yesOpt.label.isEmpty ? '–' : yesOpt.label,
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textPrimary)),
          if (yesOpt.pointsLabel.isNotEmpty)
            Text(yesOpt.pointsLabel,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary, fontSize: 11)),
          const SizedBox(height: 4),
          if (!editable)
            Text(
              !hasEntry ? 'N/A' : (isYes ? 'Yes · ${_ptsStr(earned)}' : 'No'),
              style: AppTextStyles.caption.copyWith(
                color: !hasEntry
                    ? AppColors.textSecondary
                    : (isYes ? AppColors.success : AppColors.error),
                fontWeight: FontWeight.w700,
              ),
            )
          else
            Row(
              children: [
                _ynChip('Yes', hasEntry && isYes,
                    () => _setYesNoPair(groups, subtype, true)),
                const SizedBox(width: 8),
                _ynChip('No', hasEntry && !isYes,
                    () => _setYesNoPair(groups, subtype, false)),
              ],
            ),
        ],
      ),
    );
  }

  Widget _ynChip(String label, bool selected, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.background,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
              color: selected ? AppColors.primary : AppColors.border),
        ),
        child: Text(
          label,
          style: AppTextStyles.caption.copyWith(
            color: selected ? Colors.white : AppColors.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  /// Independent per-option number (count × per-unit points).
  Widget _editNumberRow(_Option o, {bool perUnit = false}) {
    final counts = _optionCounts(o.id);
    final pts = _optionPoints(o.id);
    final ctrl = TextEditingController(
        text: counts == 0 ? '' : _ptsStr(counts));
    ctrl.selection =
        TextSelection.fromPosition(TextPosition(offset: ctrl.text.length));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(o.label.isEmpty ? '–' : o.label,
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textPrimary)),
          if (o.pointsLabel.isNotEmpty)
            Text(o.pointsLabel,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary, fontSize: 11)),
          const SizedBox(height: 6),
          Row(
            children: [
              SizedBox(
                width: 90,
                child: TextField(
                  controller: ctrl,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyMedium
                      .copyWith(fontWeight: FontWeight.w700),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: '0',
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                  ),
                  onChanged: (v) => _setIndependentNumber(o, v),
                ),
              ),
              const SizedBox(width: 8),
              _ptsBadge(pts),
            ],
          ),
        ],
      ),
    );
  }

  /// Range-matched number across an option group (the count picks the band).
  Widget _rangeRow(List<_Option> opts, {required bool editable}) {
    final counts = _rangeCounts(opts);
    final pts = _rangePoints(opts);
    final label = opts.map((o) => o.label).where((l) => l.isNotEmpty).join(' / ');
    final ptsLabel =
        opts.map((o) => o.pointsLabel).where((l) => l.isNotEmpty).join(' / ');
    if (!editable) {
      return _optionRow(
        label: label.isEmpty ? '–' : label,
        pointsLabel: ptsLabel,
        trailing: 'count ${_ptsStr(counts)} · pts ${_ptsStr(pts)}',
        highlight: pts > 0,
      );
    }
    final ctrl = TextEditingController(
        text: counts == 0 ? '' : _ptsStr(counts));
    ctrl.selection =
        TextSelection.fromPosition(TextPosition(offset: ctrl.text.length));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (label.isNotEmpty)
            Text(label,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textPrimary)),
          if (ptsLabel.isNotEmpty)
            Text(ptsLabel,
                style: AppTextStyles.caption
                    .copyWith(color: AppColors.textSecondary, fontSize: 11)),
          const SizedBox(height: 6),
          Row(
            children: [
              SizedBox(
                width: 90,
                child: TextField(
                  controller: ctrl,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodyMedium
                      .copyWith(fontWeight: FontWeight.w700),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: '0',
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                  ),
                  onChanged: (v) => _setRangeNumber(opts, v),
                ),
              ),
              const SizedBox(width: 8),
              _ptsBadge(pts),
            ],
          ),
        ],
      ),
    );
  }

  Widget _ptsBadge(num pts) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        '= ${_ptsStr(pts)}',
        style: AppTextStyles.caption
            .copyWith(color: AppColors.primary, fontWeight: FontWeight.w700),
      ),
    );
  }

  // ---------------- section shell ----------------

  Widget _sectionShell({
    required String title,
    required IconData icon,
    required Color color,
    required bool expanded,
    required VoidCallback onToggle,
    required List<Widget> children,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.background,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Material(
                color: color,
                child: InkWell(
                  onTap: onToggle,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 12),
                    child: Row(
                      children: [
                        Icon(icon, size: 20, color: Colors.white),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            title,
                            style: AppTextStyles.bodyMedium.copyWith(
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        Icon(
                          expanded
                              ? Icons.keyboard_arrow_up_rounded
                              : Icons.keyboard_arrow_down_rounded,
                          color: Colors.white,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (expanded)
                Container(
                  color: AppColors.background,
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: children,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
