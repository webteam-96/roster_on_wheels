import 'dart:convert';

import 'package:flutter/material.dart' hide Text;
import 'package:flutter_html/flutter_html.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_gradients.dart';
import '../../data/models/login_announcement_model.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Checks for an active login announcement and shows the popup if one exists.
///
/// Call this from the `initState` of landing screens (HomeScreen)
/// inside a `WidgetsBinding.instance.addPostFrameCallback((_) => ...)`.
///
/// Safe to call without awaiting — silently swallows any network failure so it
/// never blocks the user from reaching the screen.
Future<void> checkAndShowLoginAnnouncement(
  BuildContext context, {
  String? currentRole,
}) async {
  try {
    final api = ApiClient();
    final resp = await api.get<Map<String, dynamic>>(
      '/api/mobile/login-announcement/active',
      queryParams: currentRole == null ? null : {'currentRole': currentRole},
      fromJson: (j) => j as Map<String, dynamic>,
    );
    final data = resp.data;
    if (data == null) return;

    final ann = ActiveLoginAnnouncement.fromJson(data);
    if (!ann.hasContent) return;
    if (!context.mounted) return;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => LoginAnnouncementPopup(announcement: ann),
    );
  } catch (_) {
    // Silently skip — a failed announcement fetch must never block the app.
  }
}

class LoginAnnouncementPopup extends StatefulWidget {
  final ActiveLoginAnnouncement announcement;
  const LoginAnnouncementPopup({super.key, required this.announcement});

  @override
  State<LoginAnnouncementPopup> createState() => _LoginAnnouncementPopupState();
}

class _LoginAnnouncementPopupState extends State<LoginAnnouncementPopup> {
  final _api = ApiClient();
  bool _acknowledging = false;

  /// Which announcement is on screen when several arrived together.
  int _index = 0;

  // Something behind the dialog rebuilds this popup periodically. Parse the
  // HTML and decode each image ONCE and cache the results, otherwise every
  // rebuild re-runs the base64 decode and mints a fresh Image, making the
  // picture flash/reload roughly once a second.
  //
  // Keyed by announcement id, NOT a single field: with ◀ ▶ a one-slot cache
  // would keep serving the first announcement's HTML after navigating away.
  final Map<int, String> _cleanedContent = {};
  final Map<String, ImageProvider?> _imageProviders = {};

  List<LoginAnnouncementItem> get _items => widget.announcement.items;
  LoginAnnouncementItem get _current =>
      _items[_index.clamp(0, _items.length - 1)];

  /// "For: Club Admin · 2 of 5" — either half is dropped when it adds nothing.
  /// The role line tells a multi-hat member which of their roles this is aimed
  /// at, which is the whole point of the targeting added on the server.
  String get _subtitle {
    final roles = _current.roles
        .where((r) => r != 'ALL')
        .map(LoginAnnouncementItem.roleLabel)
        .join(', ');
    final counter = _items.length > 1 ? '${_index + 1} of ${_items.length}' : '';
    if (roles.isEmpty) return counter;
    if (counter.isEmpty) return 'For: $roles';
    return 'For: $roles · $counter';
  }

  void _go(int delta) {
    final next = _index + delta;
    if (next < 0 || next >= _items.length) return;
    setState(() => _index = next);
  }

