import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../common/custom_app_bar.dart';
import '../common/empty_state_widget.dart';
import '../common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Shared building blocks for read-only "detail" pages across District and Club
/// modules. Design language: a hero header (banner image / title / status pill),
/// then soft-shadow rounded cards whose section title sits ABOVE the card, with
/// inline label/value rows separated by thin dividers.

const double _kRadius = 16;

/// Resolves a possibly-relative media path to an absolute URL. Null for empty.
String? detailMediaUrl(String? path) {
  if (path == null || path.trim().isEmpty) return null;
  final p = path.trim();
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  final clean = p.startsWith('/') ? p : '/$p';
  return '${ApiConstants.mediaBaseUrl}$clean';
}

/// Opens a URL externally. Prefixes https:// when the scheme is missing.
Future<void> openDetailLink(BuildContext context, String url) async {
  final href = url.trim();
  if (href.isEmpty) return;
  final normalized = href.startsWith('http://') || href.startsWith('https://')
      ? href
      : 'https://$href';
  final uri = Uri.tryParse(normalized);
  if (uri == null) return;
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } else if (context.mounted) {
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Cannot open link')));
  }
}

/// Full detail-page scaffold: app bar + loading/error/retry states.
class DetailScaffold extends StatelessWidget {
  final String title;
  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  final List<Widget>? actions;
  final WidgetBuilder body;

  const DetailScaffold({
    super.key,
    required this.title,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.body,
    this.actions,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: title, actions: actions),
      body: loading
          ? const LoadingWidget()
          : error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: ErrorStateWidget(
                        message: error!, onRetry: onRetry),
                  ),
                )
              : body(context),
    );
  }
}

/// Hero header shown at the top of a detail page. With [imageUrl] it renders a
/// banner with a dark gradient and the title/status overlaid; without one it
/// renders a clean soft card with the title, status pill and optional meta.
class DetailHeader extends StatelessWidget {
  final String title;
  final String? imageUrl;
  final String? status;
  final String? meta;
  final IconData? icon;

  const DetailHeader({
    super.key,
    required this.title,
    this.imageUrl,
    this.status,
    this.meta,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    if (url != null && url.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(_kRadius),
        child: Stack(
          children: [
            CachedNetworkImage(
              imageUrl: url,
              height: 210,
              width: double.infinity,
              fit: BoxFit.cover,
              placeholder: (_, __) => Container(
                height: 210,
                color: AppColors.muted,
                child:
                    const Center(child: CircularProgressIndicator(strokeWidth: 2)),
              ),
              errorWidget: (_, __, ___) => Container(
                height: 210,
                color: AppColors.muted,
                child: const Icon(Icons.image_outlined,
                    size: 40, color: AppColors.textSecondary),
              ),
            ),
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.transparent,
                ),
              ),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 14,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: AppTextStyles.h3.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if ((status != null && status!.isNotEmpty) ||
                      (meta != null && meta!.isNotEmpty)) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        if (status != null && status!.isNotEmpty)
                          DetailStatusChip(label: status!),
                        if (status != null &&
                            status!.isNotEmpty &&
                            meta != null &&
                            meta!.isNotEmpty)
                          const SizedBox(width: 10),
                        if (meta != null && meta!.isNotEmpty)
                          Flexible(
                            child: Text(
                              meta!,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                                fontSize: 12.5,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      );
    }

    // No image: soft card with title + status + meta.
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(_kRadius),
      ),
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (icon != null) ...[
                Container(
                  width: 38,
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, color: AppColors.primary, size: 20),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Text(
                  title,
                  style: AppTextStyles.h3.copyWith(
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          if ((status != null && status!.isNotEmpty) ||
              (meta != null && meta!.isNotEmpty)) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                if (status != null && status!.isNotEmpty)
                  DetailStatusChip(label: status!),
                if (status != null &&
                    status!.isNotEmpty &&
                    meta != null &&
                    meta!.isNotEmpty)
                  const SizedBox(width: 10),
                if (meta != null && meta!.isNotEmpty)
                  Flexible(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.event_outlined,
                            size: 14, color: AppColors.textSecondary),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            meta!,
                            style: AppTextStyles.caption.copyWith(
                                color: AppColors.textSecondary,
                                fontWeight: FontWeight.w600),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// A section: an uppercase title (with a small accent icon) sitting ABOVE a
/// soft-shadow rounded card that holds the section's rows.
class DetailSectionCard extends StatelessWidget {
  final IconData icon;
  final String title;

  /// Retained for source compatibility with existing call sites; no longer
  /// rendered (the dated numbered-circle was removed in the redesign).
  final int number;
  final Widget child;

  const DetailSectionCard({
    super.key,
    required this.icon,
    required this.title,
    required this.number,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(6, 0, 6, 9),
          child: Row(
            children: [
              Icon(icon, size: 15, color: AppColors.primary),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.8,
                    fontSize: 11.5,
                  ),
                ),
              ),
            ],
          ),
        ),
        Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(_kRadius),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: child,
        ),
      ],
    );
  }
}

