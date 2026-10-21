import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/services/monthly_report_pdf.dart';
import '../../../../../core/services/monthly_report_word.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/rotary_year_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../projects/projects_screen.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Club Monthly Report — List + 4-tab Editor (web parity)
//   Tabs: Meetings → TRF → Projects → Members Info
// ─────────────────────────────────────────────────────────────────────────────

class ClubMonthlyReportScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const ClubMonthlyReportScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<ClubMonthlyReportScreen> createState() =>
      _ClubMonthlyReportScreenState();
}

const List<String> _kMonthNamesFull = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const List<Map<String, String>> _kMeetingTypes = [
  {'value': 'regular', 'label': 'Regular'},
  {'value': 'fellowship', 'label': 'Fellowship'},
  {'value': 'bod', 'label': 'BOD'},
  {'value': 'assembly', 'label': 'Assembly'},
  {'value': 'trust', 'label': 'Trust'},
];

String _meetingTypeLabel(String? v) {
  if (v == null) return '';
  for (final m in _kMeetingTypes) {
    if (m['value'] == v) return m['label']!;
  }
  return v;
}

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

double _asDouble(dynamic v) {
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0.0;
  return 0.0;
}

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

List<dynamic> _asList(dynamic resp) {
  if (resp is List) return resp;
  if (resp is Map<String, dynamic>) {
    final items = resp['items'];
    if (items is List) return items;
    final data = resp['data'];
    if (data is List) return data;
  }
  return const [];
}

class _ClubMonthlyReportScreenState extends State<ClubMonthlyReportScreen> {
  final _api = ApiClient();

