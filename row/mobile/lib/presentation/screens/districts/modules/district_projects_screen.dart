import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/project_share_service.dart';
import '../../../../core/utils/currency_symbol.dart';
import '../../../../core/utils/image_crop.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../providers/auth_provider.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/embedded_search_add_bar.dart';
import '../../../widgets/common/custom_button.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/confirmation_dialog.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/pagination_widget.dart';
import '../../../widgets/common/rotary_year_bar.dart';
import '../../../widgets/detail/detail_widgets.dart';
import '../../../widgets/detail/detail_hero_layout.dart';

// ---------------------------------------------------------------------------
// Form constants — mirror the web district-project add page exactly.
// ---------------------------------------------------------------------------

/// Sentinel id used to represent the "Others" option in AoF/Category/Sub-
/// Category dropdowns. Matches the convention used in the club projects screen
/// (`_kOthersSentinel`). When this is selected the corresponding `other…` text
/// field becomes visible and required.
const int _kOthersSentinel = -999;

/// District projects always classify under Community Service on the web. Used
/// for the Area of Focus lookup.
const String _kCommunityServiceModuleKey = 'community_service';

/// English-only character set used by the web add page
/// (`/^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$/`). Mirrored verbatim so the same
/// strings that pass the web form also pass here.
final RegExp _kEnglishOnly = RegExp(r'''^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$''');

const int _kTitleMaxChars = 50;
const int _kDescMaxChars = 1000;
const int _kPhotoDescMaxChars = 500;

/// Photo constraints from the web spec.
const Set<String> _kAllowedPhotoExts = {'jpg', 'jpeg', 'png', 'gif', 'webp'};
const int _kPhotoMaxBytes = 10 * 1024 * 1024;

/// Single dropdown entry used for AoF, Category, Sub-Category, Funding.
class _DropdownItem {
  final int id;
  final String name;
  final bool isActive;
  const _DropdownItem(
      {required this.id, required this.name, this.isActive = true});

  factory _DropdownItem.fromJson(Map<String, dynamic> j) => _DropdownItem(
        id: j['id'] as int? ?? 0,
        name: (j['name'] ?? j['title'] ?? '').toString(),
        isActive: _asBool(j['isActive'] ?? j['active'] ?? true),
      );

  bool get isOthers => name.toLowerCase() == 'others';
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

/// Keep only active options, and drop any API row literally named "Others":
/// the classification dropdowns always render their own synthetic "Others"
/// (the free-text trigger), so a backend "Others" would show up twice.
/// Mirrors the web console, which filters `aof.filter(a => a.isActive)`.
List<_DropdownItem> _usableOptions(List<_DropdownItem> items) => items
    .where((e) => e.isActive && e.name.trim().toLowerCase() != 'others')
    .toList();

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Project {
  final int id;
  final String title;
  final String? description;
  final String? location;
  final DateTime? projectDate;
  final double? projectCost;
  // Currency the projectCost is in (INR/LKR/NPR/USD); backend defaults INR.
  final String? currency;
  final int? directBeneficiaries;
  final int? manHours;
  final int? rotariansInvolved;
  final int? rotaractorsInvolved;
  // List endpoint returns these (names, not ids) — used to recover the
  // dropdown selections by name when the detail endpoint is unavailable.
  final String? areaOfFocusName;
  final String? categoryName;
  final String? primaryPhoto;
  final bool isJointProject;
  final String? coHostName;
  final bool isActive;
  // Rotary year this project lives in. Projects are stored in year-partitioned
  // tables (`rotary_projects_YYYY_YY`), so the detail/edit/delete routes are
  // year-scoped (`/projects/{yearId}/{id}`). The list endpoint returns it.
  final int? yearId;

  const _Project({
    required this.id,
    required this.title,
    this.description,
    this.location,
    this.projectDate,
    this.projectCost,
    this.currency,
    this.directBeneficiaries,
    this.manHours,
    this.rotariansInvolved,
    this.rotaractorsInvolved,
    this.areaOfFocusName,
    this.categoryName,
    this.primaryPhoto,
    this.isJointProject = false,
    this.coHostName,
    this.isActive = true,
    this.yearId,
  });

  factory _Project.fromJson(Map<String, dynamic> j) => _Project(
        id: (j['id'] as num?)?.toInt() ?? 0,
        title: j['title'] as String? ?? '',
        description: j['description'] as String?,
        location: j['location'] as String?,
        projectDate: j['projectDate'] != null ? DateTime.tryParse(j['projectDate'].toString()) : null,
        projectCost: (j['projectCost'] as num?)?.toDouble(),
        currency: j['currency']?.toString(),
        directBeneficiaries: (j['directBeneficiaries'] as num?)?.toInt(),
        manHours: (j['manHours'] as num?)?.toInt(),
        rotariansInvolved: (j['rotariansInvolved'] as num?)?.toInt(),
        rotaractorsInvolved: (j['rotaractorsInvolved'] as num?)?.toInt(),
        areaOfFocusName: j['areaOfFocusName'] as String?,
        categoryName: j['categoryName'] as String?,
        primaryPhoto: j['primaryPhoto'] as String?,
        isJointProject: j['isJointProject'] as bool? ?? false,
        coHostName: j['coHostName'] as String?,
        isActive: j['isActive'] as bool? ?? true,
        yearId: (j['yearId'] as num?)?.toInt(),
      );
}

/// A rotary year row from `…/projects/available-years` (`{id, yearLabel, isCurrent}`).
class _PYear {
  final int id;
  final String label;
  final bool isCurrent;
  const _PYear({required this.id, required this.label, this.isCurrent = false});

  factory _PYear.fromJson(Map<String, dynamic> j) => _PYear(
        id: (j['id'] as num?)?.toInt() ?? 0,
        label: (j['yearLabel'] ?? j['label'] ?? '').toString(),
        isCurrent: j['isCurrent'] == true || j['isCurrent'] == 1,
      );
}

class _ProjectPhoto {
  String path;
  String description;
  bool isPrimary;
  _ProjectPhoto({required this.path, this.description = '', this.isPrimary = false});

  factory _ProjectPhoto.fromJson(Map<String, dynamic> j) => _ProjectPhoto(
        path: (j['imagePath'] ?? j['path'] ?? '').toString(),
        description: (j['description'] ?? '').toString(),
        isPrimary: j['isPrimary'] == true || j['isPrimary'] == 1,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictProjectsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  final bool viewOnly;

  /// When non-null the screen is driven by an EXTERNAL year (e.g. the district
  /// dashboard's global year selector): the built-in year bar is hidden and
  /// this year is used for the list + add/edit/delete. When null the screen
  /// shows and manages its own year bar (standalone / module usage).
  final int? fixedYearId;

  /// Optional widget rendered as a scroll-away header ABOVE the list (used when
  /// embedded inside the Foundation tab so the KPI cards + sub-tab bar scroll
  /// together with the project list instead of being pinned). When null the
  /// screen keeps its original pinned-year-bar + Expanded-list layout, so every
  /// existing caller is unaffected.
  final Widget? header;

  const DistrictProjectsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
    this.fixedYearId,
    this.header,
  });

  @override
  State<DistrictProjectsScreen> createState() => _DistrictProjectsScreenState();
}

