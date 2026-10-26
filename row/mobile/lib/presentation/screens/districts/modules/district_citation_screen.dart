
import 'package:flutter/material.dart' hide Text;
import 'package:flutter_html/flutter_html.dart';
import 'package:flutter_quill/flutter_quill.dart' as quill;
import 'package:flutter_quill_delta_from_html/flutter_quill_delta_from_html.dart';
import 'package:provider/provider.dart';
import 'package:vsc_quill_delta_to_html/vsc_quill_delta_to_html.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../../core/utils/file_download_utils.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_button.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/rotary_year_bar.dart';
import '../../clubs/modules/citation/club_citation_screen.dart';
import 'district_citation_category_form_screen.dart';
import 'district_citation_manual_form_screen.dart';
import 'district_citation_question_form_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ============================================================================
// Models
// ============================================================================

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear(
      {required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _Category {
  final int id;
  final String name;
  final int sortOrder;
  final int yearId;
  const _Category(
      {required this.id,
      required this.name,
      required this.sortOrder,
      required this.yearId});

  factory _Category.fromJson(Map<String, dynamic> j) => _Category(
        id: (j['id'] as int?) ?? 0,
        name: (j['categoryName'] ?? j['name'])?.toString() ?? '',
        sortOrder: (j['sortOrder'] as int?) ?? 0,
        yearId: (j['yearId'] as int?) ?? 0,
      );
}

class _Lookup {
  final int id;
  final String name;
  // For activities only. subType == 1 means the activity supports sub-items.
  final int? subType;
  const _Lookup({required this.id, required this.name, this.subType});

  factory _Lookup.fromJson(Map<String, dynamic> j) => _Lookup(
        id: (j['id'] as int?) ?? 0,
        name: (j['activityName'] ??
                    j['categoryName'] ??
                    j['criteriaName'] ??
                    j['name'])
                ?.toString() ??
            '',
        subType: j['subType'] as int?,
      );
}

class _AutoQuestion {
  final int id;
  final int? categoryId;
  final int? activityId;
  final num points;
  final bool isBonus;
  final num? bonusPoints;
  final num? minBonus;
  final num? maxBonus;
  final int sortOrder;
  final int subItemCount;
  // Raw sub-item list from the API, kept so the edit form can hydrate.
  final List<Map<String, dynamic>> subItemsRaw;

  const _AutoQuestion({
    required this.id,
    this.categoryId,
    this.activityId,
    required this.points,
    this.isBonus = false,
    this.bonusPoints,
    this.minBonus,
    this.maxBonus,
    this.sortOrder = 0,
    this.subItemCount = 0,
    this.subItemsRaw = const [],
  });

  factory _AutoQuestion.fromJson(Map<String, dynamic> j) {
    final subs = j['subItems'];
    final list = subs is List
        ? subs
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    return _AutoQuestion(
      id: (j['id'] as int?) ?? 0,
      categoryId: j['categoryId'] as int?,
      activityId: j['activityId'] as int?,
      points: (j['points'] as num?) ?? 0,
      isBonus: _asBool(j['isBonus']),
      bonusPoints: j['bonusPoints'] as num?,
      minBonus: j['minBonus'] as num?,
      maxBonus: j['maxBonus'] as num?,
      sortOrder: (j['sortOrder'] as int?) ?? 0,
      subItemCount: list.length,
      subItemsRaw: list,
    );
  }
}

class _ManualCriterion {
  final int id;
  final int? categoryId;
  final String? categoryName;
  final String name;
  final num points;
  final int sortOrder;
  final bool isBonus;
  final num? bonusPoints;
  final num? minBonus;
  final num? maxBonus;
  // Raw sub-criteria list from the API; preserved for the edit form to
  // hydrate (titles, answer types, points, options, etc.).
  final List<Map<String, dynamic>> subCriteriaRaw;

  const _ManualCriterion({
    required this.id,
    this.categoryId,
    this.categoryName,
    required this.name,
    required this.points,
    this.sortOrder = 0,
    this.isBonus = false,
    this.bonusPoints,
    this.minBonus,
    this.maxBonus,
    this.subCriteriaRaw = const [],
  });

  factory _ManualCriterion.fromJson(Map<String, dynamic> j) {
    final subs = j['subCriteria'];
    final list = subs is List
        ? subs
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    return _ManualCriterion(
      id: (j['id'] as int?) ?? 0,
      categoryId: j['categoryId'] as int?,
      categoryName: j['categoryName']?.toString(),
      name: (j['criteriaName'] ?? j['name'])?.toString() ?? '',
      points: (j['points'] as num?) ?? 0,
      sortOrder: (j['sortOrder'] as int?) ?? 0,
      isBonus: _asBool(j['isBonus']),
      bonusPoints: j['bonusPoints'] as num?,
      minBonus: j['minBonus'] as num?,
      maxBonus: j['maxBonus'] as num?,
      subCriteriaRaw: list,
    );
  }
}

class _ClubPoints {
  final int clubId;
  final String clubName;
  // Rotary-issued club ID (e.g. "12345"). Optional in backend response.
  final String? clubRotaryId;
  final num totalPoints;

  const _ClubPoints({
    required this.clubId,
    required this.clubName,
    this.clubRotaryId,
    required this.totalPoints,
  });

  factory _ClubPoints.fromJson(Map<String, dynamic> j) => _ClubPoints(
        clubId: (j['clubId'] as int?) ?? 0,
        clubName: j['clubName']?.toString() ?? '',
        clubRotaryId: j['clubRotaryId']?.toString(),
        totalPoints: (j['totalPoints'] as num?) ?? 0,
      );
}

// ============================================================================
// Main screen
// ============================================================================

class DistrictCitationScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  const DistrictCitationScreen(
      {super.key, required this.districtId, this.embedded = false});

  @override
  State<DistrictCitationScreen> createState() => _DistrictCitationScreenState();
}

class _DistrictCitationScreenState extends State<DistrictCitationScreen> {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  // Always fetched from /api/rotary-years (system-wide) so the edit gate
  // can compare regardless of what's in the available-years list.
  int? _currentYearId;
  // "District {N}" — used in the AppBar title. Empty until fetched.
  String _districtName = '';

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    // Fetch district number for the AppBar title (non-blocking; failure
    // just leaves the title generic).
    _api
        .get<Map<String, dynamic>>(
      '/api/districts/${widget.districtId}',
      fromJson: (j) => j as Map<String, dynamic>,
    )
        .then((r) {
      final n = r.data?['districtNumber'];
      if (n != null && mounted) {
        setState(() => _districtName = '$n');
      }
    }).catchError((_) {});
    try {
      List<_RotaryYear> years = [];
      try {
        final availResp = await _api.get<List<dynamic>>(
          '/api/district-modules/${widget.districtId}/citation/available-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (availResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {}

      // Always fetch all rotary years so we know which one is "current" —
      // available-years may not contain it (when no data exists yet).
      int? currentSystemYearId;
      try {
        final allResp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        final all = (allResp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
        final cur = all.firstWhere(
          (y) => y.isCurrent,
          orElse: () => const _RotaryYear(id: 0, yearLabel: ''),
        );
        if (cur.id != 0) currentSystemYearId = cur.id;
        if (years.isEmpty) {
          years = cur.id != 0 ? [cur] : (all.isNotEmpty ? [all.first] : []);
        }
      } catch (_) {}

      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty
            ? years.first
            : const _RotaryYear(id: 0, yearLabel: ''),
      );

      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _currentYearId = currentSystemYearId;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isDistrictAdmin = auth.isDistrictAdminOf(widget.districtId);
    // Editing past years is disallowed (web parity: only current year is
    // editable for district admins). Past years are view-only.
    final bool isCurrentYear = _selectedYearId != null &&
        _currentYearId != null &&
        _selectedYearId == _currentYearId;
    final canManage = isDistrictAdmin && isCurrentYear;

    final title = _districtName.isNotEmpty
        ? '$_districtName - District Awards'
        : 'District Awards';
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: widget.embedded ? null : CustomAppBar(title: title),
        body: _loading
            ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
            : _error != null
                ? ErrorStateWidget(message: _error!, onRetry: _loadInitial)
                : Column(
                    children: [
                      _buildYearSelector(),
                      if (isDistrictAdmin && !isCurrentYear && _selectedYearId != null)
                        Container(
                          margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: AppColors.warning.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                                color:
                                    AppColors.warning.withValues(alpha: 0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.lock_clock,
                                  size: 16, color: AppColors.warning),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Viewing past year: read-only. Editing is restricted to the current year.',
                                  style: AppTextStyles.caption.copyWith(
                                      color: AppColors.textSecondary),
                                ),
                              ),
                            ],
                          ),
                        ),
                      Container(
                        margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                        decoration: BoxDecoration(
                          color: AppColors.primaryLight.withOpacity(0.4),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                              color: AppColors.primary.withOpacity(0.15)),
                        ),
                        child: TabBar(
                          isScrollable: true,
                          tabAlignment: TabAlignment.start,
                          labelColor: Colors.white,
                          unselectedLabelColor: AppColors.textSecondary,
                          dividerColor: Colors.transparent,
                          indicatorSize: TabBarIndicatorSize.tab,
                          padding: const EdgeInsets.all(4),
                          labelPadding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 0),
                          indicator: BoxDecoration(
                            color: AppColors.primary,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          labelStyle: AppTextStyles.bodyMedium
                              .copyWith(fontWeight: FontWeight.w700),
                          unselectedLabelStyle: AppTextStyles.bodyMedium,
                          tabs: const [
                            Tab(text: 'Categories'),
                            Tab(text: 'Description'),
                            Tab(text: 'Auto Questions'),
                            Tab(text: 'Manual Questions'),
                            Tab(text: 'Club Points'),
                          ],
                        ),
                      ),
                      Expanded(
                        child: _selectedYearId == null
                            ? const EmptyStateWidget(
                                title: 'No rotary year available',
                                subtitle: 'Configure a rotary year first.',
                                icon: Icons.calendar_month_outlined,
                              )
                            : TabBarView(
                                children: [
                                  _CategoriesTab(
                                    districtId: widget.districtId,
                                    yearId: _selectedYearId!,
                                    canManage: canManage,
                                  ),
                                  _DescriptionTab(
                                    districtId: widget.districtId,
                                    yearId: _selectedYearId!,
                                    canManage: canManage,
                                  ),
                                  _AutoQuestionsTab(
                                    districtId: widget.districtId,
                                    yearId: _selectedYearId!,
                                    canManage: canManage,
                                  ),
                                  _ManualCriteriaTab(
                                    districtId: widget.districtId,
                                    yearId: _selectedYearId!,
                                    canManage: canManage,
                                  ),
                                  _ClubPointsTab(
                                    districtId: widget.districtId,
                                    yearId: _selectedYearId!,
                                  ),
                                ],
                              ),
                      ),
                    ],
                  ),
      ),
    );
  }

  Widget _buildYearSelector() {
    if (_years.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Web parity: subtitle under the title.
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Manage award criteria and view club points',
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
          RotaryYearBar<int>(
            value: _selectedYearId,
            margin: EdgeInsets.zero,
            options: [
              for (final y in _years)
                RotaryYearOption(
                    value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
            ],
            onChanged: (v) => setState(() => _selectedYearId = v),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// Tab 1: Categories
// ============================================================================

class _CategoriesTab extends StatefulWidget {
  final int districtId;
  final int yearId;
  final bool canManage;
  const _CategoriesTab(
      {required this.districtId,
      required this.yearId,
      required this.canManage});

  @override
  State<_CategoriesTab> createState() => _CategoriesTabState();
}

class _CategoriesTabState extends State<_CategoriesTab> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_Category> _items = [];

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _CategoriesTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/district-modules/${widget.districtId}/citation/categories',
        queryParams: {'yearId': widget.yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _Category.fromJson(e as Map<String, dynamic>))
          .toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() {
        _items = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openCategoryForm({_Category? existing}) async {
    final initial = existing == null
        ? null
        : CitationCategoryFormInitial(
            id: existing.id,
            name: existing.name,
            sortOrder: existing.sortOrder,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictCitationCategoryFormScreen(
          districtId: widget.districtId,
          yearId: widget.yearId,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetch();
  }

  Future<void> _confirmDelete(_Category c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Category'),
        content: Text("Delete category '${c.name}'?"),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child:
                const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/district-modules/${widget.districtId}/citation/categories/${c.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    return Stack(
      children: [
        if (_items.isEmpty)
          EmptyStateWidget(
            title: 'No categories yet',
            subtitle: widget.canManage
                ? 'Tap + to add one.'
                : 'No categories added yet.',
            icon: Icons.category_outlined,
          )
        else
          RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _fetch,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (ctx, i) {
                final c = _items[i];
                return Card(
                  elevation: 0,
                  margin: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: AppColors.border),
                  ),
                  color: AppColors.surface,
                  child: ListTile(
                    leading: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.category_outlined,
                          size: 20, color: AppColors.primary),
                    ),
                    title: Text(
                      c.name,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      'Sort: ${c.sortOrder}',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                    trailing: widget.canManage
                        ? PopupMenuButton<String>(
                            icon: const Icon(Icons.more_horiz),
                            onSelected: (v) {
                              if (v == 'edit') _openCategoryForm(existing: c);
                              if (v == 'delete') _confirmDelete(c);
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'edit', child: Text('Edit')),
                              PopupMenuItem(
                                value: 'delete',
                                child: Text('Delete',
                                    style: TextStyle(color: AppColors.error)),
                              ),
                            ],
                          )
                        : null,
                  ),
                );
              },
            ),
          ),
        if (widget.canManage)
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
              heroTag: 'citation_cat_fab',
              backgroundColor: AppColors.primary,
              onPressed: () => _openCategoryForm(),
              child: const Icon(Icons.add, color: Colors.white),
            ),
          ),
      ],
    );
  }
}