/// Uppercase field label (used for the few non-row labels like "Status").
class DetailFieldLabel extends StatelessWidget {
  final String label;
  const DetailFieldLabel(this.label, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12, bottom: 4),
        child: Text(
          label.toUpperCase(),
          style: AppTextStyles.caption.copyWith(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
      );
}

/// Inline label/value row with a thin bottom divider. Labels share a fixed
/// left column so values line up across the card.
class DetailRow extends StatelessWidget {
  final String label;
  final String value;
  const DetailRow({super.key, required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: AppColors.border.withValues(alpha: 0.6)),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(
              label,
              style: AppTextStyles.bodyMedium.copyWith(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w500,
                height: 1.35,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              value,
              style: AppTextStyles.bodyMedium.copyWith(
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Tappable hyperlink row (label + underlined link + open-in-new icon).
class DetailLinkRow extends StatelessWidget {
  final String label;
  final String url;
  const DetailLinkRow({super.key, required this.label, required this.url});
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: AppColors.border.withValues(alpha: 0.6)),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(
              label,
              style: AppTextStyles.bodyMedium.copyWith(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w500,
                height: 1.35,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: InkWell(
              onTap: () => openDetailLink(context, url),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      url,
                      style: AppTextStyles.bodyMedium.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                        decoration: TextDecoration.underline,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.open_in_new, size: 14, color: AppColors.primary),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Status pill: a coloured dot + label. Published/sent/active=green,
/// expired/failed/inactive=red, unpublished/draft/pending/sending=amber.
class DetailStatusChip extends StatelessWidget {
  final String label;
  const DetailStatusChip({super.key, required this.label});
  @override
  Widget build(BuildContext context) {
    final lower = label.toLowerCase();
    Color c;
    if (lower == 'published' || lower == 'sent' || lower == 'active') {
      c = Colors.green.shade600;
    } else if (lower == 'expired' || lower == 'failed' || lower == 'inactive') {
      c = Colors.red.shade600;
    } else if (lower == 'unpublished' ||
        lower == 'draft' ||
        lower == 'pending' ||
        lower == 'sending') {
      c = Colors.amber.shade700;
    } else {
      c = AppColors.textSecondary;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: c, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: AppTextStyles.caption
                .copyWith(color: c, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// Single network image with rounded corners + loading/error placeholders.
class DetailImage extends StatelessWidget {
  final String url;
  final double height;
  const DetailImage({super.key, required this.url, this.height = 190});
  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: CachedNetworkImage(
        imageUrl: url,
        height: height,
        width: double.infinity,
        fit: BoxFit.cover,
        placeholder: (_, __) => Container(
          height: height,
          color: AppColors.background,
          child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
        ),
        errorWidget: (_, __, ___) => Container(
          height: height,
          color: AppColors.background,
          child: const Center(child: Icon(Icons.broken_image_outlined)),
        ),
      ),
    );
  }
}

/// Swipeable photo gallery with page dots. Renders nothing when [urls] is empty.
class DetailPhotoGallery extends StatefulWidget {
  final List<String> urls;
  final double height;
  const DetailPhotoGallery({super.key, required this.urls, this.height = 220});
  @override
  State<DetailPhotoGallery> createState() => _DetailPhotoGalleryState();
}

class _DetailPhotoGalleryState extends State<DetailPhotoGallery> {
  final _ctrl = PageController();
  int _index = 0;
  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.urls.isEmpty) return const SizedBox.shrink();
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: widget.height,
            child: PageView.builder(
              controller: _ctrl,
              itemCount: widget.urls.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (_, i) => CachedNetworkImage(
                imageUrl: widget.urls[i],
                fit: BoxFit.cover,
                width: double.infinity,
                placeholder: (_, __) => Container(
                  color: AppColors.background,
                  child: const Center(
                      child: CircularProgressIndicator(strokeWidth: 2)),
                ),
                errorWidget: (_, __, ___) => Container(
                  color: AppColors.background,
                  child: const Center(child: Icon(Icons.broken_image_outlined)),
                ),
              ),
            ),
          ),
        ),
        if (widget.urls.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                widget.urls.length,
                (i) => AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _index ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == _index ? AppColors.primary : AppColors.border,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Tappable attachment/file tile for Documents & Newsletters.
class DetailAttachmentTile extends StatelessWidget {
  final String label;
  final String? subtitle;
  final IconData icon;

  /// Opens the file in the device's default viewer.
  final VoidCallback onView;

  /// Saves / shares the file via the OS share sheet.
  /// When null, the Download button is hidden and only View is shown
  /// (e.g. for view-only documents).
  final VoidCallback? onDownload;

  const DetailAttachmentTile({
    super.key,
    required this.label,
    required this.onView,
    this.onDownload,
    this.subtitle,
    this.icon = Icons.insert_drive_file_outlined,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
        ),
        child: Column(
          children: [
            Row(
              children: [
                // File-type icon badge.
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: AppColors.primary, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: AppTextStyles.bodyMedium
                            .copyWith(fontWeight: FontWeight.w700),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle != null && subtitle!.isNotEmpty
                            ? subtitle!
                            : 'Attachment',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onView,
                    icon: const Icon(Icons.visibility_outlined, size: 18),
                    label: const Text('View'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      side: BorderSide(
                          color: AppColors.primary.withValues(alpha: 0.5)),
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                if (onDownload != null) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: onDownload,
                      icon: const Icon(Icons.download_rounded, size: 18),
                      label: const Text('Download'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 11),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
