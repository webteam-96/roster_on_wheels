import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _WeblinkItem {
  final int id;
  final String title;
  final String? writeup;
  final String linkType;
  final String? linkUrl;
  final String? youtubeUrl;
  final String? buttonText;
  final bool isActive;

  const _WeblinkItem({
    required this.id,
    required this.title,
    required this.linkType,
    this.writeup,
    this.linkUrl,
    this.youtubeUrl,
    this.buttonText,
    this.isActive = true,
  });

  factory _WeblinkItem.fromJson(Map<String, dynamic> j) => _WeblinkItem(
        id: j['id'] as int? ?? 0,
        title: j['title']?.toString() ?? '',
        writeup: j['writeup']?.toString(),
        linkType: j['linkType']?.toString() ?? 'link',
        linkUrl: j['linkUrl']?.toString(),
        youtubeUrl: j['youtubeUrl']?.toString(),
        buttonText: j['buttonText']?.toString(),
        isActive: j['isActive'] as bool? ?? true,
      );

  String? get targetUrl {
    if ((youtubeUrl ?? '').isNotEmpty) return youtubeUrl;
    if ((linkUrl ?? '').isNotEmpty) return linkUrl;
    return null;
  }
}

class RiDirectorWeblinksScreen extends StatefulWidget {
  const RiDirectorWeblinksScreen({super.key});

  @override
  State<RiDirectorWeblinksScreen> createState() => _RiDirectorWeblinksScreenState();
}

class _RiDirectorWeblinksScreenState extends State<RiDirectorWeblinksScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_WeblinkItem> _items = const [];

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/ri-director/weblinks',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _items = (resp.data ?? const [])
            .map((e) => _WeblinkItem.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _openLink(_WeblinkItem item) async {
    final raw = item.targetUrl;
    if (raw == null || raw.trim().isEmpty) return;
    var url = raw.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _delete(_WeblinkItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.error),
          const SizedBox(width: 8),
          Text('Delete Link', style: AppTextStyles.h3),
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
      await _api.delete('/api/ri-director/weblinks/${item.id}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Link deleted'), backgroundColor: AppColors.success));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error));
    }
  }

  Future<void> _openAdd() async {
    final changed = await context.push<bool>(RouteNames.riDirectorWeblinkAdd);
    if (changed == true) _load();
  }

  Future<void> _openEdit(_WeblinkItem item) async {
    final changed = await context.push<bool>(RouteNames.riDirectorWeblinkEdit(item.id));
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Web Links',
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Add Link',
            onPressed: _openAdd,
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _load,
        child: _loading
            ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
            : _error != null
                ? ErrorStateWidget(message: _error!, onRetry: _load)
                : _items.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: const [
                          SizedBox(height: 80),
                          EmptyStateWidget(
                            icon: Icons.link_off,
                            title: 'No web links',
                            subtitle: 'No links have been added yet.',
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        physics: const AlwaysScrollableScrollPhysics(),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (_, i) {
                          final item = _items[i];
                          final hasUrl = item.targetUrl != null;
                          return Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: const BorderSide(color: AppColors.border),
                            ),
                            color: AppColors.surface,
                            child: InkWell(
                              onTap: hasUrl ? () => _openLink(item) : null,
                              borderRadius: BorderRadius.circular(10),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Container(
                                      width: 40, height: 40,
                                      decoration: BoxDecoration(
                                        color: AppColors.primaryLight,
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Icon(
                                        item.linkType.toLowerCase() == 'youtube'
                                            ? Icons.play_circle_outline
                                            : Icons.link,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(children: [
                                            Expanded(child: Text(item.title, style: AppTextStyles.bodyMedium,
                                                maxLines: 2, overflow: TextOverflow.ellipsis)),
                                            if (!item.isActive)
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: AppColors.textMuted.withValues(alpha: 0.12),
                                                  borderRadius: BorderRadius.circular(8),
                                                ),
                                                child: Text('Inactive', style: AppFonts.body(
                                                  fontSize: 10, color: AppColors.textMuted,
                                                  fontWeight: FontWeight.w600,
                                                )),
                                              ),
                                          ]),
                                          if ((item.writeup ?? '').isNotEmpty) ...[
                                            const SizedBox(height: 4),
                                            Text(item.writeup!, style: AppTextStyles.caption,
                                                maxLines: 2, overflow: TextOverflow.ellipsis),
                                          ],
                                          if (hasUrl) ...[
                                            const SizedBox(height: 4),
                                            Text(item.targetUrl!, style: AppTextStyles.caption.copyWith(
                                              color: AppColors.primary,
                                              decoration: TextDecoration.underline,
                                            ), maxLines: 1, overflow: TextOverflow.ellipsis),
                                          ],
                                        ],
                                      ),
                                    ),
                                    PopupMenuButton<String>(
                                      icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
                                      onSelected: (v) {
                                        if (v == 'edit') _openEdit(item);
                                        else if (v == 'delete') _delete(item);
                                        else if (v == 'open') _openLink(item);
                                      },
                                      itemBuilder: (_) => [
                                        if (hasUrl)
                                          const PopupMenuItem(value: 'open', child: ListTile(
                                            leading: Icon(Icons.open_in_new, size: 18),
                                            title: Text('Open'),
                                            dense: true,
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
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}
