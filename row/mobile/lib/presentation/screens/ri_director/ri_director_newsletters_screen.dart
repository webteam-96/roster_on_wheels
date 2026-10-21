import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/app_router.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _NewsletterItem {
  final int id;
  final String title;
  final DateTime? publishDateTime;
  final DateTime? expiryDateTime;
  final String attachmentType;
  final String? linkUrl;
  final String? filePath;
  final bool isSendEmail;
  final String status;

  const _NewsletterItem({
    required this.id,
    required this.title,
    required this.attachmentType,
    this.publishDateTime,
    this.expiryDateTime,
    this.linkUrl,
    this.filePath,
    this.isSendEmail = false,
    this.status = 'Unpublished',
  });

  factory _NewsletterItem.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    return _NewsletterItem(
      id: j['id'] as int? ?? 0,
      title: j['title']?.toString() ?? '',
      publishDateTime: parse(j['publishDateTime']),
      expiryDateTime: parse(j['expiryDateTime']),
      attachmentType: j['attachmentType']?.toString() ?? 'link',
      linkUrl: j['linkUrl']?.toString(),
      filePath: j['filePath']?.toString(),
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      status: j['status']?.toString() ?? 'Unpublished',
    );
  }
}

const _statusOptions = ['all', 'Published', 'Expired', 'Unpublished'];

class RiDirectorNewslettersScreen extends StatefulWidget {
  const RiDirectorNewslettersScreen({super.key});

  @override
  State<RiDirectorNewslettersScreen> createState() => _RiDirectorNewslettersScreenState();
}

class _RiDirectorNewslettersScreenState extends State<RiDirectorNewslettersScreen>
    with RouteAware {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  static const _pageSize = 20;

  bool _loading = true;
  String? _error;
  List<_NewsletterItem> _items = const [];
  int _page = 1;
  int _totalCount = 0;
  int _totalPages = 1;
  String _status = 'all';
  String _search = '';

  @override
  void initState() { super.initState(); _load(); }
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Refresh when the add/edit form (or detail) pops back to this list.
    final route = ModalRoute.of(context);
    if (route is PageRoute) appRouteObserver.subscribe(this, route);
  }
  @override
  void didPopNext() { _load(); }
  @override
  void dispose() { appRouteObserver.unsubscribe(this); _searchCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    final sAt = _status;
    final qAt = _search;
    final pAt = _page;
    setState(() { _loading = true; _error = null; });
    try {
      final qp = <String, dynamic>{'page': pAt, 'pageSize': _pageSize};
      if (sAt != 'all') qp['status'] = sAt;
      if (qAt.isNotEmpty) qp['search'] = qAt;
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/newsletters',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (sAt != _status || qAt != _search || pAt != _page) return;
      final data = resp.data ?? const {};
      final raw = (data['items'] as List<dynamic>? ?? const []);
      setState(() {
        _items = raw.map((e) => _NewsletterItem.fromJson(e as Map<String, dynamic>)).toList();
        _totalCount = data['totalCount'] as int? ?? 0;
        _totalPages = _totalCount == 0 ? 1 : ((_totalCount + _pageSize - 1) ~/ _pageSize);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _openDetail(int id) async {
    final changed = await context.push<bool>(RouteNames.riDirectorNewsletterDetail(id));
    if (changed == true) _load();
  }

  Future<void> _delete(_NewsletterItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Newsletter', style: AppTextStyles.h3),
        ]),
        content: Text('Delete "${item.title}"?', style: AppTextStyles.body),
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
      await _api.delete('/api/ri-director/newsletters/${item.id}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Newsletter deleted'), backgroundColor: AppColors.success));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Future<void> _openAttachment(_NewsletterItem item) async {
    String? url;
    if (item.attachmentType.toLowerCase() == 'link') {
      url = item.linkUrl;
    } else {
      final p = item.filePath;
      if (p != null && p.isNotEmpty) url = ApiConstants.mediaUrl(p);
    }
    if (url == null || url.isEmpty) return;
    if (!url.startsWith('http')) url = 'https://$url';
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
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

  Future<void> _openAdd() async {
    // Page 1 so a newly created newsletter is visible; refresh via didPopNext().
    if (_page != 1) setState(() => _page = 1);
    await context.push<bool>(RouteNames.riDirectorNewsletterAdd);
  }

  Future<void> _openEdit(_NewsletterItem item) async {
    await context.push<bool>(RouteNames.riDirectorNewsletterEdit(item.id));
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'Published': return AppColors.success;
      case 'Expired': return AppColors.error;
      case 'Unpublished': return AppColors.warning;
      default: return AppColors.textSecondary;
    }
  }

  String _fmtDT(DateTime? d) {
    if (d == null || d.year <= 1) return '–'; // `0001-01-01` zero date => no value
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    return '$dd/$mm/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Newsletters',
        actions: [
          IconButton(icon: const Icon(Icons.add_rounded), tooltip: 'Add', onPressed: _openAdd),
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
      child: Column(children: [
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
                  child: Row(children: [
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
                  ]),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: _applySearch,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary, foregroundColor: Colors.white,
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
                key: ValueKey('ri_nl_status_$s'),
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
                  side: BorderSide(color: selected ? AppColors.primary : AppColors.border),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }

  Widget _buildList() {
    if (_loading) return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    if (_items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 80),
          EmptyStateWidget(icon: Icons.newspaper_outlined, title: 'No newsletters',
              subtitle: 'No newsletters match your filters.'),
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
        final isLink = item.attachmentType.toLowerCase() == 'link';
        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: const BorderSide(color: AppColors.border),
          ),
          color: AppColors.surface,
          child: InkWell(
            onTap: () => _openDetail(item.id),
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(isLink ? Icons.link : Icons.picture_as_pdf_outlined, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(child: Text(item.title, style: AppTextStyles.bodyMedium,
                            maxLines: 2, overflow: TextOverflow.ellipsis)),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: _statusColor(item.status).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(item.status, style: AppFonts.body(
                            fontSize: 10, color: _statusColor(item.status), fontWeight: FontWeight.w600,
                          )),
                        ),
                      ]),
                      const SizedBox(height: 4),
                      Row(children: [
                        const Icon(Icons.schedule, size: 12, color: AppColors.textSecondary),
                        const SizedBox(width: 2),
                        Expanded(
                          child: Text(
                            '${_fmtDT(item.publishDateTime)} → ${_fmtDT(item.expiryDateTime)}',
                            style: AppTextStyles.caption,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ]),
                      if (item.isSendEmail) ...[
                        const SizedBox(height: 4),
                        const _FlagChip(icon: Icons.email_outlined, label: 'Email'),
                      ],
                    ],
                  ),
                ),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
                  onSelected: (v) {
                    if (v == 'open') _openAttachment(item);
                    else if (v == 'edit') _openEdit(item);
                    else if (v == 'delete') _delete(item);
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'open', child: ListTile(
                      leading: Icon(Icons.open_in_new, size: 18),
                      title: Text('Open'), dense: true,
                    )),
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
              ]),
            ),
          ),
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
            onPressed: _page > 1 ? () { setState(() => _page -= 1); _load(); } : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Text('Page $_page of $_totalPages · $_totalCount items',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
          IconButton(
            onPressed: _page < _totalPages ? () { setState(() => _page += 1); _load(); } : null,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
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
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 12, color: AppColors.primary),
        const SizedBox(width: 4),
        Text(label, style: AppFonts.body(
          fontSize: 11, color: AppColors.primary, fontWeight: FontWeight.w600,
        )),
      ]),
    );
  }
}
