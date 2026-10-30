import 'dart:io';

import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/utils/image_crop.dart';
import '../../../../core/network/api_client.dart';
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
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/form_action_bar.dart';

// District events mirror the web add/edit form: Title (English, ≤50),
// Description (English, ≤1000), Date, and 1-5 photos (each with an optional
// ≤500-char caption). The backend stores events in year-partitioned tables and
// requires at least one photo.
final RegExp _kEvtEnglishOnly = RegExp(r'''^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$''');
const int _kEvtTitleMaxChars = 50;
const int _kEvtDescMaxChars = 1000;
const int _kEvtPhotoDescMaxChars = 500;
const int _kEvtMaxPhotos = 5;
const Set<String> _kEvtAllowedPhotoExts = {'jpg', 'jpeg', 'png', 'gif', 'webp'};
const int _kEvtPhotoMaxBytes = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
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
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _DistrictEvent {
  final int id;
  final String title;
  final String? description;
  final DateTime? eventDate;
  final String? eventTime;
  final String? location;
  final String? category;
  final bool isActive;
  // Year-partitioned table the event lives in; detail/edit/delete are
  // year-scoped (`/district-events/{yearId}/{id}`).
  final int? yearId;

  const _DistrictEvent({
    required this.id,
    required this.title,
    this.description,
    this.eventDate,
    this.eventTime,
    this.location,
    this.category,
    this.isActive = true,
    this.yearId,
  });

  factory _DistrictEvent.fromJson(Map<String, dynamic> j) => _DistrictEvent(
        id: j['id'] as int? ?? 0,
        title: j['title'] as String? ?? '',
        description: j['description'] as String?,
        eventDate: j['eventDate'] != null ? DateTime.tryParse(j['eventDate'] as String) : null,
        eventTime: j['eventTime'] as String?,
        location: j['location'] as String?,
        category: j['category'] as String? ?? j['categoryName'] as String?,
        isActive: _asBool(j['isActive'] ?? true),
        yearId: (j['yearId'] as num?)?.toInt(),
      );
}

/// A mutable photo row in the event form (uploaded path + optional caption).
class _EventPhoto {
  String path;
  String description;
  bool isPrimary;
  _EventPhoto({required this.path, this.description = '', this.isPrimary = false});

  factory _EventPhoto.fromJson(Map<String, dynamic> j) => _EventPhoto(
        path: (j['imagePath'] ?? j['path'] ?? '').toString(),
        description: (j['description'] ?? '').toString(),
        isPrimary: j['isPrimary'] == true || j['isPrimary'] == 1,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictEventsScreen extends StatefulWidget {
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
  /// together with the event list instead of being pinned). When null the
  /// screen keeps its original pinned-year-bar + Expanded-list layout, so every
  /// existing caller is unaffected.
  final Widget? header;

  const DistrictEventsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
    this.fixedYearId,
    this.header,
  });

  @override
  State<DistrictEventsScreen> createState() => _DistrictEventsScreenState();
}

