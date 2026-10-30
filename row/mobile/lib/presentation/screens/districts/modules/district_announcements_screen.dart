import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/utils/image_crop.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/module_filter_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/pagination_widget.dart';
import '../../../widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String _absUrl(String? path) {
  return ApiConstants.mediaUrl(path);
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

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
class _Announcement {
  final int id;
  final String title;
  final String? description;
  final String? imagePath;
  final String? publishDateTime;
  final String? expiryDateTime;
  final bool isDisplayOnBanner;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String status;
  final List<String> reminders;

  const _Announcement({
    required this.id,
    required this.title,
    this.description,
    this.imagePath,
    this.publishDateTime,
    this.expiryDateTime,
    this.isDisplayOnBanner = false,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
    this.status = '',
    this.reminders = const [],
  });

  factory _Announcement.fromJson(Map<String, dynamic> j) {
    final rem = (j['reminders'] as List<dynamic>?) ?? const [];
    return _Announcement(
      id: (j['id'] as int?) ?? 0,
      title: j['title']?.toString() ?? '',
      description: j['description']?.toString(),
      imagePath: j['imagePath']?.toString(),
      publishDateTime: j['publishDateTime']?.toString() ?? j['publishDate']?.toString(),
      expiryDateTime: j['expiryDateTime']?.toString() ?? j['expiryDate']?.toString(),
      isDisplayOnBanner: j['isDisplayOnBanner'] as bool? ?? false,
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
      status: j['status']?.toString() ?? '',
      reminders: rem.map((e) => e.toString()).toList(),
    );
  }
}

class _Reminder {
  DateTime? date;
  TimeOfDay? time;
  _Reminder({this.date, this.time});
}

// ---------------------------------------------------------------------------
// List Screen
// ---------------------------------------------------------------------------
class DistrictAnnouncementsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  /// When true, forces read-only rendering regardless of the user's admin
  /// role. Set by the unified flow when the user isn't admin of this district.
  final bool viewOnly;
  const DistrictAnnouncementsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<DistrictAnnouncementsScreen> createState() =>
      _DistrictAnnouncementsScreenState();
}

