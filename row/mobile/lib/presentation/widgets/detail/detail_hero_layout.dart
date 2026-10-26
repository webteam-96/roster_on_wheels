import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../common/aspect_ratio_network_image.dart';
import '../common/full_screen_image_view.dart';
import 'detail_widgets.dart' show openDetailLink;
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Shared "club-finder style" detail layout used by Project and Upcoming-Event
/// detail pages. The design language mirrors
/// `club_finder/club_finder_project_detail_screen.dart`:
///   full-bleed image gallery (no text overlay)
///     → bold title (+ subtitle)
///     → status pill + info chips
///     → plain paragraph description
///     → one bordered key/value info card.
///
/// Screens compose these pieces inside a `ListView(padding: EdgeInsets.zero)`
/// so the gallery bleeds edge-to-edge and the rest sits in a 16px padded body.

// ── Full-bleed image slider — each image WHOLE at its own aspect ratio ──────
/// Images are shown exactly as before — every image at its OWN aspect ratio
/// (never cropped), capped to [_maxHeightFraction] of the screen — but instead
/// of stacking vertically they're now a horizontal, **swipeable slider**
/// (`PageView` + dot indicators). The frame height ADAPTS to the current
/// image's ratio so nothing is letterboxed once a page settles. Tap opens the
/// full-screen pinch-to-zoom viewer that also swipes between all images.
class DetailHeroGallery extends StatefulWidget {
  final List<String> urls;

  /// Optional per-image captions, aligned by index with [urls]. When null (or an
  /// entry is blank) no caption strip is shown for that image — so callers that
  /// pass only urls (e.g. Upcoming Events) render exactly as before. Used by the
  /// District Events / District Projects detail sliders to surface each photo's
  /// description below the image.
  final List<String>? captions;
  const DetailHeroGallery({super.key, required this.urls, this.captions});

  /// Fraction of the screen height a hero image may occupy at most.
  static const double _maxHeightFraction = 0.6;

  @override
  State<DetailHeroGallery> createState() => _DetailHeroGalleryState();
}

class _DetailHeroGalleryState extends State<DetailHeroGallery> {
  final PageController _controller = PageController();
  int _current = 0;
  // index → decoded image aspect ratio (width/height); drives the frame height.
  final Map<int, double> _ratios = {};

  @override
  void initState() {
    super.initState();
    _resolveRatios();
  }

  @override
  void didUpdateWidget(covariant DetailHeroGallery old) {
    super.didUpdateWidget(old);
    if (old.urls.join('|') != widget.urls.join('|')) {
      _ratios.clear();
      _current = 0;
      _resolveRatios();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  // Pre-resolve each image's real aspect ratio so the slider frame can size to
  // the current image (whole, no crop). Uses the same cached provider as display.
  void _resolveRatios() {
    for (var i = 0; i < widget.urls.length; i++) {
      final index = i;
      final stream = CachedNetworkImageProvider(widget.urls[i])
          .resolve(const ImageConfiguration());
      late final ImageStreamListener listener;
      listener = ImageStreamListener((info, _) {
        final h = info.image.height.toDouble();
        if (mounted && h > 0) {
          setState(() => _ratios[index] = info.image.width / h);
        }
        stream.removeListener(listener);
      }, onError: (_, __) => stream.removeListener(listener));
      stream.addListener(listener);
    }
  }

  double _heightFor(int i, double width, double maxHeight) {
    final ratio = _ratios[i];
    final r = (ratio == null || ratio <= 0) ? 16 / 9 : ratio; // 16:9 until known
    return (width / r).clamp(120.0, maxHeight);
  }

  /// Trimmed caption for image [i], or '' when none was supplied.
  String _captionFor(int i) {
    final caps = widget.captions;
    if (caps == null || i < 0 || i >= caps.length) return '';
    return caps[i].trim();
  }

  Widget _captionStrip(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 12.5,
            height: 1.35,
            fontWeight: FontWeight.w500,
            color: AppColors.textSecondary,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final urls = widget.urls;
    if (urls.isEmpty) return const SizedBox.shrink();
    final size = MediaQuery.of(context).size;
    final maxHeight = size.height * DetailHeroGallery._maxHeightFraction;

    // Single image: whole, natural ratio, capped — unchanged from before (plus
    // an optional caption strip below when the caller supplied one).
    if (urls.length == 1) {
      final image = GestureDetector(
        onTap: () => FullScreenImageView.openGallery(context,
            imageUrls: urls, initialIndex: 0),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxHeight),
            child: AspectRatioNetworkImage(
              url: urls[0],
              fallbackRatio: 16 / 9,
              errorWidget: _errorBox(),
            ),
          ),
        ),
      );
      final cap = _captionFor(0);
      if (cap.isEmpty) return image;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [image, _captionStrip(cap)],
      );
    }

    // Multiple images: swipeable slider. Frame height follows the CURRENT
    // image's own ratio (capped), so each image is shown whole/uncropped.
    final frameHeight = _heightFor(_current, size.width, maxHeight);
    return Column(
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
          height: frameHeight,
          child: PageView.builder(
            controller: _controller,
            itemCount: urls.length,
            onPageChanged: (i) => setState(() => _current = i),
            itemBuilder: (_, i) => GestureDetector(
              onTap: () => FullScreenImageView.openGallery(context,
                  imageUrls: urls, initialIndex: i),
              child: CachedNetworkImage(
                imageUrl: urls[i],
                fit: BoxFit.contain, // whole image, centered in the frame
                width: double.infinity,
                placeholder: (_, __) => const Center(
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
                errorWidget: (_, __, ___) => _errorBox(),
              ),
            ),
          ),
        ),
        // Caption for the CURRENT image (only when supplied + non-blank).
        if (_captionFor(_current).isNotEmpty)
          _captionStrip(_captionFor(_current)),
        const SizedBox(height: 10),
        // Dot indicators (active dot elongates).
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (int i = 0; i < urls.length; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == _current ? 20 : 7,
                height: 7,
                decoration: BoxDecoration(
                  color: i == _current ? AppColors.primary : AppColors.border,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _errorBox() => Container(
        height: 180,
        color: AppColors.muted,
        alignment: Alignment.center,
        child: const Icon(Icons.broken_image_outlined,
            color: AppColors.textSecondary, size: 40),
      );
}

// ── Title (+ optional subtitle) ─────────────────────────────────────────────
class DetailHeroTitle extends StatelessWidget {
  final String title;
  final String? subtitle;
  const DetailHeroTitle({super.key, required this.title, this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: AppFonts.body(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            height: 1.25,
          ),
        ),
        if (subtitle != null && subtitle!.trim().isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            subtitle!,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ],
    );
  }
}

// ── Info chip (icon + text pill) ────────────────────────────────────────────
Widget detailInfoChip(IconData icon, String text) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: AppColors.muted.withValues(alpha: 0.7),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.primaryPrime),
        const SizedBox(width: 6),
        // Flexible + ellipsis so a long value (e.g. a long venue) shrinks to
        // fit the available width instead of overflowing the Wrap row.
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ],
    ),
  );
}