class _DistrictEventsScreenState extends State<DistrictEventsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');

  // Title search (embedded Foundation layout only) — sent to the list endpoint
  // as `search`, mirroring the web card header.
  final TextEditingController _searchCtrl = TextEditingController();
  String _search = '';

  final List<_DistrictEvent> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  bool _loadingYears = true;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _loadYearsThenFetch();
  }

  Future<void> _loadYearsThenFetch() async {
    // External year control (embedded in the Foundation tab): skip the year
    // dropdown and use the year handed down from the district's global
    // selector. `_years` stays empty so the year bar is never rendered.
    if (widget.fixedYearId != null) {
      setState(() {
        _years = [];
        _selectedYearId = widget.fixedYearId;
        _loadingYears = false;
      });
      await _fetch(reset: true);
      return;
    }
    setState(() { _loadingYears = true; });
    try {
      final availResp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/district-events/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      List<_RotaryYear> years = (availResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      if (years.isEmpty) {
        try {
          final allResp = await _api.get<List<dynamic>>(
            '/api/rotary-years',
            fromJson: (j) => j as List<dynamic>,
          );
          final all = (allResp.data ?? [])
              .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
              .toList();
          final cur = all.where((y) => y.isCurrent).toList();
          years = cur.isNotEmpty ? cur : (all.isNotEmpty ? [all.first] : []);
        } catch (_) {}
      }
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
      );
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loadingYears = false;
      });
    } catch (_) {
      setState(() { _loadingYears = false; });
    }
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
        '/api/districts/${widget.districtId}/district-events',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_selectedYearId != null) 'yearId': _selectedYearId,
          if (_search.trim().isNotEmpty) 'search': _search.trim(),
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _DistrictEvent.fromJson(j));
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

  Future<void> _delete(_DistrictEvent item) async {
    // Year-scoped delete — events live in year-partitioned tables.
    final yearId = item.yearId ?? _selectedYearId;
    if (yearId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Delete failed: missing event year'), backgroundColor: AppColors.error),
        );
      }
      return;
    }
    try {
      await _api.delete('/api/districts/${widget.districtId}/district-events/$yearId/${item.id}');
      setState(() => _items.removeWhere((e) => e.id == item.id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Event deleted'), backgroundColor: AppColors.success),
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

  Future<void> _showForm({_DistrictEvent? existing}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _EventFormPage(
          districtId: widget.districtId,
          existing: existing,
        ),
      ),
    );
    if (saved == true) _fetch(reset: true);
  }

  Future<void> _openDetail(_DistrictEvent item) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _EventDetailScreen(
          districtId: widget.districtId,
          eventId: item.id,
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'District Events'),
      // Embedded (Foundation tab) uses an explicit "Add Event" button in the
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
          _buildYearSelector(),
          // Search-only row (add is handled by the FAB in this layout).
          EmbeddedSearchAddBar(
            controller: _searchCtrl,
            hintText: 'Search events',
            addLabel: 'Add Event',
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
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 6, itemHeight: 100)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
                    : _items.isEmpty
                        ? EmptyStateWidget(
                            title: 'No District Events',
                            subtitle: 'Tap + to create a new district event.',
                            icon: Icons.event_note_outlined,
                            actionLabel: canManage ? 'Add Event' : null,
                            onAction: canManage ? () => _showForm() : null,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: () => _fetch(reset: true),
                            child: ListView.separated(
                              padding: (const EdgeInsets.all(16)).add(const EdgeInsets.only(bottom: 88)),
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
                                return _EventCard(
                                  item: item,
                                  df: _df,
                                  canManage: canManage,
                                  onTap: () => _openDetail(item),
                                  onEdit: () => _showForm(existing: item),
                                  onDelete: () async {
                                    final ok = await ConfirmationDialog.show(
                                      context,
                                      title: 'Delete Event',
                                      message: 'Delete "${item.title}"?',
                                    );
                                    if (ok) _delete(item);
                                  },
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  /// Single-scroll body used when a [DistrictEventsScreen.header] is supplied:
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
              hintText: 'Search events',
              addLabel: 'Add Event',
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
              child: ShimmerList(itemCount: 6, itemHeight: 100),
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
                title: 'No District Events',
                subtitle: 'Tap + to create a new district event.',
                icon: Icons.event_note_outlined,
                actionLabel: canManage ? 'Add Event' : null,
                onAction: canManage ? () => _showForm() : null,
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 104),
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
                      child: _EventCard(
                        item: item,
                        df: _df,
                        canManage: canManage,
                        onTap: () => _openDetail(item),
                        onEdit: () => _showForm(existing: item),
                        onDelete: () async {
                          final ok = await ConfirmationDialog.show(
                            context,
                            title: 'Delete Event',
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

  Widget _buildYearSelector() {
    if (_loadingYears) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: SizedBox(height: 40, child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))),
      );
    }
    if (_years.isEmpty) return const SizedBox.shrink();
    return RotaryYearBar<int>(
      value: _selectedYearId,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      options: [
        for (final y in _years)
          RotaryYearOption(
              value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
      ],
      onChanged: (v) {
        setState(() => _selectedYearId = v);
        _fetch(reset: true);
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _EventCard extends StatelessWidget {
  final _DistrictEvent item;
  final DateFormat df;
  final bool canManage;
  final VoidCallback? onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _EventCard({
    required this.item,
    required this.df,
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
                    color: item.isActive ? AppColors.primaryLight : AppColors.muted,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.event_note_outlined, size: 20,
                      color: item.isActive ? AppColors.primary : AppColors.textSecondary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.title, style: AppTextStyles.bodyMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                      if (item.category != null && item.category!.isNotEmpty)
                        Text(item.category!, style: AppTextStyles.caption.copyWith(color: AppColors.primary)),
                    ],
                  ),
                ),
                if (!item.isActive)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: AppColors.muted, borderRadius: BorderRadius.circular(12)),
                    child: Text('Inactive', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                  ),
                if (canManage) ...[
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
              spacing: 12,
              children: [
                if (item.eventDate != null)
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.calendar_today_outlined, size: 12, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Text(df.format(item.eventDate!), style: AppTextStyles.caption),
                  ]),
                if (item.eventTime != null)
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.access_time_outlined, size: 12, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Text(item.eventTime!, style: AppTextStyles.caption),
                  ]),
                if (item.location != null && item.location!.isNotEmpty)
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.location_on_outlined, size: 12, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Text(item.location!, style: AppTextStyles.caption),
                  ]),
              ],
            ),
          ],
        ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Form Page
