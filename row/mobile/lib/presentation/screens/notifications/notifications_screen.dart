import 'package:flutter/material.dart' hide Text;
import '../../../core/routing/route_names.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/notifications/deep_link_service.dart';
import '../../../core/notifications/notification_badge_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/theme/app_theme.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// One entry in the merged notifications feed served by
/// `GET /api/mobile/notifications`. The feed spans every club/district the
/// signed-in member belongs to and mixes six kinds of item, discriminated by
/// [type]. Each item carries a [deepLink] map (the same shape the FCM push
/// contract uses) so a tap can route straight to the real detail screen.
class _NotifItem {
  final String type; // greeting|project|announcement|event|newsletter|document
  final int id;
  final String title;
  final String? body;
  final String? imageUrl;
  final DateTime? date;
  final String scope; // club|district
  final String sourceName;
  final String? linkUrl;
  final Map<String, dynamic>? deepLink;

  const _NotifItem({
    required this.type,
    required this.id,
    required this.title,
    this.body,
    this.imageUrl,
    this.date,
    required this.scope,
    required this.sourceName,
    this.linkUrl,
    this.deepLink,
  });

  factory _NotifItem.fromJson(Map<String, dynamic> j) {
    DateTime? parseDate(dynamic raw) {
      final s = (raw ?? '').toString();
      if (s.isEmpty) return null;
      try {
        final d = DateTime.parse(s).toLocal();
        return d.year <= 1 ? null : d; // `0001-01-01` zero date => no value
      } catch (_) {
        return null;
      }
    }

    return _NotifItem(
      type: (j['type'] ?? '').toString(),
      id: (j['id'] is int) ? j['id'] as int : int.tryParse('${j['id']}') ?? 0,
      title: (j['title'] ?? '').toString(),
      body: (j['body'] as String?)?.trim().isEmpty == true
          ? null
          : j['body'] as String?,
      imageUrl: (j['imageUrl'] as String?)?.trim().isEmpty == true
          ? null
          : j['imageUrl'] as String?,
      date: parseDate(j['dateTime']),
      scope: (j['scope'] ?? '').toString(),
      sourceName: (j['sourceName'] ?? '').toString(),
      linkUrl: (j['linkUrl'] as String?)?.trim().isEmpty == true
          ? null
          : j['linkUrl'] as String?,
      deepLink: (j['deepLink'] as Map?)?.cast<String, dynamic>(),
    );
  }
}

/// Visual + query config for each notification type. The `key` is the value the
/// endpoint's `types=` filter expects.
class _TypeSpec {
  final String key;
  final String label;
  final IconData icon;
  final Color color;
  const _TypeSpec(this.key, this.label, this.icon, this.color);
}

final List<_TypeSpec> _kTypes = [
  const _TypeSpec('announcement', 'Announcements', Icons.campaign_rounded,
      AppColors.primaryPrime),
  const _TypeSpec('event', 'Events', Icons.event_rounded, Colors.orange),
  const _TypeSpec('project', 'Projects', Icons.volunteer_activism_rounded,
      Colors.green),
  const _TypeSpec('greeting', 'Greetings', Icons.celebration_rounded, Colors.pink),
  const _TypeSpec('newsletter', 'Newsletters', Icons.article_rounded, Colors.teal),
  const _TypeSpec('document', 'Documents', Icons.description_rounded, Colors.blueGrey),
  // ROW modules (2026-10-23); the feed sends these only while the module is on
  const _TypeSpec('highlight', 'Highlights', Icons.emoji_events_rounded, Colors.amber),
  const _TypeSpec('celebration', 'Celebrations', Icons.flag_rounded, Colors.amber),
  const _TypeSpec('meeting', 'Meetings', Icons.groups_rounded, Colors.indigo),
  const _TypeSpec('meeting_duty', 'Meeting duties', Icons.assignment_ind_rounded, Colors.indigo),
  const _TypeSpec('volunteer', 'Volunteering', Icons.handshake_rounded, Colors.green),
  const _TypeSpec('grant', 'Grants', Icons.savings_rounded, Colors.teal),
  const _TypeSpec('invite', 'Invites', Icons.group_add_rounded, AppColors.primaryPrime),
  const _TypeSpec('escalation', 'Follow-ups', Icons.report_rounded, Colors.redAccent),
];