/// Coloured status pill (Published/active → green, Expired/inactive → red,
/// Unpublished/draft/pending → amber). Rendered inside the chips wrap.
class DetailHeroStatusPill extends StatelessWidget {
  final String label;
  const DetailHeroStatusPill({super.key, required this.label});

  @override
  Widget build(BuildContext context) {
    final lower = label.toLowerCase();
    Color c;
    if (lower == 'published' ||
        lower == 'sent' ||
        lower == 'active' ||
        lower == 'ongoing') {
      c = AppColors.success;
    } else if (lower == 'expired' ||
        lower == 'failed' ||
        lower == 'inactive') {
      c = AppColors.error;
    } else if (lower == 'unpublished' ||
        lower == 'draft' ||
        lower == 'pending' ||
        lower == 'sending') {
      c = AppColors.warning;
    } else {
      c = AppColors.textSecondary;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
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
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: c,
            ),
          ),
        ],
      ),
    );
  }
}

/// A wrap of chips (status pill + info chips). Renders nothing when empty.
class DetailHeroChips extends StatelessWidget {
  final List<Widget> chips;
  const DetailHeroChips({super.key, required this.chips});

  @override
  Widget build(BuildContext context) {
    if (chips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(spacing: 8, runSpacing: 8, children: chips),
    );
  }
}

/// Plain paragraph text (used for the description).
class DetailHeroParagraph extends StatelessWidget {
  final String text;
  const DetailHeroParagraph({super.key, required this.text});

  @override
  Widget build(BuildContext context) {
    if (text.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 14,
          color: AppColors.textPrimary,
          height: 1.5,
        ),
      ),
    );
  }
}

/// A single key/value entry for [DetailHeroInfoCard]. When [url] is set the
/// value renders as a tappable link.
class DetailKV {
  final String label;
  final String? value;
  final String? url;
  const DetailKV(this.label, this.value, {this.url});
}

/// One bordered card holding label/value rows separated by thin dividers.
/// Null-valued rows are skipped; renders nothing when no rows survive.
class DetailHeroInfoCard extends StatelessWidget {
  final List<DetailKV> rows;
  final EdgeInsetsGeometry margin;
  const DetailHeroInfoCard({
    super.key,
    required this.rows,
    this.margin = const EdgeInsets.only(top: 20),
  });

  @override
  Widget build(BuildContext context) {
    final visible = rows
        .where((kv) => (kv.value != null && kv.value!.trim().isNotEmpty))
        .toList();
    if (visible.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: margin,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          for (int i = 0; i < visible.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.border),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 140,
                    child: Text(
                      visible[i].label,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: _value(context, visible[i])),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _value(BuildContext context, DetailKV kv) {
    if (kv.url != null && kv.url!.trim().isNotEmpty) {
      return InkWell(
        onTap: () => openDetailLink(context, kv.url!),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                kv.value!,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primaryPrime,
                  decoration: TextDecoration.underline,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.open_in_new, size: 14, color: AppColors.primaryPrime),
          ],
        ),
      );
    }
    return Text(
      kv.value!,
      style: AppFonts.body(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
        height: 1.4,
      ),
    );
  }
}
