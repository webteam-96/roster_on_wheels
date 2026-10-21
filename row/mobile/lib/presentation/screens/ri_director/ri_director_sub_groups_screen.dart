import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';

class _SubGroupItem {
  final int id;
  final int? yearId;
  final String? yearLabel;
  final String groupName;
  final int memberCount;
  final DateTime? createdDate;

  const _SubGroupItem({
    required this.id,
    required this.groupName,
    this.yearId,
    this.yearLabel,
    this.memberCount = 0,
    this.createdDate,
  });

  factory _SubGroupItem.fromJson(Map<String, dynamic> j) => _SubGroupItem(
        id: j['id'] as int? ?? 0,
        yearId: j['yearId'] as int?,
        yearLabel: j['yearLabel']?.toString(),
        groupName: j['groupName']?.toString() ?? '',
        memberCount: j['memberCount'] as int? ?? 0,
        createdDate: j['createdDate'] != null ? DateTime.tryParse(j['createdDate'].toString()) : null,
      );
}

class _YearOption {
  final int id;
  final String label;
  final bool isCurrent;
  const _YearOption({required this.id, required this.label, required this.isCurrent});
  factory _YearOption.fromJson(Map<String, dynamic> j) => _YearOption(
        id: j['id'] as int? ?? 0,
        label: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: j['isCurrent'] as bool? ?? false,
      );
}

class RiDirectorSubGroupsScreen extends StatefulWidget {
  const RiDirectorSubGroupsScreen({super.key});

  @override
  State<RiDirectorSubGroupsScreen> createState() => _RiDirectorSubGroupsScreenState();
}

class _RiDirectorSubGroupsScreenState extends State<RiDirectorSubGroupsScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_SubGroupItem> _items = const [];
  List<_YearOption> _years = const [];
  int? _yearFilter; // null = all

  @override
  void initState() { super.initState(); _init(); }

  Future<void> _init() async {
    try {
      final yrs = await _api.get<List<dynamic>>(
        '/api/ri-director/sub-groups/years',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _years = (yrs.data ?? const [])
            .map((e) => _YearOption.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    } catch (_) {}
    await _load();
  }

  Future<void> _load() async {
    final yearAtRequest = _yearFilter;
    setState(() { _loading = true; _error = null; });
    try {
      final qp = <String, dynamic>{};
      if (yearAtRequest != null) qp['yearId'] = yearAtRequest;
      final resp = await _api.get<List<dynamic>>(
        '/api/ri-director/sub-groups',
        queryParams: qp,
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      if (yearAtRequest != _yearFilter) return;
      setState(() {
        _items = (resp.data ?? const [])
            .map((e) => _SubGroupItem.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _openDetail(int id) async {
    final changed = await context.push<bool>(RouteNames.riDirectorSubGroupDetail(id));
    if (changed == true) _load();
  }

  Future<void> _delete(_SubGroupItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Sub Group', style: AppTextStyles.h3),
        ]),
        content: Text('Delete "${item.groupName}"?', style: AppTextStyles.body),
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
      await _api.delete('/api/ri-director/sub-groups/${item.id}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sub group deleted'), backgroundColor: AppColors.success));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Future<void> _openAdd() async {
    final changed = await context.push<bool>(RouteNames.riDirectorSubGroupAdd);
    if (changed == true) _load();
  }

  Future<void> _openEdit(_SubGroupItem item) async {
    final changed = await context.push<bool>(RouteNames.riDirectorSubGroupEdit(item.id));
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Sub Groups',
        actions: [
          IconButton(icon: const Icon(Icons.add_rounded), tooltip: 'Add', onPressed: _openAdd),
        ],
      ),
      body: Column(
        children: [
          if (_years.isNotEmpty) _buildYearFilter(),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _load,
              child: _buildList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildYearFilter() {
    return Container(
      color: AppColors.background,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: SizedBox(
        height: 36,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: _years.length + 1,
          separatorBuilder: (_, __) => const SizedBox(width: 6),
          itemBuilder: (_, i) {
            if (i == 0) {
              final selected = _yearFilter == null;
              return ChoiceChip(
                label: const Text('All'),
                selected: selected,
                onSelected: (v) {
                  if (!v || _yearFilter == null) return;
                  setState(() => _yearFilter = null);
                  _load();
                },
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
            }
            final y = _years[i - 1];
            final selected = _yearFilter == y.id;
            return ChoiceChip(
              label: Text('${y.label}${y.isCurrent ? ' •' : ''}'),
              selected: selected,
              onSelected: (v) {
                if (!v || _yearFilter == y.id) return;
                setState(() => _yearFilter = y.id);
                _load();
              },
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
          EmptyStateWidget(icon: Icons.groups_outlined, title: 'No sub groups',
            subtitle: 'No sub groups for the selected filter.'),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
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
              child: Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.groups_outlined, color: AppColors.primary, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.groupName, style: AppTextStyles.bodyMedium,
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 4),
                      Row(children: [
                        const Icon(Icons.people, size: 13, color: AppColors.textSecondary),
                        const SizedBox(width: 4),
                        Text('${item.memberCount} member${item.memberCount != 1 ? "s" : ""}',
                            style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                        if ((item.yearLabel ?? '').isNotEmpty) ...[
                          const SizedBox(width: 10),
                          const Icon(Icons.event, size: 13, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Text(item.yearLabel!,
                              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                        ],
                      ]),
                    ],
                  ),
                ),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
                  onSelected: (v) {
                    if (v == 'edit') _openEdit(item);
                    else if (v == 'delete') _delete(item);
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'edit', child: ListTile(
                      leading: Icon(Icons.edit_outlined, size: 18),
                      title: Text('Edit'), dense: true,
                    )),
                    const PopupMenuItem(value: 'delete', child: ListTile(
                      leading: Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                      title: Text('Delete', style: TextStyle(color: AppColors.error)),
                      dense: true,
                    )),
                  ],
                ),
              ]),
            ),
          ),
        );
      },
    );
  }
}
