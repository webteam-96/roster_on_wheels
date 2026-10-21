import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/app_router.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _EventItem {
  final int id;
  final String title;
  final String? imagePath;
  final DateTime? eventDate;
  final DateTime? publishDate;
  final DateTime? expiryDate;
  final String? eventVenue;
  final String? registrationLink;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final int reminderCount;
  final String status;

  const _EventItem({
    required this.id,
    required this.title,
    this.imagePath,
    this.eventDate,
    this.publishDate,
    this.expiryDate,
    this.eventVenue,
    this.registrationLink,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
    this.reminderCount = 0,
    this.status = 'Unpublished',
  });

  factory _EventItem.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    return _EventItem(
      id: j['id'] as int? ?? 0,
      title: j['title']?.toString() ?? '',
      imagePath: j['imagePath']?.toString(),
      eventDate: parse(j['eventDate']),
      publishDate: parse(j['publishDate']),
      expiryDate: parse(j['expiryDate']),
      eventVenue: j['eventVenue']?.toString(),
      registrationLink: j['registrationLink']?.toString(),
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
      reminderCount: j['reminderCount'] as int? ?? 0,
      status: j['status']?.toString() ?? 'Unpublished',
    );
  }
}

const _statusOptions = ['all', 'Published', 'Expired', 'Unpublished'];

class RiDirectorUpcomingEventsScreen extends StatefulWidget {
  const RiDirectorUpcomingEventsScreen({super.key});

  @override
  State<RiDirectorUpcomingEventsScreen> createState() => _RiDirectorUpcomingEventsScreenState();
}

