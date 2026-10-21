import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Renders a network image at its OWN aspect ratio — the frame sizes itself to
/// the decoded image's width:height, so nothing is cropped and there is no
/// letterbox padding. Give it a bounded width (e.g. wrap in a `SizedBox(width:)`
/// for a thumbnail, or let it fill the available width for a banner) and the
/// height follows the image ratio.
///
/// While the image is still decoding (ratio unknown) it lays out at
/// [fallbackRatio] so the surrounding layout doesn't jump too much.
class AspectRatioNetworkImage extends StatefulWidget {
  final String url;

  /// width / height used until the real ratio is known (and if it can't be).
  final double fallbackRatio;
  final BorderRadius? borderRadius;
  final Widget? errorWidget;

  const AspectRatioNetworkImage({
    super.key,
    required this.url,
    this.fallbackRatio = 4 / 3,
    this.borderRadius,
    this.errorWidget,
  });

  @override
  State<AspectRatioNetworkImage> createState() =>
      _AspectRatioNetworkImageState();
}

class _AspectRatioNetworkImageState extends State<AspectRatioNetworkImage> {
  late ImageProvider _provider;
  ImageStream? _stream;
  ImageStreamListener? _listener;
  double? _ratio; // null = still resolving
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _provider = CachedNetworkImageProvider(widget.url);
    _resolve();
  }

  @override
  void didUpdateWidget(covariant AspectRatioNetworkImage old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url) {
      _ratio = null;
      _failed = false;
      _provider = CachedNetworkImageProvider(widget.url);
      _resolve();
    }
  }

  void _resolve() {
    _detach();
    final stream = _provider.resolve(const ImageConfiguration());
    final listener = ImageStreamListener(
      (info, _) {
        if (!mounted) return;
        final w = info.image.width.toDouble();
        final h = info.image.height.toDouble();
        if (h > 0) setState(() => _ratio = w / h);
      },
      onError: (_, __) {
        if (mounted) setState(() => _failed = true);
      },
    );
    _stream = stream;
    _listener = listener;
    stream.addListener(listener);
  }

  void _detach() {
    if (_stream != null && _listener != null) {
      _stream!.removeListener(_listener!);
    }
  }

  @override
  void dispose() {
    _detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) {
      return widget.errorWidget ?? const SizedBox.shrink();
    }
    final ratio = (_ratio == null || _ratio! <= 0) ? widget.fallbackRatio : _ratio!;
    // Frame ratio == image ratio, so BoxFit.cover shows the whole image with
    // no crop. Until the ratio resolves, paint nothing inside the placeholder.
    Widget child = AspectRatio(
      aspectRatio: ratio,
      child: _ratio == null
          ? const SizedBox.shrink()
          : Image(image: _provider, fit: BoxFit.cover),
    );
    if (widget.borderRadius != null) {
      child = ClipRRect(borderRadius: widget.borderRadius!, child: child);
    }
    return child;
  }
}
