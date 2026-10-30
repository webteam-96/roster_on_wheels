import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/utils/image_crop.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/event_zone.dart';
import '../../../../providers/auth_provider.dart';
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
import '../../../../widgets/detail/detail_hero_layout.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _UpcomingEvent {
  final int id;
  final String title;
  final String? description;
  final DateTime? eventDate;
  final String? eventRaw; // as sent, for DateFormatter.eventDateTime
  final String? eventVenue;
  final String? imagePath;
  final DateTime? publishDate;
  final DateTime? expiryDate;
  final String? registrationLink;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String? status;
  final List<dynamic>? reminders;
  final int? yearId;

  const _UpcomingEvent({
    required this.id,
    required this.title,
    this.description,
    this.eventDate,
    this.eventRaw,
    this.eventVenue,
    this.imagePath,
    this.publishDate,
    this.expiryDate,
    this.registrationLink,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
    this.status,
    this.reminders,
    this.yearId,
  });

  factory _UpcomingEvent.fromJson(Map<String, dynamic> j) => _UpcomingEvent(
        id: j['id'] as int? ?? 0,
        title: (j['title'] ?? '').toString(),
        description: j['description']?.toString(),
        eventDate: j['eventDate'] != null
            ? DateTime.tryParse(j['eventDate'].toString())
            : null,
        eventRaw: j['eventDate']?.toString(),
        eventVenue: j['eventVenue']?.toString(),
        imagePath: j['imagePath']?.toString(),
        publishDate: j['publishDate'] != null
            ? DateTime.tryParse(j['publishDate'].toString())
            : null,
        expiryDate: j['expiryDate'] != null
            ? DateTime.tryParse(j['expiryDate'].toString())
            : null,
        registrationLink: j['registrationLink']?.toString(),
        isSendEmail: j['isSendEmail'] as bool? ?? false,
        isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
        status: j['status']?.toString(),
        reminders: j['reminders'] as List<dynamic>?,
        yearId: j['yearId'] as int?,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class UpcomingEventsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  /// Forces read-only rendering — used by the unified flow when the viewer
  /// isn't admin of this club.
  final bool viewOnly;

  /// When set (via a push-notification deep-link), the matching event's detail
  /// page is auto-opened once the list mounts.
  final int? autoOpenDetailId;
  const UpcomingEventsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
    this.autoOpenDetailId,
  });

  @override
  State<UpcomingEventsScreen> createState() => _UpcomingEventsScreenState();
}

