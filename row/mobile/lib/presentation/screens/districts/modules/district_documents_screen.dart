import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
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
import '../../../widgets/detail/detail_widgets.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String _combineDateTime(DateTime? date, TimeOfDay? time) {
  if (date == null || time == null) return '';
  final d = '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';
  final hh = time.hour.toString().padLeft(2, '0');
  final mm = time.minute.toString().padLeft(2, '0');
  return '${d}T$hh:$mm:00';
}


// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Document {
  final int id;
  final String title;
  final String accessType; // 'view_only' | 'downloadable'
  final String? filePath;
  final String? fileName;
  final String? publishDateTime;
  final String? expiryDateTime;
  final String status;

  const _Document({
    required this.id,
    required this.title,
    this.accessType = 'downloadable',
    this.filePath,
    this.fileName,
    this.publishDateTime,
    this.expiryDateTime,
    this.status = '',
  });

  factory _Document.fromJson(Map<String, dynamic> j) {
    return _Document(
      id: (j['id'] as int?) ?? 0,
      title: j['title']?.toString() ?? '',
      accessType:
          (j['accessType']?.toString() ?? 'downloadable').toLowerCase(),
      filePath: j['filePath']?.toString(),
      // Server's DTO field is `OriginalFileName` → serialized as
      // `originalFileName`. Old `fileName` kept as a fallback for any
      // legacy responses that might still use it.
      fileName: j['originalFileName']?.toString() ?? j['fileName']?.toString(),
      publishDateTime: j['publishDateTime']?.toString() ?? j['publishDate']?.toString(),
      expiryDateTime: j['expiryDateTime']?.toString() ?? j['expiryDate']?.toString(),
      status: j['status']?.toString() ?? '',
    );
  }
}

// ---------------------------------------------------------------------------
// List Screen
// ---------------------------------------------------------------------------
class DistrictDocumentsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  /// When true, forces read-only rendering regardless of the user's admin
  /// role. Set by the unified flow when the user isn't admin of this district.
  final bool viewOnly;
  const DistrictDocumentsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<DistrictDocumentsScreen> createState() =>
      _DistrictDocumentsScreenState();
}

