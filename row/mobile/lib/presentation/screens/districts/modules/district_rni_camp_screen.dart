import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import 'district_rni_camp_form_screen.dart';

class _PphCamp {
  final int id;
  final String title;
  final String? description;
  final String? address;
  final DateTime? campDate;
  final String? campLogoPath;
  final bool isActive;
  final int attendanceCount;

  const _PphCamp({
    required this.id,
    required this.title,
    this.description,
    this.address,
    this.campDate,
    this.campLogoPath,
    required this.isActive,
    required this.attendanceCount,
  });

  factory _PphCamp.fromJson(Map<String, dynamic> j) {
    DateTime? parsedDate;
    final raw = j['campDate']?.toString();
    if (raw != null && raw.isNotEmpty) {
      parsedDate = DateTime.tryParse(raw);
    }
    return _PphCamp(
      id: (j['id'] as int?) ?? 0,
      title: j['title']?.toString() ?? '',
      description: j['description']?.toString(),
      address: j['address']?.toString(),
      campDate: parsedDate,
      campLogoPath: j['campLogoPath']?.toString(),
      isActive: j['isActive'] as bool? ?? true,
      attendanceCount: (j['attendanceCount'] as int?) ?? 0,
    );
  }
}

String _absUrl(String? path) => ApiConstants.mediaUrl(path);

String _formatDate(DateTime? d) {
  if (d == null || d.year <= 1) return ''; // `0001-01-01` zero date => no value
  return DateFormat('dd MMM yyyy').format(d);
}

class DistrictRniCampScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictRniCampScreen({super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictRniCampScreen> createState() => _DistrictRniCampScreenState();
}

class _DistrictRniCampScreenState extends State<DistrictRniCampScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_PphCamp> _camps = [];

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/district-modules/${widget.districtId}/pph-camps',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _PphCamp.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() { _camps = list; _loading = false; });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() { _camps = []; _loading = false; });
      } else {
        setState(() { _error = e.message; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _toggleActive(_PphCamp camp) async {
    try {
      await _api.put('/api/district-modules/${widget.districtId}/pph-camps/${camp.id}/toggle-active');
      await _fetch();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Toggle failed: $e')));
    }
  }

  Future<void> _confirmDelete(_PphCamp camp) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete PPH Camp'),
        content: Text('Delete "${camp.title}"? This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/district-modules/${widget.districtId}/pph-camps/${camp.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  Future<void> _openForm({_PphCamp? existing}) async {
    final initial = existing == null
        ? null
        : PphCampFormInitial(
            id: existing.id,
            title: existing.title,
            description: existing.description ?? '',
            address: existing.address ?? '',
            campDate: existing.campDate,
            campLogoPath: existing.campLogoPath,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictRniCampFormScreen(
          districtId: widget.districtId,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetch();
  }



  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : CustomAppBar(
              title: 'PPH Camps',
              actions: [
                if (canManage)
                  IconButton(
                    icon: const Icon(Icons.add),
                    tooltip: 'Add PPH camp',
                    onPressed: () => _openForm(),
                  ),
              ],
            ),
      // Embedded (E-Governance tab) suppresses the app bar, so surface Add as a
      // FAB — otherwise admins can't add a camp when the list is non-empty.
      floatingActionButton: widget.embedded && canManage
          ? FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            )
          : null,
      body: _loading
          ? const ShimmerList(itemCount: 6, itemHeight: 110)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _camps.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const EmptyStateWidget(
                            title: 'No PPH camps',
                            subtitle: 'No PPH camp records found.',
                            icon: Icons.medical_services_outlined,
                          ),
                          if (canManage)
                            Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: ElevatedButton.icon(
                                icon: const Icon(Icons.add),
                                label: const Text('Add PPH Camp'),
                                onPressed: () => _openForm(),
                              ),
                            ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: _fetch,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _camps.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (ctx, i) => _CampCard(
                          camp: _camps[i],
                          canManage: canManage,
                          onToggle: () => _toggleActive(_camps[i]),
                          onEdit: () => _openForm(existing: _camps[i]),
                          onDelete: () => _confirmDelete(_camps[i]),
                          onAttendance: () {
                            final titleParam =
                                Uri.encodeQueryComponent(_camps[i].title);
                            context.push(
                              '/districts/${widget.districtId}/rni-camp/${_camps[i].id}/attendance?title=$titleParam',
                            );
                          },
                        ),
                      ),
                    ),
    );
  }
}

class _CampCard extends StatelessWidget {
  final _PphCamp camp;
  final bool canManage;
  final VoidCallback onToggle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onAttendance;

  const _CampCard({
    required this.camp,
    required this.canManage,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
    required this.onAttendance,
  });

  @override
  Widget build(BuildContext context) {
    final logoUrl = _absUrl(camp.campLogoPath);
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: logoUrl.isNotEmpty
                      ? Image.network(
                          logoUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(
                            Icons.medical_services_outlined,
                            color: AppColors.textSecondary,
                          ),
                        )
                      : const Icon(Icons.medical_services_outlined, color: AppColors.textSecondary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        camp.title,
                        style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.bold),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (camp.description != null && camp.description!.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          camp.description!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                        ),
                      ],
                      if (camp.address != null && camp.address!.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.location_on_outlined, size: 14, color: AppColors.textSecondary),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                camp.address!,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                              ),
                            ),
                          ],
                        ),
                      ],
                      if (camp.campDate != null) ...[
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.calendar_today_outlined, size: 13, color: AppColors.textSecondary),
                            const SizedBox(width: 4),
                            Text(
                              _formatDate(camp.campDate),
                              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                if (canManage)
                  Switch(
                    value: camp.isActive,
                    onChanged: (_) => onToggle(),
                    activeColor: AppColors.success,
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: camp.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      camp.isActive ? 'Active' : 'Inactive',
                      style: AppTextStyles.caption.copyWith(
                        color: camp.isActive ? AppColors.success : AppColors.textSecondary,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            const Divider(height: 1),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.people_alt_outlined, size: 16),
                    label: Text('View Attendees (${camp.attendanceCount})'),
                    onPressed: onAttendance,
                  ),
                ),
                if (canManage) ...[
                  const SizedBox(width: 6),
                  IconButton(
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    tooltip: 'Edit',
                    onPressed: onEdit,
                    visualDensity: VisualDensity.compact,
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                    tooltip: 'Delete',
                    onPressed: onDelete,
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
