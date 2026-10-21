import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import 'zonal_approval_detail_screen.dart';
import 'zonal_approval_widgets.dart';

/// District-scoped beneficiary approval requests, opened from the
/// 3-dots menu on a district tile in the Zonal Dashboard.
///
/// Mirrors the frontend's "beneficiaries" view at zonal-dashboard/page.tsx
/// (lines 252-257, 290-305): same endpoint, scoped by districtId.
class ZonalDistrictBeneficiariesScreen extends StatefulWidget {
  final int districtId;
  final String districtNumber;

  const ZonalDistrictBeneficiariesScreen({
    super.key,
    required this.districtId,
    required this.districtNumber,
  });

  @override
  State<ZonalDistrictBeneficiariesScreen> createState() =>
      _ZonalDistrictBeneficiariesScreenState();
}

class _ZonalDistrictBeneficiariesScreenState
    extends State<ZonalDistrictBeneficiariesScreen> {
  final _api = ApiClient();
  List<ZonalApprovalRequest> _approvals = [];
  bool _loading = true;
  bool _refreshing = false;
  String? _error;
  String _filter = 'pending';

  // Load-more pagination — backend (/api/zonal-dashboard/approval-requests)
  // returns { items, totalCount, page, pageSize }; totalPages is derived.
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  bool _loadingMore = false;
  static const int _pageSize = 20;

  static const _filterOptions = ['pending', 'approved', 'rejected', 'all'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool reset = true}) async {
    final filterAtRequest = _filter;
    final pageAtRequest = reset ? 1 : _page;
    if (mounted) {
      setState(() {
        if (reset) {
          _page = 1;
          if (_approvals.isEmpty) _loading = true;
          _refreshing = true;
        } else {
          _loadingMore = true;
        }
        _error = null;
      });
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/zonal-dashboard/approval-requests',
        queryParams: {
          'status': filterAtRequest == 'all' ? '' : filterAtRequest,
          'districtId': widget.districtId.toString(),
          'page': pageAtRequest,
          'pageSize': _pageSize,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      // Discard stale response if the filter changed mid-flight.
      if (!mounted || filterAtRequest != _filter) return;
      final data = resp.data ?? {};
      final raw = data['items'] as List<dynamic>? ??
          data['data'] as List<dynamic>? ??
          [];
      final fetched = raw
          .map((e) => ZonalApprovalRequest.fromJson(e as Map<String, dynamic>))
          .toList();
      // Backend omits totalPages — derive it from totalCount + pageSize.
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
        _loading = false;
        _refreshing = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
        _refreshing = false;
        _loadingMore = false;
      });
    }
  }

  void _onLoadMore() {
    if (_page < _totalPages && !_loadingMore) {
      setState(() => _page++);
      _load(reset: false);
    }
  }

  Future<void> _openDetail(String approvalToken) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ZonalApprovalDetailScreen(approvalToken: approvalToken),
      ),
    );
    if (changed == true) _load();
  }

  Future<void> _approve(int approvalId) async {
    try {
      await _api.post('/api/zonal-dashboard/approve', body: {'approvalId': approvalId});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Request approved'), backgroundColor: AppColors.success),
      );
      _load();
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
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
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
              Navigator.of(ctx).pop();
              _reject(approvalId, remarkCtrl.text.trim());
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
        const SnackBar(content: Text('Request rejected'), backgroundColor: AppColors.success),
      );
      _load();
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
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: 'D${widget.districtNumber} - Direct Beneficiaries'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: () => _load())
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: () => _load(),
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text('Approval Requests', style: AppTextStyles.h4)),
                            if (_refreshing)
                              const SizedBox(
                                width: 14,
                                height: 14,
                                child: const CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppColors.primary,
                                ),
                              )
                            else
                              Text('${_totalCount > 0 ? _totalCount : _approvals.length} items',
                                  style: AppTextStyles.caption
                                      .copyWith(color: AppColors.textSecondary)),
                          ],
                        ),
                        const SizedBox(height: 8),
                        SizedBox(
                          height: 40,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: _filterOptions.length,
                            separatorBuilder: (_, __) => const SizedBox(width: 8),
                            itemBuilder: (ctx, i) {
                              final opt = _filterOptions[i];
                              final selected = _filter == opt;
                              return ChoiceChip(
                                key: ValueKey('zonal_district_filter_$opt'),
                                label: Text(opt[0].toUpperCase() + opt.substring(1)),
                                selected: selected,
                                onSelected: (isSelected) {
                                  if (!isSelected || _filter == opt) return;
                                  setState(() => _filter = opt);
                                  _load();
                                },
                                selectedColor: AppColors.primaryLight,
                                labelStyle: AppTextStyles.caption.copyWith(
                                  color: selected
                                      ? AppColors.primary
                                      : AppColors.textSecondary,
                                  fontWeight:
                                      selected ? FontWeight.w600 : FontWeight.w500,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(20),
                                  side: BorderSide(
                                    color: selected
                                        ? AppColors.primary
                                        : AppColors.border,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (_approvals.isEmpty)
                          Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: const BorderSide(color: AppColors.border),
                            ),
                            color: AppColors.surface,
                            child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Center(
                                child: Text(
                                  'No approval requests',
                                  style: AppTextStyles.body.copyWith(color: AppColors.textMuted),
                                ),
                              ),
                            ),
                          )
                        else
                          ...(_approvals.map((req) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: ZonalApprovalCard(
                                  request: req,
                                  statusColor: zonalApprovalStatusColor(req.status),
                                  onView: req.approvalToken != null && req.approvalToken!.isNotEmpty
                                      ? () => _openDetail(req.approvalToken!)
                                      : null,
                                  onApprove: req.status == 'pending'
                                      ? () => _approve(req.id)
                                      : null,
                                  onReject: req.status == 'pending'
                                      ? () => _showRejectDialog(req.id)
                                      : null,
                                ),
                              ))),
                        if (_approvals.isNotEmpty)
                          PaginationWidget(
                            currentPage: _page,
                            totalPages: _totalPages,
                            totalCount: _totalCount,
                            isLoading: _loadingMore,
                            onLoadMore: _onLoadMore,
                          ),
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
    );
  }
}