class _UpcomingEventsScreenState extends State<UpcomingEventsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy, hh:mm a');
  final _searchCtrl = TextEditingController();
  String _statusFilter = 'all';

  final List<_UpcomingEvent> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;
  String? _zone;

  @override
  void initState() {
    super.initState();
    EventZones.club(widget.clubId).then((z) {
      if (mounted) setState(() => _zone = z);
    });
    _fetch(reset: true);
    // Deep-link: open the event's detail directly (it fetches itself by id).
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

  /// Deep-link open (from a push notification). Verifies the event still exists
  /// first, so a deleted/invalid id falls back to the list instead of a
  /// dead-end "Failed to load" detail screen.
  Future<void> _openDetailById(int id) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/upcoming-events/$id',
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
        builder: (_) => _UpcomingEventDetailScreen(
          clubId: widget.clubId,
          eventId: id,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  void _showDeepLinkUnavailable() {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This event is no longer available.')),
    );
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    // Members only ever see Published items; admins use the status filter.
    final effectiveStatus = canManage ? _statusFilter : 'published';
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/upcoming-events',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
          if (effectiveStatus != 'all') 'status': effectiveStatus,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _UpcomingEvent.fromJson(j));
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

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/clubs/${widget.clubId}/upcoming-events/$id');
      setState(() => _items.removeWhere((e) => e.id == id));
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

  void _openDetail(_UpcomingEvent item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _UpcomingEventDetailScreen(
          clubId: widget.clubId,
          eventId: item.id,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Future<void> _showForm({_UpcomingEvent? existing}) async {
    _UpcomingEvent? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/upcoming-events/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _UpcomingEvent.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _EventFormScreen(
          clubId: widget.clubId,
          existing: detailed,
          onSaved: () => _fetch(reset: true),
        ),
      ),
    );
  }

  /// Per-level gating: only club admins of THIS club can manage.
  bool get canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Upcoming Events'),
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
          Padding(
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
                            title: 'No Upcoming Events',
                            subtitle: !canManage
                                ? 'No events have been scheduled yet.'
                                : 'Tap + to create a new event.',
                            icon: Icons.event_outlined,
                            actionLabel: !canManage ? null : 'Add Event',
                            onAction: !canManage ? null : () => _showForm(),
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
                                  zone: _zone,
                                  canManage: canManage,
                                  onTap: () => _openDetail(item),
                                  onEdit: () => _showForm(existing: item),
                                  onDelete: () async {
                                    final ok = await ConfirmationDialog.show(
                                      context,
                                      title: 'Delete Event',
                                      message: 'Are you sure you want to delete ${item.title}? This action cannot be undone.',
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
class _EventCard extends StatelessWidget {
  final _UpcomingEvent item;
  final DateFormat df;
  final String? zone;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback? onTap;

  const _EventCard({
    required this.item,
    required this.df,
    this.zone,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    this.onTap,
  });

  String get _statusLabel => item.status ?? 'Published';

  Color get _statusColor {
    switch (_statusLabel.toLowerCase()) {
      case 'expired':
        return Colors.red;
      case 'unpublished':
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
              // Header: icon + (title + chip below it) + 3-dot menu.
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child:
                        const Icon(Icons.event, size: 20, color: AppColors.primary),
                  ),
                  const SizedBox(width: 12),
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
                        // Status is an admin-only signal — hidden from members.
                        if (canManage) ...[
                          const SizedBox(height: 6),
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
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: _statusColor),
                            ),
                          ),
                        ],
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
              const SizedBox(height: 8),
            Row(
              children: [
                if (item.eventDate != null) ...[
                  const Icon(Icons.calendar_today_outlined, size: 12, color: AppColors.textSecondary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text('Event: ${DateFormatter.eventDateTime(item.eventRaw, zone)}',
                        style: AppTextStyles.caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                  ),
                ],
              ],
            ),
            // Publish/Expiry dates are intentionally NOT shown in the listing.
            if (item.eventVenue != null && item.eventVenue!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.location_on_outlined, size: 12, color: AppColors.textSecondary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(item.eventVenue!, style: AppTextStyles.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                ],
              ),
            ],
          ],
        ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Form Sheet
// ---------------------------------------------------------------------------
class _EventFormScreen extends StatefulWidget {
  final int clubId;
  final _UpcomingEvent? existing;
  final VoidCallback onSaved;

  const _EventFormScreen({
    required this.clubId,
    this.existing,
    required this.onSaved,
  });

  @override
  State<_EventFormScreen> createState() => _EventFormScreenState();
}

class _EventFormScreenState extends State<_EventFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();
  final _registrationLinkCtrl = TextEditingController();
  DateTime? _eventDate;
  TimeOfDay? _eventTime;
  DateTime? _publishDate;
  TimeOfDay? _publishTime;
  DateTime? _expiryDate;
  TimeOfDay? _expiryTime;
  bool _isSendEmail = false;
  bool _isRepeatNotification = false;
  bool _saving = false;
  String? _imagePath;
  String? _localImagePath;
  bool _uploadingImage = false;

  // Reminders state
  final List<_ReminderRow> _reminders = [];

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final e = widget.existing!;
      _titleCtrl.text = e.title;
      _descCtrl.text = e.description ?? '';
      _locationCtrl.text = e.eventVenue ?? '';
      _registrationLinkCtrl.text = e.registrationLink ?? '';
      _eventDate = e.eventDate;
      if (e.eventDate != null) {
        final dt = e.eventDate!;
        if (dt.hour != 0 || dt.minute != 0) {
          _eventTime = TimeOfDay(hour: dt.hour, minute: dt.minute);
        }
      }
      _publishDate = e.publishDate;
      if (e.publishDate != null) {
        final dt = e.publishDate!;
        if (dt.hour != 0 || dt.minute != 0) {
          _publishTime = TimeOfDay(hour: dt.hour, minute: dt.minute);
        }
      }
      _expiryDate = e.expiryDate;
      if (e.expiryDate != null) {
        final dt = e.expiryDate!;
        if (dt.hour != 0 || dt.minute != 0) {
          _expiryTime = TimeOfDay(hour: dt.hour, minute: dt.minute);
        }
      }
      _imagePath = e.imagePath;
      _isSendEmail = e.isSendEmail;
      _isRepeatNotification = e.isRepeatNotification;
      // Parse existing reminders: [{id, reminderDateTime}]
      if (e.reminders != null) {
        for (final r in e.reminders!) {
          if (r is Map<String, dynamic>) {
            final dtStr = (r['reminderDateTime'] ?? '').toString();
            final dt = DateTime.tryParse(dtStr);
            if (dt != null) {
              _reminders.add(_ReminderRow(
                date: DateTime(dt.year, dt.month, dt.day),
                time: TimeOfDay(hour: dt.hour, minute: dt.minute),
              ));
            }
          }
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
        '/api/clubs/${widget.clubId}/upcoming-events/upload',
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
    _locationCtrl.dispose();
    _registrationLinkCtrl.dispose();
    super.dispose();
  }

  // Date-only (strips time component) so date-vs-date comparisons aren't
  // tripped by time-of-day differences.
  DateTime _d(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

  Future<void> _pickDate() async {
    // Event date must sit between publish and expiry (if either is set).
    final firstAllowed = _publishDate != null
        ? _d(_publishDate!)
        : DateTime.now().subtract(const Duration(days: 365));
    final lastAllowed = _expiryDate != null ? _d(_expiryDate!) : DateTime(2100);
    DateTime initial = _eventDate ?? DateTime.now();
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
    if (picked != null) setState(() => _eventDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _eventTime ?? TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _eventTime = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_eventDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Event date is required')),
      );
      return;
    }
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
    // Enforce publish ≤ event ≤ expiry (date-only comparison).
    final ev = _d(_eventDate!);
    final pub = _d(_publishDate!);
    final exp = _d(_expiryDate!);
    if (pub.isAfter(ev)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Publish date must be on or before the event date')),
      );
      return;
    }
    if (exp.isBefore(ev)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Expiry date must be on or after the event date')),
      );
      return;
    }
    setState(() => _saving = true);

    DateTime? combinedEventDate;
    if (_eventDate != null) {
      combinedEventDate = _eventTime != null
          ? DateTime(_eventDate!.year, _eventDate!.month, _eventDate!.day, _eventTime!.hour, _eventTime!.minute)
          : _eventDate;
    }

    DateTime? combinedPublishDate;
    if (_publishDate != null) {
      combinedPublishDate = _publishTime != null
          ? DateTime(_publishDate!.year, _publishDate!.month, _publishDate!.day, _publishTime!.hour, _publishTime!.minute)
          : _publishDate;
    }

    DateTime? combinedExpiryDate;
    if (_expiryDate != null) {
      combinedExpiryDate = _expiryTime != null
          ? DateTime(_expiryDate!.year, _expiryDate!.month, _expiryDate!.day, _expiryTime!.hour, _expiryTime!.minute)
          : _expiryDate;
    }

    // Build reminders list
    List<String>? remindersList;
    if (_isRepeatNotification && _reminders.isNotEmpty) {
      final valid = _reminders
          .where((r) => r.date != null && r.time != null)
          .map((r) {
        final d = r.date!;
        final t = r.time!;
        final dt = DateTime(d.year, d.month, d.day, t.hour, t.minute);
        return '${DateFormat('yyyy-MM-dd').format(dt)}T${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}:00';
      }).toList();
      if (valid.isNotEmpty) remindersList = valid;
    }

    final descText = _descCtrl.text.trim();
    final venueText = _locationCtrl.text.trim();
    final regLinkText = _registrationLinkCtrl.text.trim();

    final body = {
      'title': _titleCtrl.text.trim(),
      'description': descText.isEmpty ? null : descText,
      'imagePath': (_imagePath != null && _imagePath!.isNotEmpty) ? _imagePath : null,
      if (combinedEventDate != null) 'eventDate': combinedEventDate.toIso8601String(),
      if (combinedPublishDate != null) 'publishDate': combinedPublishDate.toIso8601String(),
      if (combinedExpiryDate != null) 'expiryDate': combinedExpiryDate.toIso8601String(),
      'eventVenue': venueText.isEmpty ? null : venueText,
      'registrationLink': regLinkText.isEmpty ? null : regLinkText,
      'isSendEmail': _isSendEmail,
      'isRepeatNotification': _isRepeatNotification,
      'reminders': remindersList,
    };

    try {
      if (_isEditing) {
        await _api.put('/api/clubs/${widget.clubId}/upcoming-events/${widget.existing!.id}', body: body);
      } else {
        await _api.post('/api/clubs/${widget.clubId}/upcoming-events', body: body);
      }
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Event updated' : 'Event created'),
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
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEditing ? 'Edit Event' : 'New Event',
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: _saving ? null : () => Navigator.pop(context),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              CustomTextField(
                label: 'Title *',
                controller: _titleCtrl,
                hint: 'Enter event title',
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
                  Expanded(child: _buildDateField()),
                  const SizedBox(width: 10),
                  Expanded(child: _buildTimeField()),
                ],
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Location',
                controller: _locationCtrl,
                hint: 'Enter location',
                prefixIcon: Icons.location_on_outlined,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Registration Link',
                controller: _registrationLinkCtrl,
                hint: 'https://www.google.com/',
                prefixIcon: Icons.link_outlined,
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildPublishDateField()),
                  const SizedBox(width: 10),
                  Expanded(child: _buildPublishTimeField()),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildExpiryDateField()),
                  const SizedBox(width: 10),
                  Expanded(child: _buildExpiryTimeField()),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
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
                              padding: const EdgeInsets.all(2),
                              decoration: const BoxDecoration(
                                color: AppColors.error,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.close, size: 14, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Text('Notification Settings', style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              SwitchListTile(
                value: _isSendEmail,
                onChanged: (v) => setState(() => _isSendEmail = v),
                title: const Text('Send through Email'),
                activeColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              SwitchListTile(
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
                          child: InkWell(
                            onTap: () async {
                              final picked = await showDatePicker(
                                context: context,
                                initialDate: r.date ?? DateTime.now(),
                                firstDate: DateTime.now(),
                                lastDate: DateTime(2100),
                              );
                              if (picked != null) setState(() => r.date = picked);
                            },
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'Date',
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                              ),
                              child: Text(
                                r.date != null ? _displayDf.format(r.date!) : 'Select',
                                style: r.date != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: InkWell(
                            onTap: () async {
                              final picked = await showTimePicker(
                                context: context,
                                initialTime: r.time ?? TimeOfDay.now(),
                              );
                              if (picked != null) setState(() => r.time = picked);
                            },
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'Time',
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                              ),
                              child: Text(
                                r.time != null ? r.time!.format(context) : 'Select',
                                style: r.time != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                              ),
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                          onPressed: () => setState(() => _reminders.removeAt(idx)),
                        ),
                      ],
                    ),
                  );
                }),
                TextButton.icon(
                  onPressed: () => setState(() => _reminders.add(_ReminderRow())),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add Reminder'),
                ),
              ],
              const SizedBox(height: 16),
              CustomButton(
                label: _isEditing ? 'Update' : 'Create',
                onPressed: _save,
                isLoading: _saving,
                fullWidth: true,
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
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
                    style: _eventDate != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

  Widget _buildTimeField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Event Time', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickTime,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.access_time_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _eventTime != null ? _eventTime!.format(context) : 'Select',
                    style: _eventTime != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

  Future<void> _pickPublishDate() async {
    // Publish must be on/before the event date (and on/before expiry if set).
    final firstAllowed = DateTime.now().subtract(const Duration(days: 365));
    DateTime lastAllowed = DateTime(2100);
    if (_eventDate != null) lastAllowed = _d(_eventDate!);
    if (_expiryDate != null && _d(_expiryDate!).isBefore(lastAllowed)) {
      lastAllowed = _d(_expiryDate!);
    }
    DateTime initial = _publishDate ?? DateTime.now();
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
    if (picked != null) setState(() => _publishDate = picked);
  }

  Future<void> _pickExpiryDate() async {
    // Expiry must be on/after the event date (and on/after publish if set).
    DateTime firstAllowed = DateTime.now().subtract(const Duration(days: 365));
    if (_eventDate != null) firstAllowed = _d(_eventDate!);
    if (_publishDate != null && _d(_publishDate!).isAfter(firstAllowed)) {
      firstAllowed = _d(_publishDate!);
    }
    final lastAllowed = DateTime(2100);
    DateTime initial = _expiryDate ?? (_eventDate ?? DateTime.now());
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
    if (picked != null) setState(() => _expiryDate = picked);
  }

  Future<void> _pickPublishTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _publishTime ?? TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _publishTime = picked);
  }

  Future<void> _pickExpiryTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _expiryTime ?? TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _expiryTime = picked);
  }

  Widget _buildPublishDateField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Publish Date *', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickPublishDate,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.publish_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _publishDate != null ? _displayDf.format(_publishDate!) : 'Select',
                    style: _publishDate != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

  Widget _buildExpiryDateField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Expiry Date *', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickExpiryDate,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.event_busy_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _expiryDate != null ? _displayDf.format(_expiryDate!) : 'Select',
                    style: _expiryDate != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

  Widget _buildPublishTimeField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Publish Time', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickPublishTime,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.access_time_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _publishTime != null ? _publishTime!.format(context) : 'Select',
                    style: _publishTime != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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

  Widget _buildExpiryTimeField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Expiry Time', style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: _pickExpiryTime,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.access_time_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _expiryTime != null ? _expiryTime!.format(context) : 'Select',
                    style: _expiryTime != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
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
// Reminder Row helper
// ---------------------------------------------------------------------------
class _ReminderRow {
  DateTime? date;
  TimeOfDay? time;
  _ReminderRow({this.date, this.time});
}

