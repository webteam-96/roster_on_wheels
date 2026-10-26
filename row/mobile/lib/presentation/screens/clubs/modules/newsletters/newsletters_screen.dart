import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/file_download_utils.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/custom_text_field.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import '../../../../widgets/common/pagination_widget.dart';
import '../../../../widgets/common/rotary_year_bar.dart';
import '../../../../widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
Future<void> _launchExternal(BuildContext context, String url) async {
  if (url.isEmpty) return;
  try {
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open: $url')),
      );
    }
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Invalid URL: $url')),
      );
    }
  }
}

String? _downloadUrlFor(_Newsletter n) {
  final link = n.linkUrl;
  if (link != null && link.trim().isNotEmpty) return link.trim();
  final file = n.filePath;
  if (file != null && file.trim().isNotEmpty) {
    return '${ApiConstants.mediaBaseUrl}${file.trim()}';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Model
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
        isCurrent: _asBool(j['isCurrent'] ?? j['current']),
      );
}

class _Newsletter {
  final int id;
  final String title;
  final DateTime? publishDateTime;
  final DateTime? expiryDateTime;
  final String? attachmentType;
  final String? linkUrl;
  final String? filePath;
  final bool isSendEmail;
  final String? status;
  final int? yearId;

  const _Newsletter({
    required this.id,
    required this.title,
    this.publishDateTime,
    this.expiryDateTime,
    this.attachmentType,
    this.linkUrl,
    this.filePath,
    this.isSendEmail = false,
    this.status,
    this.yearId,
  });

  factory _Newsletter.fromJson(Map<String, dynamic> j) {
    DateTime? _parse(dynamic v) {
      final d = v == null ? null : DateTime.tryParse(v.toString());
      return (d == null || d.year <= 1) ? null : d; // `0001-01-01` => no value
    }
    return _Newsletter(
      id: j['id'] as int? ?? 0,
      title: (j['title'] ?? '').toString(),
      publishDateTime: _parse(j['publishDateTime'] ?? j['publishDate']),
      expiryDateTime: _parse(j['expiryDateTime'] ?? j['expiryDate']),
      attachmentType: (j['attachmentType'])?.toString(),
      linkUrl: (j['linkUrl'])?.toString(),
      filePath: (j['filePath'])?.toString(),
      isSendEmail: _asBool(j['isSendEmail']),
      status: (j['status'])?.toString(),
      yearId: j['yearId'] as int?,
    );
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class NewslettersScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  /// Forces read-only rendering — used by the unified flow when the viewer
  /// isn't admin of this club.
  final bool viewOnly;

  /// When set (via a push-notification deep-link), the matching newsletter's
  /// detail page is auto-opened once the list mounts.
  final int? autoOpenDetailId;
  const NewslettersScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
    this.autoOpenDetailId,
  });

  @override
  State<NewslettersScreen> createState() => _NewslettersScreenState();
}

