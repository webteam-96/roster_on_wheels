import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/utils/image_crop.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/custom_text_field.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/pagination_widget.dart';
import '../../../../widgets/detail/detail_widgets.dart';
import '../../../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Announcement {
  final int id;
  final String title;
  final String? description;
  final DateTime? publishDateTime;
  final DateTime? expiryDateTime;
  final bool isDisplayOnBanner;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String? status;
  final List<String> reminders;
  final String? imagePath;

  const _Announcement({
    required this.id,
    required this.title,
    this.description,
    this.publishDateTime,
    this.expiryDateTime,
    this.isDisplayOnBanner = false,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
    this.status,
    this.reminders = const [],
    this.imagePath,
  });

  factory _Announcement.fromJson(Map<String, dynamic> j) {
    DateTime? _parseDt(dynamic v) {
      final d = v == null ? null : DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }
    List<String> _parseReminders(dynamic v) {
      if (v is List) {
        return v.map((e) {
          if (e is Map) return (e['reminderDateTime'] ?? e.values.first)?.toString() ?? '';
          return e.toString();
        }).where((s) => s.isNotEmpty).toList();
      }
      return [];
    }
    return _Announcement(
      id: (j['id'] as num?)?.toInt() ?? 0,
      title: (j['title'] ?? '').toString(),
      description: j['description']?.toString(),
      publishDateTime: _parseDt(j['publishDateTime'] ?? j['publishDate']),
      expiryDateTime: _parseDt(j['expiryDateTime'] ?? j['expiryDate']),
      isDisplayOnBanner: (j['isDisplayOnBanner'] ?? j['isFeatured']) as bool? ?? false,
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
      status: j['status']?.toString(),
      reminders: _parseReminders(j['reminders']),
      imagePath: j['imagePath']?.toString(),
    );
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class AnnouncementsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  /// Forces read-only rendering — used by the unified flow when the
  /// viewer isn't admin of this club. Defaults to false so the normal
  /// per-scope route is unaffected.
  final bool viewOnly;

  /// When set (via a push-notification deep-link), the matching announcement's
  /// detail page is auto-opened once the list mounts.
  final int? autoOpenDetailId;
  const AnnouncementsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
    this.autoOpenDetailId,
  });

  @override
  State<AnnouncementsScreen> createState() => _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends State<AnnouncementsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy, hh:mm a');
  final _searchCtrl = TextEditingController();
  String _statusFilter = 'all';

  final List<_Announcement> _items = [];
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
    // Deep-link: open the announcement's detail directly (it fetches itself by
    // id, so no need to wait for the list load).
    final openId = widget.autoOpenDetailId;
    if (openId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _openDetailById(openId);
      });
    }
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Deep-link open (from a push notification). Verifies the announcement still
  /// exists first, so a deleted/invalid id falls back to the list instead of a
  /// dead-end "Failed to load" detail screen.
  Future<void> _openDetailById(int id) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/announcements/$id',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.data == null) {
        _showDeepLinkUnavailable();
        return;
      }
    } catch (_) {
      _showDeepLinkUnavailable();
      return;
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AnnouncementDetailScreen(
          clubId: widget.clubId,
          announcementId: id,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  void _showDeepLinkUnavailable() {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This announcement is no longer available.')),
    );
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final canManage =
          !widget.viewOnly && context.read<AuthProvider>().isClubAdminOf(widget.clubId);
      final effectiveStatus = canManage ? _statusFilter : 'published';
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/announcements',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
          if (effectiveStatus != 'all') 'status': effectiveStatus,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Announcement.fromJson(j));
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; _loadingMore = false; });
    }
  }

  // Removed _toggleActive: backend announcements have no isActive field.

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/clubs/${widget.clubId}/announcements/$id');
      setState(() => _items.removeWhere((a) => a.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Announcement deleted'), backgroundColor: AppColors.success),
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

  void _openDetail(_Announcement item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AnnouncementDetailScreen(
          clubId: widget.clubId,
          announcementId: item.id,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Future<void> _showForm({_Announcement? existing}) async {
    // For edit, fetch full detail so the form pre-fills fields the list
    // endpoint may omit (image, reminders, etc.).
    _Announcement? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/announcements/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _Announcement.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AnnouncementFormScreen(
          clubId: widget.clubId,
          existing: detailed,
          onSaved: () => _fetch(reset: true),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Per-level gating: only club admins of THIS club can manage.
    final canManage =
        !widget.viewOnly && auth.isClubAdminOf(widget.clubId);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Announcements'),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _showForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search by title\u2026',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(icon: const Icon(Icons.close, size: 18),
                        onPressed: () { _searchCtrl.clear(); _fetch(reset: true); })
                    : null,
              ),
              onSubmitted: (_) => _fetch(reset: true),
              onChanged: (_) => setState(() {}),
            ),
          ),
          // Status filter is admin-only; members see the Published list only.
          if (canManage)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Row(
                children: [
                  for (final entry in [('all', 'All'), ('published', 'Published'), ('expired', 'Expired')])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(entry.$2),
                        selected: _statusFilter == entry.$1,
                        onSelected: (_) {
                          setState(() => _statusFilter = entry.$1);
                          _fetch(reset: true);
                        },
                        selectedColor: AppColors.primaryLight,
                        labelStyle: TextStyle(
                          color: _statusFilter == entry.$1 ? AppColors.primary : AppColors.textSecondary,
                          fontWeight: _statusFilter == entry.$1 ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 6, itemHeight: 100)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
                    : _items.isEmpty
                        ? EmptyStateWidget(
                            title: 'No Announcements',
                            subtitle: !canManage
                                ? 'No announcements have been posted yet.'
                                : 'Tap + to create a new announcement.',
                            icon: Icons.campaign_outlined,
                            actionLabel: !canManage ? null : 'Add Announcement',
                            onAction: !canManage ? null : () => _showForm(),
                          )
                        : RefreshIndicator(
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
                                    onLoadMore: () { if (_page < _totalPages && !_loadingMore) { _page++; _fetch(); } },
                                  );
                                }
                                final item = _items[i];
                                return _AnnouncementCard(
                                  item: item,
                                  df: _df,
                                  canManage: canManage,
                                  onTap: () => _openDetail(item),
                                  onEdit: () => _showForm(existing: item),
                                  onDelete: () async {
                                    final ok = await ConfirmationDialog.show(
                                      context,
                                      title: 'Delete Announcement',
                                      message: 'Delete "${item.title}"?',
                                    );
                                    if (ok) _delete(item.id);
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
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _AnnouncementCard extends StatelessWidget {
  final _Announcement item;
  final DateFormat df;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback? onTap;

  const _AnnouncementCard({
    required this.item,
    required this.df,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    this.onTap,
  });

  String get _statusLabel {
    if (item.status != null && item.status!.isNotEmpty) {
      // Capitalize first letter from server status
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
              // Header: thumbnail/icon + (title + chips below) + 3-dot menu.
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item.imagePath != null && item.imagePath!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(right: 10),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: Image.network(
                          item.imagePath!.startsWith('http')
                              ? item.imagePath!
                              : '${ApiConstants.baseUrl}${item.imagePath!.startsWith('/') ? '' : '/'}${item.imagePath!}',
                          width: 40,
                          height: 40,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              const SizedBox.shrink(),
                        ),
                      ),
                    ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.title,
                          style: AppTextStyles.bodyMedium,
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
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: _statusColor.withOpacity(0.12),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                _statusLabel,
                                style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: _statusColor),
                              ),
                            ),
                            if (item.isDisplayOnBanner)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                    color: Colors.blue.withOpacity(0.12),
                                    borderRadius: BorderRadius.circular(12)),
                                child: Text('Banner',
                                    style: AppTextStyles.caption.copyWith(
                                        color: Colors.blue.shade700,
                                        fontWeight: FontWeight.w600)),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (canManage)
                    PopupMenuButton<String>(
                      tooltip: 'More',
                      icon: const Icon(Icons.more_vert, size: 20),
                      padding: EdgeInsets.zero,
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
// Form Bottom Sheet
// ---------------------------------------------------------------------------
class _AnnouncementFormScreen extends StatefulWidget {
  final int clubId;
  final _Announcement? existing;
  final VoidCallback onSaved;

  const _AnnouncementFormScreen({
    required this.clubId,
    this.existing,
    required this.onSaved,
  });

  @override
  State<_AnnouncementFormScreen> createState() => _AnnouncementFormScreenState();
}

class _AnnouncementFormScreenState extends State<_AnnouncementFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  DateTime? _publishDate;
  DateTime? _expiryDate;
  TimeOfDay? _publishTime;
  TimeOfDay? _expiryTime;
  bool _isFeatured = false;
  bool _isSendEmail = false;
  bool _isRepeatNotification = false;
  final List<Map<String, dynamic>> _reminders = []; // each: {date: DateTime?, time: TimeOfDay?}
  bool _saving = false;
  String? _imagePath;
  String? _localImagePath;
  bool _uploadingImage = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final e = widget.existing!;
      _titleCtrl.text = e.title;
      _descCtrl.text = e.description ?? '';
      _publishDate = e.publishDateTime;
      _expiryDate = e.expiryDateTime;
      if (e.publishDateTime != null) {
        _publishTime = TimeOfDay.fromDateTime(e.publishDateTime!);
      }
      if (e.expiryDateTime != null) {
        _expiryTime = TimeOfDay.fromDateTime(e.expiryDateTime!);
      }
      _isFeatured = e.isDisplayOnBanner;
      _isSendEmail = e.isSendEmail;
      _isRepeatNotification = e.isRepeatNotification;
      _imagePath = e.imagePath;
      // Parse existing reminders
      for (final r in e.reminders) {
        final dt = DateTime.tryParse(r);
        if (dt != null) {
          _reminders.add({'date': dt, 'time': TimeOfDay.fromDateTime(dt)});
        }
      }
    }
  }

  Future<void> _pickImage() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      // Free-form crop before upload (no fixed ratio).
      final cropped = await cropImageFree(picked.path, title: 'Crop Image');
      if (cropped == null) return;
      setState(() => _uploadingImage = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/announcements/upload',
        filePath: cropped,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      setState(() {
        _uploadingImage = false;
        if (newPath.isNotEmpty) {
          _imagePath = newPath;
          _localImagePath = cropped;
        }
      });
    } catch (e) {
      setState(() => _uploadingImage = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Upload failed: $e'), backgroundColor: AppColors.error),
        );
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

  Future<void> _pickDate(bool isPublish) async {
    // Clamp: publish ≤ expiry. When picking publish, lastDate = expiry (if set).
    // When picking expiry, firstDate = publish (if set).
    DateTime firstAllowed = DateTime(2000);
    DateTime lastAllowed = DateTime(2100);
    if (isPublish && _expiryDate != null) lastAllowed = _d(_expiryDate!);
    if (!isPublish && _publishDate != null) firstAllowed = _d(_publishDate!);
    DateTime initial =
        (isPublish ? _publishDate : _expiryDate) ?? DateTime.now();
    if (initial.isBefore(firstAllowed)) initial = firstAllowed;
    if (initial.isAfter(lastAllowed)) initial = lastAllowed;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: firstAllowed,
      lastDate: lastAllowed,
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(() {
        if (isPublish) _publishDate = picked; else _expiryDate = picked;
      });
    }
  }

  Future<void> _pickTime(bool isPublish) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: (isPublish ? _publishTime : _expiryTime) ?? TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(() {
        if (isPublish) _publishTime = picked; else _expiryTime = picked;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_publishDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Publish date is required')),
      );
      return;
    }
    if (_expiryDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Expiry date is required')),
      );
      return;
    }
    // Enforce publish ≤ expiry (date-only comparison).
    if (_d(_publishDate!).isAfter(_d(_expiryDate!))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Publish date must be on or before the expiry date')),
      );
      return;
    }
    setState(() => _saving = true);

    String? combineDateTimeIso(DateTime? date, TimeOfDay? time) {
      if (date == null) return null;
      final t = time ?? const TimeOfDay(hour: 0, minute: 0);
      return DateTime(date.year, date.month, date.day, t.hour, t.minute).toIso8601String();
    }

    // Build reminders list
    List<String>? remindersList;
    if (_isRepeatNotification && _reminders.isNotEmpty) {
      remindersList = _reminders.map((r) {
        final d = r['date'] as DateTime?;
        final t = r['time'] as TimeOfDay?;
        if (d == null) return '';
        final tt = t ?? const TimeOfDay(hour: 0, minute: 0);
        return DateTime(d.year, d.month, d.day, tt.hour, tt.minute)
            .toIso8601String();
      }).where((s) => s.isNotEmpty).toList();
    }

    final descText = _descCtrl.text.trim();
    final body = {
      'title': _titleCtrl.text.trim(),
      'description': descText.isEmpty ? null : descText,
      'isDisplayOnBanner': _isFeatured,
      'isSendEmail': _isSendEmail,
      'isRepeatNotification': _isRepeatNotification,
      'reminders': _isRepeatNotification ? (remindersList ?? []) : null,
      'imagePath': _imagePath,
      if (_publishDate != null)
        'publishDateTime': combineDateTimeIso(_publishDate, _publishTime),
      if (_expiryDate != null)
        'expiryDateTime': combineDateTimeIso(_expiryDate, _expiryTime),
    };

    try {
      if (_isEditing) {
        await _api.put('/api/clubs/${widget.clubId}/announcements/${widget.existing!.id}', body: body);
      } else {
        await _api.post('/api/clubs/${widget.clubId}/announcements', body: body);
      }
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Announcement updated' : 'Announcement created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e'), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: CustomAppBar(
        title: _isEditing ? 'Edit Announcement' : 'New Announcement',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CustomTextField(
                label: 'Title *',
                controller: _titleCtrl,
                hint: 'Enter announcement title',
                maxLength: 50,
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Description',
                controller: _descCtrl,
                hint: 'Enter description',
                maxLines: 4,
                maxLength: 1000,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildDateRow('Publish Date *', _publishDate, () => _pickDate(true))),
                  const SizedBox(width: 10),
                  Expanded(child: _buildTimeRow('Publish Time', _publishTime, () => _pickTime(true))),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildDateRow('Expiry Date *', _expiryDate, () => _pickDate(false))),
                  const SizedBox(width: 10),
                  Expanded(child: _buildTimeRow('Expiry Time', _expiryTime, () => _pickTime(false))),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: _uploadingImage ? null : _pickImage,
                    icon: _uploadingImage
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.image_outlined, size: 18),
                    label: Text(_uploadingImage
                        ? 'Uploading...'
                        : ((_imagePath == null || _imagePath!.isEmpty)
                            ? 'Pick Image'
                            : 'Replace')),
                  ),
                  const SizedBox(width: 12),
                  if (_imagePath != null && _imagePath!.isNotEmpty)
                    Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(6),
                          child: _localImagePath != null
                              ? Image.file(
                                  File(_localImagePath!),
                                  width: 80,
                                  height: 80,
                                  fit: BoxFit.cover,
                                )
                              : Image.network(
                                  _imagePath!.startsWith('http')
                                      ? _imagePath!
                                      : '${ApiConstants.baseUrl}${_imagePath!.startsWith('/') ? '' : '/'}$_imagePath',
                                  width: 80,
                                  height: 80,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Container(
                                    width: 80,
                                    height: 80,
                                    color: AppColors.muted,
                                    child: const Icon(Icons.broken_image_outlined),
                                  ),
                                ),
                        ),
                        Positioned(
                          top: 0,
                          right: 0,
                          child: GestureDetector(
                            onTap: () => setState(() {
                              _imagePath = null;
                              _localImagePath = null;
                            }),
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.black54,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              padding: const EdgeInsets.all(2),
                              child: const Icon(Icons.close, size: 14, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                value: _isSendEmail,
                onChanged: (v) => setState(() => _isSendEmail = v),
                title: Text('Send through Email', style: AppTextStyles.bodyMedium),
                activeTrackColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              // "Display on Banner" toggle hidden to match the web console
              // (kept in DB/payload for future use — `_isFeatured` stays false).
              CheckboxListTile(
                value: _isRepeatNotification,
                onChanged: (v) {
                  setState(() {
                    _isRepeatNotification = v ?? false;
                    if (!_isRepeatNotification) _reminders.clear();
                  });
                },
                title: Text('Do you want to Repeat Notification?', style: AppTextStyles.bodyMedium),
                activeColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
              ),
              if (_isRepeatNotification) ...[
                const SizedBox(height: 8),
                ..._reminders.asMap().entries.map((entry) {
                  final idx = entry.key;
                  final reminder = entry.value;
                  final rDate = reminder['date'] as DateTime?;
                  final rTime = reminder['time'] as TimeOfDay?;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Expanded(child: _buildDateRow(
                          'Reminder ${idx + 1} Date',
                          rDate,
                          () async {
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: rDate ?? DateTime.now(),
                              firstDate: DateTime(2000),
                              lastDate: DateTime(2100),
                            );
                            if (picked != null) setState(() => _reminders[idx]['date'] = picked);
                          },
                        )),
                        const SizedBox(width: 8),
                        Expanded(child: _buildTimeRow(
                          'Time',
                          rTime,
                          () async {
                            final picked = await showTimePicker(
                              context: context,
                              initialTime: rTime ?? TimeOfDay.now(),
                            );
                            if (picked != null) setState(() => _reminders[idx]['time'] = picked);
                          },
                        )),
                        IconButton(
                          icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                          onPressed: () => setState(() => _reminders.removeAt(idx)),
                          constraints: const BoxConstraints(),
                          padding: const EdgeInsets.all(4),
                        ),
                      ],
                    ),
                  );
                }),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setState(() => _reminders.add({'date': null, 'time': null})),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add Reminder'),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              CustomButton(
                label: _isEditing ? 'Update' : 'Create',
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

  Widget _buildDateRow(String label, DateTime? date, VoidCallback onTap) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.calendar_today_outlined, size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    date != null ? _displayDf.format(date) : 'Select date',
                    style: date != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

  Widget _buildTimeRow(String label, TimeOfDay? time, VoidCallback onTap) {
    String formatTime(TimeOfDay t) {
      final h = t.hourOfPeriod == 0 ? 12 : t.hourOfPeriod;
      final m = t.minute.toString().padLeft(2, '0');
      final p = t.period == DayPeriod.am ? 'AM' : 'PM';
      return '$h:$m $p';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.access_time_outlined, size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    time != null ? formatTime(time) : 'Select time',
                    style: time != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

// ---------------------------------------------------------------------------
// Detail Screen — view-only display of a single announcement.
// Mirrors the web's `/clubs/{id}/announcements/{announcementId}` page:
// 3 numbered sections (Announcement Details with status + image, Dates,
// Display & Notification Settings). Edit action visible only to club admins.
// ---------------------------------------------------------------------------
class _AnnouncementDetailScreen extends StatefulWidget {
  final int clubId;
  final int announcementId;
  const _AnnouncementDetailScreen({
    required this.clubId,
    required this.announcementId,
  });

  @override
  State<_AnnouncementDetailScreen> createState() =>
      _AnnouncementDetailScreenState();
}

class _AnnouncementDetailScreenState
    extends State<_AnnouncementDetailScreen> {
  final _api = ApiClient();
  _Announcement? _announcement;
  bool _loading = true;
  String? _error;
  bool _changed = false;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

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
        '/api/clubs/${widget.clubId}/announcements/${widget.announcementId}',
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
        _announcement = _Announcement.fromJson(resp.data!);
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
    final a = _announcement;
    if (a == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AnnouncementFormScreen(
          clubId: widget.clubId,
          existing: a,
          onSaved: () {
            _changed = true;
            _fetch();
          },
        ),
      ),
    );
  }

  String _computeStatus(_Announcement a) {
    if (a.status != null && a.status!.isNotEmpty) {
      final s = a.status!.toLowerCase();
      if (s == 'published') return 'Published';
      if (s == 'expired') return 'Expired';
      if (s == 'unpublished') return 'Unpublished';
      return a.status!;
    }
    final now = DateTime.now();
    if (a.expiryDateTime != null && a.expiryDateTime!.isBefore(now)) {
      return 'Expired';
    }
    if (a.publishDateTime != null && a.publishDateTime!.isAfter(now)) {
      return 'Unpublished';
    }
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
            if (_canManage && _announcement != null)
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
                : _buildBody(_announcement!),
      ),
    );
  }

  Widget _buildBody(_Announcement a) {
    final status = _computeStatus(a);
    final imageUrl = detailMediaUrl(a.imagePath);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DetailHeader(
          title: a.title,
          imageUrl: imageUrl,
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
