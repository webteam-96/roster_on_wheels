import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../core/utils/snackbar_utils.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/confirmation_dialog.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';

class DistrictOnlineEventLinkScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictOnlineEventLinkScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictOnlineEventLinkScreen> createState() =>
      _DistrictOnlineEventLinkScreenState();
}

class _DistrictOnlineEventLinkScreenState
    extends State<DistrictOnlineEventLinkScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  List<Map<String, dynamic>> _all = [];
  List<Map<String, dynamic>> _filtered = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<dynamic>(
        '/api/event-payment-links',
        queryParams: {'districtId': widget.districtId},
        fromJson: (j) => j,
      );
      final raw = resp.data;
      List<dynamic> items = [];
      if (raw is List) {
        items = raw;
      } else if (raw is Map<String, dynamic>) {
        items = (raw['items'] as List<dynamic>?) ?? (raw['data'] as List<dynamic>?) ?? [];
      }
      _all = items
          .whereType<Map<String, dynamic>>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      _applyFilter();
    } catch (e) {
      if (!e.toString().contains('(404)')) {
        _error = e.toString();
      } else {
        _all = [];
        _applyFilter();
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applyFilter() {
    final q = _searchCtrl.text.trim().toLowerCase();
    if (q.isEmpty) {
      _filtered = List.from(_all);
    } else {
      _filtered = _all.where((e) {
        final title = (e['title']?.toString() ?? '').toLowerCase();
        return title.contains(q);
      }).toList();
    }
    if (mounted) setState(() {});
  }

  Future<void> _toggleActive(Map<String, dynamic> link) async {
    final id = link['id'];
    if (id == null) return;
    try {
      await _api.patch('/api/event-payment-links/$id/toggle-active');
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Status updated');
      }
      _fetch();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to toggle status');
    }
  }

  Future<void> _delete(Map<String, dynamic> link) async {
    final id = link['id'];
    if (id == null) return;
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Payment Link',
      message: 'Are you sure you want to delete this payment link?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/event-payment-links/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Deleted');
      _fetch();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  void _copyReportLink(Map<String, dynamic> link) {
    final id = link['id'];
    if (id == null) return;
    final url = '${ApiConstants.mediaBaseUrl}/report/$id';
    Clipboard.setData(ClipboardData(text: url));
    SnackbarUtils.showSuccess(context, 'Report link copied');
  }

  Future<void> _openSheet(Map<String, dynamic> link) async {
    final sheetId = link['googleSheetId']?.toString();
    if (sheetId == null || sheetId.isEmpty) return;
    final url = Uri.parse('https://docs.google.com/spreadsheets/d/$sheetId');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } else {
      if (mounted) SnackbarUtils.showError(context, 'Cannot open sheet');
    }
  }

  void _viewMembers(Map<String, dynamic> link) {
    final id = link['id'];
    if (id == null) return;
    final title = link['title']?.toString() ?? 'Event';
    final encoded = Uri.encodeQueryComponent(title);
    context.push(
      '/districts/${widget.districtId}/event-payment-links/$id/members?title=$encoded',
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canAdmin = auth.isDistrictAdminOf(widget.districtId);
    final canDelete = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : const CustomAppBar(
              title: 'Event Payment Links',
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (_) => _applyFilter(),
              decoration: InputDecoration(
                hintText: 'Search by title',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _searchCtrl.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                          _applyFilter();
                        },
                      ),
                isDense: true,
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 6, itemHeight: 130)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: _fetch)
                    : _filtered.isEmpty
                        ? const EmptyStateWidget(
                            title: 'No Event Payment Links',
                            subtitle:
                                'No online event payment links found.',
                            icon: Icons.link_outlined,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: _fetch,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _filtered.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 10),
                              itemBuilder: (_, i) =>
                                  _buildCard(_filtered[i], canAdmin, canDelete),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(
    Map<String, dynamic> link,
    bool canAdmin,
    bool canDelete,
  ) {
    final title = link['title']?.toString() ?? 'Untitled';
    final formType = (link['formType'] as num?)?.toInt() ?? 1;
    final isActive = link['isActive'] == true;
    final paid = (link['paidCount'] as num?)?.toInt() ?? 0;
    final unpaid = (link['unpaidCount'] as num?)?.toInt() ?? 0;
    final total = (link['registrationCount'] as num?)?.toInt() ?? (paid + unpaid);
    final createdDate = link['createdDate']?.toString();
    final sheetId = link['googleSheetId']?.toString();
    final hasSheet = sheetId != null && sheetId.isNotEmpty;

    return Card(
      elevation: 0,
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 6, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 6, right: 8),
                    child: Text(
                      title,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                if (canAdmin)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20),
                    onSelected: (v) {
                      switch (v) {
                        case 'toggle':
                          _toggleActive(link);
                          break;
                        case 'edit':
                          SnackbarUtils.showInfo(
                            context,
                            'Use web admin to edit payment links',
                          );
                          break;
                        case 'delete':
                          _delete(link);
                          break;
                      }
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'toggle',
                        child: Text(isActive ? 'Deactivate' : 'Activate'),
                      ),
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                      if (canDelete)
                        const PopupMenuItem(
                          value: 'delete',
                          child: Text('Delete',
                              style: TextStyle(color: Colors.red)),
                        ),
                    ],
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(right: 10, top: 4),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _chip(
                    formType == 2 ? 'Dynamic' : 'Standard',
                    AppColors.primary,
                    AppColors.primaryLight,
                  ),
                  _chip(
                    isActive ? 'ACTIVE' : 'INACTIVE',
                    isActive ? AppColors.success : Colors.grey,
                    isActive
                        ? AppColors.successLight
                        : Colors.grey.withOpacity(0.15),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: Row(
                children: [
                  _countBox('Paid', paid, AppColors.success),
                  const SizedBox(width: 8),
                  _countBox('Unpaid', unpaid, AppColors.error),
                  const SizedBox(width: 8),
                  _countBox('Total', total, AppColors.primary),
                ],
              ),
            ),
            if (createdDate != null) ...[
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.only(right: 10),
                child: Text(
                  'Created ${DateFormatter.toDisplay(DateTime.tryParse(createdDate))}',
                  style: AppTextStyles.caption
                      .copyWith(color: Colors.grey[600]),
                ),
              ),
            ],
            const Divider(height: 18),
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: 4,
                children: [
                  TextButton.icon(
                    icon: const Icon(Icons.people_outline, size: 16),
                    label: const Text('View Members'),
                    onPressed: () => _viewMembers(link),
                  ),
                  TextButton.icon(
                    icon: const Icon(Icons.copy_outlined, size: 16),
                    label: const Text('Copy Report'),
                    onPressed: () => _copyReportLink(link),
                  ),
                  if (hasSheet)
                    TextButton.icon(
                      icon: const Icon(Icons.table_chart_outlined, size: 16),
                      label: const Text('Sheet'),
                      onPressed: () => _openSheet(link),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, Color fg, Color bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
      child: Text(
        label,
        style: AppTextStyles.caption
            .copyWith(color: fg, fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _countBox(String label, int count, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withOpacity(0.25)),
        ),
        child: Column(
          children: [
            Text(
              '$count',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: color, fontWeight: FontWeight.w700),
            ),
            Text(
              label,
              style: AppTextStyles.caption
                  .copyWith(color: color, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