class _DistrictAnnouncementsScreenState
    extends State<DistrictAnnouncementsScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  final List<_Announcement> _items = [];
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
      // Non-admin members see only Published items; admins keep the filter.
      final canManage = !widget.viewOnly &&
          Provider.of<AuthProvider>(context, listen: false)
              .isDistrictAdminOf(widget.districtId);
      final effectiveStatus = canManage ? _status : 'Published';
      if (effectiveStatus != 'All') qp['status'] = effectiveStatus;
      final q = _searchCtrl.text.trim();
      if (q.isNotEmpty) qp['search'] = q;

      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/announcements',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _Announcement.fromJson(j),
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

  Future<void> _delete(_Announcement item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Announcement'),
        content: Text('Delete "${item.title}"? This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
        '/api/districts/${widget.districtId}/announcements/${item.id}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Announcement deleted'),
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

  void _openDetail(_Announcement item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AnnouncementDetailScreen(
          districtId: widget.districtId,
          announcementId: item.id,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Future<void> _openEditor({_Announcement? existing}) async {
    _Announcement? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/districts/${widget.districtId}/announcements/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _Announcement.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AnnouncementEditorPage(
          districtId: widget.districtId,
          existing: detailed,
          onSaved: () {
            if (mounted) _fetch(reset: true);
          },
        ),
      ),
    );
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
        title: 'Announcements',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add announcement',
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
      searchHint: 'Search announcements',
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
        title: 'No announcements',
        subtitle: canManage
            ? 'Tap + to create a new announcement.'
            : 'No announcements have been posted yet.',
        icon: Icons.campaign_outlined,
        actionLabel: canManage ? 'Add Announcement' : null,
        onAction: canManage ? () => _openEditor() : null,
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _fetch(reset: true),
      child: ListView.separated(
        padding: (const EdgeInsets.fromLTRB(16, 8, 16, 16)).add(const EdgeInsets.only(bottom: 88)),
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
          return _AnnouncementCard(
            item: item,
            canManage: canManage,
            statusColor: _statusColor(item.status),
            onTap: () => _openDetail(item),
            onEdit: () => _openEditor(existing: item),
            onDelete: () => _delete(item),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _AnnouncementCard extends StatelessWidget {
  final _Announcement item;
  final bool canManage;
  final Color statusColor;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback? onTap;

  const _AnnouncementCard({
    required this.item,
    required this.canManage,
    required this.statusColor,
    required this.onEdit,
    required this.onDelete,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final img = _absUrl(item.imagePath);
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
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    width: 64,
                    height: 40,
                    color: AppColors.background,
                    child: img.isNotEmpty
                        ? Image.network(
                            img,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.broken_image_outlined,
                              size: 20,
                              color: AppColors.textSecondary,
                            ),
                          )
                        : const Icon(
                            Icons.campaign_outlined,
                            size: 20,
                            color: AppColors.textSecondary,
                          ),
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
                          if (item.isDisplayOnBanner)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: Colors.blue.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                'Banner',
                                style: AppTextStyles.caption
                                    .copyWith(color: Colors.blue),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (canManage)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20),
                    onSelected: (v) {
                      if (v == 'edit') onEdit();
                      if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Edit')),
                      PopupMenuItem(value: 'delete', child: Text('Delete')),
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
class _AnnouncementEditorPage extends StatefulWidget {
  final int districtId;
  final _Announcement? existing;
  final VoidCallback? onSaved;
  const _AnnouncementEditorPage({
    required this.districtId,
    this.existing,
    this.onSaved,
  });

  @override
  State<_AnnouncementEditorPage> createState() =>
      _AnnouncementEditorPageState();
}

class _AnnouncementEditorPageState extends State<_AnnouncementEditorPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();

  String _imagePath = '';
  bool _uploading = false;
  bool _saving = false;

  DateTime? _publishDate;
  TimeOfDay? _publishTime;
  DateTime? _expiryDate;
  TimeOfDay? _expiryTime;

  bool _isDisplayOnBanner = false;
  bool _isSendEmail = false;
  bool _isRepeatNotification = false;

  final List<_Reminder> _reminders = [];

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _titleCtrl.text = e.title;
      _descCtrl.text = e.description ?? '';
      _imagePath = e.imagePath ?? '';
      _isDisplayOnBanner = e.isDisplayOnBanner;
      _isSendEmail = e.isSendEmail;
      _isRepeatNotification = e.isRepeatNotification;

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
      for (final r in e.reminders) {
        final rd = DateTime.tryParse(r);
        if (rd != null) {
          final loc = rd.toLocal();
          _reminders.add(_Reminder(
            date: DateTime(loc.year, loc.month, loc.day),
            time: TimeOfDay(hour: loc.hour, minute: loc.minute),
          ));
        }
      }
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
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
    DateTime firstAllowed = DateTime(now.year - 1);
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

  Future<void> _pickTime(TimeOfDay? current, ValueChanged<TimeOfDay> onPicked) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: current ?? TimeOfDay.now(),
    );
    if (picked != null) onPicked(picked);
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final picked =
        await picker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 2560, maxHeight: 2560);
    if (picked == null) return;
    // Free-form crop before upload (no fixed ratio).
    final cropped = await cropImageFree(picked.path, title: 'Crop Image');
    if (cropped == null) return;
    setState(() => _uploading = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/announcements/upload',
        filePath: cropped,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      setState(() {
        _uploading = false;
        if (newPath.isNotEmpty) _imagePath = newPath;
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
    final expiryIso = _combineDateTime(_expiryDate, _expiryTime);
    if (publishIso.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Publish date and time are required')),
      );
      return;
    }
    if (expiryIso.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Expiry date and time are required')),
      );
      return;
    }
    // Enforce publish ≤ expiry (date-only).
    if (_d(_publishDate!).isAfter(_d(_expiryDate!))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Publish date must be on or before the expiry date')),
      );
      return;
    }

    final reminderIsos = <String>[];
    if (_isRepeatNotification) {
      for (final r in _reminders) {
        final iso = _combineDateTime(r.date, r.time);
        if (iso.isNotEmpty) reminderIsos.add(iso);
      }
    }

    final body = <String, dynamic>{
      'title': _titleCtrl.text.trim(),
      'description': _descCtrl.text.trim(),
      'imagePath': _imagePath.isEmpty ? null : _imagePath,
      'publishDateTime': publishIso,
      'expiryDateTime': expiryIso,
      'isDisplayOnBanner': _isDisplayOnBanner,
      'isSendEmail': _isSendEmail,
      'isRepeatNotification': _isRepeatNotification,
      'reminders': reminderIsos,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/announcements/${widget.existing!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/announcements',
          body: body,
        );
      }
      widget.onSaved?.call();
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEdit
                ? 'Announcement updated'
                : 'Announcement created'),
            backgroundColor: AppColors.success,
          ),
        );
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
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Announcement' : 'Add Announcement',
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
                        strokeWidth: 2, color: AppColors.primaryPrime),
                  )
                : Text(
                    _isEdit ? 'Update' : 'Save',
                    style: const TextStyle(
                        color: AppColors.primaryPrime, fontWeight: FontWeight.bold),
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
                hint: 'Enter announcement title',
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Title is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Description',
                controller: _descCtrl,
                hint: 'Details of the announcement',
                maxLines: 5,
                keyboardType: TextInputType.multiline,
                textInputAction: TextInputAction.newline,
              ),
              const SizedBox(height: 20),
              _sectionTitle('Image'),
              const SizedBox(height: 8),
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Container(
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: _imagePath.isNotEmpty
                      ? Image.network(
                          _absUrl(_imagePath),
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Center(
                            child: const Icon(Icons.broken_image_outlined,
                                size: 32, color: AppColors.textSecondary),
                          ),
                        )
                      : const Center(
                          child: const Icon(Icons.image_outlined,
                              size: 40, color: AppColors.textSecondary),
                        ),
                ),
              ),
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
                      : const Icon(Icons.upload, size: 18),
                  label: Text(_uploading
                      ? 'Uploading...'
                      : (_imagePath.isEmpty ? 'Pick Image' : 'Replace')),
                  onPressed: _uploading ? null : _pickImage,
                ),
              ),
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
              SwitchListTile.adaptive(
                value: _isRepeatNotification,
                onChanged: (v) => setState(() {
                  _isRepeatNotification = v;
                  if (!v) _reminders.clear();
                }),
                title: const Text('Repeat Notification'),
                activeColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              if (_isRepeatNotification) ...[
                const SizedBox(height: 8),
                ..._reminders.asMap().entries.map((entry) {
                  final idx = entry.key;
                  final r = entry.value;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: _pickerTile(
                            icon: Icons.calendar_today,
                            label: r.date == null
                                ? 'Reminder date'
                                : DateFormat('dd MMM yyyy').format(r.date!),
                            onTap: () => _pickDate(
                              r.date,
                              (d) => setState(() => r.date = d),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _pickerTile(
                            icon: Icons.access_time,
                            label: r.time == null
                                ? 'Time'
                                : r.time!.format(context),
                            onTap: () => _pickTime(
                              r.time,
                              (t) => setState(() => r.time = t),
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete_outline,
                              color: AppColors.error),
                          tooltip: 'Remove reminder',
                          onPressed: () =>
                              setState(() => _reminders.removeAt(idx)),
                        ),
                      ],
                    ),
                  );
                }),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    icon: const Icon(Icons.add),
                    label: const Text('Add Reminder'),
                    onPressed: () =>
                        setState(() => _reminders.add(_Reminder())),
                  ),
                ),
              ],
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
// Detail Screen — full-screen view-only display of a single announcement.
// Mirrors the club-side detail page: 3 numbered sections (Announcement
// Details with status + image, Dates, Display & Notification Settings).
// Edit action visible only to district admins of this district.
// ---------------------------------------------------------------------------
class _AnnouncementDetailScreen extends StatefulWidget {
  final int districtId;
  final int announcementId;
  const _AnnouncementDetailScreen({
    required this.districtId,
    required this.announcementId,
  });