// ---------------------------------------------------------------------------
// Detail Screen — view-only display of a single upcoming event.
// Mirrors the web's `/clubs/{id}/upcoming-events/{eventId}` page: 3 numbered
// sections (Event Details with status + image, Dates & Venue, Notification
// Settings with reminders list). Edit action visible only to club admins.
// ---------------------------------------------------------------------------
class _UpcomingEventDetailScreen extends StatefulWidget {
  final int clubId;
  final int eventId;
  const _UpcomingEventDetailScreen({
    required this.clubId,
    required this.eventId,
  });

  @override
  State<_UpcomingEventDetailScreen> createState() =>
      _UpcomingEventDetailScreenState();
}

class _UpcomingEventDetailScreenState
    extends State<_UpcomingEventDetailScreen> {
  final _api = ApiClient();
  final _dtFmt = DateFormat('dd MMM yyyy, hh:mm a');
  _UpcomingEvent? _event;
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
        '/api/clubs/${widget.clubId}/upcoming-events/${widget.eventId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.data == null) {
        setState(() {
          _error = 'Event not found';
          _loading = false;
        });
        return;
      }
      setState(() {
        _event = _UpcomingEvent.fromJson(resp.data!);
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
    final e = _event;
    if (e == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _EventFormScreen(
          clubId: widget.clubId,
          existing: e,
          onSaved: () {
            _changed = true;
            _fetch();
          },
        ),
      ),
    );
  }

  String _computeStatus(_UpcomingEvent e) {
    if (e.status != null && e.status!.isNotEmpty) return e.status!;
    final now = DateTime.now();
    if (e.expiryDate != null && e.expiryDate!.isBefore(now)) return 'Expired';
    if (e.publishDate != null && e.publishDate!.isAfter(now)) {
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
          title: 'Upcoming Events',
          actions: [
            if (_canManage && _event != null)
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
                : _buildBody(_event!),
      ),
    );
  }

  Widget _buildBody(_UpcomingEvent e) {
    final status = _computeStatus(e);
    final imageUrl = detailMediaUrl(e.imagePath);

    final chips = <Widget>[
      // Status (Published/Expired/Unpublished) is an admin-only signal.
      if (_canManage) DetailHeroStatusPill(label: status),
      if (e.eventDate != null)
        detailInfoChip(
            Icons.event_outlined, _dtFmt.format(e.eventDate!.toLocal())),
      if (e.eventVenue != null && e.eventVenue!.trim().isNotEmpty)
        detailInfoChip(Icons.location_on_outlined, e.eventVenue!.trim()),
    ];

    final hasReg =
        e.registrationLink != null && e.registrationLink!.trim().isNotEmpty;
    // Event date & venue live in the chips row above. Publish/Expiry and
    // notification settings are intentionally NOT shown on the detail page.
    final rows = <DetailKV>[
      if (hasReg)
        DetailKV('Registration', e.registrationLink!.trim(),
            url: e.registrationLink!.trim()),
    ];

    return ListView(
      padding: (EdgeInsets.zero).add(const EdgeInsets.only(bottom: 88)),
      children: [
        DetailHeroGallery(urls: [if (imageUrl != null) imageUrl]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DetailHeroTitle(title: e.title),
              DetailHeroChips(chips: chips),
              DetailHeroParagraph(text: e.description ?? ''),
              DetailHeroInfoCard(rows: rows),
            ],
          ),
        ),
      ],
    );
  }
}