// ---------------------------------------------------------------------------
class _EventFormPage extends StatefulWidget {
  final int districtId;
  final _DistrictEvent? existing;

  const _EventFormPage({required this.districtId, this.existing});

  @override
  State<_EventFormPage> createState() => _EventFormPageState();
}

class _EventFormPageState extends State<_EventFormPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');
  final _isoFmt = DateFormat('yyyy-MM-dd');

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  DateTime? _eventDate;
  bool _saving = false;

  // Photos (1-5; ≥1 required by the backend). Loaded from detail on edit.
  final List<_EventPhoto> _photos = [];
  bool _uploadingPhoto = false;
  bool _loadingPhotos = false;

  bool get _isEditing => widget.existing != null;
  int? get _existingYearId => widget.existing?.yearId;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final e = widget.existing!;
      _titleCtrl.text = e.title;
      _descCtrl.text = e.description ?? '';
      _eventDate = e.eventDate;
      _loadExistingPhotos();
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  /// Load the event's existing photos from the year-scoped detail endpoint so
  /// an edit preserves them (the list row only carries the primary thumbnail).
  Future<void> _loadExistingPhotos() async {
    final yearId = _existingYearId;
    if (yearId == null) return;
    setState(() => _loadingPhotos = true);
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/district-events/$yearId/${widget.existing!.id}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final root = resp.data ?? const <String, dynamic>{};
      final rawPhotos = (root['photos'] as List?) ?? const [];
      if (!mounted) return;
      setState(() {
        _photos
          ..clear()
          ..addAll(rawPhotos
              .whereType<Map<String, dynamic>>()
              .map(_EventPhoto.fromJson));
        if (_photos.isNotEmpty && !_photos.any((p) => p.isPrimary)) {
          _photos.first.isPrimary = true;
        }
        _loadingPhotos = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingPhotos = false);
    }
  }

  Future<void> _pickDate() async {
    // District events are a REPORT of a conducted event, so the date can never be
    // in the future — the backend (ProjectDateValidator) now 400s a future or
    // pre-1985 date because the year-partitioned table is derived from it. Cap the
    // picker at today and floor it at 2000 (mirrors district_projects_screen).
    final today = DateTime.now();
    var initial = _eventDate ?? today;
    if (initial.isAfter(today)) initial = today; // keep an edited future row in range
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2000),
      lastDate: today,
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _eventDate = picked);
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

  /// Validate format / size before upload. No minimum resolution is enforced
  /// (the backend has none either), so phone photos of any dimensions are
  /// accepted.
  Future<String?> _validatePhotoFile(String path) async {
    final lower = path.toLowerCase();
    final dot = lower.lastIndexOf('.');
    final ext = dot >= 0 ? lower.substring(dot + 1) : '';
    if (!_kEvtAllowedPhotoExts.contains(ext)) {
      return 'Allowed formats: JPG, JPEG, PNG, GIF, WEBP.';
    }
    try {
      final file = File(path);
      final size = await file.length();
      if (size > _kEvtPhotoMaxBytes) {
        final mb = (size / (1024 * 1024)).toStringAsFixed(1);
        return 'Photo exceeds 10 MB limit (file is $mb MB).';
      }
    } catch (_) {
      return 'Could not read this image file.';
    }
    return null;
  }

  Future<void> _pickAndUploadPhoto() async {
    if (_photos.length >= _kEvtMaxPhotos) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: const Text('Maximum $_kEvtMaxPhotos photos allowed'), backgroundColor: AppColors.warning),
      );
      return;
    }
    try {
      final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
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
        '/api/districts/${widget.districtId}/district-events/upload?strict=true',
        filePath: cropped,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final path = (resp.data?['path'] as String?) ?? (resp.data?['imagePath'] as String?) ?? '';
      if (path.isEmpty) throw Exception('Upload returned empty path');
      setState(() {
        _photos.add(_EventPhoto(path: path, isPrimary: _photos.isEmpty));
        _uploadingPhoto = false;
      });
    } catch (e) {
      setState(() => _uploadingPhoto = false);
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Photo upload failed: $e';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    }
  }

  String? _runValidation() {
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) return 'Title is required.';
    if (title.length > _kEvtTitleMaxChars) {
      return 'Title must be $_kEvtTitleMaxChars characters or less.';
    }
    if (!_kEvtEnglishOnly.hasMatch(title)) return 'Title must be in English only.';
    final desc = _descCtrl.text.trim();
    if (desc.isNotEmpty) {
      if (!_kEvtEnglishOnly.hasMatch(desc)) return 'Description must be in English only.';
      if (desc.length > _kEvtDescMaxChars) {
        return 'Description must be $_kEvtDescMaxChars characters or less.';
      }
    }
    if (_eventDate == null) return 'Date is required.';
    // Mirror the backend ProjectDateValidator (date-only): no future dates — the
    // event's rotary year is derived from this, so a future date is rejected 400.
    final now = DateTime.now();
    final picked = DateTime(_eventDate!.year, _eventDate!.month, _eventDate!.day);
    final today = DateTime(now.year, now.month, now.day);
    if (picked.isAfter(today)) return 'Event date cannot be in the future.';
    if (_photos.isEmpty) return 'At least one photo is required.';
    return null;
  }

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
      'eventDate': _isoFmt.format(_eventDate!),
      'photos': [
        for (var i = 0; i < _photos.length; i++)
          {
            'imagePath': _photos[i].path,
            'description': _photos[i].description.trim().isEmpty ? null : _photos[i].description.trim(),
            'isPrimary': i == 0,
            'sortOrder': i,
          }
      ],
    };

    final base = '/api/districts/${widget.districtId}/district-events';
    try {
      if (_isEditing) {
        final yearId = _existingYearId;
        if (yearId == null) {
          throw const ApiException('Cannot save: this event has no rotary year.');
        }
        final id = widget.existing!.id;
        try {
          await _api.put('$base/$yearId/$id', body: body);
        } on ApiException catch (e) {
          if (e.statusCode != 409) rethrow;
          if (!mounted) return;
          final confirmed = await ConfirmationDialog.show(
            context,
            title: 'Move event?',
            message: e.message,
            confirmLabel: 'Move',
          );
          if (!confirmed) {
            if (mounted) setState(() => _saving = false);
            return;
          }
          await _api.post('$base/$yearId/$id/move', body: body);
        }
      } else {
        await _api.post(base, body: body);
      }
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Event updated' : 'Event created'),
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      bottomNavigationBar: RowFormActionBar(child: CustomButton(
                label: _isEditing ? 'Update' : 'Create',
                onPressed: _save,
                isLoading: _saving,
                fullWidth: true,
              )),
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEditing ? 'Edit Event' : 'New District Event'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CustomTextField(
                label: 'Title * (English only, max $_kEvtTitleMaxChars chars)',
                controller: _titleCtrl,
                hint: 'Enter event title',
                maxLength: _kEvtTitleMaxChars,
                onChanged: (_) => setState(() {}),
              ),
              _counter(_titleCtrl.text.length, _kEvtTitleMaxChars),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Description (English only, max $_kEvtDescMaxChars chars)',
                controller: _descCtrl,
                hint: 'Enter description',
                maxLines: 4,
                maxLength: _kEvtDescMaxChars,
                onChanged: (_) => setState(() {}),
              ),
              _counter(_descCtrl.text.length, _kEvtDescMaxChars),
              const SizedBox(height: 12),
              _buildDateField(),
              const SizedBox(height: 16),
              Text(
                'Photos * (Max $_kEvtMaxPhotos, at least 1 mandatory)',
                style: AppTextStyles.label,
              ),
              const SizedBox(height: 4),
              Text(
                'JPG, JPEG, PNG, GIF, WEBP. Max 10 MB each.',
                style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 8),
              _loadingPhotos
                  ? const Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(
                        child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
                      ),
                    )
                  : _EventPhotoGallery(
                      photos: _photos,
                      uploading: _uploadingPhoto,
                      onAdd: _photos.length >= _kEvtMaxPhotos ? null : _pickAndUploadPhoto,
                      onSetPrimary: _markPrimary,
                      onRemove: _removePhoto,
                    ),
              
            ],
          ),
        ),
      ),
    );
  }

  Widget _counter(int used, int max) {
    return Padding(
      padding: const EdgeInsets.only(top: 2, right: 4),
      child: Align(
        alignment: Alignment.centerRight,
        child: Text('$used/$max', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
      ),
    );
  }

  Widget _buildDateField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Event Date *', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickDate,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.calendar_today_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _eventDate != null ? _displayDf.format(_eventDate!) : 'Select',
                    style: _eventDate != null
                        ? AppTextStyles.body
                        : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

}

