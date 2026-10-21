import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import 'approval_status_utils.dart';
import 'club_moderator_project_detail_screen.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────
class _YearSummary {
  final int yearId;
  final String yearLabel;
  final bool isCurrent;
  final int pendingCount;
  final int approvedCount;
  final int rejectedCount;
  final int totalCount;

  const _YearSummary({
    required this.yearId,
    required this.yearLabel,
    required this.isCurrent,
    required this.pendingCount,
    required this.approvedCount,
    required this.rejectedCount,
    required this.totalCount,
  });

  factory _YearSummary.fromJson(Map<String, dynamic> j) => _YearSummary(
        yearId: j['yearId'] as int? ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? '',
        isCurrent: j['isCurrent'] as bool? ?? false,
        pendingCount: j['pendingCount'] as int? ?? 0,
        approvedCount: j['approvedCount'] as int? ?? 0,
        rejectedCount: j['rejectedCount'] as int? ?? 0,
        totalCount: j['totalCount'] as int? ?? 0,
      );
}

class _ProjectItem {
  final int projectId;
  final String title;
  final String? clubName;
  final String? moduleName;
  final String? createdByName;
  final DateTime? projectDate;
  final String approvalStatus;

  const _ProjectItem({
    required this.projectId,
    required this.title,
    this.clubName,
    this.moduleName,
    this.createdByName,
    this.projectDate,
    this.approvalStatus = 'pending',
  });

  factory _ProjectItem.fromJson(Map<String, dynamic> j) => _ProjectItem(
        projectId: j['projectId'] as int? ?? 0,
        title: j['title']?.toString() ?? '',
        clubName: j['clubName']?.toString(),
        moduleName: j['moduleName']?.toString(),
        createdByName: j['createdByName']?.toString(),
        projectDate: j['projectDate'] != null
            ? DateTime.tryParse(j['projectDate'].toString())
            : null,
        approvalStatus: normalizeApprovalStatus(j['approvalStatus']?.toString()),
      );
}

class _ModuleOption {
  final String key;
  final String label;
  const _ModuleOption(this.key, this.label);
}

const _modules = [
  _ModuleOption('all', 'All Modules'),
  _ModuleOption('community_service', 'Community Service'),
  _ModuleOption('vocational_service', 'Vocational Service'),
  _ModuleOption('international_service', 'International Service'),
  _ModuleOption('new_generation_service', 'New Generation Service'),
  _ModuleOption('public_image_initiative', 'Public Image Initiative'),
];

const _statuses = ['all', 'pending', 'approved', 'rejected'];

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────
class ClubModeratorScreen extends StatefulWidget {
  const ClubModeratorScreen({super.key});

  @override
  State<ClubModeratorScreen> createState() => _ClubModeratorScreenState();
}

class _ClubModeratorScreenState extends State<ClubModeratorScreen> {
  final _api = ApiClient();
  static const _pageSize = 20;

  bool _yearsLoading = true;
  String? _yearsError;
  List<_YearSummary> _years = const [];
  int? _selectedYearId;

  bool _projectsLoading = false;
  bool _loadingMore = false;
  String? _projectsError;
  List<_ProjectItem> _projects = const [];
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  String _statusFilter = 'all';
  String _moduleFilter = 'community_service';

  @override
  void initState() {
    super.initState();
    _loadYears();
  }