/// Feed types whose tap opens one of the member's own screens.
const Map<String, String> _kTypeRoutes = {
  'volunteer': RouteNames.volunteers,
  'meeting_duty': RouteNames.myDuties,
};

_TypeSpec _specFor(String type) => _kTypes.firstWhere(
      (t) => t.key == type,
      orElse: () =>  const _TypeSpec(
          '', 'Update', Icons.notifications_rounded, AppColors.primaryPrime),
    );

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _api = ApiClient();
  final _scrollCtrl = ScrollController();

  final List<_NotifItem> _items = [];
  final Set<String> _selectedTypes = {}; // empty => all types
  static const int _pageSize = 20;

  int _page = 1;
  int _totalPages = 1;
  bool _loading = true; // first page / full reload
  bool _loadingMore = false; // appending a subsequent page
  String? _error;

  bool get _hasMore => _page < _totalPages;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _load(reset: true);
  }

  @override
  void dispose() {
    _scrollCtrl.removeListener(_onScroll);
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_hasMore || _loadingMore || _loading) return;
    if (_scrollCtrl.position.pixels >=
        _scrollCtrl.position.maxScrollExtent - 400) {
      _loadMore();
    }
  }

  /// Load page 1 (optionally clearing the list first — used on initial load,
  /// pull-to-refresh, and whenever the type filter changes).
  Future<void> _load({bool reset = false}) async {
    setState(() {
      _loading = true;
      _error = null;
      if (reset) {
        _items.clear();
        _page = 1;
        _totalPages = 1;
      }
    });
    try {
      final data = await _fetchPage(1);
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(data.$1);
        _page = 1;
        _totalPages = data.$2;
        _loading = false;
      });
      // Opening the feed marks everything seen → clears the home bell badge.
      NotificationBadgeService.instance.markAllSeen();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load notifications. Pull to retry.';
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final next = _page + 1;
      final data = await _fetchPage(next);
      if (!mounted) return;
      setState(() {
        _items.addAll(data.$1);
        _page = next;
        _totalPages = data.$2;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  /// Fetch one page → (items, totalPages).
  Future<(List<_NotifItem>, int)> _fetchPage(int page) async {
    final qp = <String, dynamic>{'page': page, 'pageSize': _pageSize};
    if (_selectedTypes.isNotEmpty) qp['types'] = _selectedTypes.join(',');

    final res = await _api.get<Map<String, dynamic>>(
      ApiConstants.mobileNotifications,
      queryParams: qp,
      fromJson: (j) => j as Map<String, dynamic>,
    );
    final items = (res.data?['items'] as List<dynamic>? ?? [])
        .map((e) => _NotifItem.fromJson(e as Map<String, dynamic>))
        .toList();
    final totalPages = (res.data?['totalPages'] as num?)?.toInt() ?? 1;
    return (items, totalPages);
  }

  void _toggleType(String key) {
    setState(() {
      if (_selectedTypes.contains(key)) {
        _selectedTypes.remove(key);
      } else {
        _selectedTypes.add(key);
      }
    });
    _load(reset: true);
  }

  // ── Tap → deep-link routing ────────────────────────────────────────────────
  // The endpoint's deepLink carries a generic `entityId`, but DeepLinkService
  // reads per-type keys (announcementId / eventId / newsletterId / projectId).
  // Fan entityId into all of them (routeForData only reads the one that matches
  // the type, so the extras are harmless), then route. If the type has no route
  // (e.g. document, or a personal greeting) fall back to an in-app detail sheet.
  void _onTap(_NotifItem item) {
    final own = _kTypeRoutes[item.type];
    if (own != null) {
      context.push(own);
      return;
    }
    final dl = item.deepLink;
    if (dl != null && (dl['type'] ?? '').toString().isNotEmpty) {
      final adapted = <String, dynamic>{...dl};
      final entityId = dl['entityId'];
      if (entityId != null) {
        adapted.putIfAbsent('announcementId', () => entityId);
        adapted.putIfAbsent('eventId', () => entityId);
        adapted.putIfAbsent('newsletterId', () => entityId);
        adapted.putIfAbsent('projectId', () => entityId);
      }
      final route = DeepLinkService.instance.routeForData(adapted);
      if (route != null) {
        context.push(route);
        return;
      }
    }
    _showDetail(item);
  }

  void _showDetail(_NotifItem item) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DetailSheet(item: item),
    );
  }

  // Group into Today / This Week / Earlier, preserving the server's newest-first
  // order within each bucket.
  Map<String, List<_NotifItem>> _grouped() {
    final now = DateTime.now();
    final todayStart = DateTime(now.year, now.month, now.day);
    final weekStart = todayStart.subtract(const Duration(days: 7));

    final today = <_NotifItem>[];
    final week = <_NotifItem>[];
    final older = <_NotifItem>[];

    for (final item in _items) {
      if (item.date == null || item.date!.isBefore(weekStart)) {
        older.add(item);
      } else if (item.date!.isBefore(todayStart)) {
        week.add(item);
      } else {
        today.add(item);
      }
    }

    return {
      if (today.isNotEmpty) 'Today': today,
      if (week.isNotEmpty) 'This Week': week,
      if (older.isNotEmpty) 'Earlier': older,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: CustomAppBar(
        title: 'Notifications',
        titleStyle:
            AppFonts.body(fontWeight: FontWeight.bold, fontSize: 22),
        actions: [
          if (!_loading)
            IconButton(
              icon: const Icon(Icons.refresh_rounded),
              tooltip: 'Refresh',
              onPressed: () => _load(reset: true),
            ),
        ],
      ),
      body: Column(
        children: [
          _FilterBar(selected: _selectedTypes, onToggle: _toggleType),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: () => _load(reset: true));
    }
    if (_items.isEmpty) {
      return EmptyStateWidget(
        title: 'All caught up!',
        subtitle: _selectedTypes.isEmpty
            ? 'Updates from your clubs and districts will appear here.'
            : 'No matching updates. Try clearing the filters.',
        icon: Icons.notifications_none_rounded,
        actionLabel: 'Refresh',
        onAction: () => _load(reset: true),
      );
    }

    final groups = _grouped();
    return RefreshIndicator(
      color: AppColors.primaryPrime,
      onRefresh: () => _load(reset: true),
      child: ListView(
        controller: _scrollCtrl,
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        children: [
          for (final entry in groups.entries) ...[
            _GroupHeader(label: entry.key),
            ...entry.value.map((item) => _NotifCard(item: item, onTap: _onTap)),
          ],
          if (_loadingMore)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.md),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          const SizedBox(height: AppSpacing.xl),
        ],
      ),
    );
  }
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────
class _FilterBar extends StatelessWidget {
  final Set<String> selected;
  final ValueChanged<String> onToggle;
  const _FilterBar({required this.selected, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.lightBg,
      padding: const EdgeInsets.only(top: 4, bottom: 8),
      child: SizedBox(
        height: 40,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          itemCount: _kTypes.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final t = _kTypes[i];
            final on = selected.contains(t.key);
            return _FilterChip(spec: t, selected: on, onTap: () => onToggle(t.key));
          },
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final _TypeSpec spec;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip(
      {required this.spec, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? spec.color.withOpacity(0.12) : AppColors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? spec.color : AppColors.lightBorder,
              width: selected ? 1.4 : 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(spec.icon,
                  size: 15,
                  color: selected ? spec.color : AppColors.textMuted),
              const SizedBox(width: 6),
              Text(
                spec.label,
                style: AppFonts.body(
                  color: selected ? spec.color : AppColors.textMuted,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Group Header ─────────────────────────────────────────────────────────────
class _GroupHeader extends StatelessWidget {
  final String label;
  const _GroupHeader({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
      child: Text(
        label,
        style: AppFonts.body(
          color: AppColors.textMuted,
          fontWeight: FontWeight.w800,
          fontSize: 13,
        ),
      ),
    );
  }
}

// ─── Notification Card ────────────────────────────────────────────────────────
class _NotifCard extends StatelessWidget {
  final _NotifItem item;
  final ValueChanged<_NotifItem> onTap;
  const _NotifCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final spec = _specFor(item.type);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder, width: 1),

      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => onTap(item),
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: spec.color.withOpacity(0.08),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(spec.icon, color: spec.color, size: 24),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.title,
                              style: AppFonts.body(
                                fontWeight: FontWeight.w800,
                                fontSize: 14,
                                color: AppColors.textPrimary,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (item.date != null)
                            Text(
                              _timeAgo(item.date!),
                              style: AppFonts.body(
                                color: AppColors.textMuted,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      if (item.body?.isNotEmpty == true)
                        Text(
                          item.body!,
                          style: AppTextStyles.caption.copyWith(height: 1.4),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      const SizedBox(height: 10),
                      _SourcePill(spec: spec, source: item.sourceName),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SourcePill extends StatelessWidget {
  final _TypeSpec spec;
  final String source;
  const _SourcePill({required this.spec, required this.source});

  @override
  Widget build(BuildContext context) {
    final label = source.trim().isEmpty ? spec.label : source;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: spec.color.withOpacity(0.06),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: AppFonts.body(
          color: spec.color,
          fontSize: 13,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

String _timeAgo(DateTime dt) {
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return '${dt.day} ${months[dt.month - 1]}';
}

// ─── Detail Bottom Sheet (fallback for types with no deep-link route) ─────────
class _DetailSheet extends StatelessWidget {
  final _NotifItem item;
  const _DetailSheet({required this.item});

  @override
  Widget build(BuildContext context) {
    final spec = _specFor(item.type);
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      minChildSize: 0.4,
      builder: (_, ctrl) => Container(
        decoration: const BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                  color: AppColors.lightBorder,
                  borderRadius: BorderRadius.circular(2)),
            ),
            const SizedBox(height: 24),
            Expanded(
              child: ListView(
                controller: ctrl,
                padding:
                    const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 20),
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: spec.color.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(spec.icon, size: 14, color: spec.color),
                        const SizedBox(width: 6),
                        Text(
                          (item.sourceName.trim().isEmpty
                                  ? spec.label
                                  : item.sourceName)
                              .toUpperCase(),
                          style: AppFonts.body(
                            color: spec.color,
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  if (item.imageUrl != null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: Image.network(
                        item.imageUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],
                  Text(
                    item.title,
                    style: AppFonts.body(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (item.date != null)
                    Row(
                      children: [
                        const Icon(Icons.access_time_rounded,
                            size: 14, color: AppColors.textMuted),
                        const SizedBox(width: 6),
                        Text(
                          _formatFull(item.date!),
                          style: AppFonts.body(
                            color: AppColors.textMuted,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 24),
                  const Divider(),
                  const SizedBox(height: 24),
                  if (item.body?.isNotEmpty == true)
                    Text(
                      item.body!,
                      style: AppFonts.body(
                        fontSize: 15,
                        color: AppColors.textPrimary,
                        height: 1.6,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  if (item.linkUrl != null) ...[
                    const SizedBox(height: 28),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: spec.color,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: const StadiumBorder(),
                        ),
                        onPressed: () => _openLink(item.linkUrl!),
                        icon: const Icon(Icons.open_in_new_rounded, size: 18),
                        label: const Text('Open'),
                      ),
                    ),
                  ],
                  const SizedBox(height: 48),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openLink(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  String _formatFull(DateTime dt) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    return '${dt.day} ${months[dt.month - 1]} ${dt.year}, $h:$m $ampm';
  }
}
