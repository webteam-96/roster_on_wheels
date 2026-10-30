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
import '../../../widgets/detail/detail_hero_layout.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String _absUrl(String? path) => ApiConstants.mediaUrl(path);

final _dtFmt = DateFormat('dd MMM yyyy, hh:mm a');

String _formatDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return '–';
  final dt = DateTime.tryParse(iso);
  if (dt == null || dt.year <= 1) return '–'; // `0001-01-01` zero date => no value
  return _dtFmt.format(dt.toLocal());
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
class _UpcomingEvent {
  final int id;
  final String title;
  final String? description;
  final String? imagePath;
  final String? eventDateTime;
  final String? eventVenue;
  final String? registrationLink;
  final String? publishDateTime;
  final String? expiryDateTime;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String status;
  final List<String> reminders;

  const _UpcomingEvent({
    required this.id,
    required this.title,
    this.description,
    this.imagePath,
    this.eventDateTime,
    this.eventVenue,
    this.registrationLink,
    this.publishDateTime,
    this.expiryDateTime,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
    this.status = '',
    this.reminders = const [],
  });

  factory _UpcomingEvent.fromJson(Map<String, dynamic> j) {
    final rem = (j['reminders'] as List<dynamic>?) ?? const [];
    return _UpcomingEvent(
      id: (j['id'] as int?) ?? 0,
      title: j['title']?.toString() ?? '',
      description: j['description']?.toString(),
      imagePath: j['imagePath']?.toString(),
      eventDateTime: j['eventDateTime']?.toString() ?? j['eventDate']?.toString(),
      eventVenue: j['eventVenue']?.toString(),
      registrationLink: j['registrationLink']?.toString(),
      publishDateTime: j['publishDateTime']?.toString() ?? j['publishDate']?.toString(),
      expiryDateTime: j['expiryDateTime']?.toString() ?? j['expiryDate']?.toString(),
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
class DistrictUpcomingEventsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  /// When true, forces read-only rendering regardless of the user's admin
  /// role. Set by the unified flow when the user isn't admin of this district.
  final bool viewOnly;
  const DistrictUpcomingEventsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<DistrictUpcomingEventsScreen> createState() =>
      _DistrictUpcomingEventsScreenState();
}

class _DistrictUpcomingEventsScreenState
    extends State<DistrictUpcomingEventsScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  final List<_UpcomingEvent> _items = [];
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
        '/api/districts/${widget.districtId}/upcoming-events',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _UpcomingEvent.fromJson(j),
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

  Future<void> _delete(_UpcomingEvent item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Event'),
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
        '/api/districts/${widget.districtId}/upcoming-events/${item.id}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Event deleted'),
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

  Future<void> _openEditor({_UpcomingEvent? existing}) async {
    _UpcomingEvent? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/districts/${widget.districtId}/upcoming-events/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _UpcomingEvent.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _UpcomingEventEditorPage(
          districtId: widget.districtId,
          existing: detailed,
        ),
      ),
    );
    if (saved == true) await _fetch(reset: true);
  }

  Future<void> _openDetail(_UpcomingEvent item) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _UpcomingEventDetailScreen(
          districtId: widget.districtId,
          eventId: item.id,
          fallback: item,
        ),
      ),
    );
    if (changed == true) await _fetch(reset: true);
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
        title: 'Upcoming Events',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add event',
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
      searchHint: 'Search events',
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
      return const ShimmerList(itemCount: 6, itemHeight: 130);
    }
    if (_error != null) {
      return ErrorStateWidget(
        message: _error!,
        onRetry: () => _fetch(reset: true),
      );
    }
    if (_items.isEmpty) {
      return EmptyStateWidget(
        title: 'No upcoming events',
        subtitle: canManage
            ? 'Tap + to create a new event.'
            : 'No upcoming events have been posted yet.',
        icon: Icons.event_outlined,
        actionLabel: canManage ? 'Add Event' : null,
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
          return _UpcomingEventCard(
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
class _UpcomingEventCard extends StatelessWidget {
  final _UpcomingEvent item;
  final bool canManage;
  final Color statusColor;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _UpcomingEventCard({
    required this.item,
    required this.canManage,
    required this.statusColor,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
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
                            Icons.event_outlined,
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
                      // Status is an admin-only signal — hidden from members.
                      if (canManage) ...[
                        const SizedBox(height: 6),
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
                      ],
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
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.event, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _formatDateTime(item.eventDateTime),
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textSecondary),
                  ),
                ),
              ],
            ),
            if (item.eventVenue != null && item.eventVenue!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.place, size: 14, color: AppColors.textSecondary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item.eventVenue!,
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
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
class _UpcomingEventEditorPage extends StatefulWidget {
  final int districtId;
  final _UpcomingEvent? existing;
  const _UpcomingEventEditorPage({
    required this.districtId,
    this.existing,
  });

  @override
  State<_UpcomingEventEditorPage> createState() =>
      _UpcomingEventEditorPageState();
}

class _UpcomingEventEditorPageState extends State<_UpcomingEventEditorPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _venueCtrl = TextEditingController();
  final _regLinkCtrl = TextEditingController();

  String _imagePath = '';
  bool _uploading = false;
  bool _saving = false;

  DateTime? _eventDate;
  TimeOfDay? _eventTime;
  DateTime? _publishDate;
  TimeOfDay? _publishTime;
  DateTime? _expiryDate;
  TimeOfDay? _expiryTime;

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
      _venueCtrl.text = e.eventVenue ?? '';
      _regLinkCtrl.text = e.registrationLink ?? '';
      _imagePath = e.imagePath ?? '';
      _isSendEmail = e.isSendEmail;
      _isRepeatNotification = e.isRepeatNotification;

      final ev = e.eventDateTime != null
          ? DateTime.tryParse(e.eventDateTime!)
          : null;
      if (ev != null) {
        final loc = ev.toLocal();
        _eventDate = DateTime(loc.year, loc.month, loc.day);
        _eventTime = TimeOfDay(hour: loc.hour, minute: loc.minute);
      }
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
    _venueCtrl.dispose();
    _regLinkCtrl.dispose();
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

    // 3-way rule: publish ≤ event ≤ expiry.
    if (kind == 'event') {
      if (_publishDate != null && _d(_publishDate!).isAfter(firstAllowed)) {
        firstAllowed = _d(_publishDate!);
      }
      if (_expiryDate != null && _d(_expiryDate!).isBefore(lastAllowed)) {
        lastAllowed = _d(_expiryDate!);
      }
    } else if (kind == 'publish') {
      if (_eventDate != null && _d(_eventDate!).isBefore(lastAllowed)) {
        lastAllowed = _d(_eventDate!);
      }
      if (_expiryDate != null && _d(_expiryDate!).isBefore(lastAllowed)) {
        lastAllowed = _d(_expiryDate!);
      }
    } else if (kind == 'expiry') {
      if (_eventDate != null && _d(_eventDate!).isAfter(firstAllowed)) {
        firstAllowed = _d(_eventDate!);
      }
      if (_publishDate != null && _d(_publishDate!).isAfter(firstAllowed)) {
        firstAllowed = _d(_publishDate!);
      }
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
        '/api/districts/${widget.districtId}/upcoming-events/upload',
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

  String? _validateUrl(String? v) {
    if (v == null || v.trim().isEmpty) return null;
    final s = v.trim();
    final uri = Uri.tryParse(s);
    if (uri == null || !uri.hasScheme || !(uri.isScheme('http') || uri.isScheme('https'))) {
      return 'Enter a valid URL (http/https)';
    }
    return null;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    final eventIso = _combineDateTime(_eventDate, _eventTime);
    final publishIso = _combineDateTime(_publishDate, _publishTime);
    final expiryIso = _combineDateTime(_expiryDate, _expiryTime);
    if (eventIso.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Event date and time are required')),
      );
      return;
    }
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
    // Enforce publish ≤ event ≤ expiry (date-only).
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

    final reminderIsos = <String>[];
    if (_isRepeatNotification) {
      for (final r in _reminders) {
        final iso = _combineDateTime(r.date, r.time);
        if (iso.isNotEmpty) reminderIsos.add(iso);
      }
    }

    final venue = _venueCtrl.text.trim();
    final regLink = _regLinkCtrl.text.trim();

    final body = <String, dynamic>{
      'title': _titleCtrl.text.trim(),
      'description': _descCtrl.text.trim(),
      'imagePath': _imagePath.isEmpty ? null : _imagePath,
      'eventDate': eventIso,
      'eventVenue': venue.isEmpty ? null : venue,
      'registrationLink': regLink.isEmpty ? null : regLink,
      'publishDate': publishIso,
      'expiryDate': expiryIso,
      'isSendEmail': _isSendEmail,
      'isRepeatNotification': _isRepeatNotification,
      'reminders': reminderIsos,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/upcoming-events/${widget.existing!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/upcoming-events',
          body: body,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
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
        title: _isEdit ? 'Edit Event' : 'Add Event',
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
                hint: 'Enter event title',
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Title is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Description',
                controller: _descCtrl,
                hint: 'Details of the event',
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
              _sectionTitle('Event Details'),
              const SizedBox(height: 8),
              _dateTimeRow(
                label: 'Event Date & Time *',
                date: _eventDate,
                time: _eventTime,
                onDate: () => _pickDate(
                  _eventDate,
                  (d) => setState(() => _eventDate = d),
                  kind: 'event',
                ),
                onTime: () => _pickTime(
                  _eventTime,
                  (t) => setState(() => _eventTime = t),
                ),
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Event Venue',
                controller: _venueCtrl,
                hint: 'Where is the event being held?',
                prefixIcon: Icons.place_outlined,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Registration Link',
                controller: _regLinkCtrl,
                hint: 'https://...',
                keyboardType: TextInputType.url,
                prefixIcon: Icons.link,
                validator: _validateUrl,
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
// Detail Page (read-only) — reference implementation for the shared detail
// toolkit (lib/presentation/widgets/detail/detail_widgets.dart).
// ---------------------------------------------------------------------------
class _UpcomingEventDetailScreen extends StatefulWidget {
  final int districtId;
  final int eventId;
  final _UpcomingEvent fallback;
  const _UpcomingEventDetailScreen({
    required this.districtId,
    required this.eventId,
    required this.fallback,
  });

  @override
  State<_UpcomingEventDetailScreen> createState() =>
      _UpcomingEventDetailScreenState();
}

class _UpcomingEventDetailScreenState
    extends State<_UpcomingEventDetailScreen> {
  final _api = ApiClient();
  final _dtFmt = DateFormat('dd MMM yyyy, hh:mm a');
  late _UpcomingEvent _event = widget.fallback; // seed so it never opens blank
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
        '/api/districts/${widget.districtId}/upcoming-events/${widget.eventId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        if (resp.data != null) _event = _UpcomingEvent.fromJson(resp.data!);
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

  String _fmt(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    final dt = DateTime.tryParse(raw);
    return dt == null ? raw : _dtFmt.format(dt.toLocal());
  }

  String _computeStatus(_UpcomingEvent e) {
    if (e.status.isNotEmpty) return e.status;
    final now = DateTime.now();
    final expiry = DateTime.tryParse(e.expiryDateTime ?? '');
    final publish = DateTime.tryParse(e.publishDateTime ?? '');
    if (expiry != null && expiry.isBefore(now)) return 'Expired';
    if (publish != null && publish.isAfter(now)) return 'Unpublished';
    return 'Published';
  }

  @override
  Widget build(BuildContext context) {
    final e = _event;
    final showLoading = _loading && e.id == 0;
    return DetailScaffold(
      title: 'Upcoming Events',
      loading: showLoading,
      error: e.id == 0 ? _error : null,
      onRetry: _fetch,
      body: (_) {
        // Status is an admin-only signal — hidden from normal members.
        final canManage = Provider.of<AuthProvider>(context, listen: false)
            .isDistrictAdminOf(widget.districtId);
        final imageUrl = detailMediaUrl(e.imagePath);
        final eventDate = _fmt(e.eventDateTime);
        final hasReg = e.registrationLink != null &&
            e.registrationLink!.trim().isNotEmpty;
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
                  DetailHeroChips(chips: [
                    if (canManage) DetailHeroStatusPill(label: _computeStatus(e)),
                    if (eventDate.isNotEmpty)
                      detailInfoChip(Icons.event_outlined, eventDate),
                    if (e.eventVenue != null && e.eventVenue!.trim().isNotEmpty)
                      detailInfoChip(
                          Icons.location_on_outlined, e.eventVenue!.trim()),
                  ]),
                  DetailHeroParagraph(text: e.description ?? ''),
                  DetailHeroInfoCard(rows: [
                    // Event date & venue live in the chips row above.
                    // Publish/Expiry and notification settings are intentionally
                    // NOT shown on the detail page.
                    if (hasReg)
                      DetailKV('Registration', e.registrationLink!.trim(),
                          url: e.registrationLink!.trim()),
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
