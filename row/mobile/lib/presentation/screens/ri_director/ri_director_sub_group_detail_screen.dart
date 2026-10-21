import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _Member {
  final int memberId;
  final String memberName;
  final String? clubName;
  final String? districtNumber;
  final String? zoneName;

  const _Member({
    required this.memberId,
    required this.memberName,
    this.clubName,
    this.districtNumber,
    this.zoneName,
  });

  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        memberId: j['memberId'] as int? ?? j['id'] as int? ?? 0,
        memberName: j['memberName']?.toString() ?? j['name']?.toString() ?? '',
        clubName: j['clubName']?.toString(),
        districtNumber: j['districtNumber']?.toString(),
        zoneName: j['zoneName']?.toString(),
      );
}

class _SubGroupDetail {
  final int id;
  final String groupName;
  final String? yearLabel;
  final List<_Member> members;

  const _SubGroupDetail({
    required this.id,
    required this.groupName,
    required this.members,
    this.yearLabel,
  });

  factory _SubGroupDetail.fromJson(Map<String, dynamic> j) {
    final rawMembers = j['members'] as List<dynamic>? ?? const [];
    return _SubGroupDetail(
      id: j['id'] as int? ?? 0,
      groupName: j['groupName']?.toString() ?? '',
      yearLabel: j['yearLabel']?.toString(),
      members: rawMembers.map((e) => _Member.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}

class RiDirectorSubGroupDetailScreen extends StatefulWidget {
  final int subGroupId;
  const RiDirectorSubGroupDetailScreen({super.key, required this.subGroupId});

  @override
  State<RiDirectorSubGroupDetailScreen> createState() => _RiDirectorSubGroupDetailScreenState();
}

class _RiDirectorSubGroupDetailScreenState extends State<RiDirectorSubGroupDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _SubGroupDetail? _detail;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/sub-groups/${widget.subGroupId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _SubGroupDetail.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _delete() async {
    final d = _detail;
    if (d == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Sub Group', style: AppTextStyles.h3),
        ]),
        content: Text('Delete "${d.groupName}"?', style: AppTextStyles.body),
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
      await _api.delete('/api/ri-director/sub-groups/${widget.subGroupId}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sub group deleted'), backgroundColor: AppColors.success));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Future<void> _openEdit() async {
    final changed = await context.push<bool>(
      RouteNames.riDirectorSubGroupEdit(widget.subGroupId),
    );
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Sub Group',
        actions: _detail == null
            ? null
            : [
                IconButton(icon: const Icon(Icons.edit_outlined), tooltip: 'Edit', onPressed: _openEdit),
                IconButton(icon: const Icon(Icons.delete_outline, color: AppColors.error), tooltip: 'Delete', onPressed: _delete),
              ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : _detail == null
                  ? const Center(child: Text('No data'))
                  : _buildBody(_detail!),
    );
  }

  Widget _buildBody(_SubGroupDetail d) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Text(d.groupName, style: AppFonts.display(
            fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary,
          )),
          const SizedBox(height: 8),
          Row(children: [
            const Icon(Icons.people, size: 16, color: AppColors.primary),
            const SizedBox(width: 4),
            Text('${d.members.length} member${d.members.length != 1 ? "s" : ""}',
                style: AppTextStyles.body.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600)),
            if ((d.yearLabel ?? '').isNotEmpty) ...[
              const SizedBox(width: 12),
              const Icon(Icons.event, size: 16, color: AppColors.textSecondary),
              const SizedBox(width: 4),
              Text(d.yearLabel!, style: AppTextStyles.body.copyWith(color: AppColors.textSecondary)),
            ],
          ]),
          const SizedBox(height: 16),
          Text('Members', style: AppTextStyles.h4),
          const SizedBox(height: 8),
          if (d.members.isEmpty)
            Container(
              padding: const EdgeInsets.all(16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Text('No members in this group.', style: AppTextStyles.caption),
            )
          else
            for (final m in d.members)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: AppColors.primaryLight,
                    child: Text(
                      m.memberName.isNotEmpty ? m.memberName[0].toUpperCase() : '?',
                      style: AppFonts.body(
                        color: AppColors.primary, fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.memberName, style: AppTextStyles.bodyMedium, overflow: TextOverflow.ellipsis),
                        if ((m.clubName ?? '').isNotEmpty || (m.districtNumber ?? '').isNotEmpty)
                          Text(
                            [
                              if ((m.clubName ?? '').isNotEmpty) m.clubName,
                              if ((m.districtNumber ?? '').isNotEmpty) 'D${m.districtNumber}',
                              if ((m.zoneName ?? '').isNotEmpty) m.zoneName,
                            ].whereType<String>().join(' · '),
                            style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                ]),
              ),
        ],
      ),
    );
  }
}