class _RiDirectorUpcomingEventsScreenState extends State<RiDirectorUpcomingEventsScreen>
    with RouteAware {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  static const _pageSize = 20;

  bool _loading = true;
  String? _error;
  List<_EventItem> _items = const [];
  int _page = 1;
  int _totalCount = 0;
  int _totalPages = 1;

  String _status = 'all';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Refresh when the add/edit form (or detail) pops back to this list.
    final route = ModalRoute.of(context);
    if (route is PageRoute) appRouteObserver.subscribe(this, route);
  }

  @override
  void didPopNext() => _load();

  @override
  void dispose() {
    appRouteObserver.unsubscribe(this);
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final statusAtRequest = _status;
    final searchAtRequest = _search;
    final pageAtRequest = _page;
    setState(() { _loading = true; _error = null; });
    try {
      final qp = <String, dynamic>{
        'page': pageAtRequest,
        'pageSize': _pageSize,
      };
      if (statusAtRequest != 'all') qp['status'] = statusAtRequest;
      if (searchAtRequest.isNotEmpty) qp['search'] = searchAtRequest;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/upcoming-events',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (statusAtRequest != _status ||
          searchAtRequest != _search ||
          pageAtRequest != _page) return;
      final data = resp.data ?? const {};
      final raw = (data['items'] as List<dynamic>? ?? const []);
      setState(() {
        _items = raw.map((e) => _EventItem.fromJson(e as Map<String, dynamic>)).toList();
        _totalCount = data['totalCount'] as int? ?? 0;
        _totalPages = _totalCount == 0 ? 1 : ((_totalCount + _pageSize - 1) ~/ _pageSize);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _applySearch() {
    FocusScope.of(context).unfocus();
    if (_search == _searchCtrl.text.trim()) return;
    setState(() { _search = _searchCtrl.text.trim(); _page = 1; });
    _load();
  }

  void _clearSearch() {
    if (_search.isEmpty && _searchCtrl.text.isEmpty) return;
    _searchCtrl.clear();
    setState(() { _search = ''; _page = 1; });
    _load();
  }

  void _setStatus(String s) {
    if (_status == s) return;
    setState(() { _status = s; _page = 1; });
    _load();
  }

  Future<void> _openDetail(int id) async {
    final changed = await context.push<bool>(RouteNames.riDirectorUpcomingEventDetail(id));
    if (changed == true) _load();
  }

  Future<void> _deleteItem(_EventItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.error),
            const SizedBox(width: 8),
            Text('Delete Event', style: AppTextStyles.h3),
          ],
        ),
        content: Text('Are you sure you want to delete "${item.title}"?', style: AppTextStyles.body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: Colors.white),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await _api.delete('/api/ri-director/upcoming-events/${item.id}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Event deleted'), backgroundColor: AppColors.success),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _openAdd() async {
    // Page 1 so a newly created event is visible; refresh via didPopNext().
    if (_page != 1) setState(() => _page = 1);
    await context.push<bool>(RouteNames.riDirectorUpcomingEventAdd);
  }

  Future<void> _openEdit(_EventItem item) async {
    await context.push<bool>(RouteNames.riDirectorUpcomingEventEdit(item.id));
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'Published': return AppColors.success;
      case 'Expired': return AppColors.error;
      case 'Unpublished': return AppColors.warning;
      default: return AppColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Upcoming Events',
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Add Event',
            onPressed: _openAdd,
          ),
        ],
      ),
      body: Column(
        children: [
          _buildFilters(),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _load,
              child: _buildList(),
            ),
          ),
          if (_totalPages > 1) _buildPagination(),
        ],
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      color: AppColors.background,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        children: [
          SizedBox(
            height: 44,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        const Icon(Icons.search, size: 18, color: AppColors.textSecondary),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: _searchCtrl,
                            decoration: const InputDecoration(
                              hintText: 'Search by title...',
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              errorBorder: InputBorder.none,
                              disabledBorder: InputBorder.none,
                              isCollapsed: true,
                              contentPadding: EdgeInsets.zero,
                            ),
                            onChanged: (_) => setState(() {}),
                            onSubmitted: (_) => _applySearch(),
                          ),
                        ),
                        if (_searchCtrl.text.isNotEmpty)
                          GestureDetector(
                            onTap: _clearSearch,
                            child: const Padding(
                              padding: EdgeInsets.only(left: 4),
                              child: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _applySearch,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Search'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 36,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _statusOptions.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (_, i) {
                final s = _statusOptions[i];
                final selected = _status == s;
                return ChoiceChip(
                  key: ValueKey('ri_ev_status_$s'),
                  label: Text(s == 'all' ? 'All' : s),
                  selected: selected,
                  onSelected: (v) { if (v) _setStatus(s); },
                  selectedColor: AppColors.primaryLight,
                  labelStyle: AppTextStyles.caption.copyWith(
                    color: selected ? AppColors.primary : AppColors.textSecondary,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: BorderSide(
                      color: selected ? AppColors.primary : AppColors.border,
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

  Widget _buildList() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    if (_items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 80),
          EmptyStateWidget(
            icon: Icons.event_outlined,
            title: 'No events',
            subtitle: 'No events match your filters.',
          ),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: _items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final item = _items[i];
        return _EventCard(
          item: item,
          statusColor: _statusColor(item.status),
          onTap: () => _openDetail(item.id),
          onEdit: () => _openEdit(item),
          onDelete: () => _deleteItem(item),
        );
      },
    );
  }

  Widget _buildPagination() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: const Border(top: const BorderSide(color: AppColors.border)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            onPressed: _page > 1
                ? () { setState(() => _page -= 1); _load(); }
                : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Text(
            'Page $_page of $_totalPages · $_totalCount items',
            style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
          ),
          IconButton(
            onPressed: _page < _totalPages
                ? () { setState(() => _page += 1); _load(); }
                : null,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  final _EventItem item;
  final Color statusColor;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _EventCard({
    required this.item,
    required this.statusColor,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  String _formatDT(DateTime? d) {
    if (d == null || d.year <= 1) return '–'; // `0001-01-01` zero date => no value
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    final hh = d.hour.toString().padLeft(2, '0');
    final mi = d.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${d.year} $hh:$mi';
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
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item.imagePath != null && item.imagePath!.isNotEmpty)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: CachedNetworkImage(
                        imageUrl: ApiConstants.mediaUrl(item.imagePath),
                        width: 48, height: 48, fit: BoxFit.cover,
                        placeholder: (_, __) => Container(width: 48, height: 48, color: AppColors.primaryLight),
                        errorWidget: (_, __, ___) => Container(
                          width: 48, height: 48,
                          color: AppColors.surface,
                          child: const Icon(Icons.image_outlined, color: AppColors.textMuted, size: 20),
                        ),
                      ),
                    )
                  else
                    Container(
                      width: 48, height: 48,
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.event_outlined, color: AppColors.primary, size: 22),
                    ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.title, style: AppTextStyles.bodyMedium,
                            maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: statusColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            item.status,
                            style: AppFonts.body(
                              fontSize: 11,
                              color: statusColor,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
                    onSelected: (v) {
                      if (v == 'edit') onEdit();
                      else if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(value: 'edit', child: ListTile(
                        leading: Icon(Icons.edit_outlined, size: 18),
                        title: Text('Edit'), dense: true,
                      )),
                      const PopupMenuItem(value: 'delete', child: ListTile(
                        leading: Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                        title: Text('Delete', style: TextStyle(color: AppColors.error)),
                        dense: true,
                      )),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.event, size: 13, color: AppColors.primary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      'Event: ${_formatDT(item.eventDate)}',
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              if ((item.eventVenue ?? '').isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Row(
                    children: [
                      const Icon(Icons.place_outlined, size: 13, color: AppColors.textSecondary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          item.eventVenue!,
                          style: AppTextStyles.caption,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              if (item.isSendEmail || item.isRepeatNotification || (item.registrationLink ?? '').isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6, runSpacing: 4,
                  children: [
                    if ((item.registrationLink ?? '').isNotEmpty)
                      const _FlagChip(icon: Icons.link, label: 'Registration'),
                    if (item.isSendEmail)
                      const _FlagChip(icon: Icons.email_outlined, label: 'Email'),
                    if (item.isRepeatNotification)
                      _FlagChip(
                        icon: Icons.notifications_active_outlined,
                        label: 'Repeats (${item.reminderCount})',
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

class _FlagChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _FlagChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primary),
          const SizedBox(width: 4),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.primary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
