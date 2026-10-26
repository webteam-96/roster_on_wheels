import 'package:flutter/material.dart' hide Text;
import 'package:file_picker/file_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/utils/file_download_utils.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/custom_text_field.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/pagination_widget.dart';
import '../../../../widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Document {
  final int id;
  final String title;
  final String? filePath;
  final String? originalFileName;
  final String? accessType;
  final DateTime? publishDateTime;
  final DateTime? expiryDateTime;
  final String? status;

  const _Document({
    required this.id,
    required this.title,
    this.filePath,
    this.originalFileName,
    this.accessType,
    this.publishDateTime,
    this.expiryDateTime,
    this.status,
  });

  // Convenience: derive extension from originalFileName for icons.
  String? get fileType {
    final n = originalFileName ?? filePath;
    if (n == null) return null;
    final dot = n.lastIndexOf('.');
    if (dot < 0 || dot == n.length - 1) return null;
    return n.substring(dot + 1);
  }

  String? get fileUrl => filePath;

  factory _Document.fromJson(Map<String, dynamic> j) {
    DateTime? _parse(dynamic v) {
      final d = v == null ? null : DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }
    return _Document(
      id: j['id'] as int? ?? 0,
      title: (j['title'] ?? j['originalFileName'] ?? '').toString(),
      filePath: (j['filePath'])?.toString(),
      originalFileName: (j['originalFileName'])?.toString(),
      accessType: (j['accessType'])?.toString(),
      publishDateTime: _parse(j['publishDateTime']),
      expiryDateTime: _parse(j['expiryDateTime']),
      status: (j['status'])?.toString(),
    );
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DocumentsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  /// Forces read-only rendering — used by the unified flow when the viewer
  /// isn't admin of this club.
  final bool viewOnly;
  const DocumentsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');
  final _searchCtrl = TextEditingController();
  String _statusFilter = 'all';

  final List<_Document> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

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
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      // Non-admin members always see only the Published list; the status
      // filter is admin-only, so their effective status is pinned to
      // 'published' regardless of `_statusFilter`.
      final canManage =
          !widget.viewOnly &&
          Provider.of<AuthProvider>(context, listen: false)
              .isClubAdminOf(widget.clubId);
      final effectiveStatus = canManage ? _statusFilter : 'published';
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/documents',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
          if (effectiveStatus != 'all') 'status': effectiveStatus,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Document.fromJson(j));
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } on ApiException catch (e) {
      // 404 means "no documents for this club" — treat as empty list so the
      // EmptyStateWidget renders instead of the generic error screen.
      if (e.statusCode == 404) {
        setState(() {
          _totalPages = 1;
          _totalCount = 0;
          _loading = false;
          _loadingMore = false;
        });
      } else {
        setState(() { _error = e.message; _loading = false; _loadingMore = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; _loadingMore = false; });
    }
  }

  Future<void> _openForm({_Document? existing}) async {
    _Document? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/documents/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _Document.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _DocumentFormScreen(
          clubId: widget.clubId,
          existing: detailed,
          onSaved: () => _fetch(reset: true),
        ),
      ),
    );
  }

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/clubs/${widget.clubId}/documents/$id');
      setState(() => _items.removeWhere((d) => d.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Document deleted'), backgroundColor: AppColors.success),
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

  void _openDetail(_Document item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _DocumentDetailScreen(
          clubId: widget.clubId,
          document: item,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  // Add action is a FloatingActionButton (an app-bar IconButton tinted with the
  // primary colour was invisible against the primary-coloured app bar).
  Widget? _buildFab(bool canManage) => !canManage
      ? null
      : FloatingActionButton(
          heroTag: 'club_documents_fab',
          onPressed: () => _openForm(),
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          tooltip: 'Add Document',
          child: const Icon(Icons.add),
        );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Per-level gating: only club admins of THIS club can manage.
    final canManage =
        !widget.viewOnly && auth.isClubAdminOf(widget.clubId);
    if (widget.embedded) {
      return Scaffold(
        backgroundColor: AppColors.background,
        floatingActionButton: _buildFab(canManage),
        body: Column(
          children: [
            _buildSearchAndFilter(canManage),
            Expanded(child: _buildListBody(canManage)),
          ],
        ),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Documents'),
      floatingActionButton: _buildFab(canManage),
      body: Column(
        children: [
          _buildSearchAndFilter(canManage),
          Expanded(child: _buildListBody(canManage)),
        ],
      ),
    );
  }

  void _loadData() => _fetch(reset: true);

  Widget _buildSearchAndFilter(bool canManage) {
    const filters = ['all', 'published', 'expired', 'unpublished'];
    const labels = {'all': 'All', 'published': 'Published', 'expired': 'Expired', 'unpublished': 'Unpublished'};
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: 'Search...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () { _searchCtrl.clear(); _loadData(); },
                    )
                  : null,
            ),
            onSubmitted: (_) => _loadData(),
            onChanged: (_) => setState(() {}),
          ),
        ),
        // Status filter is admin-only; members see the Published list only.
        if (canManage)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: filters.map((f) {
                  final selected = _statusFilter == f;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(labels[f]!),
                      selected: selected,
                      selectedColor: AppColors.primary.withValues(alpha: 0.15),
                      labelStyle: TextStyle(
                        color: selected ? AppColors.primary : AppColors.textSecondary,
                        fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
                        fontSize: 12,
                      ),
                      onSelected: (_) {
                        setState(() => _statusFilter = f);
                        _loadData();
                      },
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildListBody(bool canManage) => _loading
          ? const ShimmerList(itemCount: 8, itemHeight: 70)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
              : _items.isEmpty
                  ? EmptyStateWidget(
                      title: 'No Documents',
                      subtitle: !canManage
                          ? 'No documents have been uploaded yet.'
                          : 'Upload a document using the button above.',
                      icon: Icons.folder_outlined,
                      actionLabel: !canManage ? null : 'Add Document',
                      onAction: !canManage ? null : () => _openForm(),
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: () => _fetch(reset: true),
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length + 1,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
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
                          return _DocumentTile(
                            item: item,
                            df: _df,
                            canManage: canManage,
                            onTap: () => _openDetail(item),
                            onOpen: item.fileUrl != null && item.fileUrl!.isNotEmpty
                                ? () => downloadAndOpenServerFile(
                                      context,
                                      filePath: item.filePath,
                                      fileName: item.originalFileName,
                                    )
                                : null,
                            onEdit: () => _openForm(existing: item),
                            onDelete: () async {
                              final ok = await ConfirmationDialog.show(
                                context,
                                title: 'Delete Document',
                                message: 'Delete "${item.title}"?',
                              );
                              if (ok) _delete(item.id);
                            },
                          );
                        },
                      ),
                    );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------
class _DocumentTile extends StatelessWidget {
  final _Document item;
  final DateFormat df;
  final bool canManage;
  final VoidCallback? onTap;
  final VoidCallback? onOpen;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _DocumentTile({
    required this.item,
    required this.df,
    required this.canManage,
    required this.onTap,
    required this.onOpen,
    required this.onEdit,
    required this.onDelete,
  });

  String get _statusLabel {
    if (item.status != null && item.status!.isNotEmpty) {
      final s = item.status!.toLowerCase();
      if (s == 'published') return 'Published';
      if (s == 'expired') return 'Expired';
      if (s == 'unpublished') return 'Unpublished';
      return item.status!;
    }
    final now = DateTime.now();
    if (item.expiryDateTime != null && item.expiryDateTime!.isBefore(now)) return 'Expired';
    if (item.publishDateTime != null && item.publishDateTime!.isAfter(now)) return 'Unpublished';
    return 'Published';
  }

  Color get _statusColor {
    switch (_statusLabel) {
      case 'Expired':
        return Colors.red;
      case 'Unpublished':
        return Colors.orange;
      default:
        return Colors.green;
    }
  }

  static IconData _fileIcon(String? type) {
    if (type == null) return Icons.insert_drive_file_outlined;
    final t = type.toLowerCase().replaceAll('.', '');
    if (t == 'pdf') return Icons.picture_as_pdf_outlined;
    if (t == 'doc' || t == 'docx') return Icons.article_outlined;
    if (t == 'xls' || t == 'xlsx') return Icons.table_chart_outlined;
    if (t == 'ppt' || t == 'pptx') return Icons.slideshow_outlined;
    if (t == 'jpg' || t == 'jpeg' || t == 'png') return Icons.image_outlined;
    return Icons.insert_drive_file_outlined;
  }

  static Color _fileColor(String? type) {
    if (type == null) return AppColors.textSecondary;
    final t = type.toLowerCase().replaceAll('.', '');
    if (t == 'pdf') return AppColors.error;
    if (t == 'doc' || t == 'docx') return AppColors.primary;
    if (t == 'xls' || t == 'xlsx') return AppColors.success;
    if (t == 'ppt' || t == 'pptx') return AppColors.warning;
    return AppColors.textSecondary;
  }

  @override
  Widget build(BuildContext context) {
    final iconData = _fileIcon(item.fileType);
    final iconColor = _fileColor(item.fileType);

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
              // Header: file icon + (title + chips below) + 3-dot menu.
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: iconColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(iconData, size: 24, color: iconColor),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.title,
                            style: AppTextStyles.bodyMedium,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 4,
                          runSpacing: 4,
                          children: [
                            if (_statusLabel.isNotEmpty)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: _statusColor.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  _statusLabel,
                                  style: TextStyle(
                                      fontSize: 9,
                                      fontWeight: FontWeight.w700,
                                      color: _statusColor),
                                ),
                              ),
                            if (item.accessType != null)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: item.accessType == 'view_only'
                                      ? Colors.orange.withValues(alpha: 0.12)
                                      : Colors.green.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  item.accessType == 'view_only'
                                      ? 'View Only'
                                      : 'Downloadable',
                                  style: TextStyle(
                                    fontSize: 9,
                                    fontWeight: FontWeight.w700,
                                    color: item.accessType == 'view_only'
                                        ? Colors.orange
                                        : Colors.green,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (onOpen != null || canManage)
                    PopupMenuButton<String>(
                      tooltip: 'More',
                      icon: const Icon(Icons.more_vert, size: 20),
                      padding: EdgeInsets.zero,
                      onSelected: (v) {
                        if (v == 'open' && onOpen != null) onOpen!();
                        if (v == 'edit') onEdit();
                        if (v == 'delete') onDelete();
                      },
                      itemBuilder: (_) => [
                        if (onOpen != null)
                          const PopupMenuItem(
                              value: 'open', child: Text('Open')),
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
// Document Form Sheet — create or edit, with title, access type,
// publish/expiry date+time, and file picker.
// ---------------------------------------------------------------------------
class _DocumentFormScreen extends StatefulWidget {
  final int clubId;
  final _Document? existing;
  final VoidCallback onSaved;

  const _DocumentFormScreen({
    required this.clubId,
    this.existing,
    required this.onSaved,
  });

  @override
  State<_DocumentFormScreen> createState() => _DocumentFormScreenState();
}

class _DocumentFormScreenState extends State<_DocumentFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _dfDisplay = DateFormat('dd MMM yyyy');
  final _tfDisplay = DateFormat('hh:mm a');

  String _accessType = 'downloadable';
  DateTime? _publishDate;
  TimeOfDay? _publishTime;
  DateTime? _expiryDate;
  TimeOfDay? _expiryTime;

  String? _filePath; // server path
  String? _originalFileName;
  String? _localFilePath; // new file to upload
  String? _localFileName;
  bool _uploading = false;
  bool _saving = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      final e = widget.existing!;
      _titleCtrl.text = e.title;
      _accessType = e.accessType ?? 'downloadable';
      _filePath = e.filePath;
      _originalFileName = e.originalFileName;
      if (e.publishDateTime != null) {
        _publishDate = e.publishDateTime;
        _publishTime = TimeOfDay.fromDateTime(e.publishDateTime!);
      }
      if (e.expiryDateTime != null) {
        _expiryDate = e.expiryDateTime;
        _expiryTime = TimeOfDay.fromDateTime(e.expiryDateTime!);
      }
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.first;
    if (f.path == null) return;
    setState(() {
      _localFilePath = f.path;
      _localFileName = f.name;
      if (_titleCtrl.text.trim().isEmpty) _titleCtrl.text = f.name;
    });
  }

  // Date-only (strips time) for picker bounds & save-time validation.
  DateTime _d(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

  Future<void> _pickDate(bool isPublish) async {
    // Clamp: publish ≤ expiry.
    DateTime firstAllowed = DateTime(2000);
    DateTime lastAllowed = DateTime(2100);
    if (isPublish && _expiryDate != null) lastAllowed = _d(_expiryDate!);
    if (!isPublish && _publishDate != null) firstAllowed = _d(_publishDate!);
    DateTime initial = isPublish
        ? (_publishDate ?? DateTime.now())
        : (_expiryDate ?? DateTime.now().add(const Duration(days: 30)));
    if (initial.isBefore(firstAllowed)) initial = firstAllowed;
    if (initial.isAfter(lastAllowed)) initial = lastAllowed;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: firstAllowed,
      lastDate: lastAllowed,
    );
    if (picked == null) return;
    setState(() {
      if (isPublish) {
        _publishDate = picked;
      } else {
        _expiryDate = picked;
      }
    });
  }

  Future<void> _pickTime(bool isPublish) async {
    final initial = isPublish
        ? (_publishTime ?? TimeOfDay.now())
        : (_expiryTime ?? const TimeOfDay(hour: 23, minute: 59));
    final picked = await showTimePicker(context: context, initialTime: initial);
    if (picked == null) return;
    setState(() {
      if (isPublish) {
        _publishTime = picked;
      } else {
        _expiryTime = picked;
      }
    });
  }

  String _combineDateTime(DateTime? date, TimeOfDay? time) {
    if (date == null) return DateTime.now().toIso8601String();
    final d = date;
    final t = time ?? const TimeOfDay(hour: 0, minute: 0);
    return DateTime(d.year, d.month, d.day, t.hour, t.minute).toIso8601String();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_isEdit && _localFilePath == null && _filePath == null) {
      SnackbarUtils.showError(context, 'Please pick a file');
      return;
    }
    if (_publishDate == null || _publishTime == null) {
      SnackbarUtils.showError(context, 'Publish date and time are required');
      return;
    }
    if (_expiryDate == null || _expiryTime == null) {
      SnackbarUtils.showError(context, 'Expiry date and time are required');
      return;
    }
    // Enforce publish ≤ expiry (date-only comparison).
    if (_d(_publishDate!).isAfter(_d(_expiryDate!))) {
      SnackbarUtils.showError(
          context, 'Publish date must be on or before the expiry date');
      return;
    }
    setState(() => _saving = true);
    try {
      // Upload new file if picked.
      String? serverPath = _filePath;
      String? origName = _originalFileName;
      if (_localFilePath != null) {
        setState(() => _uploading = true);
        final uploadResp = await _api.uploadFile<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/documents/upload',
          filePath: _localFilePath!,
          fieldName: 'file',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        final uploaded = uploadResp.data ?? const {};
        serverPath =
            (uploaded['path'] ?? uploaded['filePath'])?.toString() ?? serverPath;
        origName = (uploaded['originalName'] ??
                    uploaded['originalFileName'] ??
                    _localFileName)
                ?.toString() ??
            origName;
        setState(() => _uploading = false);
      }

      final body = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'filePath': serverPath,
        'originalFileName': origName,
        'accessType': _accessType,
        'publishDateTime': _combineDateTime(_publishDate, _publishTime),
        'expiryDateTime': _combineDateTime(_expiryDate, _expiryTime),
      };

      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/documents/${widget.existing!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/documents',
          body: body,
        );
      }
      if (mounted) {
        SnackbarUtils.showSuccess(
            context, _isEdit ? 'Document updated' : 'Document added');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    } finally {
      if (mounted) setState(() { _saving = false; _uploading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Document' : 'Add Document',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
                      // File picker
                      OutlinedButton.icon(
                        onPressed: _uploading ? null : _pickFile,
                        icon: _uploading
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2),
                              )
                            : const Icon(Icons.upload_file, size: 18),
                        label: Text(
                          _localFileName ??
                              _originalFileName ??
                              'Pick File *',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Title
                      CustomTextField(
                        controller: _titleCtrl,
                        label: 'Title *',
                        hint: 'Document title',
                        maxLength: 50,
                        validator: (v) => v == null || v.trim().isEmpty
                            ? 'Title required'
                            : null,
                      ),
                      const SizedBox(height: 16),

                      // Access Type
                      Text('Access Type',
                          style: AppTextStyles.caption.copyWith(
                              fontWeight: FontWeight.w500,
                              color: AppColors.textMuted)),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: RadioListTile<String>(
                              value: 'downloadable',
                              groupValue: _accessType,
                              onChanged: (v) =>
                                  setState(() => _accessType = v ?? 'downloadable'),
                              title: const Text('Downloadable'),
                              activeColor: AppColors.primary,
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                            ),
                          ),
                          Expanded(
                            child: RadioListTile<String>(
                              value: 'view_only',
                              groupValue: _accessType,
                              onChanged: (v) =>
                                  setState(() => _accessType = v ?? 'view_only'),
                              title: const Text('View Only'),
                              activeColor: AppColors.primary,
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Publish Date + Time
                      Row(
                        children: [
                          Expanded(
                            child: _dateField(
                              label: 'Publish Date *',
                              date: _publishDate,
                              onTap: () => _pickDate(true),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _timeField(
                              label: 'Publish Time *',
                              time: _publishTime,
                              onTap: () => _pickTime(true),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      // Expiry Date + Time
                      Row(
                        children: [
                          Expanded(
                            child: _dateField(
                              label: 'Expiry Date *',
                              date: _expiryDate,
                              onTap: () => _pickDate(false),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _timeField(
                              label: 'Expiry Time *',
                              time: _expiryTime,
                              onTap: () => _pickTime(false),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),

              CustomButton(
                label: _isEdit ? 'Update' : 'Add Document',
                onPressed: _saving ? null : _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _dateField({
    required String label,
    required DateTime? date,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_today_outlined,
                size: 16, color: AppColors.textMuted),
            const SizedBox(width: 6),
            Text(
              date != null ? _dfDisplay.format(date) : 'Select',
              style: TextStyle(
                color: date != null ? AppColors.textPrimary : AppColors.textMuted,
                fontSize: 14,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _timeField({
    required String label,
    required TimeOfDay? time,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: Row(
          children: [
            const Icon(Icons.access_time, size: 16, color: AppColors.textMuted),
            const SizedBox(width: 6),
            Text(
              time != null ? _tfDisplay.format(DateTime(2000, 1, 1, time.hour, time.minute)) : 'Select',
              style: TextStyle(
                color: time != null ? AppColors.textPrimary : AppColors.textMuted,
                fontSize: 14,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail Screen — view-only display of a single document.
// Mirrors the web's `/clubs/{id}/documents/{documentId}` page: 3 numbered
// sections (Document Details with status/access badges, Dates, File with a
// View/Download button). Edit action visible only to club admins.
// ---------------------------------------------------------------------------
class _DocumentDetailScreen extends StatefulWidget {
  final int clubId;
  final _Document document;
  const _DocumentDetailScreen({required this.clubId, required this.document});

  @override
  State<_DocumentDetailScreen> createState() => _DocumentDetailScreenState();
}

class _DocumentDetailScreenState extends State<_DocumentDetailScreen> {
  late final _Document _doc = widget.document;
  bool _changed = false;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  Future<void> _edit() async {
    final d = _doc;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _DocumentFormScreen(
          clubId: widget.clubId,
          existing: d,
          onSaved: () => _changed = true,
        ),
      ),
    );
  }

  String _computeStatus(_Document d) {
    if (d.status != null && d.status!.isNotEmpty) {
      final s = d.status!.toLowerCase();
      if (s == 'published') return 'Published';
      if (s == 'expired') return 'Expired';
      if (s == 'unpublished') return 'Unpublished';
      return d.status!;
    }
    final now = DateTime.now();
    if (d.expiryDateTime != null && d.expiryDateTime!.isBefore(now)) {
      return 'Expired';
    }
    if (d.publishDateTime != null && d.publishDateTime!.isAfter(now)) {
      return 'Unpublished';
    }
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
    final status = _computeStatus(d);
    final isViewOnly = (d.accessType ?? '').toLowerCase() == 'view_only';
    final displayName =
        (d.originalFileName != null && d.originalFileName!.isNotEmpty)
            ? d.originalFileName!
            : (d.filePath != null && d.filePath!.isNotEmpty
                ? d.filePath!.split('/').last
                : 'Open document');
    final fileUrl = detailMediaUrl(d.filePath);

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
                    fileName: d.originalFileName,
                  ),
                  // View-only documents get the View button only — no Download.
                  onDownload: isViewOnly
                      ? null
                      : () => shareServerFile(
                            context,
                            filePath: d.filePath,
                            fileName: d.originalFileName,
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