  Future<void> _loadYears() async {
    setState(() { _yearsLoading = true; _yearsError = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/project-approval/moderator/years',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      final data = (resp.data ?? const [])
          .map((e) => _YearSummary.fromJson(e as Map<String, dynamic>))
          .toList();
      final current = data.where((y) => y.isCurrent).toList();
      final initial = current.isNotEmpty ? current.first.yearId : (data.isNotEmpty ? data.first.yearId : null);
      setState(() {
        _years = data;
        _selectedYearId = initial;
        _yearsLoading = false;
      });
      if (initial != null) _loadProjects(reset: true);
    } catch (e) {
      if (!mounted) return;
      setState(() { _yearsError = e.toString(); _yearsLoading = false; });
    }
  }

  Future<void> _loadProjects({bool reset = false}) async {
    if (_selectedYearId == null) return;
    final yearAtRequest = _selectedYearId;
    final statusAtRequest = _statusFilter;
    final moduleAtRequest = _moduleFilter;
    final pageAtRequest = reset ? 1 : _page;
    setState(() {
      _projectsError = null;
      if (reset) {
        _page = 1;
        _projectsLoading = true;
      } else {
        _loadingMore = true;
      }
    });
    try {
      final qp = <String, dynamic>{
        'yearId': yearAtRequest,
        'page': pageAtRequest,
        'pageSize': _pageSize,
      };
      if (statusAtRequest != 'all') qp['status'] = statusAtRequest;
      if (moduleAtRequest != 'all') qp['moduleKey'] = moduleAtRequest;

      final resp = await _api.get<Map<String, dynamic>>(
        '/api/project-approval/moderator/projects',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      // Discard stale response if filters/year/page changed since.
      if (yearAtRequest != _selectedYearId ||
          statusAtRequest != _statusFilter ||
          moduleAtRequest != _moduleFilter ||
          pageAtRequest != _page) {
        return;
      }
      final data = resp.data ?? const {};
      final raw = (data['items'] as List<dynamic>? ?? const []);
      final fetched = raw.map((e) => _ProjectItem.fromJson(e as Map<String, dynamic>)).toList();
      setState(() {
        _projects = reset ? fetched : [..._projects, ...fetched];
        _totalCount = data['totalCount'] as int? ?? 0;
        _totalPages = data['totalPages'] as int? ?? 1;
        _projectsLoading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _projectsError = e.toString(); _projectsLoading = false; _loadingMore = false; });
    }
  }

  void _onLoadMore() {
    if (_page < _totalPages && !_loadingMore && !_projectsLoading) {
      setState(() => _page++);
      _loadProjects();
    }
  }

  Future<void> _openDetail(_ProjectItem p) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ClubModeratorProjectDetailScreen(
          projectId: p.projectId,
          yearId: _selectedYearId, // the list is loaded scoped to this year
        ),
      ),
    );
    if (changed == true) {
      _loadProjects(reset: true);
      _loadYears(); // refresh summary counts
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'approved': return AppColors.success;
      case 'rejected': return AppColors.error;
      default: return AppColors.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Project Approvals'),
      body: _yearsLoading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _yearsError != null
              ? ErrorStateWidget(message: _yearsError!, onRetry: _loadYears)
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: () async {
                    await _loadYears();
                  },
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildSummaryCards(),
                        const SizedBox(height: 16),
                        _buildFilters(),
                        const SizedBox(height: 14),
                        _buildProjectsList(),
                        if (_projects.isNotEmpty && !_projectsLoading)
                          PaginationWidget(
                            currentPage: _page,
                            totalPages: _totalPages,
                            totalCount: _totalCount,
                            isLoading: _loadingMore,
                            onLoadMore: _onLoadMore,
                          ),
                      ],
                    ),
                  ),
                ),
    );
  }

  // ───────── Summary cards
  Widget _buildSummaryCards() {
    final summary = _years.firstWhere(
      (y) => y.yearId == _selectedYearId,
      orElse: () => const _YearSummary(
        yearId: 0, yearLabel: '', isCurrent: false,
        pendingCount: 0, approvedCount: 0, rejectedCount: 0, totalCount: 0,
      ),
    );
    return GridView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 2.4,
      ),
      children: [
        _SummaryCard(
          label: 'Pending',
          value: summary.pendingCount,
          color: AppColors.warning,
          onTap: () => _setStatus('pending'),
          selected: _statusFilter == 'pending',
        ),
        _SummaryCard(
          label: 'Approved',
          value: summary.approvedCount,
          color: AppColors.success,
          onTap: () => _setStatus('approved'),
          selected: _statusFilter == 'approved',
        ),
        _SummaryCard(
          label: 'Rejected',
          value: summary.rejectedCount,
          color: AppColors.error,
          onTap: () => _setStatus('rejected'),
          selected: _statusFilter == 'rejected',
        ),
        _SummaryCard(
          label: 'Total',
          value: summary.totalCount,
          color: AppColors.primary,
          onTap: () => _setStatus('all'),
          selected: _statusFilter == 'all',
        ),
      ],
    );
  }

  void _setStatus(String s) {
    if (_statusFilter == s) return;
    setState(() => _statusFilter = s);
    _loadProjects(reset: true);
  }

  // ───────── Filters
  Widget _buildFilters() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: _DropdownField<int>(
                label: 'Year',
                value: _selectedYearId,
                items: _years
                    .map((y) => DropdownMenuItem(
                          value: y.yearId,
                          child: Text(
                            '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                            style: AppTextStyles.body,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ))
                    .toList(),
                onChanged: (v) {
                  if (v == null || v == _selectedYearId) return;
                  setState(() => _selectedYearId = v);
                  _loadProjects(reset: true);
                },
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _DropdownField<String>(
                label: 'Module',
                value: _moduleFilter,
                items: _modules
                    .map((m) => DropdownMenuItem(
                          value: m.key,
                          child: Text(m.label, style: AppTextStyles.body, overflow: TextOverflow.ellipsis),
                        ))
                    .toList(),
                onChanged: (v) {
                  if (v == null || v == _moduleFilter) return;
                  setState(() => _moduleFilter = v);
                  _loadProjects(reset: true);
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 36,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _statuses.length,
            separatorBuilder: (_, __) => const SizedBox(width: 6),
            itemBuilder: (_, i) {
              final s = _statuses[i];
              final selected = _statusFilter == s;
              return ChoiceChip(
                key: ValueKey('moderator_status_$s'),
                label: Text(s[0].toUpperCase() + s.substring(1)),
                selected: selected,
                onSelected: (v) {
                  if (!v || _statusFilter == s) return;
                  _setStatus(s);
                },
                selectedColor: AppColors.primaryLight,
                labelStyle: AppTextStyles.caption.copyWith(
                  color: selected ? AppColors.primary : AppColors.textSecondary,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: BorderSide(
                    color: selected ? AppColors.primary : AppColors.border,
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // ───────── Projects list
  Widget _buildProjectsList() {
    if (_projectsLoading) {
      return const Padding(
        padding: EdgeInsets.all(40),
        child: const Center(child: const CircularProgressIndicator(color: AppColors.primary)),
      );
    }
    if (_projectsError != null) {
      return ErrorStateWidget(message: _projectsError!, onRetry: () => _loadProjects());
    }
    if (_projects.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.assignment_outlined,
        title: 'No projects',
        subtitle: 'No projects match the selected filters.',
      );
    }
    return Column(
      children: [
        for (final p in _projects)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _ProjectCard(
              project: p,
              statusColor: _statusColor(p.approvalStatus),
              onTap: () => _openDetail(p),
            ),
          ),
      ],
    );
  }

}

// ─────────────────────────────────────────────────────────────────────────────
// UI components
// ─────────────────────────────────────────────────────────────────────────────
class _SummaryCard extends StatelessWidget {
  final String label;
  final int value;
  final Color color;
  final VoidCallback onTap;
  final bool selected;

  const _SummaryCard({
    required this.label,
    required this.value,
    required this.color,
    required this.onTap,
    required this.selected,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? color.withValues(alpha: 0.12) : AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? color : color.withValues(alpha: 0.25),
              width: selected ? 1.5 : 1,
            ),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  '$value',
                  style: AppFonts.display(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
              ),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  label,
                  style: AppTextStyles.caption.copyWith(color: color),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DropdownField<T> extends StatelessWidget {
  final String label;
  final T? value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?> onChanged;

  const _DropdownField({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
        const SizedBox(height: 4),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<T>(
              isExpanded: true,
              value: value,
              items: items,
              onChanged: onChanged,
              icon: const Icon(Icons.expand_more_rounded, color: AppColors.textSecondary),
            ),
          ),
        ),
      ],
    );
  }
}

class _ProjectCard extends StatelessWidget {
  final _ProjectItem project;
  final Color statusColor;
  final VoidCallback onTap;

  const _ProjectCard({
    required this.project,
    required this.statusColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      project.title.isEmpty ? 'Project #${project.projectId}' : project.title,
                      style: AppTextStyles.bodyMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      project.approvalStatus.toUpperCase(),
                      style: AppTextStyles.caption.copyWith(
                        color: statusColor,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              if (project.clubName != null || project.moduleName != null) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.business_outlined, size: 14, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        [project.clubName, project.moduleName].whereType<String>().join(' · '),
                        style: AppTextStyles.caption.copyWith(color: AppColors.primary),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
              if (project.createdByName != null && project.createdByName!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  'By: ${project.createdByName}',
                  style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                ),
              ],
              if (project.projectDate != null) ...[
                const SizedBox(height: 2),
                Text(
                  'Date: ${_formatDate(project.projectDate!)}',
                  style: AppTextStyles.caption.copyWith(color: AppColors.textMuted),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}