  /// OK marks EVERY announcement in this popup as read, not just the one on
  /// screen — same as web, so arrowing through is optional rather than a
  /// chore. The X button acknowledges nothing and it all returns next login.
  Future<void> _acknowledge() async {
    if (_acknowledging) return;
    final ids = _items.map((i) => i.id).toList();
    if (ids.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _acknowledging = true);
    try {
      await _api.post<void>(
        '/api/mobile/login-announcement/acknowledge',
        body: {'ids': ids},
      );
    } catch (_) {
      // Even if acknowledge fails, close the popup — user clicked OK.
    }
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return Dialog(
      insetPadding: const EdgeInsets.all(20),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      backgroundColor: AppColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 440,
          maxHeight: mq.size.height * 0.75,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _header(),
            Flexible(
              child: Stack(
                children: [
                  SingleChildScrollView(
                    // Extra bottom padding so the last line of text clears the
                    // fade overlay when scrolled to the very end.
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 30),
                    child: Html(
                  key: ValueKey(_current.id),
                  data: _cleanedContent[_current.id] ??=
                      _cleanHtml(_current.content),
                  onLinkTap: (url, _, __) => _openUrl(url),
                  // flutter_html's built-in <img> renderer feeds CSS units
                  // (`width:30%`, `height:auto`) straight into Image as raw
                  // pixels — `height:auto` becomes 0, collapsing the image to
                  // nothing. Announcements are authored in a web editor that
                  // emits exactly that markup, so override <img> ourselves and
                  // render it aspect-correct, constrained to the popup width.
                  extensions: [
                    TagExtension(
                      tagsToExtend: const {'img'},
                      builder: (extCtx) => _announcementImage(
                        context,
                        extCtx.attributes['src'] ?? '',
                      ),
                    ),
                  ],
                  style: {
                    'body': Style(
                      margin: Margins.zero,
                      padding: HtmlPaddings.zero,
                      fontFamily: AppFonts.bodyFamily,
                      fontSize: FontSize(14),
                      color: AppColors.textPrimary,
                      lineHeight: const LineHeight(1.45),
                    ),
                    'h1': Style(
                      fontFamily: AppFonts.displayFamily,
                      fontSize: FontSize(22),
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                      margin: Margins.only(bottom: 6),
                    ),
                    'h2': Style(
                      fontFamily: AppFonts.displayFamily,
                      fontSize: FontSize(18),
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                      margin: Margins.only(bottom: 6),
                    ),
                    'h3': Style(
                      fontSize: FontSize(16),
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                      margin: Margins.only(bottom: 6),
                    ),
                    'a': Style(
                      color: AppColors.primary,
                      textDecoration: TextDecoration.underline,
                    ),
                    'p': Style(margin: Margins.only(bottom: 10)),
                    'ul': Style(margin: Margins.only(bottom: 10)),
                    'ol': Style(margin: Margins.only(bottom: 10)),
                    'li': Style(margin: Margins.only(bottom: 2)),
                    'br': Style(margin: Margins.zero),
                  },
                    ),
                  ),
                  // Soft fade over the bottom edge hints there is more to read
                  // by scrolling when the message runs past the viewport.
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: IgnorePointer(
                      child: Container(
                        height: 32,
                        decoration: BoxDecoration(
                          color: AppColors.surface.withValues(alpha: 0.0),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 8, 14),
      decoration: const BoxDecoration(
        gradient: AppGradients.royalSweep,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(18),
          topRight: Radius.circular(18),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.campaign_rounded, color: Colors.white, size: 20),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Announcement',
                  style: AppFonts.display(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                if (_subtitle.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      _subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: Colors.white.withValues(alpha: 0.85),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Close: shows again next login',
            icon: const Icon(Icons.close_rounded, color: Colors.white),
            onPressed: _acknowledging ? null : () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  Widget _footer() {
    final multi = _items.length > 1;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      child: Row(
        children: [
          if (multi) ...[
            _navButton(
              icon: Icons.chevron_left_rounded,
              tooltip: 'Previous announcement',
              onTap: _index == 0 || _acknowledging ? null : () => _go(-1),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(child: _okButton()),
          if (multi) ...[
            const SizedBox(width: 10),
            _navButton(
              icon: Icons.chevron_right_rounded,
              tooltip: 'Next announcement',
              onTap: _index >= _items.length - 1 || _acknowledging
                  ? null
                  : () => _go(1),
            ),
          ],
        ],
      ),
    );
  }

  Widget _navButton({
    required IconData icon,
    required String tooltip,
    VoidCallback? onTap,
  }) {
    final enabled = onTap != null;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: enabled ? AppColors.primaryLight : AppColors.slate100,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            width: 44,
            height: 44,
            child: Icon(
              icon,
              size: 24,
              color: enabled ? AppColors.primary : AppColors.slate400,
            ),
          ),
        ),
      ),
    );
  }

  Widget _okButton() {
    return SizedBox(
        width: double.infinity,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 12),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          onPressed: _acknowledging ? null : _acknowledge,
          child: _acknowledging
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(Colors.white),
                  ),
                )
              : Text(
                  'OK, Got it',
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
        ),
    );
  }

  /// Renders an announcement `<img>` regardless of the inline CSS the web
  /// editor attaches. Handles base64 `data:` URIs (the common case) and plain
  /// http(s) URLs; anything else, or a decode failure, renders nothing rather
  /// than crashing the popup. The image keeps its aspect ratio and is capped
  /// to the available width (never upscaled past its intrinsic size).
  Widget _announcementImage(BuildContext ctx, String rawSrc) {
    final provider = _providerFor(rawSrc.trim());
    if (provider == null) return const SizedBox.shrink();

    final mq = MediaQuery.of(ctx);
    // Cap the image height so it can never fill the whole scroll viewport —
    // otherwise it hides the text below the fold and the user can't tell there
    // is more to read. Capped, the image sits at the top and the message text
    // stays visible beneath it. BoxFit.contain keeps the aspect ratio.
    final maxImgHeight = mq.size.height * 0.22;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: LayoutBuilder(
        builder: (_, constraints) {
          final maxW = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : mq.size.width;
          return Align(
            alignment: Alignment.center,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: maxW,
                maxHeight: maxImgHeight,
              ),
              child: Image(
                image: provider,
                fit: BoxFit.contain,
                // Keep the last decoded frame during rebuilds so the image
                // never flashes back to a blank/loading state.
                gaplessPlayback: true,
                errorBuilder: (_, __, ___) => const SizedBox.shrink(),
              ),
            ),
          );
        },
      ),
    );
  }

  /// Decodes an announcement image `src` into a cached [ImageProvider] so the
  /// base64 decode happens exactly once. Returns null (and caches that) for an
  /// unsupported scheme or a decode failure. The stable provider instance lets
  /// Flutter's image cache serve rebuilds without re-decoding or reloading.
  ImageProvider? _providerFor(String src) {
    if (_imageProviders.containsKey(src)) return _imageProviders[src];

    ImageProvider? provider;
    final dataMatch =
        RegExp(r'^data:image/[^,]*base64,(.*)$', dotAll: true).firstMatch(src);
    if (dataMatch != null) {
      try {
        provider = MemoryImage(
          base64.decode(dataMatch.group(1)!.replaceAll(RegExp(r'\s'), '')),
        );
      } catch (_) {
        provider = null;
      }
    } else if (src.startsWith('http://') || src.startsWith('https://')) {
      provider = NetworkImage(src);
    }

    _imageProviders[src] = provider;
    return provider;
  }

  String _cleanHtml(String raw) {
    var s = raw;
    s = s.replaceAll(
      RegExp(
        r'<p[^>]*>\s*(?:&nbsp;| |<br\s*/?>\s*)*\s*</p>',
        caseSensitive: false,
      ),
      '',
    );
    s = s.replaceAll(
      RegExp(
        r'<div[^>]*>\s*(?:&nbsp;| |<br\s*/?>\s*)*\s*</div>',
        caseSensitive: false,
      ),
      '',
    );
    s = s.replaceAll(
      RegExp(r'(?:<br\s*/?>\s*){2,}', caseSensitive: false),
      '<br>',
    );
    s = s.replaceAll(RegExp(r'\n{3,}'), '\n\n');
    return s.trim();
  }

  Future<void> _openUrl(String? raw) async {
    if (raw == null || raw.isEmpty) return;
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
}