// ============================================================================
// Tab 2: Description
// ============================================================================

class _DescriptionTab extends StatefulWidget {
  final int districtId;
  final int yearId;
  final bool canManage;
  const _DescriptionTab(
      {required this.districtId,
      required this.yearId,
      required this.canManage});

  @override
  State<_DescriptionTab> createState() => _DescriptionTabState();
}

class _DescriptionTabState extends State<_DescriptionTab> {
  final _api = ApiClient();
  bool _loading = true;
  bool _editing = false;
  bool _saving = false;
  String? _error;
  String _description = '';

  // Rich text — same pattern as club_website_data_screen.dart _AboutFormPage.
  // Controller is (re)built when the user enters edit mode so it reflects the
  // latest fetched _description.
  quill.QuillController? _quillCtrl;
  final FocusNode _editorFocusNode = FocusNode();
  final ScrollController _editorScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _DescriptionTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) _fetch();
  }

  @override
  void dispose() {
    _quillCtrl?.dispose();
    _editorFocusNode.dispose();
    _editorScrollController.dispose();
    super.dispose();
  }

  void _enterEdit() {
    // Seed the Quill document with the current HTML so the user edits in
    // place. Empty document otherwise.
    _quillCtrl?.dispose();
    final html = _description.trim();
    final doc = html.isEmpty
        ? quill.Document()
        : quill.Document.fromDelta(HtmlToDelta().convert(html));
    _quillCtrl = quill.QuillController(
      document: doc,
      selection: const TextSelection.collapsed(offset: 0),
    );
    setState(() => _editing = true);
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
      _editing = false;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/district-modules/${widget.districtId}/citation/description',
        queryParams: {'yearId': widget.yearId},
        fromJson: (j) => (j is Map<String, dynamic>) ? j : <String, dynamic>{},
      );
      final desc = resp.data?['descriptionHtml']?.toString() ?? '';
      setState(() {
        _description = desc;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _description = '';
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    final ctrl = _quillCtrl;
    if (ctrl == null) return;
    final delta = ctrl.document.toDelta();
    final converter = QuillDeltaToHtmlConverter(
      List<Map<String, dynamic>>.from(delta.toJson()),
      ConverterOptions.forEmail(),
    );
    final html = converter.convert();
    setState(() => _saving = true);
    try {
      await _api.post(
        '/api/district-modules/${widget.districtId}/citation/description',
        body: {'yearId': widget.yearId, 'descriptionHtml': html},
      );
      setState(() {
        _description = html;
        _editing = false;
        _saving = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Description saved')));
      }
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Save failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }

    if (_editing && _quillCtrl != null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Quill toolbar
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: AppColors.border),
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(8)),
              ),
              child: quill.QuillSimpleToolbar(
                controller: _quillCtrl!,
                config: const quill.QuillSimpleToolbarConfig(
                  multiRowsDisplay: false,
                  showFontFamily: false,
                  showFontSize: false,
                  showSmallButton: false,
                  showStrikeThrough: false,
                  showInlineCode: false,
                  showCodeBlock: false,
                  showQuote: false,
                  showIndent: false,
                  showSearchButton: false,
                  showSubscript: false,
                  showSuperscript: false,
                  showDirection: false,
                  showBackgroundColorButton: false,
                  showListCheck: false,
                  showLineHeightButton: false,
                  showAlignmentButtons: true,
                  showHeaderStyle: true,
                  showListNumbers: true,
                  showListBullets: true,
                  showBoldButton: true,
                  showItalicButton: true,
                  showUnderLineButton: true,
                  showColorButton: true,
                  showClearFormat: true,
                  showLink: true,
                  showUndo: true,
                  showRedo: true,
                ),
              ),
            ),
            // Quill editor — fills remaining space inside the tab.
            Expanded(
              child: Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: const Border(
                    left: const BorderSide(color: AppColors.border),
                    right: const BorderSide(color: AppColors.border),
                    bottom: const BorderSide(color: AppColors.border),
                  ),
                  borderRadius:
                      BorderRadius.vertical(bottom: Radius.circular(8)),
                ),
                padding: const EdgeInsets.all(12),
                child: quill.QuillEditor(
                  controller: _quillCtrl!,
                  focusNode: _editorFocusNode,
                  scrollController: _editorScrollController,
                  config: const quill.QuillEditorConfig(
                    placeholder: 'Write description here...',
                    expands: true,
                    scrollable: true,
                    autoFocus: false,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed:
                        _saving ? null : () => setState(() => _editing = false),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: CustomButton(
                    label: _saving ? 'Saving...' : 'Save',
                    icon: Icons.save_outlined,
                    onPressed: _saving ? null : _save,
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Card(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.border),
        ),
        color: AppColors.surface,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Awards Description', style: AppTextStyles.bodyMedium),
                  if (widget.canManage)
                    IconButton(
                      icon: const Icon(Icons.edit_outlined, size: 20),
                      onPressed: _enterEdit,
                      tooltip: 'Edit',
                    ),
                ],
              ),
              const SizedBox(height: 8),
              if (_description.trim().isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Center(
                    child: Text(
                      widget.canManage
                          ? 'No description yet. Tap edit to add one.'
                          : 'No description added yet.',
                      style: AppTextStyles.caption,
                    ),
                  ),
                )
              else
                Html(data: _description),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================================
