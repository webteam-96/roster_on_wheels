import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import '../../widgets/login_announcement_popup.dart';
import 'zonal_approval_detail_screen.dart';
import 'zonal_approval_widgets.dart';

// ---------------------------------------------------------------------------
// Zonal Coordinator dashboard — mirrors the web frontend (zonal-dashboard/page.tsx).
//
// The frontend V2 design has exactly TWO views and nothing else:
//   1. Beneficiary Approvals (default) — a zone-wide list of direct-beneficiary
//      requests with year / district / status filters; view detail + approve /
//      reject. This is the ZC's core job.
//   2. Report — a district picker scoped to the zone's districts that opens the
//      (shared) District report module for the chosen district.
//
// Deliberately NOT ported from the old app screen (they leaked district-admin
// surfaces a ZC must never reach): the zone stats card, the "Districts in Zone"
// list, and the per-district tiles that opened the District-Admin dashboard /
// District Clubs admin screens.
// ---------------------------------------------------------------------------

class _ZoneDistrict {
  final int id;
  final String districtNumber;
  final String districtName;

  const _ZoneDistrict({
    required this.id,
    required this.districtNumber,
    required this.districtName,
  });

  factory _ZoneDistrict.fromJson(Map<String, dynamic> j) => _ZoneDistrict(
        id: j['id'] as int? ?? j['districtId'] as int? ?? 0,
        districtNumber: j['districtNumber']?.toString() ?? '',
        districtName:
            j['districtName'] as String? ?? j['name'] as String? ?? '',
      );
}

class _FilterYear {
  final int id;
  final String label;
  const _FilterYear(this.id, this.label);
  factory _FilterYear.fromJson(Map<String, dynamic> j) =>
      _FilterYear(j['id'] as int? ?? 0, j['label']?.toString() ?? '');
}

class _FilterDistrict {
  final int id;
  final String number;
  const _FilterDistrict(this.id, this.number);
  factory _FilterDistrict.fromJson(Map<String, dynamic> j) =>
      _FilterDistrict(j['id'] as int? ?? 0, j['number']?.toString() ?? '');
}

enum _ZonalView { approvals, report }

// Web dashboard accents (zonal-dashboard/page.tsx): orange active, navy text.
const Color _accentOrange = AppColors.goldPrime;
const Color _accentNavy = AppColors.primaryDeep;

class ZonalDashboardScreen extends StatefulWidget {
  const ZonalDashboardScreen({super.key});

  @override
  State<ZonalDashboardScreen> createState() => _ZonalDashboardScreenState();
}

class _ZonalDashboardScreenState extends State<ZonalDashboardScreen> {
  final _api = ApiClient();

  _ZonalView _view = _ZonalView.approvals;
  String _zoneName = '';
  bool _loading = true;
  String? _error;

  // Report view: zone-scoped districts + current picker selection.
  List<_ZoneDistrict> _districts = [];
  int? _reportDistrictId;

  // Approvals view: data-only filters (only years/districts that actually
  // have approvals — sourced from /approval-filters).
  List<_FilterYear> _filterYears = [];
  List<_FilterDistrict> _filterDistricts = [];
  String _statusFilter = 'all';
  int _districtFilter = 0; // 0 = All
  int _yearFilter = 0; // 0 = All

  // Approvals list + load-more pagination.
  List<ZonalApprovalRequest> _approvals = [];
  bool _listLoading = false;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  bool _loadingMore = false;
  static const int _pageSize = 20;

  static const _statusOptions = ['all', 'pending', 'approved', 'rejected'];