  @override
  State<_AnnouncementDetailScreen> createState() =>
      _AnnouncementDetailScreenState();
}

class _AnnouncementDetailScreenState
    extends State<_AnnouncementDetailScreen> {
  final _api = ApiClient();
  _Announcement? _ann;
  bool _loading = true;
  String? _error;
  bool _changed = false;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isDistrictAdminOf(widget.districtId);

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
        '/api/districts/${widget.districtId}/announcements/${widget.announcementId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.data == null) {
        setState(() {
          _error = 'Announcement not found';
          _loading = false;
        });
        return;
      }
      setState(() {
        _ann = _Announcement.fromJson(resp.data!);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load: $e';
        _loading = false;
      });
    }
  }

  Future<void> _edit() async {
    final a = _ann;
    if (a == null) return;
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AnnouncementEditorPage(
          districtId: widget.districtId,
          existing: a,
          onSaved: () {
            _changed = true;
            if (mounted) _fetch();
          },
        ),
      ),
    );
  }

  String _statusOrComputed(_Announcement a) {
    if (a.status.isNotEmpty) return a.status;
    final pubDt = a.publishDateTime != null
        ? DateTime.tryParse(a.publishDateTime!)
        : null;
    final expDt = a.expiryDateTime != null
        ? DateTime.tryParse(a.expiryDateTime!)
        : null;
    final now = DateTime.now();
    if (expDt != null && expDt.isBefore(now)) return 'Expired';
    if (pubDt != null && pubDt.isAfter(now)) return 'Unpublished';
    return 'Published';
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async {
        Navigator.of(context).pop(_changed);
        return false;
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: CustomAppBar(
          title: 'Announcements',
          actions: [
            if (_canManage && _ann != null)
              IconButton(
                tooltip: 'Edit',
                icon: const Icon(Icons.edit_outlined),
                onPressed: _edit,
              ),
          ],
        ),
        body: _loading
            ? const LoadingWidget()
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          TextButton(
                              onPressed: _fetch, child: const Text('Retry')),
                        ],
                      ),
                    ),
                  )
                : _buildBody(_ann!),
      ),
    );
  }

  Widget _buildBody(_Announcement a) {
    final status = _statusOrComputed(a);
    final img = _absUrl(a.imagePath);

    return ListView(
      padding: (const EdgeInsets.all(16)).add(const EdgeInsets.only(bottom: 88)),
      children: [
        DetailHeader(
          title: a.title,
          imageUrl: img.isNotEmpty ? img : null,
          status: status,
          icon: Icons.campaign_outlined,
        ),
        const SizedBox(height: 16),
        if (a.description != null && a.description!.isNotEmpty)
          DetailSectionCard(
            icon: Icons.description_outlined,
            title: 'Announcement Details',
            number: 1,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DetailRow(label: 'Description', value: a.description!),
              ],
            ),
          ),
        // Publish/Expiry dates and notification settings are intentionally
        // NOT shown on the detail page.
        const SizedBox(height: 24),
      ],
    );
  }
}