class _NewslettersScreenState extends State<NewslettersScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');
  final _searchCtrl = TextEditingController();
  String _statusFilter = 'all';

  final List<_Newsletter> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _loadYears();
    await _fetch(reset: true);
    // Deep-link: fetch the newsletter by id and open its detail. Done after the
    // year/list load so we don't fight the initial setState.
    if (!mounted) return;
    final openId = widget.autoOpenDetailId;
    if (openId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _openDetailById(openId);
      });
    }
  }

  /// Deep-link open (from a push notification). Fetches the newsletter by id;
  /// if it's gone/invalid, falls back to the list with a brief note instead of
  /// a dead-end error.
  Future<void> _openDetailById(int id) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/newsletters/$id',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.data == null) {
        _showDeepLinkUnavailable();
        return;
      }
      final newsletter = _Newsletter.fromJson(resp.data!);
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => _NewsletterDetailScreen(
            clubId: widget.clubId,
            newsletter: newsletter,
          ),
        ),
      );
      if (mounted) _fetch(reset: true);
    } catch (_) {
      _showDeepLinkUnavailable();
    }
  }

  void _showDeepLinkUnavailable() {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This newsletter is no longer available.')),
    );
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadYears() async {
    List<_RotaryYear> years = [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/newsletters/years',
        fromJson: (j) => j as List<dynamic>,
      );
      years = (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      years = [];
    }
    if (years.isEmpty) {
      try {
        final resp = await _api.get<List<dynamic>>(
          '/api/rotary-years',
          fromJson: (j) => j as List<dynamic>,
        );
        years = (resp.data ?? [])
            .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
            .toList();
      } catch (_) {
        years = [];
      }
    }
    final current = years.firstWhere(
      (y) => y.isCurrent,
      orElse: () => years.isNotEmpty
          ? years.first
          : const _RotaryYear(id: 0, yearLabel: ''),
    );
    if (!mounted) return;
    setState(() {
      _years = years;
      _selectedYearId = current.id != 0 ? current.id : null;
    });
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final effectiveStatus = canManage ? _statusFilter : 'published';
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/newsletters',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          'yearId': _selectedYearId ?? 0,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
          if (effectiveStatus != 'all') 'status': effectiveStatus,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _Newsletter.fromJson(j));
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
      await _api.delete('/api/clubs/${widget.clubId}/newsletters/$id');
      setState(() => _items.removeWhere((n) => n.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Newsletter deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Delete failed';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _openDetail(_Newsletter item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _NewsletterDetailScreen(
          clubId: widget.clubId,
          newsletter: item,
        ),
      ),
    ).then((changed) {
      if (changed == true) _fetch(reset: true);
    });
  }

  Future<void> _showForm({_Newsletter? existing}) async {
    _Newsletter? detailed = existing;
    if (existing != null) {
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/clubs/${widget.clubId}/newsletters/${existing.id}',
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.data != null) detailed = _Newsletter.fromJson(resp.data!);
      } catch (_) {}
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _NewsletterFormScreen(
          clubId: widget.clubId,
          yearId: _selectedYearId ?? 0,
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Newsletters'),
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
                  for (final entry in [('all', 'All'), ('published', 'Published'), ('unpublished', 'Unpublished')])
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
          if (_years.isNotEmpty)
            RotaryYearBar<int>(
              value: _selectedYearId,
              options: [
                for (final y in _years)
                  RotaryYearOption(
                      value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                _fetch(reset: true);
              },
            ),
          Expanded(child: _buildListBody()),
        ],
      ),
    );
  }

  Widget _buildListBody() {
    return _loading
          ? const ShimmerList(itemCount: 6, itemHeight: 90)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
              : _items.isEmpty
                  ? EmptyStateWidget(
                      title: 'No Newsletters',
                      subtitle: canManage
                          ? 'Tap + to create a new newsletter.'
                          : 'No newsletters have been posted yet.',
                      icon: Icons.article_outlined,
                      actionLabel: canManage ? 'Add Newsletter' : null,
                      onAction: canManage ? () => _showForm() : null,
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
                              onLoadMore: () {
                                if (_page < _totalPages && !_loadingMore) { _page++; _fetch(); }
                              },
                            );
                          }
                          final item = _items[i];
                          return _NewsletterCard(
                            item: item,
                            df: _df,
                            canManage: canManage,
                            onTap: () => _openDetail(item),
                            onEdit: () => _showForm(existing: item),
                            onDelete: () async {
                              final ok = await ConfirmationDialog.show(
                                context,
                                title: 'Delete Newsletter',
                                message: 'Delete "${item.title}"?',
                              );
                              if (ok) _delete(item.id);
                            },
                            onView: () => _openDetail(item),
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
  final DateFormat df;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onView;
  final VoidCallback? onTap;

  const _NewsletterCard({
    required this.item,
    required this.df,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    required this.onView,
    this.onTap,
  });

  String get _statusLabel {
    // Status is binary server-side (Unpublished | Published); no Expired branch.
    if (item.status != null && item.status!.isNotEmpty) {
      final s = item.status!.toLowerCase();
      if (s == 'unpublished') return 'Unpublished';
      if (s == 'published') return 'Published';
      return item.status!;
    }
    final now = DateTime.now();
    if (item.publishDateTime != null && item.publishDateTime!.isAfter(now)) return 'Unpublished';
    return 'Published';
  }

  Color get _statusColor {
    switch (_statusLabel) {
      case 'Unpublished':
        return Colors.orange;
      default:
        return Colors.green;
    }
  }

  String get _typeLabel {
    if (item.attachmentType?.toLowerCase() == 'file') return 'File';
    if (item.attachmentType?.toLowerCase() == 'link') return 'Link';
    if (item.filePath != null && item.filePath!.isNotEmpty) return 'File';
    if (item.linkUrl != null && item.linkUrl!.isNotEmpty) return 'Link';
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final downloadUrl = _downloadUrlFor(item);
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
            // Header: icon + (title + chips below) + 3-dot menu.
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.article_outlined,
                      size: 20, color: AppColors.primary),
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
                          if (_typeLabel.isNotEmpty)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: (_typeLabel == 'Link'
                                        ? Colors.blue
                                        : Colors.deepPurple)
                                    .withOpacity(0.12),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                _typeLabel,
                                style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: _typeLabel == 'Link'
                                        ? Colors.blue
                                        : Colors.deepPurple),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                PopupMenuButton<String>(
                  tooltip: 'More',
                  icon: const Icon(Icons.more_vert, size: 20),
                  padding: EdgeInsets.zero,
                  onSelected: (v) {
                    switch (v) {
                      case 'open':
                        // Link → open externally; File → download bytes + open
                        // with the device's default app (browser-launch did not
                        // reliably save the file on Android 11+).
                        final link = item.linkUrl;
                        if (link != null && link.trim().isNotEmpty) {
                          _launchExternal(context, link.trim());
                        } else if (item.filePath != null &&
                            item.filePath!.trim().isNotEmpty) {
                          downloadAndOpenServerFile(
                            context,
                            filePath: item.filePath,
                          );
                        }
                        break;
                      case 'view':
                        onView();
                        break;
                      case 'edit':
                        onEdit();
                        break;
                      case 'delete':
                        onDelete();
                        break;
                    }
                  },
                  itemBuilder: (_) => [
                    if (downloadUrl != null)
                      const PopupMenuItem(
                          value: 'open', child: Text('Open / Download')),
                    const PopupMenuItem(value: 'view', child: Text('View')),
                    if (canManage)
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    if (canManage)
                      const PopupMenuItem(
                          value: 'delete', child: Text('Delete')),
                  ],
                ),
              ],
            ),
            // Publish date is intentionally NOT shown in the listing.
            if (item.linkUrl != null && item.linkUrl!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                item.linkUrl!,
                style: AppTextStyles.caption,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
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
// Detail Screen — view-only display of a single newsletter.
// Mirrors the web's `/clubs/{id}/newsletters/{newsletterId}` page: 4 numbered
// sections (Newsletter Details with status, Dates, Attachment, Notification
// Settings). Edit action visible only to club admins.
// ---------------------------------------------------------------------------
class _NewsletterDetailScreen extends StatefulWidget {
  final int clubId;
  final _Newsletter newsletter;
  const _NewsletterDetailScreen({
    required this.clubId,
    required this.newsletter,
  });

  @override
  State<_NewsletterDetailScreen> createState() =>
      _NewsletterDetailScreenState();
}

class _NewsletterDetailScreenState extends State<_NewsletterDetailScreen> {
  late final _Newsletter _newsletter = widget.newsletter;
  bool _changed = false;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  Future<void> _edit() async {
    final n = _newsletter;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _NewsletterFormScreen(
          clubId: widget.clubId,
          yearId: n.yearId ?? 0,
          existing: n,
          onSaved: () => _changed = true,
        ),
      ),
    );
  }

  String _computeStatus(_Newsletter n) {
    // Status is binary server-side (Unpublished | Published); no Expired branch.
    if (n.status != null && n.status!.isNotEmpty) {
      final s = n.status!.toLowerCase();
      if (s == 'unpublished') return 'Unpublished';
      if (s == 'published') return 'Published';
      return n.status!;
    }
    final now = DateTime.now();
    if (n.publishDateTime != null && n.publishDateTime!.isAfter(now)) {
      return 'Unpublished';
    }
    return 'Published';
  }

  bool _isLink(_Newsletter n) {
    final t = n.attachmentType?.toLowerCase();
    if (t == 'link') return true;
    if (t == 'file') return false;
    if (n.linkUrl != null && n.linkUrl!.isNotEmpty) return true;
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final n = _newsletter;
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
    final status = _computeStatus(n);
    final isLink = _isLink(n);
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
              if (isLink && n.linkUrl != null && n.linkUrl!.isNotEmpty)
                DetailLinkRow(label: 'Link', url: n.linkUrl!)
              else if (!isLink && fileUrl != null)
                DetailAttachmentTile(
                  label: (n.filePath != null && n.filePath!.isNotEmpty)
                      ? n.filePath!.split('/').last
                      : 'Open document',
                  icon: Icons.picture_as_pdf_outlined,
                  onView: () => downloadAndOpenServerFile(
                    context,
                    filePath: n.filePath,
                  ),
                  onDownload: () => shareServerFile(
                    context,
                    filePath: n.filePath,
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

// ---------------------------------------------------------------------------
// Form Sheet
// ---------------------------------------------------------------------------
class _NewsletterFormScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final _Newsletter? existing;
  final VoidCallback onSaved;

  const _NewsletterFormScreen({
    required this.clubId,
    required this.yearId,
    this.existing,
    required this.onSaved,
  });

  @override
  State<_NewsletterFormScreen> createState() => _NewsletterFormScreenState();
}

class _NewsletterFormScreenState extends State<_NewsletterFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');
  final _timeFmt = DateFormat('hh:mm a');

  final _titleCtrl = TextEditingController();
  // Repurposed as link URL until Pass 2 introduces dedicated link/file pickers.
  final _descCtrl = TextEditingController();
  DateTime? _publishDate;
  TimeOfDay? _publishTime;
  bool _isSendEmail = false;
  bool _saving = false;

  String _attachmentType = 'link'; // 'link' | 'file'
  String? _filePath;
  String? _fileName;
  bool _uploadingFile = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final e = widget.existing!;
      _titleCtrl.text = e.title;
      _descCtrl.text = e.linkUrl ?? '';
      _publishDate = e.publishDateTime;
      if (e.publishDateTime != null) {
        _publishTime = TimeOfDay.fromDateTime(e.publishDateTime!);
      }
      _isSendEmail = e.isSendEmail;
      _filePath = e.filePath;
      if (e.filePath != null && e.filePath!.isNotEmpty) {
        _attachmentType = 'file';
        _fileName = e.filePath!.split('/').last;
      } else {
        _attachmentType = (e.attachmentType == 'file') ? 'file' : 'link';
      }
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf'],
      );
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() => _uploadingFile = true);
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/newsletters/upload',
        filePath: f.path!,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      final newName = (resp.data?['fileName'] as String?) ?? f.name;
      setState(() {
        _uploadingFile = false;
        if (newPath.isNotEmpty) {
          _filePath = newPath;
          _fileName = newName;
        }
      });
    } catch (e) {
      setState(() => _uploadingFile = false);
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Upload failed';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    }
  }

  Future<void> _pickDate() async {
    final firstAllowed = DateTime(2000);
    final DateTime lastAllowed = DateTime(2100);
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

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_publishDate == null || _publishTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Publish date and time are required')),
      );
      return;
    }
    setState(() => _saving = true);

    final linkUrl = _descCtrl.text.trim();
    final filePath = _filePath ?? '';
    String? publishIso;
    if (_publishDate != null) {
      final pubTime = _publishTime ?? const TimeOfDay(hour: 0, minute: 0);
      publishIso = DateTime(
        _publishDate!.year, _publishDate!.month, _publishDate!.day,
        pubTime.hour, pubTime.minute,
      ).toIso8601String();
    }

    // Expiry was removed from the form; the backend field is non-nullable, so
    // send a far-future date — the newsletter effectively never auto-expires.
    final expiryIso = DateTime(2099, 12, 31, 23, 59).toIso8601String();

    final body = {
      'title': _titleCtrl.text.trim(),
      'attachmentType': _attachmentType,
      'linkUrl': _attachmentType == 'link' && linkUrl.isNotEmpty ? linkUrl : null,
      'filePath': _attachmentType == 'file' && filePath.isNotEmpty ? filePath : null,
      'isSendEmail': _isSendEmail,
      'publishDateTime': publishIso,
      'expiryDateTime': expiryIso,
    };

    try {
      if (_isEditing) {
        await _api.put('/api/clubs/${widget.clubId}/newsletters/${widget.existing!.id}', body: body);
      } else {
        await _api.post('/api/clubs/${widget.clubId}/newsletters', body: body);
      }
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Newsletter updated' : 'Newsletter created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        final msg = e is ApiException ? e.message : 'Save failed';
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
      backgroundColor: AppColors.surface,
      appBar: CustomAppBar(
        title: _isEditing ? 'Edit Newsletter' : 'New Newsletter',
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
                hint: 'Max 50 chars, English only',
                maxLength: 50,
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
              ),
              const SizedBox(height: 12),
              Text('Attachment', style: AppTextStyles.label),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: RadioListTile<String>(
                      value: 'link',
                      groupValue: _attachmentType,
                      onChanged: (v) => setState(() => _attachmentType = v ?? 'link'),
                      title: const Text('Link'),
                      activeColor: AppColors.primary,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                  ),
                  Expanded(
                    child: RadioListTile<String>(
                      value: 'file',
                      groupValue: _attachmentType,
                      onChanged: (v) => setState(() => _attachmentType = v ?? 'file'),
                      title: const Text('File'),
                      activeColor: AppColors.primary,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (_attachmentType == 'link')
                CustomTextField(
                  label: 'Link URL *',
                  controller: _descCtrl,
                  hint: 'https://...',
                  maxLines: 1,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Link URL is required' : null,
                )
              else
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _uploadingFile ? null : _pickFile,
                      icon: _uploadingFile
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.upload_file, size: 18),
                      label: Text(_uploadingFile
                          ? 'Uploading...'
                          : ((_filePath == null || _filePath!.isEmpty)
                              ? 'Pick PDF File'
                              : 'Replace File')),
                    ),
                    if (_filePath != null && _filePath!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.insert_drive_file_outlined,
                              size: 16, color: AppColors.textSecondary),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _fileName ?? _filePath!.split('/').last,
                              style: AppTextStyles.caption,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              const SizedBox(height: 12),
              // --- Publish Date & Time ---
              Text('Publish Date & Time *', style: AppTextStyles.label),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: _pickDate,
                      borderRadius: BorderRadius.circular(8),
                      child: InputDecorator(
                        decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                        child: Row(
                          children: [
                            const Icon(Icons.calendar_today_outlined, size: 16, color: AppColors.textSecondary),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _publishDate != null ? _displayDf.format(_publishDate!) : 'Select date',
                                style: _publishDate != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InkWell(
                      onTap: () async {
                        final picked = await showTimePicker(
                          context: context,
                          initialTime: _publishTime ?? TimeOfDay.now(),
                          builder: (ctx, child) => Theme(
                            data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
                            child: child!,
                          ),
                        );
                        if (picked != null) setState(() => _publishTime = picked);
                      },
                      borderRadius: BorderRadius.circular(8),
                      child: InputDecorator(
                        decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
                        child: Row(
                          children: [
                            const Icon(Icons.access_time, size: 16, color: AppColors.textSecondary),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _publishTime != null
                                    ? _timeFmt.format(DateTime(2000, 1, 1, _publishTime!.hour, _publishTime!.minute))
                                    : 'Select time',
                                style: _publishTime != null ? AppTextStyles.body : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                value: _isSendEmail,
                onChanged: (v) => setState(() => _isSendEmail = v),
                title: Text('Send through Email', style: AppTextStyles.body),
                activeColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
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
}