  @override
  void initState() {
    super.initState();
    _loadInit();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      // Only show the login announcement when this screen is the actual
      // landing (no back available). Skip when pushed from Home → My Connections.
      if (!context.canPop()) {
        checkAndShowLoginAnnouncement(context,
            currentRole: 'ZonalCoordinator');
      }
    });
  }

  Future<void> _loadInit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final zoneFuture = _api.get<Map<String, dynamic>>(
        '/api/zonal-dashboard/zone-info',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final districtsFuture = _api.get<List<dynamic>>(
        '/api/zonal-dashboard/districts',
        fromJson: (j) => j as List<dynamic>,
      );
      final filtersFuture = _api.get<Map<String, dynamic>>(
        '/api/zonal-dashboard/approval-filters',
        fromJson: (j) => j as Map<String, dynamic>,
      );

      final results = await Future.wait([
        zoneFuture,
        districtsFuture,
        filtersFuture,
      ]);
      final zoneData = (results[0].data as Map<String, dynamic>?) ?? {};
      final districtsList = (results[1].data as List<dynamic>?) ?? const [];
      final filtersData = (results[2].data as Map<String, dynamic>?) ?? {};

      final years = (filtersData['years'] as List<dynamic>? ?? [])
          .map((e) => _FilterYear.fromJson(e as Map<String, dynamic>))
          .toList();
      final filterDistricts = (filtersData['districts'] as List<dynamic>? ?? [])
          .map((e) => _FilterDistrict.fromJson(e as Map<String, dynamic>))
          .toList();

      if (!mounted) return;
      setState(() {
        _zoneName = zoneData['zoneName'] as String? ??
            zoneData['name'] as String? ??
            '';
        _districts = districtsList
            .map((e) => _ZoneDistrict.fromJson(e as Map<String, dynamic>))
            .toList();
        _filterYears = years;
        _filterDistricts = filterDistricts;
        _loading = false;
      });
      await _loadApprovals(reset: true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadApprovals({bool reset = true}) async {
    final statusAtRequest = _statusFilter;
    final districtAtRequest = _districtFilter;
    final yearAtRequest = _yearFilter;
    final pageAtRequest = reset ? 1 : _page;
    if (mounted) {
      setState(() {
        if (reset) {
          _page = 1;
          _listLoading = true;
        } else {
          _loadingMore = true;
        }
      });
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/zonal-dashboard/approval-requests',
        queryParams: {
          'status': statusAtRequest == 'all' ? '' : statusAtRequest,
          'districtId': districtAtRequest,
          'yearId': yearAtRequest,
          'page': pageAtRequest,
          'pageSize': _pageSize,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      // Discard a stale response if any filter changed while in flight —
      // only the latest filter combination's data wins.
      if (!mounted ||
          statusAtRequest != _statusFilter ||
          districtAtRequest != _districtFilter ||
          yearAtRequest != _yearFilter) {
        return;
      }
      final data = resp.data ?? {};
      final raw = data['items'] as List<dynamic>? ??
          data['data'] as List<dynamic>? ??
          [];
      final fetched = raw
          .map((e) => ZonalApprovalRequest.fromJson(e as Map<String, dynamic>))
          .toList();
      final totalCount = data['totalCount'] as int? ?? fetched.length;
      setState(() {
        if (reset) {
          _approvals = fetched;
        } else {
          _approvals.addAll(fetched);
        }
        _totalCount = totalCount;
        _totalPages =
            totalCount == 0 ? 1 : ((totalCount + _pageSize - 1) ~/ _pageSize);
        _listLoading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _listLoading = false;
        _loadingMore = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Failed to load approvals: $e'),
            backgroundColor: AppColors.error),
      );
    }
  }

  void _onLoadMore() {
    if (_page < _totalPages && !_loadingMore) {
      setState(() => _page++);
      _loadApprovals(reset: false);
    }
  }

  Future<void> _openDetail(String approvalToken) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ZonalApprovalDetailScreen(approvalToken: approvalToken),
      ),
    );
    if (changed == true) _loadApprovals(reset: true);
  }

  Future<void> _approve(int approvalId) async {
    try {
      await _api
          .post('/api/zonal-dashboard/approve', body: {'approvalId': approvalId});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Request approved'),
            backgroundColor: AppColors.success),
      );
      _loadApprovals(reset: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  void _showRejectDialog(int approvalId) {
    final remarkCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        title: Text('Reject Request', style: AppTextStyles.h3),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Enter reason for rejection:', style: AppTextStyles.body),
            const SizedBox(height: 10),
            TextField(
              controller: remarkCtrl,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Remark...',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                contentPadding: const EdgeInsets.all(12),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final remark = remarkCtrl.text.trim();
              // Backend requires a remark on reject — keep the dialog open
              // instead of firing an action that will 400.
              if (remark.isEmpty) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(
                      content: Text('A remark is required to reject.'),
                      backgroundColor: AppColors.error),
                );
                return;
              }
              Navigator.of(ctx).pop();
              _reject(approvalId, remark);
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Reject', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Future<void> _reject(int approvalId, String remark) async {
    try {
      await _api.post('/api/zonal-dashboard/reject', body: {
        'approvalId': approvalId,
        'remark': remark,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Request rejected'),
            backgroundColor: AppColors.success),
      );
      _loadApprovals(reset: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.slate50,
      appBar: const CustomAppBar(title: 'Zonal Dashboard'),
      drawer: const CustomDrawer(),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadInit)
              : Column(
                  children: [
                    _buildHeader(),
                    Expanded(
                      child: _view == _ZonalView.approvals
                          ? _buildApprovalsView()
                          : _buildReportView(),
                    ),
                  ],
                ),
    );
  }

  // Zone name + the two-view segmented switch.
  // Orange bottom accent mirrors the web dashboard header.
  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: _accentOrange, width: 2),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_zoneName.isNotEmpty) ...[
            Row(
              children: [
                const Icon(Icons.public, size: 16, color: AppColors.primary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _zoneName,
                    style: AppTextStyles.bodyMedium
                        .copyWith(color: AppColors.primary),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
          ],
          _ViewToggle(
            view: _view,
            onChanged: (v) {
              if (v == _view) return;
              setState(() => _view = v);
            },
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------ Approvals
  Widget _buildApprovalsView() {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _loadApprovals(reset: true),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.slate200),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Panel header: title + count + filters (web card header).
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Beneficiary Approval Requests',
                      style: AppTextStyles.bodySemiBold
                          .copyWith(color: AppColors.slate700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _listLoading
                          ? 'Loading…'
                          : '$_totalCount request${_totalCount == 1 ? '' : 's'}',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.slate500),
                    ),
                    const SizedBox(height: 12),
                    _buildApprovalFilters(),
                  ],
                ),
              ),
              const Divider(height: 1, thickness: 1, color: AppColors.slate100),
              // Panel body: rows separated by hairline dividers.
              if (_listLoading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 44),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_approvals.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 44),
                  child: Center(
                    child: Text('No approval requests found.',
                        style: AppTextStyles.body
                            .copyWith(color: AppColors.slate500)),
                  ),
                )
              else ...[
                for (var i = 0; i < _approvals.length; i++) ...[
                  if (i > 0)
                    const Divider(
                        height: 1,
                        thickness: 1,
                        color: AppColors.slate100,
                        indent: 14,
                        endIndent: 14),
                  ZonalApprovalCard(
                    bordered: false,
                    request: _approvals[i],
                    statusColor: zonalApprovalStatusColor(_approvals[i].status),
                    onView: _approvals[i].approvalToken != null &&
                            _approvals[i].approvalToken!.isNotEmpty
                        ? () => _openDetail(_approvals[i].approvalToken!)
                        : null,
                    onApprove: _approvals[i].status == 'pending'
                        ? () => _approve(_approvals[i].id)
                        : null,
                    onReject: _approvals[i].status == 'pending'
                        ? () => _showRejectDialog(_approvals[i].id)
                        : null,
                  ),
                ],
                const Divider(height: 1, thickness: 1, color: AppColors.slate100),
                Padding(
                  padding: const EdgeInsets.all(6),
                  child: PaginationWidget(
                    currentPage: _page,
                    totalPages: _totalPages,
                    totalCount: _totalCount,
                    isLoading: _loadingMore,
                    onLoadMore: _onLoadMore,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildApprovalFilters() {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        _FilterSelect<int>(
          width: 150,
          value: _yearFilter,
          items: [
            const DropdownMenuItem(value: 0, child: Text('All Years')),
            ..._filterYears.map(
                (y) => DropdownMenuItem(value: y.id, child: Text(y.label))),
          ],
          onChanged: (v) {
            if (v == null || v == _yearFilter) return;
            setState(() => _yearFilter = v);
            _loadApprovals(reset: true);
          },
        ),
        _FilterSelect<int>(
          width: 170,
          value: _districtFilter,
          items: [
            const DropdownMenuItem(value: 0, child: Text('All Districts')),
            ..._filterDistricts.map((d) => DropdownMenuItem(
                value: d.id, child: Text('District ${d.number}'))),
          ],
          onChanged: (v) {
            if (v == null || v == _districtFilter) return;
            setState(() => _districtFilter = v);
            _loadApprovals(reset: true);
          },
        ),
        _FilterSelect<String>(
          width: 150,
          value: _statusFilter,
          items: _statusOptions
              .map((s) => DropdownMenuItem(
                    value: s,
                    child: Text(s == 'all'
                        ? 'All Status'
                        : s[0].toUpperCase() + s.substring(1)),
                  ))
              .toList(),
          onChanged: (v) {
            if (v == null || v == _statusFilter) return;
            setState(() => _statusFilter = v);
            _loadApprovals(reset: true);
          },
        ),
      ],
    );
  }

  // --------------------------------------------------------------------- Report
  Widget _buildReportView() {
    final selected = _reportDistrictId != null;
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Web-parity panel: header + district picker + CTA.
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.slate200),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Report',
                        style: AppTextStyles.bodySemiBold
                            .copyWith(color: AppColors.slate700),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'District-wise reports for your zone',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.slate500),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1, thickness: 1, color: AppColors.slate100),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text('District',
                              style: AppTextStyles.captionMedium
                                  .copyWith(color: AppColors.slate700)),
                          const Text(' *',
                              style: TextStyle(color: AppColors.error)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      _reportDistrictSelect(),
                      const SizedBox(height: 8),
                      Text(
                        'Reports open in the district report module.',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.slate400),
                      ),
                      const SizedBox(height: 14),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: selected
                              ? () => context.push(
                                  RouteNames.districtReports(_reportDistrictId!))
                              : null,
                          icon: const Icon(Icons.open_in_new, size: 18),
                          label: const Text('View Reports'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _accentNavy,
                            foregroundColor: Colors.white,
                            disabledBackgroundColor: AppColors.slate200,
                            disabledForegroundColor: AppColors.slate400,
                            elevation: 0,
                            padding: const EdgeInsets.symmetric(vertical: 13),
                            textStyle: AppTextStyles.button,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (!selected) _emptyPanel('Choose a district above to open its reports.'),
        ],
      ),
    );
  }

  // Full-width web-style select for the report district picker.
  Widget _reportDistrictSelect() {
    return Container(
      width: double.infinity,
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.slate200),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          key: const ValueKey('zonal_report_district'),
          value: _reportDistrictId,
          isDense: true,
          isExpanded: true,
          hint: Text('Select a district…',
              style: AppTextStyles.caption.copyWith(color: AppColors.slate400)),
          icon: const Icon(Icons.keyboard_arrow_down_rounded,
              size: 18, color: AppColors.slate500),
          style: AppTextStyles.caption.copyWith(
            color: AppColors.slate700,
            fontWeight: FontWeight.w500,
          ),
          borderRadius: BorderRadius.circular(10),
          items: _districts
              .map((d) => DropdownMenuItem(
                    value: d.id,
                    child: Text('District ${d.districtNumber}'),
                  ))
              .toList(),
          onChanged: (v) => setState(() => _reportDistrictId = v),
        ),
      ),
    );
  }

  Widget _emptyPanel(String message) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      child: Column(
        children: [
          const Icon(Icons.description_outlined,
              size: 34, color: AppColors.slate400),
          const SizedBox(height: 10),
          Text(
            message,
            style: AppTextStyles.body.copyWith(color: AppColors.slate500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Two-view segmented switch (Beneficiary Approvals | Report).
// ---------------------------------------------------------------------------
class _ViewToggle extends StatelessWidget {
  final _ZonalView view;
  final ValueChanged<_ZonalView> onChanged;
  const _ViewToggle({required this.view, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.all(3),
      child: Row(
        children: [
          _segment('Beneficiary Approvals', _ZonalView.approvals),
          _segment('Report', _ZonalView.report),
        ],
      ),
    );
  }

  Widget _segment(String label, _ZonalView v) {
    final selected = view == v;
    return Expanded(
      child: GestureDetector(
        onTap: () => onChanged(v),
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: selected ? _accentOrange : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: AppTextStyles.caption.copyWith(
              color: selected ? _accentNavy : AppColors.textSecondary,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Web-style select for the approvals filters: white, thin slate border, a
// rounded rectangle with a chevron — mirrors the frontend <Select> triggers.
// ---------------------------------------------------------------------------
class _FilterSelect<T> extends StatelessWidget {
  final T value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?> onChanged;
  final double width;

  const _FilterSelect({
    required this.value,
    required this.items,
    required this.onChanged,
    this.width = 150,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: 38,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.slate200),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          isDense: true,
          isExpanded: true,
          icon: const Icon(Icons.keyboard_arrow_down_rounded,
              size: 18, color: AppColors.slate500),
          style: AppTextStyles.caption.copyWith(
            color: AppColors.slate700,
            fontWeight: FontWeight.w500,
          ),
          borderRadius: BorderRadius.circular(10),
          items: items,
          onChanged: onChanged,
        ),
      ),
    );
  }
}
