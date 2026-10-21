import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/app_router.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _MassEmailItem {
  final int id;
  final String subject;
  final String status;
  final int totalRecipients;
  final int sentCount;
  final int failedCount;
  final DateTime? sentDate;
  final DateTime? createdDate;

  const _MassEmailItem({
    required this.id,
    required this.subject,
    required this.status,
    required this.totalRecipients,
    required this.sentCount,
    required this.failedCount,
    this.sentDate,
    this.createdDate,
  });

  factory _MassEmailItem.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    return _MassEmailItem(
      id: j['id'] as int? ?? 0,
      subject: j['subject']?.toString() ?? '',
      status: j['status']?.toString() ?? 'Draft',
      totalRecipients: j['totalRecipients'] as int? ?? 0,
      sentCount: j['sentCount'] as int? ?? 0,
      failedCount: j['failedCount'] as int? ?? 0,
      sentDate: parse(j['sentDate']),
      createdDate: parse(j['createdDate']),
    );
  }
}

const _statusOptions = ['all', 'Draft', 'Sending', 'Sent', 'Partial', 'Failed'];

class RiDirectorMassEmailsScreen extends StatefulWidget {
  const RiDirectorMassEmailsScreen({super.key});

  @override
  State<RiDirectorMassEmailsScreen> createState() => _RiDirectorMassEmailsScreenState();
}