class _DistrictDocumentsScreenState extends State<DistrictDocumentsScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  final List<_Document> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  String _status = 'All';
  static const _statuses = ['All', 'Published', 'Expired', 'Unpublished'];

  @override
  void initState() {
    super.initState();
    _fetch(reset: true);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
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
      // Members only ever see Published items; admins use the status filter.
      final canManage = !widget.viewOnly &&
          Provider.of<AuthProvider>(context, listen: false)
              .isDistrictAdminOf(widget.districtId);
      final effectiveStatus = canManage ? _status : 'Published';
      if (effectiveStatus != 'All') qp['status'] = effectiveStatus;
      final q = _searchCtrl.text.trim();
      if (q.isNotEmpty) qp['search'] = q;

      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/documents',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _Document.fromJson(j),
      );
      setState(() {
        _items.addAll(paged.items);
        _totalCount = paged.totalCount;
        // Backend returns only { items, totalCount } (no totalPages) — derive
        // it so Load More can advance past page 1.
        _totalPages =
            _totalCount == 0 ? 1 : ((_totalCount + _pageSize - 1) ~/ _pageSize);
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

  Future<void> _delete(_Document item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Document'),
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
        '/api/districts/${widget.districtId}/documents/${item.id}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Document deleted'),
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

  Future<void> _openEditor({_Document? existing}) async {
    _Document? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/districts/${widget.districtId}/documents/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _Document.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _DocumentEditorPage(
          districtId: widget.districtId,
          existing: detailed,
        ),
      ),
    );
    if (saved == true) await _fetch(reset: true);
  }

  void _openDetail(_Document item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _DocumentDetailScreen(
          districtId: widget.districtId,
          document: item,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'Published':
        return AppColors.success;
      case 'Expired':
        return AppColors.error;
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
        title: 'Documents',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add document',
              onPressed: () => _openEditor(),
            ),
        ],
      ),
      body: body,
    );
  }

  Widget _buildFilters(bool canManage) {
    return ModuleFilterBar(
      searchController: _searchCtrl,
      searchHint: 'Search documents',
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
    );
  }

  Widget _buildBody(bool canManage) {
    if (_loading) {
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
        title: 'No documents',
        subtitle: canManage
            ? 'Tap + to add a new document.'
            : 'No documents have been posted yet.',
        icon: Icons.folder_outlined,
        actionLabel: canManage ? 'Add Document' : null,
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
          return _DocumentCard(
            item: item,
            canManage: canManage,
            statusColor: _statusColor(item.status),
            onTap: () => _openDetail(item),
            onEdit: () => _openEditor(existing: item),
            onDelete: () => _delete(item),
            onOpen: () => downloadAndOpenServerFile(
              context,
              filePath: item.filePath,
              fileName: item.fileName,
            ),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _DocumentCard extends StatelessWidget {
  final _Document item;
  final bool canManage;
  final Color statusColor;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onOpen;
  final VoidCallback? onTap;

  const _DocumentCard({
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
    final isViewOnly = item.accessType == 'view_only';
    final accessColor = isViewOnly ? Colors.amber.shade700 : AppColors.success;
    final accessLabel = isViewOnly ? 'View Only' : 'Downloadable';
    final hasFile = item.filePath != null && item.filePath!.isNotEmpty;

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
                    Icons.description_outlined,
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
                              color: accessColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              accessLabel,
                              style: AppTextStyles.caption
                                  .copyWith(color: accessColor),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (hasFile || canManage)
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
                      if (hasFile)
                        PopupMenuItem(
                          value: 'open',
                          child: Text(isViewOnly ? 'View' : 'Download'),
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
            // Publish/Expiry dates are intentionally NOT shown in the listing.
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
class _DocumentEditorPage extends StatefulWidget {
  final int districtId;
  final _Document? existing;

  const _DocumentEditorPage({
    required this.districtId,
    this.existing,
  });

  @override
  State<_DocumentEditorPage> createState() => _DocumentEditorPageState();
}

class _DocumentEditorPageState extends State<_DocumentEditorPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();

  String _accessType = 'downloadable';
  String _filePath = '';
  String? _fileName;
  bool _uploading = false;
  bool _saving = false;

  DateTime? _publishDate;
  TimeOfDay? _publishTime;
  DateTime? _expiryDate;
  TimeOfDay? _expiryTime;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _titleCtrl.text = e.title;
      _accessType = e.accessType == 'view_only' ? 'view_only' : 'downloadable';
      _filePath = e.filePath ?? '';
      _fileName = e.fileName;

      final pd = e.publishDateTime != null
          ? DateTime.tryParse(e.publishDateTime!)
          : null;
      if (pd != null) {
        final loc = pd.toLocal();
        _publishDate = DateTime(loc.year, loc.month, loc.day);
        _publishTime = TimeOfDay(hour: loc.hour, minute: loc.minute);
      }
      final ed = e.expiryDateTime != null
          ? DateTime.tryParse(e.expiryDateTime!)
          : null;
      if (ed != null) {
        final loc = ed.toLocal();
        _expiryDate = DateTime(loc.year, loc.month, loc.day);
        _expiryTime = TimeOfDay(hour: loc.hour, minute: loc.minute);
      }
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  // Date-only (strips time) for picker bounds & save-time validation.
  DateTime _d(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

  Future<void> _pickDate(
    DateTime? current,
    ValueChanged<DateTime> onPicked, {
    String kind = 'any',
  }) async {
    final now = DateTime.now();
    DateTime firstAllowed = DateTime(now.year - 2);
    DateTime lastAllowed = DateTime(now.year + 5);

    // 2-way rule: publish ≤ expiry.
    if (kind == 'publish' && _expiryDate != null) {
      lastAllowed = _d(_expiryDate!);
    } else if (kind == 'expiry' && _publishDate != null) {
      firstAllowed = _d(_publishDate!);
    }

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
        '/api/districts/${widget.districtId}/documents/upload',
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

    // A file is mandatory — the server's CreateDocumentDto.FilePath is a
    // non-nullable string (implicitly [Required]), and the web form enforces
    // the same ("File is required."). Block here so the user gets a clean
    // message instead of a raw 400 validation error.
    if (_uploading) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please wait for the file upload to finish'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }
    if (_filePath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('File is required'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    final publishIso = _combineDateTime(_publishDate, _publishTime);
    final expiryIso = _combineDateTime(_expiryDate, _expiryTime);
    if (publishIso.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Publish date and time are required'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }
    if (expiryIso.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Expiry date and time are required'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }
    // Enforce publish ≤ expiry (date-only).
    if (_d(_publishDate!).isAfter(_d(_expiryDate!))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Publish date must be on or before the expiry date'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    // Property names MUST match Create/UpdateDocumentDto exactly:
    //   • `filePath`         (required, non-null — validated above)
    //   • `publishDateTime`  (not `publishDate`)
    //   • `expiryDateTime`   (not `expiryDate`)
    //   • `originalFileName` (not `fileName`)
    // Wrong names get silently ignored by the model binder and the date
    // columns end up as DateTime.MinValue (`0001-01-01T00:00:00`) — which
    // then renders on the list as "01 Jan 0001, 12:00 AM" and tags every
    // row "Expired".
    final body = <String, dynamic>{
      'title': _titleCtrl.text.trim(),
      'accessType': _accessType,
      'filePath': _filePath,
      if (_fileName != null) 'originalFileName': _fileName,
      'publishDateTime': publishIso,
      'expiryDateTime': expiryIso,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/documents/${widget.existing!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/documents',
          body: body,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        // `ApiException.toString()` returns the server's user-facing
        // message verbatim — show it without the generic "Save failed:"
        // prefix so reasons like "Insufficient credits" render cleanly.
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
        title: _isEdit ? 'Edit Document' : 'Add Document',
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
                hint: 'Enter document title',
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Title is required'
                    : null,
              ),
              const SizedBox(height: 20),
              _sectionTitle('Access Type'),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                      value: 'downloadable',
                      label: Text('Downloadable'),
                      icon: Icon(Icons.download)),
                  ButtonSegment(
                      value: 'view_only',
                      label: Text('View Only'),
                      icon: Icon(Icons.visibility)),
                ],
                selected: {_accessType},
                onSelectionChanged: (s) =>
                    setState(() => _accessType = s.first),
              ),
              const SizedBox(height: 20),
              _sectionTitle('File *'),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: _uploading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
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
                          size: 18, color: AppColors.textSecondary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _fileName ?? _filePath.split('/').last,
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
              const SizedBox(height: 12),
              _dateTimeRow(
                label: 'Expiry *',
                date: _expiryDate,
                time: _expiryTime,
                onDate: () => _pickDate(
                  _expiryDate,
                  (d) => setState(() => _expiryDate = d),
                  kind: 'expiry',
                ),
                onTime: () => _pickTime(
                  _expiryTime,
                  (t) => setState(() => _expiryTime = t),
                ),
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
// Detail Screen — view-only display of a single document. Renders the passed-in
// list row directly (the list payload already carries every field; there is no
// dedicated detail endpoint). Edit action visible only to district admins.
// ---------------------------------------------------------------------------
class _DocumentDetailScreen extends StatefulWidget {
  final int districtId;
  final _Document document;
  const _DocumentDetailScreen({
    required this.districtId,
    required this.document,
  });

  @override
  State<_DocumentDetailScreen> createState() => _DocumentDetailScreenState();
}

class _DocumentDetailScreenState extends State<_DocumentDetailScreen> {
  late final _Document _doc = widget.document;
  bool _changed = false;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isDistrictAdminOf(widget.districtId);

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _DocumentEditorPage(
          districtId: widget.districtId,
          existing: _doc,
        ),
      ),
    );
    if (saved == true) _changed = true;
  }

  String _statusOrComputed(_Document d) {
    if (d.status.isNotEmpty) return d.status;
    final pub = d.publishDateTime != null
        ? DateTime.tryParse(d.publishDateTime!)
        : null;
    final exp = d.expiryDateTime != null
        ? DateTime.tryParse(d.expiryDateTime!)
        : null;
    final now = DateTime.now();
    if (exp != null && exp.isBefore(now)) return 'Expired';
    if (pub != null && pub.isAfter(now)) return 'Unpublished';
    return 'Published';
  }

  @override
  Widget build(BuildContext context) {
    final d = _doc;
    return WillPopScope(
      onWillPop: () async {
        Navigator.of(context).pop(_changed);
        return false;
      },
      child: DetailScaffold(
        title: 'Documents',
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
        body: (_) => _buildBody(d),
      ),
    );
  }

  Widget _buildBody(_Document d) {
    final status = _statusOrComputed(d);
    final isViewOnly = d.accessType == 'view_only';
    final fileUrl = detailMediaUrl(d.filePath);
    final displayName = (d.fileName != null && d.fileName!.isNotEmpty)
        ? d.fileName!
        : ((d.filePath != null && d.filePath!.isNotEmpty)
            ? d.filePath!.split('/').last
            : 'Open document');

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DetailHeader(
          title: d.title,
          status: status,
          icon: Icons.folder_outlined,
        ),
        const SizedBox(height: 16),
        DetailSectionCard(
          icon: Icons.description_outlined,
          title: 'Document Details',
          number: 1,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DetailRow(
                label: 'Access Type',
                value: isViewOnly ? 'View Only' : 'Downloadable',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        DetailSectionCard(
          icon: Icons.upload_file_outlined,
          title: 'File',
          number: 2,
          child: fileUrl != null
              ? DetailAttachmentTile(
                  label: displayName,
                  onView: () => downloadAndOpenServerFile(
                    context,
                    filePath: d.filePath,
                    fileName: d.fileName,
                  ),
                  onDownload: () => shareServerFile(
                    context,
                    filePath: d.filePath,
                    fileName: d.fileName,
                  ),
                )
              : const DetailRow(label: 'File', value: '-'),
        ),
        // Publish/Expiry dates are intentionally NOT shown on the detail page.
        const SizedBox(height: 24),
      ],
    );
  }
}
