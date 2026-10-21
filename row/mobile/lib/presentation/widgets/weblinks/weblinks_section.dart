import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/weblink.dart';
import '../common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

const Color _kWebAccent = AppColors.chart5;

/// Fetches the active weblinks for a mobile endpoint (optionally under a parent),
/// already filtered to active + sorted by sortOrder.
Future<List<Weblink>> fetchWeblinks(ApiClient api, String endpoint,
    {int? parentId}) async {
  final resp = await api.get<dynamic>(
    endpoint,
    queryParams: parentId != null ? {'parentId': parentId} : null,
    fromJson: (j) => j,
  );
  final raw = resp.data;
  final list = raw is List
      ? raw
      : (raw is Map ? (raw['items'] as List? ?? const []) : const []);
  final parsed = list
      .whereType<Map>()
      .map((e) => Weblink.fromJson(e.cast<String, dynamic>()))
      .where((w) => w.isActive)
      .toList()
    ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  return parsed;
}

/// Opens a weblink: container nodes drill into a read-only viewer; leaf nodes
/// launch their URL / PDF / YouTube link externally.
Future<void> openWeblink(
    BuildContext context, String baseEndpoint, Weblink w) async {
  if (w.isContainer) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => WebLinksViewerScreen(
        baseEndpoint: baseEndpoint,
        parentId: w.id,
        title: w.title,
      ),
    ));
    return;
  }
  String? url;
  switch (w.linkType) {
    case 'PDF':
      url = ApiConstants.mediaUrl(w.pdfPath);
      break;
    case 'URL':
      url = w.linkUrl;
      break;
    default:
      url = (w.youtubeUrl != null && w.youtubeUrl!.isNotEmpty)
          ? w.youtubeUrl
          : w.linkUrl;
  }
  if (url == null || url.isEmpty) return;
  final uri = Uri.tryParse(url);
  if (uri != null && await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } else if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Cannot open this link')),
    );
  }
}

/// Read-only "Web Links" section for the club / district dashboards. Loads the
/// active top-level weblinks from [baseEndpoint] and renders them as a tappable
/// list. Renders nothing when there are no links (or on error), so a dashboard
/// without weblinks shows no empty section.
class WebLinksSection extends StatefulWidget {
  final String baseEndpoint; // e.g. /api/mobile/clubs/123/weblinks
  const WebLinksSection({super.key, required this.baseEndpoint});

  @override
  State<WebLinksSection> createState() => _WebLinksSectionState();
}

class _WebLinksSectionState extends State<WebLinksSection> {
  final _api = ApiClient();
  List<Weblink> _links = const [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final links = await fetchWeblinks(_api, widget.baseEndpoint);
      if (mounted) {
        setState(() {
          _links = links;
          _loaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded || _links.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, top: 8, bottom: 8),
          child: Text(
            'WEB LINKS',
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: _kWebAccent,
              letterSpacing: 1.5,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.divider),
          ),
          child: Column(
            children: [
              for (int i = 0; i < _links.length; i++) ...[
                if (i > 0)
                  const Divider(
                      height: 1, indent: 56, color: AppColors.divider),
                WeblinkRow(
                  link: _links[i],
                  onTap: () =>
                      openWeblink(context, widget.baseEndpoint, _links[i]),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Full-page read-only viewer for a weblink sub-tree (drill-down).
class WebLinksViewerScreen extends StatefulWidget {
  final String baseEndpoint;
  final int? parentId;
  final String title;
  const WebLinksViewerScreen({
    super.key,
    required this.baseEndpoint,
    required this.title,
    this.parentId,
  });

  @override
  State<WebLinksViewerScreen> createState() => _WebLinksViewerScreenState();
}

class _WebLinksViewerScreenState extends State<WebLinksViewerScreen> {
  final _api = ApiClient();
  late Future<List<Weblink>> _future;

  @override
  void initState() {
    super.initState();
    _future =
        fetchWeblinks(_api, widget.baseEndpoint, parentId: widget.parentId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: CustomAppBar(title: widget.title),
      body: FutureBuilder<List<Weblink>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final links = snap.data ?? const [];
          if (links.isEmpty) {
            return Center(
              child: Text(
                'No links here',
                style: AppFonts.body(color: AppColors.slate400),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: links.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) => Container(
              decoration: BoxDecoration(
                color: AppColors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.divider),
              ),
              child: WeblinkRow(
                link: links[i],
                onTap: () =>
                    openWeblink(context, widget.baseEndpoint, links[i]),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// A single weblink row — logo/icon avatar + title + writeup + trailing
/// chevron (container) or open-in-new (leaf).
class WeblinkRow extends StatelessWidget {
  final Weblink link;
  final VoidCallback onTap;
  const WeblinkRow({super.key, required this.link, required this.onTap});

  IconData get _icon {
    if (link.isContainer) return Icons.folder_outlined;
    switch (link.linkType) {
      case 'PDF':
        return Icons.picture_as_pdf_outlined;
      case 'URL':
        return Icons.link_outlined;
      default:
        return (link.youtubeUrl != null && link.youtubeUrl!.isNotEmpty)
            ? Icons.play_circle_outline
            : Icons.link_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasLogo = link.logoPath != null && link.logoPath!.isNotEmpty;
    final writeup = link.writeup?.trim() ?? '';
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: hasLogo
                  ? Image.network(
                      ApiConstants.mediaUrl(link.logoPath),
                      width: 32,
                      height: 32,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _iconAvatar(),
                    )
                  : _iconAvatar(),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    link.title.isEmpty ? 'Untitled' : link.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (writeup.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      writeup,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                        fontSize: 11,
                        color: AppColors.slate500,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(
              link.isContainer
                  ? Icons.chevron_right_rounded
                  : Icons.open_in_new_rounded,
              size: 18,
              color: AppColors.slate400,
            ),
          ],
        ),
      ),
    );
  }

  Widget _iconAvatar() => Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: _kWebAccent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(_icon, size: 18, color: _kWebAccent),
      );
}