class _DistrictProjectsScreenState extends State<DistrictProjectsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');
  final _currencyFmt = NumberFormat.decimalPatternDigits(locale: brandNumberLocale(), decimalDigits: 2);

  // Title search (embedded Foundation layout only) — sent to the list endpoint
  // as `search`, mirroring the web card header.
  final TextEditingController _searchCtrl = TextEditingController();
  String _search = '';

  final List<_Project> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  // Year context. Projects live in year-partitioned tables, so the list is
  // filtered by year and detail/edit/delete are year-scoped.
  List<_PYear> _years = [];
  int? _selectedYearId;
  bool _yearsLoading = true;

  @override
  void initState() {
    super.initState();
    _loadYears();
  }

  /// Load years that have projects (`…/projects/available-years`); fall back to
  /// the full rotary-year list so the dropdown still works (and a default year
  /// exists) when there are no projects yet. Defaults to the current year, then
  /// fetches that year's list. With [preserveSelection] the currently-selected
  /// year is kept if it still exists (used after add/edit so the view doesn't
  /// jump back to the current year).
  Future<void> _loadYears({bool preserveSelection = false}) async {
    // External year control (embedded in the Foundation tab): skip the year
    // dropdown entirely and use the year handed down from the district's global
    // selector. `_years` stays empty so `_yearBar()` is never rendered.
    if (widget.fixedYearId != null) {
      setState(() {
        _years = [];
        _selectedYearId = widget.fixedYearId;
        _yearsLoading = false;
      });
      await _fetch(reset: true);
      return;
    }
    setState(() => _yearsLoading = true);
    List<_PYear> years = [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/projects/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      years = (resp.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(_PYear.fromJson)
          .toList();
    } catch (_) {/* fall through to rotary-years */}
    if (years.isEmpty) {
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (resp.data ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(_PYear.fromJson)
            .toList();
      } catch (_) {}
    }
    setState(() {
      _years = years;
      final keep = preserveSelection &&
          _selectedYearId != null &&
          years.any((y) => y.id == _selectedYearId);
      if (!keep) {
        final current = years.where((y) => y.isCurrent).toList();
        _selectedYearId = current.isNotEmpty
            ? current.first.id
            : (years.isNotEmpty ? years.first.id : null);
      }
      _yearsLoading = false;
    });
    await _fetch(reset: true);
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/projects',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_selectedYearId != null) 'yearId': _selectedYearId,
          if (_search.trim().isNotEmpty) 'search': _search.trim(),
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Project.fromJson(j));
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!e.toString().contains('(404)')) setState(() => _error = e.toString());
      setState(() { _loading = false; _loadingMore = false; });
    }
  }

  Future<void> _delete(_Project p) async {
    // Year-scoped delete — the record lives in its year-partitioned table.
    final yearId = p.yearId ?? _selectedYearId;
    if (yearId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Delete failed: missing project year'), backgroundColor: AppColors.error),
        );
      }
      return;
    }
    try {
      await _api.delete('/api/districts/${widget.districtId}/projects/$yearId/${p.id}');
      setState(() => _items.removeWhere((x) => x.id == p.id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Project deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  Future<void> _showForm({_Project? existing}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _ProjectFormPage(
          districtId: widget.districtId,
          existing: existing,
        ),
      ),
    );
    // Reload years too — a create/move may have introduced a new year — but keep
    // the year the user is viewing.
    if (saved == true) _loadYears(preserveSelection: true);
  }

  Future<void> _openDetail(_Project item) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _ProjectDetailScreen(
          districtId: widget.districtId,
          projectId: item.id,
          yearId: item.yearId ?? _selectedYearId ?? 0,
          fallback: item,
        ),
      ),
    );
    if (changed == true) _fetch(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Per-level gating: only district admins of THIS district can manage.
    final canManage =
        !widget.viewOnly && auth.isDistrictAdminOf(widget.districtId);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded ? null : const CustomAppBar(title: 'District Projects'),
      // Embedded (Foundation tab) uses an explicit "Add Project" button in the
      // search row instead of this floating "+" (which read as confusing there).
      floatingActionButton: (!canManage || widget.header != null)
          ? null
          : FloatingActionButton(
              onPressed: () => _showForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      // With a scroll-away `header` (Foundation tab), the whole screen is ONE
      // scroll view so the header scrolls with the list. Otherwise keep the
      // original pinned-year-bar + Expanded-list layout (all other callers).
      body: widget.header != null
          ? _buildEmbeddedScroll(canManage)
          : Column(
              children: [
                if (_years.isNotEmpty) _yearBar(),
                // Search-only row (add is handled by the FAB in this layout).
                EmbeddedSearchAddBar(
                  controller: _searchCtrl,
                  hintText: 'Search projects',
                  addLabel: 'Add Project',
                  canAdd: false,
                  onSubmit: () {
                    setState(() => _search = _searchCtrl.text);
                    _fetch(reset: true);
                  },
                  onClear: () {
                    _searchCtrl.clear();
                    setState(() => _search = '');
                    _fetch(reset: true);
                  },
                  onAdd: () => _showForm(),
                ),
                Expanded(child: _buildContent(canManage)),
              ],
            ),
    );
  }

  /// Single-scroll body used when a [DistrictProjectsScreen.header] is supplied:
  /// header + list (or loading / error / empty) as slivers, so everything
  /// scrolls together and pull-to-refresh works even when the list is short.
  Widget _buildEmbeddedScroll(bool canManage) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _fetch(reset: true),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(child: widget.header!),
          SliverToBoxAdapter(
            child: EmbeddedSearchAddBar(
              controller: _searchCtrl,
              hintText: 'Search projects',
              addLabel: 'Add Project',
              canAdd: canManage,
              onSubmit: () {
                setState(() => _search = _searchCtrl.text);
                _fetch(reset: true);
              },
              onClear: () {
                _searchCtrl.clear();
                setState(() => _search = '');
                _fetch(reset: true);
              },
              onAdd: () => _showForm(),
            ),
          ),
          if (_loading)
            const SliverToBoxAdapter(
              child: ShimmerList(itemCount: 6, itemHeight: 110),
            )
          else if (_error != null)
            SliverFillRemaining(
              // hasScrollBody must stay true: Error/EmptyStateWidget are rooted
              // in a LayoutBuilder, and `false` forces an intrinsic-height
              // measurement LayoutBuilder can't answer (crashes on empty list).
              hasScrollBody: true,
              child: ErrorStateWidget(
                  message: _error!, onRetry: () => _fetch(reset: true)),
            )
          else if (_items.isEmpty)
            SliverFillRemaining(
              hasScrollBody: true,
              child: EmptyStateWidget(
                title: 'No Projects',
                subtitle: 'Tap + to create a new community service project.',
                icon: Icons.volunteer_activism_outlined,
                actionLabel: canManage ? 'Add Project' : null,
                onAction: canManage ? () => _showForm() : null,
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (ctx, i) {
                    if (i == _items.length) {
                      return PaginationWidget(
                        currentPage: _page,
                        totalPages: _totalPages,
                        totalCount: _totalCount,
                        isLoading: _loadingMore,
                        onLoadMore: () {
                          if (_page < _totalPages && !_loadingMore) {
                            _page++;
                            _fetch();
                          }
                        },
                      );
                    }
                    final item = _items[i];
                    return Padding(
                      padding: EdgeInsets.only(
                          bottom: i == _items.length - 1 ? 0 : 10),
                      child: _ProjectCard(
                        item: item,
                        df: _df,
                        currencyFmt: _currencyFmt,
                        canManage: canManage,
                        onTap: () => _openDetail(item),
                        onEdit: () => _showForm(existing: item),
                        onDelete: () async {
                          final ok = await ConfirmationDialog.show(
                            context,
                            title: 'Delete Project',
                            message: 'Delete "${item.title}"?',
                          );
                          if (ok) _delete(item);
                        },
                      ),
                    );
                  },
                  childCount: _items.length + 1,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _yearBar() {
    return RotaryYearBar<int>(
      value: _selectedYearId,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      options: [
        for (final y in _years)
          RotaryYearOption(value: y.id, label: y.label, isCurrent: y.isCurrent),
      ],
      onChanged: _yearsLoading
          ? null
          : (v) {
              if (v == null || v == _selectedYearId) return;
              setState(() => _selectedYearId = v);
              _fetch(reset: true);
            },
    );
  }

  Widget _buildContent(bool canManage) {
    if (_loading) return const ShimmerList(itemCount: 6, itemHeight: 110);
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true));
    }
    if (_items.isEmpty) {
      return EmptyStateWidget(
        title: 'No Projects',
        subtitle: 'Tap + to create a new community service project.',
        icon: Icons.volunteer_activism_outlined,
        actionLabel: canManage ? 'Add Project' : null,
        onAction: canManage ? () => _showForm() : null,
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _fetch(reset: true),
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _items.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (ctx, i) {
          if (i == _items.length) {
            return PaginationWidget(
              currentPage: _page,
              totalPages: _totalPages,
              totalCount: _totalCount,
              isLoading: _loadingMore,
              onLoadMore: () {
                if (_page < _totalPages && !_loadingMore) { _page++; _fetch(); }
              },
            );
          }
          final item = _items[i];
          return _ProjectCard(
            item: item,
            df: _df,
            currencyFmt: _currencyFmt,
            canManage: canManage,
            onTap: () => _openDetail(item),
            onEdit: () => _showForm(existing: item),
            onDelete: () async {
              final ok = await ConfirmationDialog.show(
                context,
                title: 'Delete Project',
                message: 'Delete "${item.title}"?',
              );
              if (ok) _delete(item);
            },
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _ProjectCard extends StatelessWidget {
  final _Project item;
  final DateFormat df;
  final NumberFormat currencyFmt;
  final bool canManage;
  final VoidCallback? onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ProjectCard({
    required this.item,
    required this.df,
    required this.currencyFmt,
    required this.canManage,
    this.onTap,
    required this.onEdit,
    required this.onDelete,
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
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.volunteer_activism_outlined, size: 20, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(item.title, style: AppTextStyles.bodyMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                ),
                if (item.isJointProject)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.info.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text('Joint', style: AppTextStyles.caption.copyWith(color: AppColors.info)),
                  ),
                if (canManage) ...[
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.edit_outlined, size: 18, color: AppColors.primary),
                    onPressed: onEdit,
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.all(6),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                    onPressed: onDelete,
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.all(6),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                if (item.projectDate != null)
                  _InfoChip(icon: Icons.calendar_today_outlined, label: df.format(item.projectDate!)),
                if (item.location != null && item.location!.isNotEmpty)
                  _InfoChip(icon: Icons.location_on_outlined, label: item.location!),
                if (item.projectCost != null)
                  _InfoChip(icon: Icons.payments_outlined, label: '${currencySymbolFor(item.currency)} ${currencyFmt.format(item.projectCost!)}'),
                if (item.directBeneficiaries != null)
                  _InfoChip(icon: Icons.people_outline, label: '${item.directBeneficiaries} beneficiaries'),
              ],
            ),
            if (item.description != null && item.description!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(item.description!, style: AppTextStyles.caption, maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ],
        ),
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _InfoChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: AppColors.textSecondary),
        const SizedBox(width: 4),
        Text(label, style: AppTextStyles.caption),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Form Page — mirrors web /districts/{id}/projects/add page exactly.
// 14 fields: Title*, Description, Location, AoF*, Category*, Sub-Category,
// Date*, Project Cost, Funding, Direct Beneficiaries, Man Hours, Rotarians
// Involved, Rotaractors Involved, Photos* (≥1, ≤5, format + size + dimension
// validated per spec).
// ---------------------------------------------------------------------------
class _ProjectFormPage extends StatefulWidget {
  final int districtId;
  final _Project? existing;

  const _ProjectFormPage({
    required this.districtId,
    this.existing,
  });

  @override
  State<_ProjectFormPage> createState() => _ProjectFormPageState();
}

class _ProjectFormPageState extends State<_ProjectFormPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');
  final _isoFmt = DateFormat('yyyy-MM-dd');

  // Text controllers (mirror web names)
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();
  final _otherAofCtrl = TextEditingController();
  final _otherCategoryCtrl = TextEditingController();
  final _otherSubCategoryCtrl = TextEditingController();
  final _costCtrl = TextEditingController();
  final _beneficiariesCtrl = TextEditingController();
  final _manHoursCtrl = TextEditingController();
  final _rotariansCtrl = TextEditingController();
  final _rotaractorsCtrl = TextEditingController();

  // Funding-conditional fields (shown only for Global Grant / CSR funding).
  final _ggNumberCtrl = TextEditingController();
  final _amtSanctionedCtrl = TextEditingController();
  final _amtReceivedCtrl = TextEditingController();
  final _amtSpentCtrl = TextEditingController();
  final _hostCtrl = TextEditingController();
  final _partnerCtrl = TextEditingController();
  final _csrCompanyCtrl = TextEditingController();

  DateTime? _projectDate;
  bool _saving = false;
  bool _initLoading = true;

  // Lookups
  List<_DropdownItem> _areasOfFocus = const [];
  List<_DropdownItem> _categories = const [];
  List<_DropdownItem> _subCategories = const [];
  List<_DropdownItem> _fundings = const [];

  int? _aofId;
  int? _categoryId;
  int? _subCategoryId;
  int? _fundingId;
  int? _moduleId; // community_service module id, resolved on init

  bool get _isOthersAof => _aofId == _kOthersSentinel;
  bool get _isOthersCategory => _categoryId == _kOthersSentinel;
  bool get _isOthersSubCategory => _subCategoryId == _kOthersSentinel;

  // ── Funding classification (mirrors backend ClassifyFunding + web) ──────────
  String _classifyFunding(String? name) {
    if (name == null) return '';
    final n = name.trim().toLowerCase();
    if (n.contains('global grant')) return 'global_grant';
    if (n == 'csr' || n.startsWith('csr ') || n.contains(' csr') || n.contains('(csr)')) {
      return 'csr';
    }
    return '';
  }

  String? get _selectedFundingName {
    for (final f in _fundings) {
      if (f.id == _fundingId) return f.name;
    }
    return null;
  }

  String get _fundingClass => _classifyFunding(_selectedFundingName);
  bool get _showGlobalGrant => _fundingClass == 'global_grant';
  bool get _showCsr => _fundingClass == 'csr';

  // Preserved-from-server fields the form doesn't expose but the API may store
  // on existing records — we send them back unchanged on edit so toggling
  // them from the web UI isn't clobbered by mobile saves.
  bool _existingIsJointProject = false;
  bool _existingIsActive = true;
  String? _existingCoHostName;

  // Photos
  final List<_ProjectPhoto> _photos = [];
  static const int _maxPhotos = 5;
  bool _uploadingPhoto = false;
  bool _loadingPhotos = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  /// Resolve the community_service module id, fetch funding + AoFs in
  /// parallel, then (if editing) hydrate the form from the project detail.
  Future<void> _bootstrap() async {
    setState(() => _initLoading = true);
    // Seed the scalar fields synchronously from the row the list already
    // loaded, so the form is never blank even if the detail GET below is slow
    // or fails. _hydrateFromExisting then enriches the dropdowns + photos.
    if (_isEditing) _seedFromExisting();
    try {
      _moduleId = await _resolveCommunityServiceModuleId();
      await Future.wait([
        _loadAreasOfFocus(),
        _loadFundings(),
      ]);
      if (_isEditing) {
        // Recover the dropdowns + primary photo from the list row first (works
        // even when the detail endpoint 404s), then let the detail fetch
        // override with exact ids/photos when it's available.
        await _recoverFromListRow();
        await _hydrateFromExisting();
      }
    } catch (_) {
      // soft-fail; user will see empty dropdowns rather than a blocked form
    } finally {
      if (mounted) setState(() => _initLoading = false);
    }
  }

  /// Pre-fill the text fields from the list row (`widget.existing`) before the
  /// network detail fetch resolves. Covers everything the list endpoint returns.
  void _seedFromExisting() {
    final e = widget.existing!;
    _titleCtrl.text = e.title;
    _descCtrl.text = e.description ?? '';
    _locationCtrl.text = e.location ?? '';
    _projectDate = e.projectDate;
    _costCtrl.text = _numToCtrl(e.projectCost);
    _beneficiariesCtrl.text = _numToCtrl(e.directBeneficiaries);
    _manHoursCtrl.text = _numToCtrl(e.manHours);
    _rotariansCtrl.text = _numToCtrl(e.rotariansInvolved);
    _rotaractorsCtrl.text = _numToCtrl(e.rotaractorsInvolved);
  }

  /// Recover the Area-of-Focus + Category dropdown selections (by name) and the
  /// primary photo from the list row. This is the fallback that keeps edit
  /// usable when the detail endpoint (`/districts/{id}/projects/{id}`) 404s —
  /// the list only gives names + the primary photo, not ids, so we match names
  /// against the loaded masters to derive the ids.
  Future<void> _recoverFromListRow() async {
    final e = widget.existing!;
    final aofName = e.areaOfFocusName?.trim().toLowerCase();
    if (aofName != null && aofName.isNotEmpty) {
      final match = _areasOfFocus
          .where((a) => a.name.trim().toLowerCase() == aofName)
          .toList();
      if (match.isNotEmpty) {
        _aofId = match.first.id;
        await _loadCategories(_aofId!);
        final catName = e.categoryName?.trim().toLowerCase();
        if (catName != null && catName.isNotEmpty) {
          final cm = _categories
              .where((c) => c.name.trim().toLowerCase() == catName)
              .toList();
          if (cm.isNotEmpty) _categoryId = cm.first.id;
        }
      }
    }
    final photo = e.primaryPhoto?.trim();
    if (photo != null && photo.isNotEmpty && _photos.isEmpty) {
      _photos.add(_ProjectPhoto(path: photo, isPrimary: true));
    }
    if (mounted) setState(() {});
  }

  /// Project collection path for this district.
  String get _projectsBase => '/api/districts/${widget.districtId}/projects';

  /// Rotary year the edited project lives in. Detail/edit/delete are
  /// year-scoped (`/projects/{yearId}/{id}`) because projects are stored in
  /// year-partitioned tables.
  int? get _existingYearId => widget.existing?.yearId;

  /// GET the full project record from its year-partitioned table.
  Future<ApiResponse<Map<String, dynamic>>> _getProjectDetail(int yearId, int id) {
    return _api.get<Map<String, dynamic>>(
      '$_projectsBase/$yearId/$id',
      fromJson: (j) => j as Map<String, dynamic>,
    );
  }

  Future<int?> _resolveCommunityServiceModuleId() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/modules',
        fromJson: (j) => j as List<dynamic>,
      );
      for (final raw in resp.data ?? const []) {
        if (raw is! Map<String, dynamic>) continue;
        if (raw['moduleKey']?.toString() == _kCommunityServiceModuleKey) {
          final id = raw['id'];
          if (id is int && id > 0) return id;
        }
      }
    } catch (_) {/* fall through */}
    return null;
  }

  Future<void> _loadAreasOfFocus() async {
    if (_moduleId == null) return;
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/area-of-focus',
        queryParams: {'moduleId': _moduleId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _areasOfFocus = _usableOptions((resp.data ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(_DropdownItem.fromJson)
            .toList());
      });
    } catch (_) {}
  }

  Future<void> _loadFundings() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/funding',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _fundings = (resp.data ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(_DropdownItem.fromJson)
            .toList();
      });
    } catch (_) {}
  }

  Future<void> _loadCategories(int aofId) async {
    if (aofId == _kOthersSentinel) {
      setState(() {
        _categories = const [];
        _categoryId = null;
        _subCategories = const [];
        _subCategoryId = null;
      });
      return;
    }
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/categories',
        queryParams: {'areaOfFocusId': aofId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _categories = _usableOptions((resp.data ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(_DropdownItem.fromJson)
            .toList());
      });
    } catch (_) {}
  }

  Future<void> _loadSubCategories(int categoryId) async {
    if (categoryId == _kOthersSentinel) {
      setState(() {
        _subCategories = const [];
        _subCategoryId = null;
      });
      return;
    }
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/sub-categories',
        queryParams: {'categoryId': categoryId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _subCategories = _usableOptions((resp.data ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(_DropdownItem.fromJson)
            .toList());
      });
    } catch (_) {}
  }

  /// Hydrate every form field from `/api/districts/{id}/projects/{projectId}`
  /// — this is the only place we read the full project record. Cascades the
  /// AoF → Category → Sub-Category loads in sequence so the existing
  /// selections are present in their respective dropdowns when applied.
  Future<void> _hydrateFromExisting() async {
    // No year → can't hit the year-scoped detail route; the list-row recovery
    // (already run in _bootstrap) keeps the form populated.
    if (_existingYearId == null) return;
    setState(() => _loadingPhotos = true);
    try {
      final resp = await _getProjectDetail(_existingYearId!, widget.existing!.id);
      // The controller wraps the row in `{ project: {…}, photos: [...] }`
      // (DistrictModulesController.GetDistrictProject). The scalar columns
      // live under `project`; reading them from the root used to leave every
      // field null, so the edit form rendered blank.
      final root = resp.data ?? const <String, dynamic>{};
      final d = (root['project'] is Map<String, dynamic>)
          ? root['project'] as Map<String, dynamic>
          : root;
      if (!mounted) return;

      _titleCtrl.text = (d['title'] ?? '').toString();
      _descCtrl.text = (d['description'] ?? '').toString();
      _locationCtrl.text = (d['location'] ?? '').toString();

      // Only adopt the detail endpoint's id when it actually exists in the
      // loaded dropdown options. The detail's ids can live in a different id
      // space than the module-scoped masters (or point at inactive/deleted
      // rows), and a DropdownButton crashes if its value isn't among its items.
      // When the id isn't present we keep the name-matched id that
      // _recoverFromListRow already resolved (or leave it null).
      final aofId = (d['areaOfFocusId'] as num?)?.toInt();
      final otherAof = (d['otherAreaOfFocus'] ?? '').toString();
      if (aofId != null && _areasOfFocus.any((a) => a.id == aofId)) {
        _aofId = aofId;
      } else if (otherAof.isNotEmpty) {
        _aofId = _kOthersSentinel;
        _otherAofCtrl.text = otherAof;
      }
      if (_aofId != null && _aofId != _kOthersSentinel) {
        await _loadCategories(_aofId!);
      }

      final catId = (d['categoryId'] as num?)?.toInt();
      final otherCat = (d['otherCategory'] ?? '').toString();
      if (catId != null && _categories.any((c) => c.id == catId)) {
        _categoryId = catId;
      } else if (otherCat.isNotEmpty) {
        _categoryId = _kOthersSentinel;
        _otherCategoryCtrl.text = otherCat;
      }
      if (_categoryId != null && _categoryId != _kOthersSentinel) {
        await _loadSubCategories(_categoryId!);
      }

      final subId = (d['subCategoryId'] as num?)?.toInt();
      final otherSub = (d['otherSubCategory'] ?? '').toString();
      if (subId != null && _subCategories.any((s) => s.id == subId)) {
        _subCategoryId = subId;
      } else if (otherSub.isNotEmpty) {
        _subCategoryId = _kOthersSentinel;
        _otherSubCategoryCtrl.text = otherSub;
      }

      final fundingId = (d['fundingId'] as num?)?.toInt();
      if (fundingId != null && _fundings.any((f) => f.id == fundingId)) {
        _fundingId = fundingId;
      }

      // Funding-conditional fields — populate so the relevant block prefills on
      // edit (the build shows them based on the resolved funding name).
      _ggNumberCtrl.text = (d['globalGrantNumber'] ?? '').toString();
      _amtSanctionedCtrl.text = _numToCtrl(d['amountSanctioned']);
      _amtReceivedCtrl.text = _numToCtrl(d['amountReceived']);
      _amtSpentCtrl.text = _numToCtrl(d['amountSpent']);
      _hostCtrl.text = (d['hostClubsDistricts'] ?? '').toString();
      _partnerCtrl.text = (d['globalPartnerClubsDistricts'] ?? '').toString();
      _csrCompanyCtrl.text = (d['csrCompanyName'] ?? '').toString();

      final pd = (d['projectDate'] ?? '').toString();
      if (pd.isNotEmpty) _projectDate = DateTime.tryParse(pd);

      _costCtrl.text = _numToCtrl(d['projectCost']);
      _beneficiariesCtrl.text = _numToCtrl(d['directBeneficiaries']);
      _manHoursCtrl.text = _numToCtrl(d['manHours']);
      _rotariansCtrl.text = _numToCtrl(d['rotariansInvolved']);
      _rotaractorsCtrl.text = _numToCtrl(d['rotaractorsInvolved']);

      _existingIsJointProject = d['isJointProject'] == true;
      _existingIsActive = d['isActive'] != false;
      _existingCoHostName = (d['coHostName'] as String?);

      // Photos sit at the response root (`{ project, photos }`), not nested
      // inside `project`. Read from `root` so the gallery hydrates correctly
      // even when the legacy flat shape isn't being returned.
      final rawPhotos = (root['photos'] as List?) ?? (d['photos'] as List?) ?? const [];
      _photos
        ..clear()
        ..addAll(rawPhotos
            .whereType<Map<String, dynamic>>()
            .map(_ProjectPhoto.fromJson));
      if (_photos.isNotEmpty && !_photos.any((p) => p.isPrimary)) {
        _photos.first.isPrimary = true;
      }
      setState(() {});
    } catch (e) {
      // The scalar fields are already seeded from the list row, so the form is
      // never blank. A 404 here just means the detail endpoint can't find this
      // project record (a data quirk for some rows) — the focus area / category
      // / funding dropdowns and full photo list can't be enriched, but the form
      // stays usable, so show a soft note rather than a red error. Any other
      // failure (500/network) is a real problem and is shown in red.
      if (mounted) {
        final is404 = e is ApiException && e.statusCode == 404;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(is404
                ? 'Loaded from summary. Check funding, sub-category and photos before saving.'
                : (e is ApiException ? e.message : 'Could not load full project details.')),
            backgroundColor: is404 ? Colors.grey.shade800 : AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingPhotos = false);
    }
  }

  String _numToCtrl(dynamic v) {
    if (v == null) return '';
    if (v is num) {
      // ints stay integral; doubles drop a trailing .0
      if (v is int || v == v.toInt()) return v.toInt().toString();
      return v.toString();
    }
    return v.toString();
  }

  // ── Photo handling ────────────────────────────────────────────────────────

  Future<void> _pickAndUploadPhoto() async {
    if (_photos.length >= _maxPhotos) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: const Text('Maximum $_maxPhotos photos allowed'),
          backgroundColor: AppColors.warning,
        ),
      );
      return;
    }
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      // Free-form crop before upload (no fixed ratio).
      final cropped = await cropImageFree(picked.path, title: 'Crop Image');
      if (cropped == null) return;
      final reject = await _validatePhotoFile(cropped);
      if (reject != null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(reject), backgroundColor: AppColors.error),
          );
        }
        return;
      }
      setState(() => _uploadingPhoto = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/projects/upload',
        filePath: cropped,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final path = (resp.data?['imagePath'] as String?) ??
          (resp.data?['path'] as String?) ??
          '';
      if (path.isEmpty) throw Exception('Upload returned empty path');
      setState(() {
        final isFirst = _photos.isEmpty;
        _photos.add(_ProjectPhoto(path: path, isPrimary: isFirst));
        _uploadingPhoto = false;
      });
    } catch (e) {
      setState(() => _uploadingPhoto = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Photo upload failed: $e'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  /// Enforces the web spec: allowed formats and max 10 MB file size. No
  /// minimum resolution is enforced (the backend has none either), so phone
  /// photos of any dimensions are accepted. Returns the user-facing error or
  /// null if valid.
  Future<String?> _validatePhotoFile(String path) async {
    final lower = path.toLowerCase();
    final dot = lower.lastIndexOf('.');
    final ext = dot >= 0 ? lower.substring(dot + 1) : '';
    if (!_kAllowedPhotoExts.contains(ext)) {
      return 'Allowed formats: JPG, JPEG, PNG, GIF, WEBP.';
    }
    try {
      final file = File(path);
      final size = await file.length();
      if (size > _kPhotoMaxBytes) {
        final mb = (size / (1024 * 1024)).toStringAsFixed(1);
        return 'Photo exceeds 10 MB limit (file is $mb MB).';
      }
    } catch (_) {
      return 'Could not read this image file.';
    }
    return null;
  }

  void _markPrimary(int index) {
    setState(() {
      for (var i = 0; i < _photos.length; i++) {
        _photos[i].isPrimary = (i == index);
      }
    });
  }

  void _removePhoto(int index) {
    setState(() {
      final wasPrimary = _photos[index].isPrimary;
      _photos.removeAt(index);
      if (wasPrimary && _photos.isNotEmpty) _photos.first.isPrimary = true;
    });
  }


  @override
  void dispose() {
    for (final c in [
      _titleCtrl,
      _descCtrl,
      _locationCtrl,
      _otherAofCtrl,
      _otherCategoryCtrl,
      _otherSubCategoryCtrl,
      _costCtrl,
      _beneficiariesCtrl,
      _manHoursCtrl,
      _rotariansCtrl,
      _rotaractorsCtrl,
      _ggNumberCtrl,
      _amtSanctionedCtrl,
      _amtReceivedCtrl,
      _amtSpentCtrl,
      _hostCtrl,
      _partnerCtrl,
      _csrCompanyCtrl,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    // Projects can only be dated today or in the past — no future dates.
    final today = DateTime.now();
    DateTime initial = _projectDate ?? today;
    if (initial.isAfter(today)) initial = today;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2000),
      lastDate: today,
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: const ColorScheme.light(primary: AppColors.primary),
        ),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _projectDate = picked);
  }

  // ── Save / validation ─────────────────────────────────────────────────────

  Future<void> _save() async {
    final err = _runValidation();
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err), backgroundColor: AppColors.error),
      );
      return;
    }
    setState(() => _saving = true);

    final body = <String, dynamic>{
      'title': _titleCtrl.text.trim(),
      'description': _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
      'location': _locationCtrl.text.trim().isEmpty ? null : _locationCtrl.text.trim(),
      'areaOfFocusId': _isOthersAof ? null : _aofId,
      'otherAreaOfFocus': _isOthersAof ? _otherAofCtrl.text.trim() : null,
      'categoryId': _isOthersAof ? null : (_isOthersCategory ? null : _categoryId),
      'otherCategory': _isOthersCategory ? _otherCategoryCtrl.text.trim() : null,
      'subCategoryId': _isOthersAof || _isOthersCategory
          ? null
          : (_isOthersSubCategory ? null : _subCategoryId),
      'otherSubCategory':
          _isOthersSubCategory ? _otherSubCategoryCtrl.text.trim() : null,
      'projectDate': _isoFmt.format(_projectDate!),
      'projectCost': _parseNum(_costCtrl.text),
      'fundingId': _fundingId,
      // Funding-conditional fields — only send the ones relevant to the selected
      // funding; the rest are null (the backend also nulls non-applicable ones).
      'globalGrantNumber': _showGlobalGrant ? _nullIfEmpty(_ggNumberCtrl.text) : null,
      'amountSanctioned': (_showGlobalGrant || _showCsr) ? _parseNum(_amtSanctionedCtrl.text) : null,
      'amountReceived': (_showGlobalGrant || _showCsr) ? _parseNum(_amtReceivedCtrl.text) : null,
      'amountSpent': _showGlobalGrant ? _parseNum(_amtSpentCtrl.text) : null,
      'hostClubsDistricts': _showGlobalGrant ? _nullIfEmpty(_hostCtrl.text) : null,
      'globalPartnerClubsDistricts': _showGlobalGrant ? _nullIfEmpty(_partnerCtrl.text) : null,
      'csrCompanyName': _showCsr ? _nullIfEmpty(_csrCompanyCtrl.text) : null,
      'directBeneficiaries': _parseInt(_beneficiariesCtrl.text),
      'manHours': _parseInt(_manHoursCtrl.text),
      'rotariansInvolved': _parseInt(_rotariansCtrl.text),
      'rotaractorsInvolved': _parseInt(_rotaractorsCtrl.text),
      'photos': [
        for (var i = 0; i < _photos.length; i++)
          {
            'imagePath': _photos[i].path,
            'description': _photos[i].description.trim().isEmpty
                ? null
                : _photos[i].description.trim(),
            'isPrimary': i == 0 ? true : _photos[i].isPrimary,
            'sortOrder': i,
          }
      ],
      // Preserve server-side values the form doesn't expose (web add page
      // doesn't include them; for edit we send the existing values so a
      // toggled value from the web side isn't reverted).
      if (_isEditing) ...{
        'isJointProject': _existingIsJointProject,
        'isActive': _existingIsActive,
        if (_existingCoHostName != null && _existingCoHostName!.isNotEmpty)
          'coHostName': _existingCoHostName,
      },
    };

    try {
      if (_isEditing) {
        final yearId = _existingYearId;
        if (yearId == null) {
          throw const ApiException('Cannot save: this project has no rotary year.');
        }
        try {
          // Year-scoped update. If the new date crosses into another rotary
          // year the server replies 409 (ConflictException) and we confirm a
          // move instead (the record gets a new id in the target year).
          await _api.put('$_projectsBase/$yearId/${widget.existing!.id}', body: body);
        } on ApiException catch (e) {
          if (e.statusCode != 409) rethrow;
          if (!mounted) return;
          final confirmed = await ConfirmationDialog.show(
            context,
            title: 'Move project?',
            message: e.message,
            confirmLabel: 'Move',
          );
          if (!confirmed) {
            if (mounted) setState(() => _saving = false);
            return; // user cancelled — leave the project where it is
          }
          await _api.post('$_projectsBase/$yearId/${widget.existing!.id}/move', body: body);
        }
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/projects',
          body: body,
        );
      }
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Project updated' : 'Project created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Save failed: $e';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Mirrors the web `handleSave` validation order so error messages line up
  /// between platforms.
  String? _runValidation() {
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) return 'Title is required.';
    if (title.length > _kTitleMaxChars) {
      return 'Title must be $_kTitleMaxChars characters or less.';
    }
    if (!_kEnglishOnly.hasMatch(title)) return 'Title must be in English only.';

    final desc = _descCtrl.text;
    if (desc.isNotEmpty) {
      if (!_kEnglishOnly.hasMatch(desc)) {
        return 'Description must be in English only.';
      }
      if (desc.length > _kDescMaxChars) {
        return 'Description must be $_kDescMaxChars characters or less.';
      }
    }
    if (_projectDate == null) return 'Date is required.';
    if (_aofId == null) return 'Area of Focus is required.';
    if (_isOthersAof && _otherAofCtrl.text.trim().isEmpty) {
      return 'Please specify the Area of Focus.';
    }
    if (!_isOthersAof && _categoryId == null) {
      return 'Category is required.';
    }
    if (_isOthersCategory && _otherCategoryCtrl.text.trim().isEmpty) {
      return 'Please specify the Category.';
    }
    if (_isOthersSubCategory && _otherSubCategoryCtrl.text.trim().isEmpty) {
      return 'Please specify the Sub Category.';
    }
    if (_showGlobalGrant) {
      if (_ggNumberCtrl.text.trim().isEmpty) return 'Global Grant Number is required for Global Grant.';
      if (_amtSanctionedCtrl.text.trim().isEmpty) return 'Amount Sanctioned is required for Global Grant.';
      if (_amtReceivedCtrl.text.trim().isEmpty) return 'Amount Received is required for Global Grant.';
      if (_amtSpentCtrl.text.trim().isEmpty) return 'Amount Spent Till Date is required for Global Grant.';
      if (_hostCtrl.text.trim().isEmpty) return 'Host Clubs/Districts is required for Global Grant.';
      if (_partnerCtrl.text.trim().isEmpty) return 'Global Partner Clubs/Districts is required for Global Grant.';
    } else if (_showCsr) {
      if (_csrCompanyCtrl.text.trim().isEmpty) return 'Name of the CSR Company is required for CSR.';
      if (_amtSanctionedCtrl.text.trim().isEmpty) return 'Amount Sanctioned is required for CSR.';
      if (_amtReceivedCtrl.text.trim().isEmpty) return 'Amount Received is required for CSR.';
    }
    if (_photos.isEmpty) return 'At least one photo is required.';
    return null;
  }

  String? _nullIfEmpty(String s) => s.trim().isEmpty ? null : s.trim();

  int? _parseInt(String s) {
    final t = s.trim();
    if (t.isEmpty) return null;
    return int.tryParse(t);
  }

  num? _parseNum(String s) {
    final t = s.trim();
    if (t.isEmpty) return null;
    return num.tryParse(t);
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEditing ? 'Edit District Project' : 'Add District Project',
      ),
      body: _initLoading
          ? const Center(
              child: SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                  20, 16, 20, 24),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildTitleField(),
                    const SizedBox(height: 12),
                    _buildDescriptionField(),
                    const SizedBox(height: 12),
                    CustomTextField(
                      label: 'Location of the Project',
                      controller: _locationCtrl,
                      hint: 'Enter location',
                      prefixIcon: Icons.location_on_outlined,
                    ),
                    const SizedBox(height: 16),
                    _buildAofDropdown(),
                    if (_isOthersAof) ...[
                      const SizedBox(height: 8),
                      CustomTextField(
                        label: 'Specify Area of Focus *',
                        controller: _otherAofCtrl,
                        hint: 'Enter area of focus',
                      ),
                    ],
                    const SizedBox(height: 16),
                    _buildCategoryDropdown(),
                    if (_isOthersCategory) ...[
                      const SizedBox(height: 8),
                      CustomTextField(
                        label: 'Specify Category *',
                        controller: _otherCategoryCtrl,
                        hint: 'Enter category',
                      ),
                    ],
                    const SizedBox(height: 16),
                    _buildSubCategoryDropdown(),
                    if (_isOthersSubCategory) ...[
                      const SizedBox(height: 8),
                      CustomTextField(
                        label: 'Specify Sub Category',
                        controller: _otherSubCategoryCtrl,
                        hint: 'Enter sub category',
                      ),
                    ],
                    const SizedBox(height: 16),
                    _buildDateField(),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: CustomTextField(
                            label: 'Project Cost (${currencySymbolFor(null)})',
                            controller: _costCtrl,
                            hint: '0',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                  RegExp(r'^\d*\.?\d*'))
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(child: _buildFundingDropdown()),
                      ],
                    ),
                    _buildFundingConditional(),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: CustomTextField(
                            label: 'Direct Beneficiaries',
                            controller: _beneficiariesCtrl,
                            hint: '0',
                            keyboardType: TextInputType.number,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: CustomTextField(
                            label: 'Man Hours',
                            controller: _manHoursCtrl,
                            hint: '0',
                            keyboardType: TextInputType.number,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: CustomTextField(
                            label: 'Rotarians Involved',
                            controller: _rotariansCtrl,
                            hint: '0',
                            keyboardType: TextInputType.number,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: CustomTextField(
                            label: 'Rotaractors Involved',
                            controller: _rotaractorsCtrl,
                            hint: '0',
                            keyboardType: TextInputType.number,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Photos * (Max $_maxPhotos, at least 1 mandatory)',
                      style: AppTextStyles.label,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'JPG, JPEG, PNG, GIF, WEBP. Max 10 MB each.',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 8),
                    _loadingPhotos
                        ? const SizedBox(
                            height: 96,
                            child: Center(
                              child: SizedBox(
                                width: 22,
                                height: 22,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              ),
                            ),
                          )
                        : _DistrictPhotoGallery(
                            photos: _photos,
                            uploading: _uploadingPhoto,
                            onAdd: _photos.length >= _maxPhotos
                                ? null
                                : _pickAndUploadPhoto,
                            onSetPrimary: _markPrimary,
                            onRemove: _removePhoto,
                          ),
                    const SizedBox(height: 20),
                    CustomButton(
                      label: _isEditing ? 'Update' : 'Save Project',
                      onPressed: _save,
                      isLoading: _saving,
                      fullWidth: true,
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildTitleField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CustomTextField(
          label: 'Title * (English only, max $_kTitleMaxChars chars)',
          controller: _titleCtrl,
          hint: 'Project title',
          maxLength: _kTitleMaxChars,
          onChanged: (_) => setState(() {}),
        ),
        _counter(_titleCtrl.text.length, _kTitleMaxChars),
      ],
    );
  }

  Widget _buildDescriptionField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CustomTextField(
          label: 'Description (English only, max $_kDescMaxChars chars)',
          controller: _descCtrl,
          hint: 'Project description',
          maxLines: 4,
          maxLength: _kDescMaxChars,
          onChanged: (_) => setState(() {}),
        ),
        _counter(_descCtrl.text.length, _kDescMaxChars),
      ],
    );
  }

  Widget _counter(int used, int max) {
    return Padding(
      padding: const EdgeInsets.only(top: 2, right: 4),
      child: Align(
        alignment: Alignment.centerRight,
        child: Text(
          '$used/$max',
          style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
        ),
      ),
    );
  }

  Widget _buildDateField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Date *', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickDate,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            ),
            child: Row(
              children: [
                const Icon(Icons.calendar_today_outlined,
                    size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 10),
                Text(
                  _projectDate != null
                      ? _displayDf.format(_projectDate!)
                      : 'Select date',
                  style: _projectDate != null
                      ? AppTextStyles.body
                      : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAofDropdown() {
    final items = <DropdownMenuItem<int>>[
      for (final a in _areasOfFocus)
        DropdownMenuItem(value: a.id, child: Text(a.name)),
      const DropdownMenuItem(value: _kOthersSentinel, child: Text('Others')),
    ];
    return _labeledDropdown(
      label: 'Area of Focus *',
      value: _aofId,
      items: items,
      onChanged: (v) async {
        setState(() {
          _aofId = v;
          _categoryId = null;
          _subCategoryId = null;
          _categories = const [];
          _subCategories = const [];
          if (!_isOthersAof) _otherAofCtrl.clear();
          _otherCategoryCtrl.clear();
          _otherSubCategoryCtrl.clear();
        });
        if (v != null) await _loadCategories(v);
      },
    );
  }

  Widget _buildCategoryDropdown() {
    final disabled = _isOthersAof || _aofId == null;
    final items = <DropdownMenuItem<int>>[
      for (final c in _categories)
        DropdownMenuItem(value: c.id, child: Text(c.name)),
      const DropdownMenuItem(value: _kOthersSentinel, child: Text('Others')),
    ];
    return _labeledDropdown(
      label: 'Category *',
      value: disabled ? null : _categoryId,
      items: items,
      onChanged: disabled
          ? null
          : (v) async {
              setState(() {
                _categoryId = v;
                _subCategoryId = null;
                _subCategories = const [];
                if (!_isOthersCategory) _otherCategoryCtrl.clear();
                _otherSubCategoryCtrl.clear();
              });
              if (v != null) await _loadSubCategories(v);
            },
      placeholder: disabled ? 'N/A' : 'Select',
    );
  }

  Widget _buildSubCategoryDropdown() {
    final disabled =
        _isOthersAof || _isOthersCategory || _categoryId == null;
    final items = <DropdownMenuItem<int>>[
      for (final s in _subCategories)
        DropdownMenuItem(value: s.id, child: Text(s.name)),
      const DropdownMenuItem(value: _kOthersSentinel, child: Text('Others')),
    ];
    return _labeledDropdown(
      label: 'Sub Category',
      value: disabled ? null : _subCategoryId,
      items: items,
      onChanged: disabled
          ? null
          : (v) {
              setState(() {
                _subCategoryId = v;
                if (!_isOthersSubCategory) _otherSubCategoryCtrl.clear();
              });
            },
      placeholder: disabled ? 'N/A' : 'Select',
    );
  }

  /// Numeric (amount / grant number) field used in the funding blocks.
  Widget _amountField(String label, TextEditingController ctrl) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: CustomTextField(
        label: label,
        controller: ctrl,
        hint: '0',
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      ),
    );
  }

  Widget _textField(String label, TextEditingController ctrl, String hint) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: CustomTextField(label: label, controller: ctrl, hint: hint),
    );
  }

  /// Global Grant / CSR conditional fields, shown based on the selected funding.
  Widget _buildFundingConditional() {
    if (_showGlobalGrant) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _amountField('Global Grant Number *', _ggNumberCtrl),
          _amountField('Amount Sanctioned (${currencySymbolFor(null)}) *', _amtSanctionedCtrl),
          _amountField('Amount Received (${currencySymbolFor(null)}) *', _amtReceivedCtrl),
          _amountField('Amount spent till date (${currencySymbolFor(null)}) *', _amtSpentCtrl),
          _textField('Host Clubs/Districts *', _hostCtrl, 'e.g., RC Pune, RC Mumbai'),
          _textField('Global Partner Clubs/Districts *', _partnerCtrl, 'e.g., RC Tokyo'),
        ],
      );
    }
    if (_showCsr) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _textField('Name of the CSR Company *', _csrCompanyCtrl, 'e.g., ABC Industries Pvt Ltd'),
          _amountField('Amount Sanctioned (${currencySymbolFor(null)}) *', _amtSanctionedCtrl),
          _amountField('Amount Received (${currencySymbolFor(null)}) *', _amtReceivedCtrl),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _buildFundingDropdown() {
    final items = <DropdownMenuItem<int>>[
      for (final f in _fundings)
        DropdownMenuItem(value: f.id, child: Text(f.name)),
    ];
    return _labeledDropdown(
      label: 'Funding',
      value: _fundingId,
      items: items,
      // Changing funding wipes the conditional fields so stale Global Grant/CSR
      // values are never carried over to a different funding type.
      onChanged: (v) => setState(() {
        _fundingId = v;
        _ggNumberCtrl.clear();
        _amtSanctionedCtrl.clear();
        _amtReceivedCtrl.clear();
        _amtSpentCtrl.clear();
        _hostCtrl.clear();
        _partnerCtrl.clear();
        _csrCompanyCtrl.clear();
      }),
    );
  }

  Widget _labeledDropdown({
    required String label,
    required int? value,
    required List<DropdownMenuItem<int>> items,
    required ValueChanged<int?>? onChanged,
    String placeholder = 'Select',
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.label),
        const SizedBox(height: 6),
        DropdownButtonFormField<int>(
          initialValue: value,
          isExpanded: true,
          decoration: const InputDecoration(
            contentPadding:
                EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
          hint: Text(
            placeholder,
            style: AppTextStyles.body.copyWith(color: AppColors.textMuted),
          ),
          items: items,
          onChanged: onChanged,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Photo Gallery (horizontal strip + add tile)
// ---------------------------------------------------------------------------
/// Vertical photo list with an inline description field per photo (matches the
/// web form, where each image has its own caption box + character counter).
class _DistrictPhotoGallery extends StatelessWidget {
  final List<_ProjectPhoto> photos;
  final bool uploading;
  final VoidCallback? onAdd;
  final ValueChanged<int> onSetPrimary;
  final ValueChanged<int> onRemove;

  const _DistrictPhotoGallery({
    required this.photos,
    required this.uploading,
    required this.onAdd,
    required this.onSetPrimary,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < photos.length; i++) ...[
          _DistrictPhotoCard(
            // Key by the (unique) upload path so each card keeps its own
            // description controller even when photos are added/removed and
            // the list indices shift.
            key: ValueKey('district_project_photo_${photos[i].path}'),
            photo: photos[i],
            isPrimary: photos[i].isPrimary,
            onSetPrimary: () => onSetPrimary(i),
            onRemove: () => onRemove(i),
          ),
          const SizedBox(height: 10),
        ],
        InkWell(
          onTap: uploading ? null : onAdd,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.border),
            ),
            alignment: Alignment.center,
            child: uploading
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.add_a_photo_outlined, color: AppColors.textSecondary, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        onAdd == null ? 'Maximum photos reached' : 'Add photo',
                        style: AppTextStyles.bodyMedium,
                      ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }
}

/// A single photo row: thumbnail + inline description field (with counter) +
/// primary / delete controls. Stateful so the description TextEditingController
/// survives parent rebuilds; edits are written straight back to [photo].
class _DistrictPhotoCard extends StatefulWidget {
  final _ProjectPhoto photo;
  final bool isPrimary;
  final VoidCallback onSetPrimary;
  final VoidCallback onRemove;

  const _DistrictPhotoCard({
    super.key,
    required this.photo,
    required this.isPrimary,
    required this.onSetPrimary,
    required this.onRemove,
  });

  @override
  State<_DistrictPhotoCard> createState() => _DistrictPhotoCardState();
}

class _DistrictPhotoCardState extends State<_DistrictPhotoCard> {
  late final TextEditingController _descCtrl;

  @override
  void initState() {
    super.initState();
    _descCtrl = TextEditingController(text: widget.photo.description);
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final photo = widget.photo;
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: widget.isPrimary ? AppColors.primary : AppColors.border,
          width: widget.isPrimary ? 2 : 1,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Container(
              width: 84,
              height: 84,
              color: AppColors.background,
              child: photo.path.isNotEmpty
                  ? Image.network(
                      ApiConstants.mediaUrl(photo.path),
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const Icon(
                        Icons.broken_image_outlined,
                        color: AppColors.textSecondary,
                      ),
                    )
                  : const Icon(Icons.image_outlined, color: AppColors.textSecondary, size: 28),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _descCtrl,
                  minLines: 2,
                  maxLines: 3,
                  maxLength: _kPhotoDescMaxChars,
                  keyboardType: TextInputType.multiline,
                  textInputAction: TextInputAction.newline,
                  // Write edits straight back to the model; the parent reads
                  // `photo.description` at save time.
                  onChanged: (v) => widget.photo.description = v,
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Description for this photo',
                    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
                Row(
                  children: [
                    InkWell(
                      onTap: widget.onSetPrimary,
                      borderRadius: BorderRadius.circular(6),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 2),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              widget.isPrimary ? Icons.star : Icons.star_border,
                              size: 18,
                              color: widget.isPrimary ? Colors.amber : AppColors.textSecondary,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              widget.isPrimary ? 'Primary' : 'Set primary',
                              style: AppTextStyles.caption.copyWith(
                                color: widget.isPrimary ? AppColors.primary : AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.error),
                      visualDensity: VisualDensity.compact,
                      onPressed: widget.onRemove,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail Screen (read-only) — view a single district project.
// Fetches `/api/districts/{id}/projects/{yearId}/{projectId}` which returns
// `{ project: {…}, photos: [...] }`. Seeds from the tapped list row so it never
// opens blank and survives a failed / 404 detail call (be defensive — district
// project detail endpoints have 404'd before).
// ---------------------------------------------------------------------------
class _ProjectDetailScreen extends StatefulWidget {
  final int districtId;
  final int projectId;
  final int yearId;
  final _Project fallback;

  const _ProjectDetailScreen({
    required this.districtId,
    required this.projectId,
    required this.yearId,
    required this.fallback,
  });

  @override
  State<_ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<_ProjectDetailScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');
  static NumberFormat get _inrFmt => NumberFormat.decimalPattern(brandNumberLocale());

  Map<String, dynamic> _project = const {};
  List<_ProjectPhoto> _photos = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/projects/${widget.yearId}/${widget.projectId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final root = resp.data ?? const <String, dynamic>{};
      final project = (root['project'] is Map<String, dynamic>)
          ? root['project'] as Map<String, dynamic>
          : root;
      final rawPhotos = (root['photos'] as List?) ??
          (project['photos'] as List?) ??
          const [];
      final photos = rawPhotos
          .whereType<Map<String, dynamic>>()
          .map(_ProjectPhoto.fromJson)
          .where((p) => p.path.isNotEmpty)
          .toList();
      setState(() {
        _project = project;
        _photos = photos;
        _loading = false;
      });
    } catch (e) {
      // Be defensive: keep the fallback row visible rather than hard-failing.
      if (!mounted) return;
      setState(() {
        _error = _project.isEmpty && widget.fallback.id == 0
            ? 'Failed to load: $e'
            : null;
        _loading = false;
      });
    }
  }

  String? _text(dynamic v) {
    final s = v?.toString().trim() ?? '';
    return s.isEmpty ? null : s;
  }

  String? _count(dynamic v) {
    final n = (v is num) ? v : num.tryParse(v?.toString() ?? '');
    if (n == null || n == 0) return null;
    return _inrFmt.format(n.toInt());
  }

  String? _money(dynamic v, {String? symbol}) {
    final n = (v is num) ? v : num.tryParse(v?.toString() ?? '');
    if (n == null || n <= 0) return null;
    final hasFraction = n != n.truncateToDouble();
    return '${symbol ?? currencySymbolFor(null)} ${hasFraction ? _inrFmt.format(n) : _inrFmt.format(n.toInt())}';
  }

  String? _date(dynamic v) {
    final raw = v?.toString();
    if (raw == null || raw.isEmpty) return null;
    final dt = DateTime.tryParse(raw);
    if (dt == null || dt.year <= 1) return null;
    return _df.format(dt);
  }

  bool _bool(dynamic v) => v == true || v == 1 || v == 'true' || v == '1';

  @override
  Widget build(BuildContext context) {
    // Seed from the tapped row so the page never opens blank.
    final fb = widget.fallback;
    final p = <String, dynamic>{
      'title': fb.title,
      'description': fb.description,
      'location': fb.location,
      'projectDate': fb.projectDate?.toIso8601String(),
      'projectCost': fb.projectCost,
      'currency': fb.currency,
      'directBeneficiaries': fb.directBeneficiaries,
      'manHours': fb.manHours,
      'rotariansInvolved': fb.rotariansInvolved,
      'rotaractorsInvolved': fb.rotaractorsInvolved,
      'areaOfFocusName': fb.areaOfFocusName,
      'categoryName': fb.categoryName,
      'isJointProject': fb.isJointProject,
      'coHostName': fb.coHostName,
      ..._project, // detail overrides the seed once loaded
    };

    final photos = _photos.isNotEmpty
        ? _photos
        : (fb.primaryPhoto != null && fb.primaryPhoto!.trim().isNotEmpty
            ? <_ProjectPhoto>[
                _ProjectPhoto(path: fb.primaryPhoto!, isPrimary: true)
              ]
            : const <_ProjectPhoto>[]);

    final title = _text(p['title']) ?? 'Project';

    return DetailScaffold(
      title: 'District Project',
      loading: _loading && _project.isEmpty && fb.id == 0,
      error: _error,
      onRetry: _fetch,
      actions: [
        IconButton(
          tooltip: 'Share',
          icon: const Icon(Icons.share_outlined),
          onPressed: () => shareProject(context,
              projectId: widget.projectId, yearId: widget.yearId),
        ),
      ],
      body: (_) {
        final sym = currencySymbolFor(p['currency']?.toString());
        final cost = _money(p['projectCost'], symbol: sym);
        final beneficiaries = _count(p['directBeneficiaries']);
        final manHours = _count(p['manHours']);
        final rotarians = _count(p['rotariansInvolved']);
        final rotaractors = _count(p['rotaractorsInvolved']);
        final aof = _text(p['areaOfFocusName']) ??
            _text(p['areaOfFocus']) ??
            _text(p['otherAreaOfFocus']);
        final category = _text(p['categoryName']) ?? _text(p['otherCategory']);
        final subCategory =
            _text(p['subCategoryName']) ?? _text(p['otherSubCategory']);
        final funding = _text(p['fundingName']);
        final grantNo = _text(p['globalGrantNumber']);
        final amtSanctioned = _money(p['amountSanctioned'], symbol: sym);
        final amtReceived = _money(p['amountReceived'], symbol: sym);
        final amtSpent = _money(p['amountSpent'], symbol: sym);
        final hostClubs = _text(p['hostClubsDistricts']);
        final globalPartners = _text(p['globalPartnerClubsDistricts']);
        final csr = _text(p['csrCompanyName']);
        final date = _date(p['projectDate']);
        final location = _text(p['location']);
        final description = _text(p['description']);
        final projectType = _text(p['projectType']);
        final isJoint = _bool(p['isJointProject']);
        final coHost = _text(p['coHostName']);

        // Build urls + captions together so they stay index-aligned even when a
        // path fails to resolve to a media URL.
        final galleryUrls = <String>[];
        final galleryCaptions = <String>[];
        for (final ph in photos.where((ph) => ph.path.trim().isNotEmpty)) {
          final u = detailMediaUrl(ph.path);
          if (u == null) continue;
          galleryUrls.add(u);
          galleryCaptions.add(ph.description);
        }

        // Date & location are surfaced as chips (club-finder style); the info
        // card holds the structured project fields.
        final chips = <Widget>[
          if (date != null)
            detailInfoChip(Icons.calendar_today_outlined, date),
          if (location != null)
            detailInfoChip(Icons.location_on_outlined, location),
          if (aof != null) detailInfoChip(Icons.track_changes_outlined, aof),
          if (category != null) detailInfoChip(Icons.category_outlined, category),
        ];

        return ListView(
          padding: EdgeInsets.zero,
          children: [
            DetailHeroGallery(urls: galleryUrls, captions: galleryCaptions),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DetailHeroTitle(title: title),
                  DetailHeroChips(chips: chips),
                  if (description != null)
                    DetailHeroParagraph(text: description),
                  DetailHeroInfoCard(rows: [
                    DetailKV('Project Type', projectType),
                    DetailKV('Joint Project', isJoint ? 'Yes' : null),
                    DetailKV('Co-Host', isJoint ? coHost : null),
                    DetailKV('Area of Focus', aof),
                    DetailKV('Category', category),
                    DetailKV('Sub-Category', subCategory),
                    DetailKV('Project Cost', cost),
                    DetailKV('Funding', funding),
                    DetailKV('Global Grant Number', grantNo),
                    DetailKV('Amount Sanctioned', amtSanctioned),
                    DetailKV('Amount Received', amtReceived),
                    DetailKV('Amount Spent Till Date', amtSpent),
                    DetailKV('Host Clubs/Districts', hostClubs),
                    DetailKV('Global Partner Clubs/Districts', globalPartners),
                    DetailKV('CSR Company', csr),
                    DetailKV('Direct Beneficiaries', beneficiaries),
                    DetailKV('Man Hours', manHours),
                    DetailKV('Rotarians Involved', rotarians),
                    DetailKV('Rotaractors Involved', rotaractors),
                  ]),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