class _RiDirectorMassEmailsScreenState extends State<RiDirectorMassEmailsScreen>
    with RouteAware {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  static const _pageSize = 20;

  bool _loading = true;
  String? _error;
  List<_MassEmailItem> _items = const [];
  int _page = 1;
  int _totalCount = 0;
  int _totalPages = 1;
  String _status = 'all';
  String _search = '';

  @override
  void initState() { super.initState(); _load(); }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Refresh when the compose/edit form pops back to this list.
    final route = ModalRoute.of(context);
    if (route is PageRoute) appRouteObserver.subscribe(this, route);
  }

  @override
  void didPopNext() => _load();

  @override
  void dispose() { appRouteObserver.unsubscribe(this); _searchCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    final statusAtRequest = _status;
    final searchAtRequest = _search;
    final pageAtRequest = _page;
    setState(() { _loading = true; _error = null; });
    try {
      final qp = <String, dynamic>{'page': pageAtRequest, 'pageSize': _pageSize};
      if (statusAtRequest != 'all') qp['status'] = statusAtRequest;
      if (searchAtRequest.isNotEmpty) qp['search'] = searchAtRequest;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/mass-emails',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (statusAtRequest != _status || searchAtRequest != _search || pageAtRequest != _page) return;
      final data = resp.data ?? const {};
      final raw = (data['items'] as List<dynamic>? ?? const []);
      setState(() {
        _items = raw.map((e) => _MassEmailItem.fromJson(e as Map<String, dynamic>)).toList();
        _totalCount = data['totalCount'] as int? ?? 0;
        _totalPages = _totalCount == 0 ? 1 : ((_totalCount + _pageSize - 1) ~/ _pageSize);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _applySearch() {
    FocusScope.of(context).unfocus();
    if (_search == _searchCtrl.text.trim()) return;
    setState(() { _search = _searchCtrl.text.trim(); _page = 1; });
    _load();
  }

  void _clearSearch() {
    if (_search.isEmpty && _searchCtrl.text.isEmpty) return;
    _searchCtrl.clear();
    setState(() { _search = ''; _page = 1; });
    _load();
  }

  void _setStatus(String s) {
    if (_status == s) return;
    setState(() { _status = s; _page = 1; });
    _load();
  }

  Future<void> _openDetail(int id) async {
    final changed = await context.push<bool>(RouteNames.riDirectorMassEmailDetail(id));
    if (changed == true) _load();
  }

  Future<void> _delete(_MassEmailItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Email', style: AppTextStyles.h3),
        ]),
        content: Text('Delete "${item.subject}"?', style: AppTextStyles.body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: Colors.white),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await _api.delete('/api/ri-director/mass-emails/${item.id}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Email deleted'), backgroundColor: AppColors.success));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Future<void> _openCompose() async {
    // Page 1 so a newly composed email is visible; refresh via didPopNext().
    if (_page != 1) setState(() => _page = 1);
    await context.push<bool>(RouteNames.riDirectorMassEmailCompose);
  }

  Future<void> _openEdit(int id) async {
    await context.push<bool>(RouteNames.riDirectorMassEmailEdit(id));
  }

  Future<void> _sendNow(_MassEmailItem item) async {
    final isRetry = item.status == 'Failed' || item.status == 'Partial' || item.status == 'Sending';
    final title = isRetry ? 'Resume / Retry' : 'Send Now';
    final message = isRetry
        ? 'Resume sending "${item.subject}"? Failed recipients will be retried.'
        : 'Send "${item.subject}" to ${item.totalRecipients} recipients now?';
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(title, style: AppTextStyles.h3),
        content: Text(message, style: AppTextStyles.body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
            child: Text(isRetry ? 'Resume' : 'Send'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await _api.post('/api/ri-director/mass-emails/${item.id}/send');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(isRetry ? 'Resume started' : 'Send started'), backgroundColor: AppColors.success));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: AppColors.error));
    }
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'Sent': return AppColors.success;
      case 'Failed': return AppColors.error;
      case 'Partial': return AppColors.warning;
      case 'Sending': return AppColors.primary;
      default: return AppColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Mass Emails',
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Compose',
            onPressed: _openCompose,
          ),
        ],
      ),
      body: Column(
        children: [
          _buildFilters(),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _load,
              child: _buildList(),
            ),
          ),
          if (_totalPages > 1) _buildPagination(),
        ],
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      color: AppColors.background,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(children: [
        SizedBox(
          height: 44,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(children: [
                    const Icon(Icons.search, size: 18, color: AppColors.textSecondary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _searchCtrl,
                        decoration: const InputDecoration(
                          hintText: 'Search by subject...',
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          errorBorder: InputBorder.none,
                          disabledBorder: InputBorder.none,
                          isCollapsed: true,
                          contentPadding: EdgeInsets.zero,
                        ),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) => _applySearch(),
                      ),
                    ),
                    if (_searchCtrl.text.isNotEmpty)
                      GestureDetector(
                        onTap: _clearSearch,
                        child: const Padding(
                          padding: EdgeInsets.only(left: 4),
                          child: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
                        ),
                      ),
                  ]),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: _applySearch,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: const Text('Search'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 36,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _statusOptions.length,
            separatorBuilder: (_, __) => const SizedBox(width: 6),
            itemBuilder: (_, i) {
              final s = _statusOptions[i];
              final selected = _status == s;
              return ChoiceChip(
                key: ValueKey('ri_me_status_$s'),
                label: Text(s == 'all' ? 'All' : s),
                selected: selected,
                onSelected: (v) { if (v) _setStatus(s); },
                selectedColor: AppColors.primaryLight,
                labelStyle: AppTextStyles.caption.copyWith(
                  color: selected ? AppColors.primary : AppColors.textSecondary,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: BorderSide(color: selected ? AppColors.primary : AppColors.border),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }

  Widget _buildList() {
    if (_loading) return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    if (_items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 80),
          EmptyStateWidget(icon: Icons.mail_outline, title: 'No emails', subtitle: 'No mass emails match your filters.'),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: _items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final item = _items[i];
        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: const BorderSide(color: AppColors.border),
          ),
          color: AppColors.surface,
          child: InkWell(
            onTap: () => _openDetail(item.id),
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(item.subject, style: AppTextStyles.bodyMedium,
                            maxLines: 2, overflow: TextOverflow.ellipsis),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: _statusColor(item.status).withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          item.status,
                          style: AppFonts.body(
                            fontSize: 11,
                            color: _statusColor(item.status),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      PopupMenuButton<String>(
                        icon: const Icon(Icons.more_vert, size: 18, color: AppColors.textSecondary),
                        onSelected: (v) {
                          switch (v) {
                            case 'view': _openDetail(item.id); break;
                            case 'edit': _openEdit(item.id); break;
                            case 'send': _sendNow(item); break;
                            case 'resume': _sendNow(item); break;
                            case 'delete': _delete(item); break;
                          }
                        },
                        itemBuilder: (_) {
                          final isDraft = item.status == 'Draft';
                          final isRetryable = item.status == 'Failed' || item.status == 'Partial' || item.status == 'Sending';
                          final canDelete = item.status == 'Draft' || item.status == 'Failed';
                          return [
                            const PopupMenuItem(value: 'view', child: ListTile(
                              leading: Icon(Icons.visibility_outlined, size: 18),
                              title: Text('View'),
                              dense: true,
                            )),
                            if (isDraft) ...[
                              const PopupMenuItem(value: 'edit', child: ListTile(
                                leading: Icon(Icons.edit_outlined, size: 18),
                                title: Text('Edit'),
                                dense: true,
                              )),
                              const PopupMenuItem(value: 'send', child: ListTile(
                                leading: Icon(Icons.send_outlined, size: 18),
                                title: Text('Send Now'),
                                dense: true,
                              )),
                            ],
                            if (isRetryable)
                              const PopupMenuItem(value: 'resume', child: ListTile(
                                leading: Icon(Icons.refresh_outlined, size: 18),
                                title: Text('Resume / Retry'),
                                dense: true,
                              )),
                            if (canDelete)
                              const PopupMenuItem(value: 'delete', child: ListTile(
                                leading: Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                                title: Text('Delete', style: TextStyle(color: AppColors.error)),
                                dense: true,
                              )),
                          ];
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(children: [
                    _MetricChip(label: 'Total', value: '${item.totalRecipients}'),
                    const SizedBox(width: 6),
                    _MetricChip(label: 'Sent', value: '${item.sentCount}', color: AppColors.success),
                    const SizedBox(width: 6),
                    _MetricChip(label: 'Failed', value: '${item.failedCount}', color: AppColors.error),
                  ]),
                  if (item.sentDate != null || item.createdDate != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      item.sentDate != null
                          ? 'Sent: ${_fmt(item.sentDate!)}'
                          : 'Created: ${_fmt(item.createdDate!)}',
                      style: AppTextStyles.caption.copyWith(color: AppColors.textMuted),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildPagination() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: const Border(top: const BorderSide(color: AppColors.border)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            onPressed: _page > 1 ? () { setState(() => _page -= 1); _load(); } : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Text('Page $_page of $_totalPages · $_totalCount items',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          IconButton(
            onPressed: _page < _totalPages ? () { setState(() => _page += 1); _load(); } : null,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }

  String _fmt(DateTime d) {
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    final hh = d.hour.toString().padLeft(2, '0');
    final mi = d.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${d.year} $hh:$mi';
  }
}

class _MetricChip extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _MetricChip({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text('$label: ', style: AppTextStyles.caption.copyWith(color: c)),
        Text(value, style: AppTextStyles.caption.copyWith(color: c, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}