// Tab 3: Auto Questions
// ============================================================================

class _AutoQuestionsTab extends StatefulWidget {
  final int districtId;
  final int yearId;
  final bool canManage;
  const _AutoQuestionsTab(
      {required this.districtId,
      required this.yearId,
      required this.canManage});

  @override
  State<_AutoQuestionsTab> createState() => _AutoQuestionsTabState();
}

class _AutoQuestionsTabState extends State<_AutoQuestionsTab> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_AutoQuestion> _items = [];
  List<_Category> _categories = [];
  List<_Lookup> _activities = [];
  List<_Lookup> _meetingTypes = [];

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _AutoQuestionsTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.get<List<dynamic>>(
          '/api/district-modules/${widget.districtId}/citation/auto-questions',
          queryParams: {'yearId': widget.yearId},
          fromJson: (j) => j as List<dynamic>,
        ),
        _api.get<List<dynamic>>(
          '/api/district-modules/${widget.districtId}/citation/categories',
          queryParams: {'yearId': widget.yearId},
          fromJson: (j) => j as List<dynamic>,
        ),
        _api.get<List<dynamic>>(
          '/api/district-modules/citation/activities',
          fromJson: (j) => j as List<dynamic>,
        ),
        _api.get<List<dynamic>>(
          '/api/district-modules/citation/meeting-types',
          fromJson: (j) => j as List<dynamic>,
        ),
      ]);
      final qs = (results[0].data ?? [])
          .map((e) => _AutoQuestion.fromJson(e as Map<String, dynamic>))
          .toList();
      qs.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      final cats = (results[1].data ?? [])
          .map((e) => _Category.fromJson(e as Map<String, dynamic>))
          .toList();
      final acts = (results[2].data ?? [])
          .map((e) => _Lookup.fromJson(e as Map<String, dynamic>))
          .toList();
      // meeting-types endpoint returns {id, name} where id is a string slug.
      final mts = (results[3].data ?? []).map((e) {
        final m = e as Map<String, dynamic>;
        return _Lookup(id: 0, name: m['name']?.toString() ?? '');
      }).toList();
      setState(() {
        _items = qs;
        _categories = cats;
        _activities = acts;
        _meetingTypes = mts;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _catName(int? id) {
    if (id == null) return '–';
    final c = _categories.where((x) => x.id == id).toList();
    return c.isNotEmpty ? c.first.name : '–';
  }

  String _actName(int? id) {
    if (id == null) return '–';
    final a = _activities.where((x) => x.id == id).toList();
    return a.isNotEmpty ? a.first.name : '–';
  }

  Future<void> _openQuestionForm({_AutoQuestion? existing}) async {
    final initial = existing == null
        ? null
        : CitationQuestionFormInitial(
            id: existing.id,
            categoryId: existing.categoryId,
            activityId: existing.activityId,
            points: existing.points,
            sortOrder: existing.sortOrder,
            isBonus: existing.isBonus,
            bonusPoints: existing.bonusPoints,
            minBonus: existing.minBonus,
            maxBonus: existing.maxBonus,
            subItems: existing.subItemsRaw.map((s) {
              return CitationSubItemInitial(
                subItemType: s['subItemType']?.toString() ?? '',
                subItemId: s['subItemId'] as int?,
                subItemName: s['subItemName']?.toString(),
                points: (s['points'] as num?) ?? 0,
                isBonus: _asBool(s['isBonus']),
                bonusPoints: s['bonusPoints'] as num?,
                minBonus: s['minBonus'] as num?,
                maxBonus: s['maxBonus'] as num?,
              );
            }).toList(),
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictCitationQuestionFormScreen(
          districtId: widget.districtId,
          yearId: widget.yearId,
          categories: _categories
              .map((c) => CitationQuestionFormOption(id: c.id, name: c.name))
              .toList(),
          activities: _activities
              .map((a) => CitationQuestionFormOption(
                    id: a.id,
                    name: a.name,
                    subType: a.subType,
                  ))
              .toList(),
          meetingTypes: _meetingTypes
              .map((m) => CitationQuestionFormOption(id: m.id, name: m.name))
              .toList(),
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetch();
  }

  Future<void> _confirmDelete(_AutoQuestion q) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Question'),
        content: const Text(
            'Delete this auto question? Associated sub-items will also be removed.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child:
                const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/district-modules/${widget.districtId}/citation/auto-questions/${q.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }

    // Group by category
    final Map<int, List<_AutoQuestion>> grouped = {};
    for (final q in _items) {
      grouped.putIfAbsent(q.categoryId ?? 0, () => []).add(q);
    }

    return Stack(
      children: [
        if (_items.isEmpty)
          EmptyStateWidget(
            title: 'No auto questions yet',
            subtitle: widget.canManage
                ? 'Tap + to add one.'
                : 'No auto questions added yet.',
            icon: Icons.quiz_outlined,
          )
        else
          RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _fetch,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: grouped.entries.map((e) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        _catName(e.key),
                        style: AppTextStyles.bodyMedium
                            .copyWith(fontWeight: FontWeight.bold),
                      ),
                    ),
                    ...e.value.map((q) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Card(
                            elevation: 0,
                            margin: EdgeInsets.zero,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: const BorderSide(color: AppColors.border),
                            ),
                            color: AppColors.surface,
                            child: ListTile(
                              title: Text(_actName(q.activityId),
                                  style: AppTextStyles.bodyMedium),
                              subtitle: Wrap(
                                spacing: 8,
                                runSpacing: 4,
                                children: [
                                  _chip('${q.points.round()} pts', AppColors.primary),
                                  if (q.isBonus) _chip('Bonus', Colors.orange),
                                  if (q.subItemCount > 0)
                                    _chip('${q.subItemCount} sub', Colors.teal),
                                ],
                              ),
                              trailing: widget.canManage
                                  ? PopupMenuButton<String>(
                                      icon: const Icon(Icons.more_horiz),
                                      onSelected: (v) {
                                        if (v == 'edit')
                                          _openQuestionForm(existing: q);
                                        if (v == 'delete') _confirmDelete(q);
                                      },
                                      itemBuilder: (_) => const [
                                        PopupMenuItem(
                                            value: 'edit', child: Text('Edit')),
                                        PopupMenuItem(
                                          value: 'delete',
                                          child: Text('Delete',
                                              style: TextStyle(
                                                  color: AppColors.error)),
                                        ),
                                      ],
                                    )
                                  : null,
                            ),
                          ),
                        )),
                  ],
                );
              }).toList(),
            ),
          ),
        if (widget.canManage)
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
              heroTag: 'citation_auto_fab',
              backgroundColor: AppColors.primary,
              onPressed: () => _openQuestionForm(),
              child: const Icon(Icons.add, color: Colors.white),
            ),
          ),
      ],
    );
  }

  Widget _chip(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(label, style: TextStyle(fontSize: 11, color: color)),
    );
  }
}