  String _clubName = '';
  List<dynamic> _rotaryYears = [];
  List<dynamic> _months = [];
  int? _selectedYearId;
  String _selectedYearLabel = '';
  bool _loadingYears = true;
  bool _loadingMonths = false;
  int? _downloadingMonth;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await Future.wait([_loadClubName(), _loadRotaryYears()]);
    if (_selectedYearId != null) {
      await _loadMonths(_selectedYearId!);
    }
  }

  Future<void> _loadClubName() async {
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}',
        fromJson: (j) => j,
      );
      final data = resp.data;
      if (data is Map && data['clubName'] != null && mounted) {
        setState(() => _clubName = data['clubName'].toString());
      }
    } catch (_) {
      // Title falls back to generic "Club Monthly Reports".
    }
  }

  Future<void> _loadRotaryYears() async {
    setState(() => _loadingYears = true);
    try {
      var years = <dynamic>[];
      try {
        final resp = await _api.get(
          '/api/clubs/${widget.clubId}/monthly-reports/years',
          fromJson: (j) => j,
        );
        years = _asList(resp.data);
      } catch (_) {}
      if (years.isEmpty) {
        try {
          final resp = await _api.get('/api/rotary-years', fromJson: (j) => j);
          years = _asList(resp.data);
        } catch (_) {}
      }

      int? yearId;
      String label = '';
      if (years.isNotEmpty) {
        final current = years.firstWhere(
          (y) => _asBool((y as Map)['isCurrent']),
          orElse: () => years.first,
        );
        yearId = _asInt((current as Map)['id']);
        label = current['yearLabel']?.toString() ?? '';
      }
      if (!mounted) return;
      setState(() {
        _rotaryYears = years;
        _selectedYearId = yearId;
        _selectedYearLabel = label;
      });
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load years');
    } finally {
      if (mounted) setState(() => _loadingYears = false);
    }
  }

  Future<void> _loadMonths(int yearId) async {
    setState(() => _loadingMonths = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/monthly-reports/months/$yearId',
        fromJson: (j) => j,
      );
      if (!mounted) return;
      setState(() => _months = _asList(resp.data));
    } catch (_) {
      if (!mounted) return;
      setState(() => _months = []);
      SnackbarUtils.showError(context, 'Failed to load months');
    } finally {
      if (mounted) setState(() => _loadingMonths = false);
    }
  }

  Future<void> _onMonthTap(Map<String, dynamic> monthItem) async {
    final month = _asInt(monthItem['month']);
    if (_selectedYearId == null || month == 0) return;
    final isCreated = _asBool(monthItem['isCreated']);
    int? reportId = monthItem['reportId'] != null
        ? _asInt(monthItem['reportId'])
        : null;

    if (!isCreated || reportId == null) {
      try {
        final resp = await _api.post(
          '/api/clubs/${widget.clubId}/monthly-reports/init/$_selectedYearId/$month',
          body: const <String, dynamic>{},
          fromJson: (j) => j,
        );
        final data = resp.data;
        if (data is Map && data['reportId'] != null) {
          reportId = _asInt(data['reportId']);
        }
      } catch (_) {
        if (mounted) {
          SnackbarUtils.showError(context, 'Failed to initialize report');
        }
        return;
      }
    }

    if (!mounted) return;
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _MonthlyReportTabsPage(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          yearLabel: _selectedYearLabel,
          month: month,
          reportId: reportId,
          // Per-level gating: force view-only when the user is not a
          // club admin of THIS club, in addition to any explicit viewOnly.
          viewOnly: widget.viewOnly ||
              !Provider.of<AuthProvider>(context, listen: false)
                  .isClubAdminOf(widget.clubId),
        ),
      ),
    );
    if (changed == true && mounted && _selectedYearId != null) {
      await _loadMonths(_selectedYearId!);
    }
  }

  Future<void> _downloadReport(int month, String format) async {
    if (_selectedYearId == null) return;
    setState(() => _downloadingMonth = month);
    try {
      if (format == 'pdf') {
        final pdf = MonthlyReportPdfService();
        final path = await pdf.generateAndSavePdf(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          month: month,
        );
        if (mounted) {
          SnackbarUtils.showSuccess(context, 'PDF saved: opening...');
        }
        await pdf.openFile(path);
      } else if (format == 'word') {
        final word = MonthlyReportWordService();
        final path = await word.generateAndSaveDocx(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          month: month,
        );
        if (mounted) {
          SnackbarUtils.showSuccess(context, 'Word file saved: opening...');
        }
        await word.openFile(path);
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException && e.message.isNotEmpty
            ? 'Failed to generate report: ${e.message}'
            : 'Failed to generate report';
        SnackbarUtils.showError(context, msg);
      }
    } finally {
      if (mounted) setState(() => _downloadingMonth = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = _clubName.isNotEmpty
        ? '$_clubName - Club Monthly Reports'
        : 'Club Monthly Reports';
    return Scaffold(
      appBar: widget.embedded ? null : CustomAppBar(title: title),
      body: Column(
        children: [
          _buildYearBar(),
          Expanded(
            child: _loadingYears
                ? const LoadingWidget()
                : _rotaryYears.isEmpty
                    ? const EmptyStateWidget(
                        title: 'No rotary years configured')
                    : _loadingMonths
                        ? const LoadingWidget()
                        : RefreshIndicator(
                            onRefresh: () async {
                              if (_selectedYearId != null) {
                                await _loadMonths(_selectedYearId!);
                              }
                            },
                            child: _buildMonthList(),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildYearBar() {
    return RotaryYearBar<int>(
      value: _selectedYearId,
      options: _rotaryYears.map((y) {
        final m = y as Map;
        return RotaryYearOption<int>(
          value: _asInt(m['id']),
          label: m['yearLabel']?.toString() ?? '',
          isCurrent: _asBool(m['isCurrent']),
        );
      }).toList(),
      onChanged: (v) {
        if (v == null) return;
        final label = _rotaryYears.firstWhere(
          (y) => _asInt((y as Map)['id']) == v,
          orElse: () => const {'yearLabel': ''},
        )['yearLabel']
                ?.toString() ??
            '';
        setState(() {
          _selectedYearId = v;
          _selectedYearLabel = label;
          _months = [];
        });
        _loadMonths(v);
      },
    );
  }

  Widget _buildMonthList() {
    final items = List<Map<String, dynamic>>.from(
        _months.map((e) => Map<String, dynamic>.from(e as Map)));
    if (items.isEmpty) {
      return const EmptyStateWidget(title: 'No months found for this year');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      physics: const AlwaysScrollableScrollPhysics(),
      // +1 for the header row.
      itemCount: items.length + 1,
      itemBuilder: (_, i) {
        if (i == 0) return _buildTableHeader();
        return _buildMonthRow(items[i - 1], i);
      },
    );
  }

  Widget _buildTableHeader() {
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: const BoxDecoration(
        color: AppColors.primary,
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(10)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 36,
            child: Text('#',
                style: AppTextStyles.caption.copyWith(
                    color: Colors.white, fontWeight: FontWeight.w700)),
          ),
          Expanded(
            flex: 4,
            child: Text('Month',
                style: AppTextStyles.caption.copyWith(
                    color: Colors.white, fontWeight: FontWeight.w700)),
          ),
          Expanded(
            flex: 4,
            child: Text('Status',
                textAlign: TextAlign.center,
                style: AppTextStyles.caption.copyWith(
                    color: Colors.white, fontWeight: FontWeight.w700)),
          ),
          SizedBox(
            width: 96,
            child: Text('Actions',
                textAlign: TextAlign.center,
                style: AppTextStyles.caption.copyWith(
                    color: Colors.white, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  Widget _buildMonthRow(Map<String, dynamic> item, int rowIndex) {
    final monthNum = _asInt(item['month']);
    final monthName = item['monthName']?.toString() ??
        (monthNum >= 1 && monthNum <= 12 ? _kMonthNamesFull[monthNum] : '?');
    final isCreated = _asBool(item['isCreated']);
    final isUploaded = _asBool(item['isUploadedToDistrict']);
    final isDownloading = _downloadingMonth == monthNum;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Colors.grey.shade200),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // S.No.
          SizedBox(
            width: 36,
            child: Text('$rowIndex',
                style: AppTextStyles.body
                    .copyWith(fontWeight: FontWeight.w600)),
          ),
          // Month
          Expanded(
            flex: 4,
            child: Row(
              children: [
                Icon(Icons.calendar_today,
                    size: 14, color: Colors.grey.shade600),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(monthName,
                      style: AppTextStyles.body.copyWith(
                          fontWeight: FontWeight.w600, fontSize: 13),
                      overflow: TextOverflow.ellipsis),
                ),
              ],
            ),
          ),
          // Status
          Expanded(
            flex: 4,
            child: Wrap(
              alignment: WrapAlignment.center,
              spacing: 4,
              runSpacing: 4,
              children: [
                _statusBadge(isCreated, isUploaded),
                if (isUploaded) _uploadedBadge(),
              ],
            ),
          ),
          // Actions
          SizedBox(
            width: 96,
            child: _rowActions(item, monthNum, isCreated, isDownloading),
          ),
        ],
      ),
    );
  }

  Widget _statusBadge(bool isCreated, bool isUploaded) {
    if (isCreated || isUploaded) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.green.shade50,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle,
                size: 12, color: Colors.green.shade700),
            const SizedBox(width: 4),
            Text('Created',
                style: AppTextStyles.caption.copyWith(
                    color: Colors.green.shade800,
                    fontWeight: FontWeight.w600,
                    fontSize: 11)),
          ],
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.grey.shade200,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.schedule, size: 12, color: Colors.amber.shade800),
          const SizedBox(width: 4),
          Text('Pending',
              style: AppTextStyles.caption.copyWith(
                  color: Colors.grey.shade800,
                  fontWeight: FontWeight.w600,
                  fontSize: 11)),
        ],
      ),
    );
  }

  Widget _uploadedBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text('Uploaded',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppTextStyles.caption.copyWith(
              color: Colors.blue.shade800,
              fontWeight: FontWeight.w600,
              fontSize: 10)),
    );
  }

  /// Only a club admin of THIS club (and not forced view-only) may create or
  /// download monthly reports. Members see read-only "View" entries.
  bool get _canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  Widget _rowActions(Map<String, dynamic> item, int monthNum, bool isCreated,
      bool isDownloading) {
    final canManage = _canManage;
    if (!isCreated) {
      // Members can't create a report; show a placeholder instead of the
      // Create button.
      if (!canManage) {
        return const Center(
          child: Text('–', style: TextStyle(color: AppColors.textMuted)),
        );
      }
      return Center(
        child: SizedBox(
          height: 32,
          child: ElevatedButton.icon(
            onPressed: () => _onMonthTap(item),
            icon: const Icon(Icons.add, size: 14),
            label: const Text('Create', style: TextStyle(fontSize: 12)),
            style: ElevatedButton.styleFrom(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
              minimumSize: const Size(0, 32),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ),
      );
    }
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        _iconActionButton(
          icon: canManage ? Icons.edit_outlined : Icons.visibility_outlined,
          tooltip: canManage ? 'Edit' : 'View',
          color: AppColors.primary,
          onTap: () => _onMonthTap(item),
        ),
        // Download is an admin-only action; members don't see it.
        if (!canManage)
          const SizedBox.shrink()
        else ...[
        const SizedBox(width: 4),
        isDownloading
            ? const SizedBox(
                width: 32,
                height: 32,
                child: Center(
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            : PopupMenuButton<String>(
                tooltip: 'Download report',
                onSelected: (format) => _downloadReport(monthNum, format),
                padding: EdgeInsets.zero,
                itemBuilder: (_) => const [
                  PopupMenuItem(
                    value: 'pdf',
                    child: Row(
                      children: [
                        Icon(Icons.picture_as_pdf,
                            size: 18, color: Colors.red),
                        SizedBox(width: 8),
                        Text('Download PDF'),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'word',
                    child: Row(
                      children: [
                        Icon(Icons.description,
                            size: 18, color: Colors.blue),
                        SizedBox(width: 8),
                        Text('Download Word'),
                      ],
                    ),
                  ),
                ],
                child: Container(
                  width: 32,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.grey.shade400),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Icon(Icons.download_rounded,
                      size: 16, color: Colors.grey.shade700),
                ),
              ),
        ],
      ],
    );
  }

  Widget _iconActionButton({
    required IconData icon,
    required String tooltip,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Container(
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border.all(color: Colors.grey.shade400),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(icon, size: 16, color: color),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs Page — 4 tabs: Meetings → TRF → Projects → Members Info
// ─────────────────────────────────────────────────────────────────────────────

class _MonthlyReportTabsPage extends StatefulWidget {
  final int clubId;
  final int yearId;
  final String yearLabel;
  final int month;
  final int? reportId;
  final bool viewOnly;

  const _MonthlyReportTabsPage({
    required this.clubId,
    required this.yearId,
    required this.yearLabel,
    required this.month,
    required this.reportId,
    this.viewOnly = false,
  });

  @override
  State<_MonthlyReportTabsPage> createState() => _MonthlyReportTabsPageState();
}

class _MonthlyReportTabsPageState extends State<_MonthlyReportTabsPage> {
  final _api = ApiClient();

  String _clubName = '';
  int _currentStep = 0;
  bool _loadingDetail = true;
  bool _saving = false;
  bool _dirty = false;
  int? _reportId;

  static const _kStepLabels = ['Meetings', 'TRF', 'Projects', 'Members Info'];
  static const _kStepIcons = [
    Icons.calendar_today,
    Icons.attach_money,
    Icons.folder_open,
    Icons.people,
  ];

  // Members Info controllers
  final _lastMonthCtrl = TextEditingController();
  final _deletedCtrl = TextEditingController();
  final _addedCtrl = TextEditingController();
  final _remarksCtrl = TextEditingController();
  // True while re-deriving the three member counts from live club_members.
  bool _recalculating = false;

  // Meetings
  List<dynamic> _meetings = [];
  bool _meetingsLoaded = false;
  bool _meetingsLoading = false;

  // Projects (grouped by module)
  Map<String, List<dynamic>> _projects = {};
  bool _projectsLoaded = false;
  bool _projectsLoading = false;

  // TRF
  List<_TrfRow> _trfRows = [];
  List<dynamic> _trfFunds = [];
  bool _trfLoaded = false;
  bool _trfLoading = false;

  @override
  void initState() {
    super.initState();
    _reportId = widget.reportId;
    _lastMonthCtrl.addListener(_refresh);
    _deletedCtrl.addListener(_refresh);
    _addedCtrl.addListener(_refresh);
    _loadDetail();
  }

  @override
  void dispose() {
    _lastMonthCtrl.dispose();
    _deletedCtrl.dispose();
    _addedCtrl.dispose();
    _remarksCtrl.dispose();
    for (final r in _trfRows) {
      r.dispose();
    }
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _loadClubName() async {
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}',
        fromJson: (j) => j,
      );
      final data = resp.data;
      if (data is Map && data['clubName'] != null && mounted) {
        setState(() => _clubName = data['clubName'].toString());
      }
    } catch (_) {
      // Title falls back to "Monthly Report".
    }
  }

  Future<void> _loadDetail() async {
    setState(() => _loadingDetail = true);
    // Club name in parallel with init — non-blocking either way.
    _loadClubName();
    try {
      if (_reportId == null) {
        final resp = await _api.post(
          '/api/clubs/${widget.clubId}/monthly-reports/init/${widget.yearId}/${widget.month}',
          body: const <String, dynamic>{},
          fromJson: (j) => j,
        );
        final data = resp.data;
        if (data is Map && data['reportId'] != null) {
          _reportId = _asInt(data['reportId']);
        }
      }
      // Web parity: detail endpoint is path `/detail/{yearId}/{month}`.
      try {
        final resp = await _api.get(
          '/api/clubs/${widget.clubId}/monthly-reports/detail/${widget.yearId}/${widget.month}',
          fromJson: (j) => j,
        );
        final data = resp.data;
        if (data is Map) {
          if (data['reportId'] != null) {
            _reportId = _asInt(data['reportId']);
          }
          _remarksCtrl.text = data['additionalRemarks']?.toString() ?? '';
          // Members Info: auto-fill from live club_members data ONLY the first
          // time (report never saved). modifiedDate is NULL until the first
          // member-info save, so it's the reliable "has been saved" marker.
          // Once saved, always show the admin's edited values — never
          // re-fetch/overwrite. (Web parity: v2 club-monthly-report page.)
          final savedMemberInfo = data['modifiedDate'] != null;
          if (savedMemberInfo) {
            _lastMonthCtrl.text =
                _asInt(data['memberCountLastMonth']).toString();
            _deletedCtrl.text = _asInt(data['membersDeleted']).toString();
            _addedCtrl.text = _asInt(data['membersAdded']).toString();
          } else {
            await _autofillMemberStats();
          }
        }
      } catch (_) {
        // No-op: detail endpoint may not be available or report empty.
      }
      // Parallel initial loads
      await Future.wait([
        _loadMeetings(),
        _loadTrf(),
        _loadProjects(),
      ]);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load report');
    } finally {
      if (mounted) setState(() => _loadingDetail = false);
    }
  }

  int get _computedCurrent {
    final last = int.tryParse(_lastMonthCtrl.text.trim()) ?? 0;
    final del = int.tryParse(_deletedCtrl.text.trim()) ?? 0;
    final add = int.tryParse(_addedCtrl.text.trim()) ?? 0;
    return last - del + add;
  }

  // Derive the three member counts from live club_members data via the
  // member-stats endpoint and write them into the fields. Used both to
  // auto-fill on first load and to recalculate on demand.
  Future<bool> _fetchMemberStats() async {
    final resp = await _api.get(
      '/api/clubs/${widget.clubId}/monthly-reports/member-stats/${widget.yearId}/${widget.month}',
      fromJson: (j) => j,
    );
    final data = resp.data;
    if (data is! Map) return false;
    _lastMonthCtrl.text = _asInt(data['memberCountLastMonth']).toString();
    _deletedCtrl.text = _asInt(data['membersDeleted']).toString();
    _addedCtrl.text = _asInt(data['membersAdded']).toString();
    return true;
  }

  // First-load auto-fill (report never saved). Non-fatal: on failure the
  // fields stay at 0 for manual entry, matching web behaviour.
  Future<void> _autofillMemberStats() async {
    try {
      await _fetchMemberStats();
    } catch (_) {
      // Leave fields at 0 — the compute may fail (no prior year, etc.).
    }
  }

  // Re-derive the three member counts from live club_members data (on demand),
  // overwriting whatever is in the fields. Web parity: "Recalculate" button.
  Future<void> _recalcMemberStats() async {
    setState(() => _recalculating = true);
    try {
      final ok = await _fetchMemberStats();
      if (mounted && ok) {
        SnackbarUtils.showSuccess(context, 'Member counts recalculated');
      }
    } catch (_) {
      if (mounted) {
        SnackbarUtils.showError(context, 'Failed to recalculate member counts');
      }
    } finally {
      if (mounted) setState(() => _recalculating = false);
    }
  }

  // Rotary years run July → June. Calendar year for a report month within
  // year "2025-26" is 2025 for months 7-12, 2026 for months 1-6.
  int get _calendarYear {
    final parts = widget.yearLabel.split('-');
    final startYear = int.tryParse(parts.first) ?? DateTime.now().year;
    return widget.month >= 7 ? startYear : startYear + 1;
  }

  DateTime get _monthStart => DateTime(_calendarYear, widget.month, 1);
  DateTime get _monthEnd =>
      DateTime(_calendarYear, widget.month + 1, 1)
          .subtract(const Duration(days: 1));

  // ── Meetings ─────────────────────────────────────────────
  Future<void> _loadMeetings({bool force = false}) async {
    if (_meetingsLoaded && !force) return;
    if (mounted) setState(() => _meetingsLoading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/monthly-reports/meetings/${widget.yearId}/${widget.month}',
        fromJson: (j) => j,
      );
      if (!mounted) return;
      setState(() {
        _meetings = _asList(resp.data);
        _meetingsLoaded = true;
      });
    } catch (_) {
      // 404/500 — backend may not have aggregated meetings endpoint.
      if (!mounted) return;
      setState(() {
        _meetings = [];
        _meetingsLoaded = true;
      });
    } finally {
      if (mounted) setState(() => _meetingsLoading = false);
    }
  }

  Future<void> _deleteMeeting(int meetingId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete meeting?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      // Meetings are stored as projects under the club_service module.
      await _api.delete(
        '/api/clubs/${widget.clubId}/projects/$meetingId',
      );
      _dirty = true;
      if (mounted) SnackbarUtils.showSuccess(context, 'Meeting deleted');
      await _loadMeetings(force: true);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete meeting');
    }
  }

  Future<void> _openAddEditMeeting({Map<String, dynamic>? existing}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AddEditMeetingPage(
          clubId: widget.clubId,
          yearId: widget.yearId,
          month: widget.month,
          reportId: _reportId,
          yearLabel: widget.yearLabel,
          existing: existing,
        ),
      ),
    );
    if (saved == true) {
      _dirty = true;
      await _loadMeetings(force: true);
    }
  }

  // ── Projects ─────────────────────────────────────────────
  Future<void> _loadProjects({bool force = false}) async {
    if (_projectsLoaded && !force) return;
    if (mounted) setState(() => _projectsLoading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/monthly-reports/projects/${widget.yearId}/${widget.month}',
        fromJson: (j) => j,
      );
      final data = resp.data;
      final grouped = <String, List<dynamic>>{};
      if (data is Map) {
        data.forEach((k, v) {
          if (v is List) grouped[k.toString()] = v;
        });
      }
      if (!mounted) return;
      setState(() {
        _projects = grouped;
        _projectsLoaded = true;
      });
    } catch (_) {
      // 404/500 — backend may not have aggregated projects endpoint.
      if (!mounted) return;
      setState(() {
        _projects = const {};
        _projectsLoaded = true;
      });
    } finally {
      if (mounted) setState(() => _projectsLoading = false);
    }
  }

  Future<void> _deleteProject(int projectId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete project?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
        '/api/clubs/${widget.clubId}/projects/$projectId',
      );
      _dirty = true;
      if (mounted) SnackbarUtils.showSuccess(context, 'Project deleted');
      await _loadProjects(force: true);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete project');
    }
  }

  // ── TRF ──────────────────────────────────────────────────
  Future<void> _loadTrf({bool force = false}) async {
    if (_trfLoaded && !force) return;
    if (mounted) setState(() => _trfLoading = true);
    try {
      if (_trfFunds.isEmpty) {
        try {
          final fr = await _api.get(
            '/api/clubs/${widget.clubId}/trf/funds',
            fromJson: (j) => j,
          );
          _trfFunds = _asList(fr.data);
        } catch (_) {}
      }
      {
        // TRF by-month endpoint — returns entries filed for this club in the
        // given month, independent of the monthly-report id.
        try {
          final resp = await _api.get(
            '/api/clubs/${widget.clubId}/trf/by-month?yearId=${widget.yearId}&month=${widget.month}',
            fromJson: (j) => j,
          );
          final list = _asList(resp.data);
          for (final r in _trfRows) {
            r.dispose();
          }
          _trfRows = list.map((e) => _TrfRow.fromJson(e as Map)).toList();
        } catch (_) {
          // No-op: no existing TRF entries endpoint on this backend.
        }
      }
      if (mounted) setState(() => _trfLoaded = true);
    } catch (_) {
      // Fund list failure or other unexpected issue — mark loaded so the UI
      // can still render with empty funds/rows.
      if (mounted) setState(() => _trfLoaded = true);
    } finally {
      if (mounted) setState(() => _trfLoading = false);
    }
  }

  Future<bool> _saveTrf() async {
    // Drop fully-empty rows (e.g., an extra row added but never filled in).
    final filled = _trfRows.where((r) {
      final donor = r.donorCtrl.text.trim();
      final amount = double.tryParse(r.amountCtrl.text.trim()) ?? 0.0;
      return r.fundId > 0 || donor.isNotEmpty || amount > 0 || r.trfDate != null;
    }).toList();

    // Validate any partially-filled rows.
    for (var i = 0; i < filled.length; i++) {
      final r = filled[i];
      final donor = r.donorCtrl.text.trim();
      final amount = double.tryParse(r.amountCtrl.text.trim()) ?? 0.0;
      if (r.fundId <= 0) {
        if (mounted) {
          SnackbarUtils.showError(context, 'Entry ${i + 1}: select a Fund');
        }
        return false;
      }
      if (donor.isEmpty) {
        if (mounted) {
          SnackbarUtils.showError(
              context, 'Entry ${i + 1}: Donor Name is required');
        }
        return false;
      }
      if (amount <= 0) {
        if (mounted) {
          SnackbarUtils.showError(
              context, 'Entry ${i + 1}: enter a valid Amount');
        }
        return false;
      }
      if (r.trfDate == null) {
        if (mounted) {
          SnackbarUtils.showError(
              context, 'Entry ${i + 1}: select a TRF Date');
        }
        return false;
      }
    }

    if (filled.isEmpty) return true;

    setState(() => _saving = true);
    try {
      // Per-row create (POST) or update (PUT). Web parity:
      //   create: POST /api/clubs/{clubId}/trf      body: {yearId, trfDate, donorName, amountUSD, fundId, otherFundName}
      //   update: PUT  /api/clubs/{clubId}/trf/{id} body: {trfDate, donorName, amountUSD, fundId, otherFundName}
      for (var i = 0; i < filled.length; i++) {
        final r = filled[i];
        final donor = r.donorCtrl.text.trim();
        final amount = double.tryParse(r.amountCtrl.text.trim()) ?? 0.0;
        final other = r.otherFundCtrl.text.trim();
        final base = <String, dynamic>{
          'trfDate': r.trfDate?.toIso8601String(),
          'donorName': donor,
          'amountUSD': amount,
          'fundId': r.fundId,
          'otherFundName': other.isEmpty ? null : other,
        };
        if (r.id <= 0) {
          await _api.post(
            '/api/clubs/${widget.clubId}/trf',
            body: {...base, 'yearId': widget.yearId},
          );
        } else {
          await _api.put(
            '/api/clubs/${widget.clubId}/trf/${r.id}',
            body: base,
          );
        }
      }
      _dirty = true;
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'TRF entries saved');
      }
      // Refetch so newly-created rows pick up their server IDs.
      await _loadTrf(force: true);
      return true;
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException && e.message.isNotEmpty
            ? 'Failed to save TRF: ${e.message}'
            : 'Failed to save TRF';
        SnackbarUtils.showError(context, msg);
      }
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _deleteTrfRow(int index) async {
    if (index < 0 || index >= _trfRows.length) return;
    final row = _trfRows[index];

    // Unsaved local row — just remove.
    if (row.id <= 0) {
      setState(() {
        row.dispose();
        _trfRows.removeAt(index);
      });
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete TRF entry?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;

    try {
      await _api.delete('/api/clubs/${widget.clubId}/trf/${row.id}');
      _dirty = true;
      if (mounted) {
        setState(() {
          row.dispose();
          _trfRows.removeAt(index);
        });
        SnackbarUtils.showSuccess(context, 'TRF entry deleted');
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException && e.message.isNotEmpty
            ? 'Failed to delete TRF: ${e.message}'
            : 'Failed to delete TRF';
        SnackbarUtils.showError(context, msg);
      }
    }
  }

  // ── Members Info — Save & Generate ───────────────────────
  Future<void> _saveAndGenerate() async {
    if (_reportId == null) return;
    setState(() => _saving = true);
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/monthly-reports/member-info/${_reportId!}',
        body: {
          'memberCountLastMonth':
              int.tryParse(_lastMonthCtrl.text.trim()) ?? 0,
          'membersDeleted': int.tryParse(_deletedCtrl.text.trim()) ?? 0,
          'membersAdded': int.tryParse(_addedCtrl.text.trim()) ?? 0,
          'additionalRemarks': _remarksCtrl.text.trim(),
        },
      );
      await _api.post(
        '/api/clubs/${widget.clubId}/monthly-reports/upload-to-district/${_reportId!}',
        body: const <String, dynamic>{},
      );
      _dirty = true;
      if (!mounted) return;
      SnackbarUtils.showSuccess(
          context, 'Report generated and uploaded to district');
      Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to generate report');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Stepper navigation
  // ─────────────────────────────────────────────────────────

  /// Returns false if save failed (callers should not advance the step).
  Future<bool> _saveCurrentStep() async {
    // Only step 1 (TRF) saves on advance. Step 3 (Members Info) is handled
    // by the explicit Save & Generate button on the last step.
    if (_currentStep == 1 && !widget.viewOnly && _trfRows.isNotEmpty) {
      return await _saveTrf();
    }
    return true;
  }

  Future<void> _handleNext() async {
    if (_saving) return;
    final ok = await _saveCurrentStep();
    if (!ok || !mounted) return;
    setState(() => _currentStep = (_currentStep + 1).clamp(0, 3));
  }

  void _handlePrevious() {
    if (_saving || _currentStep == 0) return;
    setState(() => _currentStep = (_currentStep - 1).clamp(0, 3));
  }

  Future<void> _handleSaveAndGenerate() async {
    if (_saving) return;
    final lastMonth = int.tryParse(_lastMonthCtrl.text.trim());
    final deleted = int.tryParse(_deletedCtrl.text.trim());
    final added = int.tryParse(_addedCtrl.text.trim());
    if (lastMonth == null) {
      SnackbarUtils.showError(
          context, 'Member count as on last month is required');
      return;
    }
    if (deleted == null) {
      SnackbarUtils.showError(
          context, 'Members Deleted/Terminated is required');
      return;
    }
    if (added == null) {
      SnackbarUtils.showError(context, 'Members Added is required');
      return;
    }
    await _saveAndGenerate();
  }

  // ─────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final monthName = _kMonthNamesFull[widget.month];
    final title = _clubName.isNotEmpty
        ? '$_clubName - Monthly Report'
        : 'Monthly Report';
    return WillPopScope(
      onWillPop: () async {
        Navigator.of(context).pop(_dirty);
        return false;
      },
      child: Scaffold(
        appBar: CustomAppBar(title: title),
        body: _loadingDetail
            ? const LoadingWidget()
            : Column(
                children: [
                  Container(
                    width: double.infinity,
                    color: Colors.white,
                    padding:
                        const EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: Text(
                      '$monthName ${widget.yearLabel}',
                      style: AppTextStyles.body.copyWith(
                        color: Colors.grey.shade600,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  _buildStepIndicator(),
                  Expanded(
                    child: _buildStepContent(),
                  ),
                  _buildBottomNav(),
                ],
              ),
      ),
    );
  }

  Widget _buildStepIndicator() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(8, 16, 8, 8),
      child: Row(
        children: List.generate(_kStepLabels.length, (index) {
          final isActive = index == _currentStep;
          final isCompleted = index < _currentStep;
          final isLast = index == _kStepLabels.length - 1;

          Color circleColor;
          Color iconColor;
          Color borderColor;
          if (isCompleted) {
            circleColor = Colors.green;
            iconColor = Colors.white;
            borderColor = Colors.green;
          } else if (isActive) {
            circleColor = AppColors.primary;
            iconColor = Colors.white;
            borderColor = AppColors.primary;
          } else {
            circleColor = Colors.transparent;
            iconColor = Colors.grey.shade500;
            borderColor = Colors.grey.shade400;
          }

          return Expanded(
            child: Row(
              mainAxisSize: MainAxisSize.max,
              children: [
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: circleColor,
                          shape: BoxShape.circle,
                          border: Border.all(color: borderColor, width: 2),
                        ),
                        child: Icon(
                          isCompleted ? Icons.check : _kStepIcons[index],
                          color: iconColor,
                          size: 16,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _kStepLabels[index],
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.caption.copyWith(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: isActive
                              ? AppColors.primary
                              : isCompleted
                                  ? Colors.green
                                  : Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!isLast)
                  Container(
                    width: 8,
                    height: 2,
                    color: isCompleted
                        ? Colors.green
                        : Colors.grey.shade300,
                    margin: const EdgeInsets.only(bottom: 18),
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _buildStepContent() {
    switch (_currentStep) {
      case 0:
        return _meetingsTab();
      case 1:
        return _trfTab();
      case 2:
        return _projectsTab();
      case 3:
        return _membersInfoTab();
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildBottomNav() {
    final isLast = _currentStep == 3;
    return SafeArea(
      top: false,
      child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey.shade200)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          if (_currentStep > 0)
            OutlinedButton.icon(
              onPressed: _saving ? null : _handlePrevious,
              icon: const Icon(Icons.arrow_back, size: 16),
              label: const Text('Previous',
                  style: TextStyle(fontSize: 13)),
              style: OutlinedButton.styleFrom(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                minimumSize: const Size(0, 36),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            )
          else
            const SizedBox.shrink(),
          if (isLast)
            // For members (viewOnly), there's nothing to save or generate on
            // the last step — close the read-only viewer instead. For admins,
            // keep the original Save & Generate action.
            Flexible(
              child: widget.viewOnly
                  ? OutlinedButton.icon(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close, size: 16),
                      label: const Text('Close',
                          style: TextStyle(fontSize: 13)),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        minimumSize: const Size(0, 36),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    )
                  : ElevatedButton.icon(
                      onPressed:
                          _saving ? null : _handleSaveAndGenerate,
                      icon: _saving
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.description, size: 16),
                      label: Text(
                        _saving ? 'Saving...' : 'Save & Generate',
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13),
                      ),
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        minimumSize: const Size(0, 36),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
            )
          else
            // In view-only mode the button label drops "Save and " — the
            // underlying _saveCurrentStep is already a no-op for view-only,
            // so the button just advances the step so the member can browse
            // through Meetings → TRF → Projects → Members Info.
            Flexible(
              child: ElevatedButton.icon(
                onPressed: _saving ? null : _handleNext,
                icon: _saving
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.arrow_forward, size: 16),
                label: Text(
                  _saving
                      ? 'Saving...'
                      : (widget.viewOnly ? 'Next' : 'Save and Next'),
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  minimumSize: const Size(0, 36),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
            ),
        ],
      ),
    ),
    );
  }

  // ── Tab 1: Meetings ──────────────────────────────────────
  Widget _meetingsTab() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              if (!widget.viewOnly)
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _saving ? null : () => _openAddEditMeeting(),
                    icon: const Icon(Icons.add),
                    label: const Text('Add Meeting'),
                  ),
                ),
              if (!widget.viewOnly) const SizedBox(width: 8),
              IconButton(
                tooltip: 'Refresh',
                icon: const Icon(Icons.refresh),
                onPressed: _meetingsLoading
                    ? null
                    : () => _loadMeetings(force: true),
              ),
            ],
          ),
        ),
        Expanded(
          child: _meetingsLoading
              ? const LoadingWidget()
              : _meetings.isEmpty
                  ? const EmptyStateWidget(
                      title: 'No meetings recorded for this month')
                  : RefreshIndicator(
                      onRefresh: () => _loadMeetings(force: true),
                      child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                        physics: const AlwaysScrollableScrollPhysics(),
                        itemCount: _meetings.length,
                        itemBuilder: (_, i) => _MeetingCard(
                          data: Map<String, dynamic>.from(
                              _meetings[i] as Map),
                          canManage: !widget.viewOnly,
                          onEdit: () => _openAddEditMeeting(
                              existing: Map<String, dynamic>.from(
                                  _meetings[i] as Map)),
                          onDelete: () {
                            final m =
                                Map<String, dynamic>.from(_meetings[i] as Map);
                            final id = _asInt(m['projectId'] ??
                                m['id'] ??
                                m['attendanceId']);
                            if (id > 0) _deleteMeeting(id);
                          },
                        ),
                      ),
                    ),
        ),
      ],
    );
  }

  // ── Tab 2: TRF ───────────────────────────────────────────
  Widget _trfTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton.icon(
              onPressed: _trfLoading ? null : () => _loadTrf(force: true),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Refresh'),
            ),
          ],
        ),
        if (_trfLoading)
          const Padding(
              padding: EdgeInsets.all(16), child: LoadingWidget())
        else ...[
          for (int i = 0; i < _trfRows.length; i++)
            _buildTrfRow(i, _trfRows[i]),
          if (!widget.viewOnly) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () {
                setState(() => _trfRows.add(_TrfRow.empty()));
              },
              icon: const Icon(Icons.add),
              label: const Text('Add Entry'),
            ),
          ],
        ],
      ],
    );
  }

  Widget _buildTrfRow(int index, _TrfRow row) {
    String? selectedFundName;
    for (final f in _trfFunds) {
      if (_asInt((f as Map)['id']) == row.fundId) {
        selectedFundName = f['fundName']?.toString();
        break;
      }
    }
    final isOther = (selectedFundName ?? row.fundType).toLowerCase() ==
            'others' ||
        (selectedFundName ?? row.fundType).toLowerCase() == 'other';

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Entry ${index + 1}',
                    style: AppTextStyles.body
                        .copyWith(fontWeight: FontWeight.w600)),
                if (!widget.viewOnly)
                  IconButton(
                    icon: const Icon(Icons.delete_outline, color: Colors.red),
                    onPressed: () => _deleteTrfRow(index),
                  ),
              ],
            ),
            DropdownButtonFormField<int>(
              value: row.fundId == 0 ? null : row.fundId,
              decoration: const InputDecoration(labelText: 'Fund'),
              items: _trfFunds.map((f) {
                final m = f as Map;
                return DropdownMenuItem<int>(
                  value: _asInt(m['id']),
                  child: Text(m['fundName']?.toString() ?? ''),
                );
              }).toList(),
              onChanged: (v) {
                setState(() {
                  row.fundId = v ?? 0;
                  row.fundType = _trfFunds.firstWhere(
                    (f) => _asInt((f as Map)['id']) == v,
                    orElse: () => const {'fundName': ''},
                  )['fundName']
                          ?.toString() ??
                      '';
                });
              },
            ),
            if (isOther) ...[
              const SizedBox(height: 8),
              CustomTextField(
                controller: row.otherFundCtrl,
                label: 'Other Fund Name',
              ),
            ],
            const SizedBox(height: 8),
            CustomTextField(controller: row.donorCtrl, label: 'Donor Name'),
            const SizedBox(height: 8),
            CustomTextField(
              controller: row.amountCtrl,
              label: 'Amount (\$ USD)',
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 8),
            InkWell(
              onTap: () async {
                // Clamp to the report's month so the entry shows up under
                // /trf/by-month?yearId=...&month=... after save.
                final monthStart = _monthStart;
                final monthEnd = _monthEnd;
                DateTime initial = row.trfDate ?? monthStart;
                if (initial.isBefore(monthStart)) initial = monthStart;
                if (initial.isAfter(monthEnd)) initial = monthEnd;
                final picked = await showDatePicker(
                  context: context,
                  initialDate: initial,
                  firstDate: monthStart,
                  lastDate: monthEnd,
                );
                if (picked != null) {
                  setState(() => row.trfDate = picked);
                }
              },
              child: InputDecorator(
                decoration: const InputDecoration(labelText: 'TRF Date'),
                child: Text(
                  row.trfDate == null
                      ? 'Select date'
                      : DateFormatter.toDisplay(row.trfDate),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Tab 3: Projects ──────────────────────────────────────
  // Service-type → label (matches web's PROJECT_LABELS).
  static const Map<String, String> _kProjectLabels = {
    'community_service': 'Community Service',
    'vocational_service': 'Vocational Service',
    'international_service': 'International Service',
    'new_generation_service': 'New Generation Service',
    'public_image_initiative': 'Public Image Initiative',
  };

  String? _addProjectType;

  /// Maps a service-type key to the matching Flutter `moduleType` arg used
  /// by `ProjectsScreen`. Matches web's PROJECT_ROUTES mapping.
  String _moduleTypeFor(String serviceType) {
    switch (serviceType) {
      case 'community_service':
      case 'vocational_service':
      case 'international_service':
      case 'new_generation_service':
      case 'public_image_initiative':
        return serviceType;
      default:
        return serviceType;
    }
  }

  Future<void> _openAddProject() async {
    final type = _addProjectType;
    if (type == null) {
      SnackbarUtils.showError(context, 'Please select a service type first');
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProjectsScreen(
          clubId: widget.clubId,
          moduleType: _moduleTypeFor(type),
          frozenMonth: widget.month,
          frozenYearId: widget.yearId,
          autoOpenAdd: true,
        ),
      ),
    );
    // Refresh on return so the new project appears under its section.
    _dirty = true;
    await _loadProjects(force: true);
  }

  Future<void> _openEditProject(String serviceType, int projectId) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProjectsScreen(
          clubId: widget.clubId,
          moduleType: _moduleTypeFor(serviceType),
          frozenMonth: widget.month,
          frozenYearId: widget.yearId,
        ),
      ),
    );
    _dirty = true;
    await _loadProjects(force: true);
  }

  Widget _projectsTab() {
    final canManage = !widget.viewOnly;
    final allEmpty = _projects.values.every((v) => v.isEmpty);

    return Column(
      children: [
        // Header: service-type dropdown + Add Project button (web parity).
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              const Icon(Icons.folder_open, size: 20),
              const SizedBox(width: 8),
              Text('Projects',
                  style: AppTextStyles.body
                      .copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              IconButton(
                tooltip: 'Refresh',
                icon: const Icon(Icons.refresh),
                onPressed: _projectsLoading
                    ? null
                    : () => _loadProjects(force: true),
              ),
            ],
          ),
        ),
        if (canManage)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _addProjectType,
                    isDense: true,
                    isExpanded: true,
                    decoration: InputDecoration(
                      hintText: 'Select service type',
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8)),
                    ),
                    items: _kProjectLabels.entries
                        .map((e) => DropdownMenuItem<String>(
                              value: e.key,
                              child: Text(e.value,
                                  overflow: TextOverflow.ellipsis),
                            ))
                        .toList(),
                    onChanged: (v) => setState(() => _addProjectType = v),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed:
                      _addProjectType == null ? null : _openAddProject,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add'),
                ),
              ],
            ),
          ),
        Expanded(
          child: _projectsLoading
              ? const LoadingWidget()
              : allEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.folder_open,
                                size: 48, color: Colors.grey.shade400),
                            const SizedBox(height: 12),
                            Text('No projects for this month',
                                style: AppTextStyles.body.copyWith(
                                    color: Colors.grey.shade700,
                                    fontWeight: FontWeight.w600)),
                            const SizedBox(height: 6),
                            Text(
                              canManage
                                  ? 'Select a service type and tap “Add” to create one'
                                  : '',
                              textAlign: TextAlign.center,
                              style: AppTextStyles.caption
                                  .copyWith(color: Colors.grey.shade600),
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: () => _loadProjects(force: true),
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: _kProjectLabels.entries
                            .where((e) =>
                                (_projects[e.key] ?? const []).isNotEmpty)
                            .map((e) {
                          final items = _projects[e.key]!;
                          return Card(
                            margin: const EdgeInsets.symmetric(vertical: 6),
                            child: ExpansionTile(
                              tilePadding:
                                  const EdgeInsets.symmetric(horizontal: 12),
                              title: Row(
                                children: [
                                  Expanded(
                                    child: Text(e.value,
                                        style: AppTextStyles.body.copyWith(
                                            fontWeight: FontWeight.w600)),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.grey.shade200,
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Text('${items.length}',
                                        style: AppTextStyles.caption.copyWith(
                                            fontWeight: FontWeight.w600)),
                                  ),
                                ],
                              ),
                              children: items.map((p) {
                                final pm =
                                    Map<String, dynamic>.from(p as Map);
                                return _projectTile(e.key, pm);
                              }).toList(),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
        ),
      ],
    );
  }

  Widget _projectTile(String serviceType, Map<String, dynamic> p) {
    final title = p['title']?.toString() ?? 'Project';
    final dateStr = p['projectDate']?.toString();
    final dateDisp =
        DateFormatter.toDisplay(DateTime.tryParse(dateStr ?? ''));
    final id = _asInt(p['id'] ?? p['projectId']);
    return ListTile(
      dense: true,
      leading: const Icon(Icons.folder_outlined, size: 20),
      title: Text(title, style: AppTextStyles.body),
      subtitle: Text(dateDisp, style: AppTextStyles.caption),
      trailing: widget.viewOnly
          ? null
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.edit_outlined, size: 20),
                  onPressed: id > 0
                      ? () => _openEditProject(serviceType, id)
                      : null,
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline,
                      size: 20, color: Colors.red),
                  onPressed: id > 0 ? () => _deleteProject(id) : null,
                ),
              ],
            ),
    );
  }

  // ── Tab 4: Members Info ──────────────────────────────────
  Widget _membersInfoTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (!widget.viewOnly) ...[
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: _recalculating ? null : _recalcMemberStats,
              icon: _recalculating
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh, size: 16),
              label: const Text('Recalculate from members'),
              style: OutlinedButton.styleFrom(
                visualDensity: VisualDensity.compact,
                textStyle: AppTextStyles.caption
                    .copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Auto-filled from the club\'s member records: last-month count '
            '(as at the 1st), plus joins and terminations dated within this '
            'month. Adjust if needed; the current count auto-calculates below.',
            style: AppTextStyles.caption
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 14),
        ],
        CustomTextField(
          controller: _lastMonthCtrl,
          label: 'Member Count (Last Month)',
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          readOnly: widget.viewOnly,
        ),
        const SizedBox(height: 10),
        CustomTextField(
          controller: _deletedCtrl,
          label: 'Members Deleted / Terminated',
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          readOnly: widget.viewOnly,
        ),
        const SizedBox(height: 10),
        CustomTextField(
          controller: _addedCtrl,
          label: 'Members Added',
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          readOnly: widget.viewOnly,
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.grey.shade100,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Current Member Count',
                  style: AppTextStyles.body
                      .copyWith(fontWeight: FontWeight.w600)),
              Text('$_computedCurrent',
                  style: AppTextStyles.h3.copyWith(color: AppColors.primary)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        CustomTextField(
          controller: _remarksCtrl,
          label: 'Additional Remarks',
          maxLines: 4,
          maxLength: 1000,
          readOnly: widget.viewOnly,
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meeting Card (list tile with edit/delete)
// ─────────────────────────────────────────────────────────────────────────────

class _MeetingCard extends StatelessWidget {
  final Map<String, dynamic> data;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _MeetingCard({
    required this.data,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final title = data['eventName']?.toString() ??
        data['title']?.toString() ??
        'Meeting';
    final dateStr = data['eventDateTime']?.toString() ??
        data['projectDate']?.toString() ??
        data['eventDate']?.toString();
    final dateDisp =
        DateFormatter.toDisplay(DateTime.tryParse(dateStr ?? ''));
    final meetingType = data['meetingType']?.toString();
    final attended = _asInt(
        data['attendance'] ?? data['membersCount'] ?? data['memberCount']);
    final pct = _asDouble(
        data['attendancePercentage'] ?? data['attendancePercent']);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(title,
                      style: AppTextStyles.body
                          .copyWith(fontWeight: FontWeight.w600)),
                ),
                if (canManage) ...[
                  IconButton(
                    tooltip: 'Edit',
                    icon: const Icon(Icons.edit_outlined, size: 20),
                    onPressed: onEdit,
                  ),
                  IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline,
                        size: 20, color: Colors.red),
                    onPressed: onDelete,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 4),
            Text(dateDisp, style: AppTextStyles.caption),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (meetingType != null && meetingType.isNotEmpty)
                  _pill(_meetingTypeLabel(meetingType),
                      Colors.indigo.shade50, Colors.indigo.shade700),
                _pill(
                  '$attended attended (${pct.toStringAsFixed(0)}%)',
                  Colors.blue.shade50,
                  Colors.blue.shade800,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _pill(String label, Color bg, Color fg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(label,
          style: AppTextStyles.caption
              .copyWith(color: fg, fontWeight: FontWeight.w600)),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add/Edit Meeting — fullscreen
// ─────────────────────────────────────────────────────────────────────────────

class _AddEditMeetingPage extends StatefulWidget {
  final int clubId;
  final int yearId;
  final int month;
  final int? reportId;
  // e.g. "2025-26" — used to derive the calendar year for the report month.
  final String yearLabel;
  final Map<String, dynamic>? existing;

  const _AddEditMeetingPage({
    required this.clubId,
    required this.yearId,
    required this.month,
    required this.reportId,
    required this.yearLabel,
    this.existing,
  });

  // Rotary years run July → June. Calendar year for a report month within
  // year "2025-26" is 2025 for months 7-12, 2026 for months 1-6.
  int get calendarYear {
    final parts = yearLabel.split('-');
    final startYear = int.tryParse(parts.first) ?? DateTime.now().year;
    return month >= 7 ? startYear : startYear + 1;
  }

  DateTime get monthStart => DateTime(calendarYear, month, 1);
  DateTime get monthEnd =>
      DateTime(calendarYear, month + 1, 1).subtract(const Duration(days: 1));

  @override
  State<_AddEditMeetingPage> createState() => _AddEditMeetingPageState();
}

class _AddEditMeetingPageState extends State<_AddEditMeetingPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _attendanceCountCtrl = TextEditingController(text: '0');
  final _attendancePctCtrl = TextEditingController(text: '0');

  DateTime? _date;
  String _meetingType = 'regular';

  String? _agendaPath;
  String? _agendaName;
  String? _minutesPath;
  String? _minutesName;

  final List<String> _photoPaths = [];

  bool _saving = false;
  bool _uploadingAgenda = false;
  bool _uploadingMinutes = false;
  bool _uploadingPhoto = false;

  // Module id for the `club_service` module — required by POST/PUT /projects.
  // Fetched once from /api/modules on init.
  int? _moduleId;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _titleCtrl.text = e['title']?.toString() ??
          e['eventName']?.toString() ??
          '';
      _descCtrl.text = e['description']?.toString() ?? '';
      _date = DateTime.tryParse(e['projectDate']?.toString() ??
          e['eventDateTime']?.toString() ??
          e['eventDate']?.toString() ??
          '');
      _meetingType = e['meetingType']?.toString() ?? 'regular';
      _agendaPath = (e['agendaDocument'] ?? e['agendaPath'])?.toString();
      _minutesPath = (e['minutesDocument'] ?? e['minutesPath'])?.toString();
      _attendanceCountCtrl.text =
          _asInt(e['attendance'] ?? e['membersCount']).toString();
      _attendancePctCtrl.text =
          _asDouble(e['attendancePercentage'] ?? e['attendancePercent'])
              .toString();
      final photos = e['photos'];
      if (photos is List) {
        for (final p in photos) {
          if (p is Map) {
            final path = (p['imagePath'] ?? p['path'])?.toString();
            if (path != null && path.isNotEmpty) _photoPaths.add(path);
          } else if (p is String) {
            _photoPaths.add(p);
          }
        }
      }
    }
    // If no date hydrated from existing, default to the report month's first
    // day so the picker opens on the right page and saves land in the right
    // month without guesswork.
    _date ??= widget.monthStart;
    _loadModule();
    if (_isEdit) _loadDetail();
  }

  // The /monthly-reports/meetings/{yearId}/{month} list endpoint only returns
  // a summary (no photos, no description, no documents). Fetch the full
  // project detail so existing photos, PDFs, and description show up in the
  // edit form.
  Future<void> _loadDetail() async {
    final id = _asInt(widget.existing!['projectId'] ??
        widget.existing!['id'] ??
        widget.existing!['attendanceId']);
    if (id <= 0) return;
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/$id',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final d = resp.data;
      if (d == null || !mounted) return;
      setState(() {
        if ((d['description'] as String?)?.isNotEmpty ?? false) {
          _descCtrl.text = d['description'] as String;
        }
        _agendaPath = d['agendaDocument']?.toString() ?? _agendaPath;
        _minutesPath = d['minutesDocument']?.toString() ?? _minutesPath;
        final photos = d['photos'];
        if (photos is List) {
          _photoPaths.clear();
          for (final p in photos) {
            if (p is Map) {
              final path = (p['imagePath'] ?? p['path'])?.toString();
              if (path != null && path.isNotEmpty) _photoPaths.add(path);
            }
          }
        }
      });
    } catch (_) {
      // Edit form still works with whatever summary fields we had; the user
      // will just need to re-attach photos/docs if hydration failed.
    }
  }

  Future<void> _loadModule() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/modules',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = resp.data ?? const [];
      for (final m in list) {
        if (m is Map && m['moduleKey']?.toString() == 'club_service') {
          final id = _asInt(m['moduleId'] ?? m['id']);
          if (id > 0 && mounted) setState(() => _moduleId = id);
          return;
        }
      }
    } catch (_) {
      // Fall through; save guard surfaces a SnackBar if id never loaded.
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _attendanceCountCtrl.dispose();
    _attendancePctCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final initial = _date ?? widget.monthStart;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: widget.monthStart,
      lastDate: widget.monthEnd,
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickPdf({required bool forAgenda}) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    if (result == null || result.files.isEmpty) return;
    final file = result.files.first;
    if (file.path == null) return;

    setState(() {
      if (forAgenda) {
        _uploadingAgenda = true;
      } else {
        _uploadingMinutes = true;
      }
    });

    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/upload-document',
        filePath: file.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final path = resp.data?['path']?.toString();
      final name = resp.data?['originalName']?.toString() ?? file.name;
      if (path == null || path.isEmpty) {
        throw const ApiException('Server returned no file path');
      }
      setState(() {
        if (forAgenda) {
          _agendaPath = path;
          _agendaName = name;
        } else {
          _minutesPath = path;
          _minutesName = name;
        }
      });
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Upload failed';
        SnackbarUtils.showError(context, msg);
      }
    } finally {
      if (mounted) {
        setState(() {
          if (forAgenda) {
            _uploadingAgenda = false;
          } else {
            _uploadingMinutes = false;
          }
        });
      }
    }
  }

  Future<void> _pickPhoto() async {
    if (_photoPaths.length >= 5) {
      SnackbarUtils.showError(context, 'Maximum 5 photos allowed');
      return;
    }
    final x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
    if (x == null) return;
    setState(() => _uploadingPhoto = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/projects/upload',
        filePath: x.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final path = resp.data?['path']?.toString();
      if (path == null || path.isEmpty) throw const ApiException('Server returned no file path');
      setState(() => _photoPaths.add(path));
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Photo upload failed';
        SnackbarUtils.showError(context, msg);
      }
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  Future<void> _save() async {
    if (_titleCtrl.text.trim().isEmpty) {
      SnackbarUtils.showError(context, 'Title is required');
      return;
    }
    if (_date == null) {
      SnackbarUtils.showError(context, 'Date is required');
      return;
    }
    if (_photoPaths.isEmpty) {
      SnackbarUtils.showError(context, 'At least 1 photo is required');
      return;
    }
    if (_moduleId == null) {
      SnackbarUtils.showError(
          context, 'Module not loaded yet: try again in a moment');
      return;
    }
    // The monthly-report listing filters by MONTH(project_date) and fk_year_id.
    // A date outside the report month would silently land in another month's
    // bucket, so block the save with a clear message instead.
    if (_date!.month != widget.month ||
        _date!.year != widget.calendarYear) {
      final monthName = _kMonthNamesFull[widget.month];
      SnackbarUtils.showError(context,
          'Meeting date must be in $monthName ${widget.calendarYear}');
      return;
    }
    setState(() => _saving = true);
    try {
      final photos = <Map<String, dynamic>>[];
      for (int i = 0; i < _photoPaths.length; i++) {
        photos.add({
          'imagePath': _photoPaths[i],
          'description': null,
          'isPrimary': i == 0,
          'sortOrder': i,
        });
      }
      // Mirrors web rotary-frontend createProject body. Meetings live in
      // rotary_projects with module_key='club_service'.
      final body = <String, dynamic>{
        'moduleId': _moduleId,
        'projectType': 'one_time',
        'isJointProject': false,
        'title': _titleCtrl.text.trim(),
        'description': _descCtrl.text.trim(),
        'projectDate': _date!.toIso8601String(),
        'meetingType': _meetingType,
        'agendaDocument': _agendaPath,
        'minutesDocument': _minutesPath,
        'attendance': int.tryParse(_attendanceCountCtrl.text.trim()) ?? 0,
        'attendancePercentage':
            double.tryParse(_attendancePctCtrl.text.trim()) ?? 0.0,
        'photos': photos,
      };
      if (_isEdit) {
        final id = _asInt(widget.existing!['projectId'] ??
            widget.existing!['id'] ??
            widget.existing!['attendanceId']);
        await _api.put(
          '/api/clubs/${widget.clubId}/projects/$id',
          body: body,
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/projects',
          body: body,
        );
      }
      if (!mounted) return;
      SnackbarUtils.showSuccess(
          context, _isEdit ? 'Meeting updated' : 'Meeting created');
      Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save meeting');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Meeting' : 'Add Meeting',
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            CustomTextField(
              controller: _titleCtrl,
              label: 'Title',
              maxLength: 50,
            ),
            const SizedBox(height: 10),
            CustomTextField(
              controller: _descCtrl,
              label: 'Description',
              maxLines: 4,
              maxLength: 1000,
            ),
            const SizedBox(height: 10),
            InkWell(
              onTap: _pickDate,
              child: InputDecorator(
                decoration: const InputDecoration(labelText: 'Date'),
                child: Text(
                  _date == null
                      ? 'Select date'
                      : DateFormatter.toDisplay(_date),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('Meeting Type',
                style:
                    AppTextStyles.body.copyWith(fontWeight: FontWeight.w600)),
            Column(
              children: _kMeetingTypes.map((mt) {
                return RadioListTile<String>(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: mt['value']!,
                  groupValue: _meetingType,
                  onChanged: (v) {
                    if (v != null) setState(() => _meetingType = v);
                  },
                  title: Text(mt['label']!),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            _documentPicker(
              label: 'Agenda PDF',
              fileName: _agendaName ??
                  (_agendaPath != null ? 'Attached' : null),
              uploading: _uploadingAgenda,
              onPick: () => _pickPdf(forAgenda: true),
              onClear: _agendaPath == null
                  ? null
                  : () => setState(() {
                        _agendaPath = null;
                        _agendaName = null;
                      }),
            ),
            const SizedBox(height: 10),
            _documentPicker(
              label: 'Minutes PDF',
              fileName: _minutesName ??
                  (_minutesPath != null ? 'Attached' : null),
              uploading: _uploadingMinutes,
              onPick: () => _pickPdf(forAgenda: false),
              onClear: _minutesPath == null
                  ? null
                  : () => setState(() {
                        _minutesPath = null;
                        _minutesName = null;
                      }),
            ),
            const SizedBox(height: 16),
            CustomTextField(
              controller: _attendanceCountCtrl,
              label: 'Attendance Count',
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            ),
            const SizedBox(height: 10),
            CustomTextField(
              controller: _attendancePctCtrl,
              label: 'Attendance %',
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Photos (1 mandatory, max 5)',
                    style: AppTextStyles.body
                        .copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton.icon(
                  onPressed: _uploadingPhoto || _photoPaths.length >= 5
                      ? null
                      : _pickPhoto,
                  icon: _uploadingPhoto
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.add_a_photo_outlined),
                  label: const Text('Add Photo'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (_photoPaths.isEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  border: Border.all(color: Colors.amber.shade200),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: Colors.amber, size: 18),
                    SizedBox(width: 8),
                    Expanded(child: Text('At least 1 photo is required')),
                  ],
                ),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (int i = 0; i < _photoPaths.length; i++)
                    Stack(
                      children: [
                        Container(
                          width: 80,
                          height: 80,
                          decoration: BoxDecoration(
                            color: Colors.grey.shade200,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: i == 0
                                  ? AppColors.primary
                                  : Colors.grey.shade300,
                              width: i == 0 ? 2 : 1,
                            ),
                          ),
                          child: const Center(
                            child: Icon(Icons.image,
                                size: 32, color: Colors.grey),
                          ),
                        ),
                        if (i == 0)
                          Positioned(
                            left: 2,
                            top: 2,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 4, vertical: 1),
                              color: AppColors.primary,
                              child: Text(
                                'Primary',
                                style: AppTextStyles.caption.copyWith(
                                    color: Colors.white, fontSize: 9),
                              ),
                            ),
                          ),
                        Positioned(
                          right: 0,
                          top: 0,
                          child: InkWell(
                            onTap: () =>
                                setState(() => _photoPaths.removeAt(i)),
                            child: Container(
                              decoration: const BoxDecoration(
                                color: Colors.red,
                                shape: BoxShape.circle,
                              ),
                              padding: const EdgeInsets.all(2),
                              child: const Icon(Icons.close,
                                  color: Colors.white, size: 14),
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            const SizedBox(height: 24),
            CustomButton(
              label: _isEdit ? 'Update Meeting' : 'Create Meeting',
              onPressed: _saving ? null : _save,
              isLoading: _saving,
            ),
          ],
        ),
      ),
    );
  }

  Widget _documentPicker({
    required String label,
    required String? fileName,
    required bool uploading,
    required VoidCallback onPick,
    VoidCallback? onClear,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Icon(Icons.picture_as_pdf_outlined, color: Colors.redAccent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: AppTextStyles.body
                        .copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(
                  fileName ?? 'No file selected',
                  style: AppTextStyles.caption
                      .copyWith(color: Colors.grey.shade700),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (uploading)
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else ...[
            if (onClear != null)
              IconButton(
                icon: const Icon(Icons.close, size: 20),
                onPressed: onClear,
              ),
            TextButton(
              onPressed: onPick,
              child: Text(fileName == null ? 'Choose' : 'Replace'),
            ),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRF row model
// ─────────────────────────────────────────────────────────────────────────────
class _TrfRow {
  int id;
  int fundId;
  String fundType;
  final TextEditingController otherFundCtrl;
  final TextEditingController donorCtrl;
  final TextEditingController amountCtrl;
  DateTime? trfDate;

  _TrfRow({
    this.id = 0,
    this.fundId = 0,
    this.fundType = '',
    required this.otherFundCtrl,
    required this.donorCtrl,
    required this.amountCtrl,
    this.trfDate,
  });

  factory _TrfRow.empty() => _TrfRow(
        otherFundCtrl: TextEditingController(),
        donorCtrl: TextEditingController(),
        amountCtrl: TextEditingController(),
      );

  factory _TrfRow.fromJson(Map j) {
    final row = _TrfRow(
      id: _asInt(j['id']),
      fundId: _asInt(j['fundId']),
      fundType: j['fundType']?.toString() ?? '',
      otherFundCtrl:
          TextEditingController(text: j['otherFundName']?.toString() ?? ''),
      donorCtrl:
          TextEditingController(text: j['donorName']?.toString() ?? ''),
      amountCtrl: TextEditingController(
          text: _asDouble(j['amountUSD']).toString()),
      trfDate: DateTime.tryParse(j['trfDate']?.toString() ?? ''),
    );
    return row;
  }

  Map<String, dynamic> toJson() => {
        'fundId': fundId,
        'fundType': fundType,
        'otherFundName': otherFundCtrl.text.trim(),
        'donorName': donorCtrl.text.trim(),
        'amountUSD': double.tryParse(amountCtrl.text.trim()) ?? 0.0,
        'trfDate': trfDate?.toIso8601String(),
      };

  void dispose() {
    otherFundCtrl.dispose();
    donorCtrl.dispose();
    amountCtrl.dispose();
  }
}
