import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/file_download_utils.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/module_filter_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/pagination_widget.dart';
import '../../../widgets/common/rotary_year_bar.dart';
import '../../../widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Helpers
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

String _combineDateTime(DateTime? date, TimeOfDay? time) {
  if (date == null || time == null) return '';
  final d = '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';
  final hh = time.hour.toString().padLeft(2, '0');
  final mm = time.minute.toString().padLeft(2, '0');
  return '${d}T$hh:$mm:00';
}

Future<void> _launchUrl(BuildContext context, String url) async {
  if (url.isEmpty) return;
  try {
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open: $url')),
      );
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Invalid URL: $url')),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
class _Newsletter {
  final int id;
  final String title;
  final String? publishDateTime;
  final String? expiryDateTime;
  final String attachmentType; // 'link' | 'file'
  final String? linkUrl;
  final String? filePath;
  final String? fileName;
  final bool isSendEmail;
  final String status;
  final int? yearId;

  const _Newsletter({
    required this.id,
    required this.title,
    this.publishDateTime,
    this.expiryDateTime,
    this.attachmentType = 'link',
    this.linkUrl,
    this.filePath,
    this.fileName,
    this.isSendEmail = false,
    this.status = '',
    this.yearId,
  });

  factory _Newsletter.fromJson(Map<String, dynamic> j) {
    return _Newsletter(
      id: (j['id'] as int?) ?? 0,
      title: j['title']?.toString() ?? '',
      publishDateTime: j['publishDateTime']?.toString() ?? j['publishDate']?.toString(),
      expiryDateTime: j['expiryDateTime']?.toString() ?? j['expiryDate']?.toString(),
      attachmentType: (j['attachmentType']?.toString() ?? 'link').toLowerCase(),
      linkUrl: j['linkUrl']?.toString(),
      filePath: j['filePath']?.toString(),
      fileName: j['fileName']?.toString(),
      isSendEmail: _asBool(j['isSendEmail']),
      status: j['status']?.toString() ?? '',
      yearId: j['yearId'] is int
          ? j['yearId'] as int
          : int.tryParse(j['yearId']?.toString() ?? ''),
    );
  }
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({
    required this.id,
    required this.yearLabel,
    this.isCurrent = false,
  });

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

// ---------------------------------------------------------------------------
// List Screen
// ---------------------------------------------------------------------------
class DistrictNewslettersScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  /// When true, forces read-only rendering regardless of the user's admin
  /// role. Set by the unified flow when the user isn't admin of this district.
  final bool viewOnly;
  const DistrictNewslettersScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<DistrictNewslettersScreen> createState() =>
      _DistrictNewslettersScreenState();
}

class _DistrictNewslettersScreenState
    extends State<DistrictNewslettersScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  final List<_Newsletter> _items = [];
  final List<_RotaryYear> _years = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _yearsLoading = true;
  String? _error;

  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  int? _yearId;
  String _status = 'All';
  static const _statuses = ['All', 'Published', 'Unpublished'];

  @override
  void initState() {
    super.initState();
    _loadYears();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/newsletters/years',
        fromJson: (j) => j as List<dynamic>,
      );
      final raw = resp.data ?? const [];
      final list = raw
          .whereType<Map<String, dynamic>>()
          .map(_RotaryYear.fromJson)
          .toList();
      if (list.isEmpty) {
        await _loadYearsFallback();
      } else {
        final current = list.firstWhere(
          (y) => y.isCurrent,
          orElse: () => list.first,
        );
        setState(() {
          _years
            ..clear()
            ..addAll(list);
          _yearId = current.id;
          _yearsLoading = false;
        });
        _fetch(reset: true);
      }
    } catch (_) {
      await _loadYearsFallback();
    }
  }

  Future<void> _loadYearsFallback() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final raw = resp.data ?? const [];
      final list = raw
          .whereType<Map<String, dynamic>>()
          .map(_RotaryYear.fromJson)
          .toList();
      _RotaryYear? current;
      if (list.isNotEmpty) {
        current = list.firstWhere(
          (y) => y.isCurrent,
          orElse: () => list.first,
        );
      }
      setState(() {
        _years
          ..clear()
          ..addAll(list);
        _yearId = current?.id;
        _yearsLoading = false;
      });
      _fetch(reset: true);
    } catch (e) {
      setState(() {
        _yearsLoading = false;
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() {
        _page = 1;
        _items.clear();
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final qp = <String, dynamic>{
        'page': _page,
        'pageSize': _pageSize,
      };
      if (_yearId != null) qp['yearId'] = _yearId;
      // Members only ever see Published items; admins use the status filter.
      final canManage = !widget.viewOnly &&
          Provider.of<AuthProvider>(context, listen: false)
              .isDistrictAdminOf(widget.districtId);
      final effectiveStatus = canManage ? _status : 'Published';
      if (effectiveStatus != 'All') qp['status'] = effectiveStatus;
      final q = _searchCtrl.text.trim();
      if (q.isNotEmpty) qp['search'] = q;

      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/newsletters',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _Newsletter.fromJson(j),
      );
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
          _loadingMore = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _delete(_Newsletter item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Newsletter'),
        content: Text('Delete "${item.title}"? This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
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
        '/api/districts/${widget.districtId}/newsletters/${item.id}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Newsletter deleted'),
          backgroundColor: AppColors.success,
        ),
      );
      await _fetch(reset: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }

  void _openDetail(_Newsletter item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _NewsletterDetailScreen(
          districtId: widget.districtId,
          newsletter: item,
          defaultYearId: _yearId ?? (_years.isNotEmpty ? _years.first.id : 0),
          years: List<_RotaryYear>.from(_years),
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Future<void> _openEditor({_Newsletter? existing}) async {
    if (_yearId == null && _years.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('No rotary year available. Create one first.')),
      );
      return;
    }
    _Newsletter? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/districts/${widget.districtId}/newsletters/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _Newsletter.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _NewsletterEditorPage(
          districtId: widget.districtId,
          defaultYearId: detailed?.yearId ?? _yearId ?? _years.first.id,
          existing: detailed,
          years: List<_RotaryYear>.from(_years),
        ),
      ),
    );
    if (saved == true) await _fetch(reset: true);
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'Published':
        return AppColors.success;
      case 'Unpublished':
        return Colors.orange;
      default:
        return AppColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // viewOnly overrides admin access — used by the unified flow.
    // Per-level gating: only district admins of THIS district can manage.
    final canManage =
        !widget.viewOnly && auth.isDistrictAdminOf(widget.districtId);

    final body = Column(
      children: [
        _buildFilters(canManage),
        Expanded(child: _buildBody(canManage)),
      ],
    );

    if (widget.embedded) {
      return Scaffold(
        backgroundColor: AppColors.background,
        // Embedded: the app bar (and its +Add action) is suppressed, so surface
        // Add as a FAB for admins.
        floatingActionButton: canManage
            ? FloatingActionButton(
                onPressed: () => _openEditor(),
                backgroundColor: AppColors.primary,
                child: const Icon(Icons.add, color: Colors.white),
              )
            : null,
        body: body,
      );
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Newsletters',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add newsletter',
              onPressed: () => _openEditor(),
            ),
        ],
      ),
      body: body,
    );
  }

  Widget _buildFilters(bool canManage) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Year filter. `_yearId` is defaulted to the current rotary year in
        // `_loadYears` and passed to the API as a query param; the year bar lets
        // the user view other years (e.g. a newsletter whose publish date moved
        // it to a different rotary year).
        if (_years.isNotEmpty)
          RotaryYearBar<int>(
            value: _yearId,
            margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            options: [
              for (final y in _years)
                RotaryYearOption(
                  value: y.id,
                  label: y.yearLabel,
                  isCurrent: y.isCurrent,
                ),
            ],
            onChanged: (v) {
              if (v == null || v == _yearId) return;
              setState(() => _yearId = v);
              _fetch(reset: true);
            },
          ),
        ModuleFilterBar(
          searchController: _searchCtrl,
          searchHint: 'Search newsletters',
          status: _status,
          statuses: _statuses,
          showStatusFilter: canManage,
          onStatusChanged: (v) {
            setState(() => _status = v);
            _fetch(reset: true);
          },
          onSubmit: () => _fetch(reset: true),
          onClear: () {
            _searchCtrl.clear();
            _fetch(reset: true);
          },
        ),
      ],
    );
  }

  Widget _buildBody(bool canManage) {
    if (_yearsLoading || _loading) {
      return const ShimmerList(itemCount: 6, itemHeight: 110);
    }
    if (_error != null) {
      return ErrorStateWidget(
        message: _error!,
        onRetry: () => _fetch(reset: true),
      );
    }
    if (_items.isEmpty) {
      return EmptyStateWidget(
        title: 'No newsletters',
        subtitle: canManage
            ? 'Tap + to create a new newsletter.'
            : 'No newsletters have been posted yet.',
        icon: Icons.article_outlined,
        actionLabel: canManage ? 'Add Newsletter' : null,
        onAction: canManage ? () => _openEditor() : null,
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _fetch(reset: true),
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
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
                if (_page < _totalPages && !_loadingMore) {
                  _page++;
                  _fetch();
                }
              },
            );
          }
          final item = _items[i];
          return _NewsletterCard(
            item: item,
            canManage: canManage,
            statusColor: _statusColor(item.status),
            onTap: () => _openDetail(item),
            onEdit: () => _openEditor(existing: item),
            onDelete: () => _delete(item),
            onOpen: () {
              // Link → open externally; File → download bytes + open with the
              // device's default app (browser-launch did not save the file).
              if (item.attachmentType == 'link') {
                _launchUrl(context, item.linkUrl ?? '');
              } else {
                downloadAndOpenServerFile(
                  context,
                  filePath: item.filePath,
                  fileName: item.fileName,
                );
              }
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
class _NewsletterCard extends StatelessWidget {
  final _Newsletter item;
  final bool canManage;
  final Color statusColor;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onOpen;
  final VoidCallback? onTap;

  const _NewsletterCard({
    required this.item,
    required this.canManage,
    required this.statusColor,
    required this.onEdit,
    required this.onDelete,
    required this.onOpen,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isLink = item.attachmentType == 'link';
    final typeColor = isLink ? Colors.blue : AppColors.success;
    final typeLabel = isLink ? 'Link' : 'File';
    final hasTarget = isLink
        ? (item.linkUrl != null && item.linkUrl!.isNotEmpty)
        : (item.filePath != null && item.filePath!.isNotEmpty);

    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.article_outlined,
                    size: 20,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        style: AppTextStyles.bodyMedium
                            .copyWith(fontWeight: FontWeight.w600),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              item.status.isEmpty ? 'Unknown' : item.status,
                              style: AppTextStyles.caption
                                  .copyWith(color: statusColor),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: typeColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              typeLabel,
                              style: AppTextStyles.caption
                                  .copyWith(color: typeColor),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (hasTarget || canManage)
                  PopupMenuButton<String>(
                    tooltip: 'More',
                    icon: const Icon(Icons.more_vert, size: 20),
                    padding: EdgeInsets.zero,
                    onSelected: (v) {
                      if (v == 'open') onOpen();
                      if (v == 'edit') onEdit();
                      if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => [
                      if (hasTarget)
                        PopupMenuItem(
                          value: 'open',
                          child: Text(isLink ? 'Open link' : 'Download'),
                        ),
                      if (canManage)
                        const PopupMenuItem(
                            value: 'edit', child: Text('Edit')),
                      if (canManage)
                        const PopupMenuItem(
                            value: 'delete', child: Text('Delete')),
                    ],
                  ),
              ],
            ),
            // Publish date is intentionally NOT shown in the listing.
          ],
        ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Editor Page (full-screen)
// ---------------------------------------------------------------------------
class _NewsletterEditorPage extends StatefulWidget {
  final int districtId;
  final int defaultYearId;
  final _Newsletter? existing;
  final List<_RotaryYear> years;

  const _NewsletterEditorPage({
    required this.districtId,
    required this.defaultYearId,
    required this.years,
    this.existing,
  });

  @override
  State<_NewsletterEditorPage> createState() => _NewsletterEditorPageState();
}

class _NewsletterEditorPageState extends State<_NewsletterEditorPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _linkCtrl = TextEditingController();

  late int _yearId;
  String _attachmentType = 'link';
  String _filePath = '';
  String? _fileName;
  bool _uploading = false;
  bool _saving = false;

  DateTime? _publishDate;
  TimeOfDay? _publishTime;

  bool _isSendEmail = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _yearId = widget.defaultYearId;
    final e = widget.existing;
    if (e != null) {
      _titleCtrl.text = e.title;
      _attachmentType = e.attachmentType == 'file' ? 'file' : 'link';
      _linkCtrl.text = e.linkUrl ?? '';
      _filePath = e.filePath ?? '';
      _fileName = e.fileName;
      _isSendEmail = e.isSendEmail;
      if (e.yearId != null) _yearId = e.yearId!;

      final pd = e.publishDateTime != null
          ? DateTime.tryParse(e.publishDateTime!)
          : null;
      if (pd != null) {
        final loc = pd.toLocal();
        _publishDate = DateTime(loc.year, loc.month, loc.day);
        _publishTime = TimeOfDay(hour: loc.hour, minute: loc.minute);
      }
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _linkCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate(
    DateTime? current,
    ValueChanged<DateTime> onPicked, {
    String kind = 'any',
  }) async {
    final now = DateTime.now();
    final DateTime firstAllowed = DateTime(now.year - 2);
    final DateTime lastAllowed = DateTime(now.year + 5);

    DateTime initial = current ?? now;
    if (initial.isBefore(firstAllowed)) initial = firstAllowed;
    if (initial.isAfter(lastAllowed)) initial = lastAllowed;

    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: firstAllowed,
      lastDate: lastAllowed,
    );
    if (picked != null) onPicked(picked);
  }

  Future<void> _pickTime(
      TimeOfDay? current, ValueChanged<TimeOfDay> onPicked) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: current ?? TimeOfDay.now(),
    );
    if (picked != null) onPicked(picked);
  }

  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles();
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() => _uploading = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/newsletters/upload',
        filePath: f.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      final newName = (resp.data?['fileName'] as String?) ?? f.name;
      setState(() {
        _uploading = false;
        if (newPath.isNotEmpty) {
          _filePath = newPath;
          _fileName = newName;
        }
      });
    } catch (e) {
      setState(() => _uploading = false);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Upload failed: $e')));
      }
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    final publishIso = _combineDateTime(_publishDate, _publishTime);
    // Expiry was removed from the form; the backend field is non-nullable, so
    // send a far-future date — the newsletter effectively never auto-expires.
    final expiryIso =
        _combineDateTime(DateTime(2099, 12, 31), const TimeOfDay(hour: 23, minute: 59));
    if (publishIso.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Publish date and time are required'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    if (_attachmentType == 'link' && _linkCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Link URL is required'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }
    if (_attachmentType == 'file' && _filePath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please pick a file'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    final body = <String, dynamic>{
      'title': _titleCtrl.text.trim(),
      'yearId': _yearId,
      // Backend DTO fields are PublishDateTime / ExpiryDateTime (non-nullable
      // DateTime). Sending publishDate/expiryDate did NOT bind, so the server
      // received DateTime.MinValue (0001-01-01) and re-derived the newsletter's
      // rotary year from that bogus date — moving it out of its year so it
      // appeared deleted after an update. Use the exact DTO field names.
      'publishDateTime': publishIso,
      'expiryDateTime': expiryIso,
      'attachmentType': _attachmentType,
      'linkUrl': _attachmentType == 'link' ? _linkCtrl.text.trim() : null,
      'filePath': _attachmentType == 'file' ? _filePath : null,
      if (_attachmentType == 'file' && _fileName != null) 'fileName': _fileName,
      'isSendEmail': _isSendEmail,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/newsletters/${widget.existing!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/newsletters',
          body: body,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        // `ApiException.toString()` already returns the server's user-facing
        // message verbatim (e.g. "Insufficient email credits. Need 13
        // credit(s)."), so we show it as-is. Anything else gets the
        // "Save failed: …" prefix so a generic Exception still makes sense.
        final msg = e is ApiException ? e.message : 'Save failed: $e';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Newsletter' : 'Add Newsletter',
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    _isEdit ? 'Update' : 'Save',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold),
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _sectionTitle('Basic info'),
              const SizedBox(height: 8),
              CustomTextField(
                label: 'Title *',
                controller: _titleCtrl,
                hint: 'Enter newsletter title',
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Title is required'
                    : null,
              ),
              // Year picker intentionally removed — the newsletter is always
              // saved under whichever year the list is currently filtered to
              // (passed in via widget.defaultYearId), so a new entry always
              // appears on the same list it was created from.
              const SizedBox(height: 20),
              _sectionTitle('Schedule'),
              const SizedBox(height: 8),
              _dateTimeRow(
                label: 'Publish *',
                date: _publishDate,
                time: _publishTime,
                onDate: () => _pickDate(
                  _publishDate,
                  (d) => setState(() => _publishDate = d),
                  kind: 'publish',
                ),
                onTime: () => _pickTime(
                  _publishTime,
                  (t) => setState(() => _publishTime = t),
                ),
              ),
              const SizedBox(height: 20),
              _sectionTitle('Attachment'),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                      value: 'link',
                      label: Text('Link'),
                      icon: Icon(Icons.link)),
                  ButtonSegment(
                      value: 'file',
                      label: Text('File'),
                      icon: Icon(Icons.attach_file)),
                ],
                selected: {_attachmentType},
                onSelectionChanged: (s) =>
                    setState(() => _attachmentType = s.first),
              ),
              const SizedBox(height: 12),
              if (_attachmentType == 'link')
                CustomTextField(
                  label: 'Link URL *',
                  controller: _linkCtrl,
                  hint: 'https://…',
                  keyboardType: TextInputType.url,
                  validator: (v) {
                    if (_attachmentType != 'link') return null;
                    final val = (v ?? '').trim();
                    if (val.isEmpty) return 'URL is required';
                    if (!val.startsWith('http://') &&
                        !val.startsWith('https://')) {
                      return 'URL must start with http:// or https://';
                    }
                    return null;
                  },
                )
              else
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: _uploading
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.upload_file, size: 18),
                        label: Text(_uploading
                            ? 'Uploading...'
                            : (_filePath.isEmpty ? 'Pick File' : 'Replace')),
                        onPressed: _uploading ? null : _pickFile,
                      ),
                    ),
                    if (_filePath.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.insert_drive_file_outlined,
                                size: 18,
                                color: AppColors.textSecondary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _fileName ??
                                    _filePath.split('/').last,
                                style: AppTextStyles.caption,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.close, size: 16),
                              tooltip: 'Clear file',
                              onPressed: () => setState(() {
                                _filePath = '';
                                _fileName = null;
                              }),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              const SizedBox(height: 20),
              _sectionTitle('Settings'),
              SwitchListTile.adaptive(
                value: _isSendEmail,
                onChanged: (v) => setState(() => _isSendEmail = v),
                title: const Text('Send through Email'),
                activeColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String title) => Text(
        title,
        style: AppTextStyles.bodyMedium
            .copyWith(fontWeight: FontWeight.w700, color: AppColors.primary),
      );

  Widget _dateTimeRow({
    required String label,
    required DateTime? date,
    required TimeOfDay? time,
    required VoidCallback onDate,
    required VoidCallback onTime,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.bodyMedium),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: _pickerTile(
                icon: Icons.calendar_today,
                label: date == null
                    ? 'Pick date'
                    : DateFormat('dd MMM yyyy').format(date),
                onTap: onDate,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _pickerTile(
                icon: Icons.access_time,
                label: time == null ? 'Pick time' : time.format(context),
                onTap: onTime,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _pickerTile({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: AppColors.textSecondary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: AppTextStyles.body,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail Screen — full-screen view-only display of a single newsletter.
// Mirrors the club-side detail page: 4 numbered sections (Newsletter Details
// with status, Dates, Attachment, Notification Settings). Edit action
// visible only to district admins of this district.
// ---------------------------------------------------------------------------
class _NewsletterDetailScreen extends StatefulWidget {
  final int districtId;
  final _Newsletter newsletter;
  final int defaultYearId;
  final List<_RotaryYear> years;
  const _NewsletterDetailScreen({
    required this.districtId,
    required this.newsletter,
    required this.defaultYearId,
    required this.years,
  });

  @override
  State<_NewsletterDetailScreen> createState() =>
      _NewsletterDetailScreenState();
}

class _NewsletterDetailScreenState extends State<_NewsletterDetailScreen> {
  late final _Newsletter _nl = widget.newsletter;
  bool _changed = false;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isDistrictAdminOf(widget.districtId);

  Future<void> _edit() async {
    final n = _nl;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _NewsletterEditorPage(
          districtId: widget.districtId,
          defaultYearId: n.yearId ?? widget.defaultYearId,
          years: widget.years,
          existing: n,
        ),
      ),
    );
    if (saved == true) _changed = true;
  }

  String _statusOrComputed(_Newsletter n) {
    // Status is binary server-side (Unpublished | Published); no Expired branch.
    if (n.status.isNotEmpty) return n.status;
    final pub = n.publishDateTime != null
        ? DateTime.tryParse(n.publishDateTime!)
        : null;
    final now = DateTime.now();
    if (pub != null && pub.isAfter(now)) return 'Unpublished';
    return 'Published';
  }

  @override
  Widget build(BuildContext context) {
    final n = _nl;
    return WillPopScope(
      onWillPop: () async {
        Navigator.of(context).pop(_changed);
        return false;
      },
      child: DetailScaffold(
        title: 'Newsletters',
        loading: false,
        error: null,
        onRetry: () {},
        actions: [
          if (_canManage)
            IconButton(
              tooltip: 'Edit',
              icon: const Icon(Icons.edit_outlined),
              onPressed: _edit,
            ),
        ],
        body: (_) => _buildBody(n),
      ),
    );
  }

  Widget _buildBody(_Newsletter n) {
    final status = _statusOrComputed(n);
    final isLink = n.attachmentType == 'link';
    final hasLink = isLink && (n.linkUrl != null && n.linkUrl!.isNotEmpty);
    final fileUrl = detailMediaUrl(n.filePath);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DetailHeader(
          title: n.title,
          status: status,
          icon: Icons.newspaper_outlined,
        ),
        const SizedBox(height: 16),
        DetailSectionCard(
          icon: Icons.link_outlined,
          title: 'Attachment',
          number: 2,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (hasLink)
                DetailLinkRow(label: 'Link', url: n.linkUrl!)
              else if (!isLink && fileUrl != null)
                DetailAttachmentTile(
                  label: (n.fileName != null && n.fileName!.isNotEmpty)
                      ? n.fileName!
                      : ((n.filePath != null && n.filePath!.isNotEmpty)
                          ? n.filePath!.split('/').last
                          : 'Open document'),
                  icon: Icons.picture_as_pdf_outlined,
                  onView: () => downloadAndOpenServerFile(
                    context,
                    filePath: n.filePath,
                    fileName: n.fileName,
                  ),
                  onDownload: () => shareServerFile(
                    context,
                    filePath: n.filePath,
                    fileName: n.fileName,
                  ),
                )
              else
                const DetailRow(label: 'Attachment', value: '-'),
            ],
          ),
        ),
        // Publish date and notification settings are intentionally NOT shown on the detail page.
        const SizedBox(height: 24),
      ],
    );
  }
}