// ============================================================================
// Tab 4: Manual Criteria
// ============================================================================

class _ManualCriteriaTab extends StatefulWidget {
  final int districtId;
  final int yearId;
  final bool canManage;
  const _ManualCriteriaTab(
      {required this.districtId,
      required this.yearId,
      required this.canManage});

  @override
  State<_ManualCriteriaTab> createState() => _ManualCriteriaTabState();
}

class _ManualCriteriaTabState extends State<_ManualCriteriaTab> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_ManualCriterion> _items = [];
  List<_Category> _categories = [];

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _ManualCriteriaTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Fetch criteria + categories in parallel — categories are needed by
      // the form so the dropdown shows the right options (and so the saved
      // payload includes the chosen category's name as criteriaName).
      final results = await Future.wait([
        _api.get<List<dynamic>>(
          '/api/district-modules/${widget.districtId}/citation/manual-criteria',
          queryParams: {'yearId': widget.yearId},
          fromJson: (j) => j as List<dynamic>,
        ),
        _api.get<List<dynamic>>(
          '/api/district-modules/${widget.districtId}/citation/categories',
          queryParams: {'yearId': widget.yearId},
          fromJson: (j) => j as List<dynamic>,
        ),
      ]);
      final list = (results[0].data ?? [])
          .map((e) => _ManualCriterion.fromJson(e as Map<String, dynamic>))
          .toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      final cats = (results[1].data ?? [])
          .map((e) => _Category.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _items = list;
        _categories = cats;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openQuestionForm({_ManualCriterion? existing}) async {
    // Categories already used by another manual criterion are excluded from
    // the new criterion's category dropdown (web parity).
    final usedCategoryIds = _items
        .where((m) => existing == null || m.id != existing.id)
        .map((m) => m.categoryId)
        .whereType<int>()
        .toSet();

    final initial = existing == null
        ? null
        : CitationManualFormInitial(
            id: existing.id,
            categoryId: existing.categoryId,
            sortOrder: existing.sortOrder,
            subCriteria: existing.subCriteriaRaw.map((sc) {
              final opts = sc['options'];
              final optList = opts is List
                  ? opts
                      .whereType<Map>()
                      .map((o) => CitationManualOptionInitial(
                            optionText: o['optionText']?.toString() ?? '',
                            optionPoints: (o['optionPoints'] as num?) ?? 0,
                            sortOrder: (o['sortOrder'] as int?) ?? 0,
                          ))
                      .toList()
                  : const <CitationManualOptionInitial>[];
              return CitationManualSubCriteriaInitial(
                subCriteriaTitle: sc['subCriteriaTitle']?.toString() ?? '',
                answerType: sc['answerType']?.toString() ?? 'number',
                points: (sc['points'] as num?) ?? 0,
                isBonus: _asBool(sc['isBonus']),
                bonusPoints: sc['bonusPoints'] as num?,
                minBonus: sc['minBonus'] as num?,
                maxBonus: sc['maxBonus'] as num?,
                remark: sc['remark']?.toString() ?? '',
                sortOrder: (sc['sortOrder'] as int?) ?? 0,
                options: optList,
              );
            }).toList(),
          );

    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DistrictCitationManualFormScreen(
          districtId: widget.districtId,
          yearId: widget.yearId,
          categories: _categories
              .map((c) =>
                  CitationManualCategoryOption(id: c.id, name: c.name))
              .toList(),
          usedCategoryIds: usedCategoryIds,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted) await _fetch();
  }

  Future<void> _confirmDelete(_ManualCriterion m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Criterion'),
        content: Text("Delete '${m.name}'?"),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child:
                const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
          '/api/district-modules/${widget.districtId}/citation/manual-criteria/${m.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  // One question line under a criterion — mirrors the web district citation
  // page: "<title> (<answerType>) — <points/bonus/options detail>".
  Widget _buildSubCriteriaLine(Map<String, dynamic> sc) {
    final title = sc['subCriteriaTitle']?.toString() ?? '';
    final answerType = sc['answerType']?.toString() ?? 'number';
    final points = (sc['points'] as num?) ?? 0;
    final isBonus = _asBool(sc['isBonus']);
    final bonusPoints = (sc['bonusPoints'] as num?) ?? 0;
    final opts = sc['options'];
    final optCount = opts is List ? opts.length : 0;

    String detail = '';
    if (answerType == 'number') {
      detail = ': Points: $points${isBonus ? ' | Bonus: $bonusPoints' : ''}';
    } else if (answerType == 'yesno') {
      detail = ': Base Points: $points';
    } else if (answerType == 'choose_one' && optCount > 0) {
      detail = ': $optCount options';
    }

    return Text.rich(
      TextSpan(
        style: AppTextStyles.caption,
        children: [
          TextSpan(
            text: title,
            style: AppTextStyles.caption.copyWith(
                fontWeight: FontWeight.w600, color: AppColors.textPrimary),
          ),
          TextSpan(
            text: ' ($answerType)',
            style:
                AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
          ),
          if (detail.isNotEmpty)
            TextSpan(
              text: detail,
              style:
                  AppTextStyles.caption.copyWith(color: AppColors.textPrimary),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    return Stack(
      children: [
        if (_items.isEmpty)
          EmptyStateWidget(
            title: 'No manual criteria yet',
            subtitle: widget.canManage
                ? 'Tap + to add one.'
                : 'No manual criteria added yet.',
            icon: Icons.rule,
          )
        else
          RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _fetch,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (ctx, i) {
                final m = _items[i];
                return Card(
                  elevation: 0,
                  margin: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: AppColors.border),
                  ),
                  color: AppColors.surface,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Category badge + criteria name (web parity).
                              Wrap(
                                spacing: 8,
                                runSpacing: 4,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  if ((m.categoryName ?? '').isNotEmpty)
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(10),
                                        border:
                                            Border.all(color: AppColors.border),
                                      ),
                                      child: Text(m.categoryName!,
                                          style: AppTextStyles.caption),
                                    ),
                                  Text(
                                    m.name,
                                    style: AppTextStyles.bodyMedium.copyWith(
                                        fontWeight: FontWeight.w600),
                                  ),
                                ],
                              ),
                              // Sub-criteria questions, indented under the
                              // criterion — these are the actual questions.
                              if (m.subCriteriaRaw.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                Container(
                                  padding: const EdgeInsets.only(left: 12),
                                  decoration: const BoxDecoration(
                                    border: const Border(
                                      left: const BorderSide(
                                          color: AppColors.border, width: 2),
                                    ),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      for (final sc in m.subCriteriaRaw)
                                        Padding(
                                          padding: const EdgeInsets.only(
                                              bottom: 4),
                                          child: _buildSubCriteriaLine(sc),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (widget.canManage)
                          PopupMenuButton<String>(
                            icon: const Icon(Icons.more_horiz),
                            onSelected: (v) {
                              if (v == 'edit') _openQuestionForm(existing: m);
                              if (v == 'delete') _confirmDelete(m);
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'edit', child: Text('Edit')),
                              PopupMenuItem(
                                value: 'delete',
                                child: Text('Delete',
                                    style: TextStyle(color: AppColors.error)),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        if (widget.canManage)
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
              heroTag: 'citation_manual_fab',
              backgroundColor: AppColors.primary,
              onPressed: () => _openQuestionForm(),
              child: const Icon(Icons.add, color: Colors.white),
            ),
          ),
      ],
    );
  }
}

// ============================================================================
// Tab 5: Club Points
// ============================================================================

class _ClubPointsTab extends StatefulWidget {
  final int districtId;
  final int yearId;
  const _ClubPointsTab({required this.districtId, required this.yearId});

  @override
  State<_ClubPointsTab> createState() => _ClubPointsTabState();
}

class _ClubPointsTabState extends State<_ClubPointsTab> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_ClubPoints> _items = [];

  // Mirrors web rotary-frontend/src/app/districts/[id]/citation/page.tsx —
  // top-right "Download Report" plus per-row download icon.
  bool _downloadingAll = false;
  int? _downloadingClubId;

  Future<void> _downloadAllClubsReport() async {
    setState(() => _downloadingAll = true);
    try {
      final bytes = await _api.downloadBytes(
        '/api/district-modules/${widget.districtId}/citation/club-report',
        queryParams: {'yearId': widget.yearId},
      );
      await saveAndOpenBytes(
        bytes,
        'citation_report_${widget.districtId}.xlsx',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to download report: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloadingAll = false);
    }
  }

  Future<void> _downloadSingleClubReport(_ClubPoints c) async {
    setState(() => _downloadingClubId = c.clubId);
    try {
      final bytes = await _api.downloadBytes(
        '/api/district-modules/${widget.districtId}/citation/club-report/${c.clubId}',
        queryParams: {'yearId': widget.yearId},
      );
      final safeName = c.clubName.replaceAll(RegExp(r'\s+'), '_');
      await saveAndOpenBytes(bytes, 'citation_$safeName.xlsx');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to download: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloadingClubId = null);
    }
  }

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(covariant _ClubPointsTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/district-modules/${widget.districtId}/citation/club-points',
        queryParams: {'yearId': widget.yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .map((e) => _ClubPoints.fromJson(e as Map<String, dynamic>))
          .toList();
      list.sort((a, b) => b.totalPoints.compareTo(a.totalPoints));
      setState(() {
        _items = list;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // View action: deep-link to the club's own citation page (web parity).
  // The screen auto-resolves the district internally, so we only pass clubId.
  // Opened read-only from the district — web passes ?readOnly=true here, which
  // hides the Save button and disables manual inputs.
  void _openClubCitation(_ClubPoints c) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ClubCitationScreen(clubId: c.clubId, readOnly: true),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _fetch);
    }
    if (_items.isEmpty) {
      return const EmptyStateWidget(
        title: 'No club points yet',
        subtitle: 'No awards activity recorded for this year.',
        icon: Icons.emoji_events_outlined,
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _fetch,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: _downloadingAll ? null : _downloadAllClubsReport,
                icon: _downloadingAll
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download_outlined, size: 18),
                label: Text(
                    _downloadingAll ? 'Downloading...' : 'Download Report'),
              ),
            ),
          ),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (ctx, i) {
                final c = _items[i];
                final isDownloading = _downloadingClubId == c.clubId;
                final isTop3 = i < 3 && c.totalPoints > 0;
                return Card(
                  elevation: 0,
                  margin: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: AppColors.border),
                  ),
                  color: AppColors.surface,
                  child: ListTile(
                    leading: SizedBox(
                      width: 40,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('${i + 1}',
                              style: AppTextStyles.bodyMedium.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.textSecondary)),
                          if (isTop3) ...[
                            const SizedBox(width: 2),
                            const Icon(Icons.emoji_events,
                                size: 14, color: Colors.amber),
                          ],
                        ],
                      ),
                    ),
                    title: Text(
                      c.clubName,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      'Club ID: ${(c.clubRotaryId?.isNotEmpty ?? false) ? c.clubRotaryId : "-"}',
                      style: AppTextStyles.caption,
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('${c.totalPoints}',
                            style: AppTextStyles.bodyMedium.copyWith(
                                fontWeight: FontWeight.bold,
                                color: AppColors.primary)),
                        IconButton(
                          icon: const Icon(Icons.visibility_outlined, size: 20),
                          onPressed: () => _openClubCitation(c),
                          tooltip: 'View',
                        ),
                        IconButton(
                          icon: isDownloading
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.download_outlined, size: 20),
                          onPressed: isDownloading
                              ? null
                              : () => _downloadSingleClubReport(c),
                          tooltip: 'Download Report',
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