/// Vertical photo list with an inline caption per photo (mirrors the web event
/// form). Each card: thumbnail + description field (≤500) + primary / delete.
class _EventPhotoGallery extends StatelessWidget {
  final List<_EventPhoto> photos;
  final bool uploading;
  final VoidCallback? onAdd;
  final ValueChanged<int> onSetPrimary;
  final ValueChanged<int> onRemove;

  const _EventPhotoGallery({
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
          _EventPhotoCard(
            key: ValueKey('district_event_photo_${photos[i].path}'),
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

class _EventPhotoCard extends StatefulWidget {
  final _EventPhoto photo;
  final bool isPrimary;
  final VoidCallback onSetPrimary;
  final VoidCallback onRemove;

  const _EventPhotoCard({
    super.key,
    required this.photo,
    required this.isPrimary,
    required this.onSetPrimary,
    required this.onRemove,
  });

  @override
  State<_EventPhotoCard> createState() => _EventPhotoCardState();
}

class _EventPhotoCardState extends State<_EventPhotoCard> {
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
                      errorBuilder: (_, __, ___) =>
                          const Icon(Icons.broken_image_outlined, color: AppColors.textSecondary),
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
                  maxLength: _kEvtPhotoDescMaxChars,
                  keyboardType: TextInputType.multiline,
                  textInputAction: TextInputAction.newline,
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
// Detail Screen (read-only) — view a single district event.
// The core fields (title, description, date, time, location, category) are
// already on the list row, so we seed from the tapped row and use the
// year-scoped detail endpoint `/district-events/{yearId}/{id}` (which returns
// `{ photos: [...] }`) only to enrich the photo gallery. Defensive: a failed /
// 404 detail call still renders the seeded fields.
// ---------------------------------------------------------------------------
class _EventDetailScreen extends StatefulWidget {
  final int districtId;
  final int eventId;
  final int yearId;
  final _DistrictEvent fallback;

  const _EventDetailScreen({
    required this.districtId,
    required this.eventId,
    required this.yearId,
    required this.fallback,
  });

  @override
  State<_EventDetailScreen> createState() => _EventDetailScreenState();
}

class _EventDetailScreenState extends State<_EventDetailScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');

  List<String> _photoUrls = const [];
  // Per-photo captions, index-aligned with _photoUrls (shown under each slide).
  List<String> _photoCaptions = const [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/district-events/${widget.yearId}/${widget.eventId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final root = resp.data ?? const <String, dynamic>{};
      final rawPhotos = (root['photos'] as List?) ?? const [];
      // Build urls + captions together so they stay index-aligned even when a
      // path fails to resolve to a media URL.
      final urls = <String>[];
      final captions = <String>[];
      for (final p in rawPhotos.whereType<Map<String, dynamic>>()) {
        final u = detailMediaUrl(
            (p['imagePath'] ?? p['path'] ?? p['url'])?.toString());
        if (u == null) continue;
        urls.add(u);
        captions.add((p['description'] ?? '').toString());
      }
      setState(() {
        _photoUrls = urls;
        _photoCaptions = captions;
      });
    } catch (_) {
      // Defensive: the core fields come from the seeded row, so a failed photo
      // fetch is non-fatal — never hard-fail to a blank screen.
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.fallback;
    final date = e.eventDate != null ? _df.format(e.eventDate!) : null;
    return DetailScaffold(
      title: 'District Event',
      // Core fields are always seeded — never block on loading.
      loading: false,
      error: _error,
      onRetry: _fetch,
      body: (_) {
        // Single club-finder-style layout (matches Upcoming Events): one
        // full-bleed swipeable hero gallery over ALL photos, then title, chips
        // and a bordered info card — no separate hero + gallery of the same
        // images.
        return ListView(
          padding: (EdgeInsets.zero).add(const EdgeInsets.only(bottom: 88)),
          children: [
            DetailHeroGallery(urls: _photoUrls, captions: _photoCaptions),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DetailHeroTitle(title: e.title),
                  DetailHeroChips(chips: [
                    if (date != null)
                      detailInfoChip(Icons.event_outlined, date),
                    if (e.eventTime != null && e.eventTime!.isNotEmpty)
                      detailInfoChip(
                          Icons.schedule_outlined, e.eventTime!.trim()),
                    if (e.location != null && e.location!.isNotEmpty)
                      detailInfoChip(
                          Icons.location_on_outlined, e.location!.trim()),
                    if (e.category != null && e.category!.isNotEmpty)
                      detailInfoChip(Icons.category_outlined, e.category!.trim()),
                  ]),
                  DetailHeroParagraph(text: e.description ?? ''),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
