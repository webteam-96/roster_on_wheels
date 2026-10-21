import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../network/api_client.dart';

/// Shares a project as a social **share card**.
///
/// Uses the backend's public share endpoints (no auth needed):
///   • `GET /api/public/projects/{id}/share?yearId=`      → `shareText` (caption)
///     + `shareUrl` (link) + `imageUrl`.
///   • `GET /api/public/projects/{id}/share-image.png`     → the 1200×630
///     social-preview PNG (server-generated from the project's title / club /
///     primary photo, cached on disk).
///
/// It downloads the card PNG + caption and hands both to the OS native share
/// sheet, so the user can post it to a messaging app, Instagram (feed
/// or Story), X, Facebook, Telegram, etc. — each app then lets them pick the
/// destination (feed / story / status). If the card image can't be built, it
/// falls back to sharing the caption text (which still carries the link).
Future<void> shareProject(
  BuildContext context, {
  required int projectId,
  int? yearId,
}) async {
  final messenger = ScaffoldMessenger.of(context);

  // iPad presents the share sheet as a popover and needs an anchor rect.
  final box = context.findRenderObject() as RenderBox?;
  final origin = (box != null && box.hasSize)
      ? box.localToGlobal(Offset.zero) & box.size
      : const Rect.fromLTWH(0, 0, 1, 1);

  final qp = <String, dynamic>{if (yearId != null) 'yearId': yearId};
  final api = ApiClient();

  messenger.showSnackBar(const SnackBar(
    content: Text('Preparing share card…'),
    duration: Duration(seconds: 30),
  ));

  // 1) Caption + link (non-fatal — we can still share the image without it).
  //    We rebuild the caption from the endpoint's STRUCTURED fields so the parts
  //    (title / description / club / district / link) stay clearly separated even
  //    in apps that collapse blank lines (e.g. Gmail). Falls back to the server's
  //    pre-baked shareText when those fields aren't present.
  String shareText = '';
  String subject = 'Rotary project';
  try {
    final resp = await api.get<Map<String, dynamic>>(
      '/api/public/projects/$projectId/share',
      queryParams: qp,
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    final data = resp.data ?? const {};
    shareText = _composeCaption(data);
    final title = (data['title'] ?? '').toString().trim();
    if (title.isNotEmpty) subject = title;
  } catch (_) {
    // ignore — caption is optional.
  }

  // 2) The card image → temp file → OS share sheet.
  try {
    final bytes = await api.downloadBytes(
      '/api/public/projects/$projectId/share-image.png',
      queryParams: qp,
    );
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/project_$projectId.png');
    await file.writeAsBytes(bytes, flush: true);
    messenger.hideCurrentSnackBar();
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'image/png')],
      text: shareText.isEmpty ? null : shareText,
      subject: subject,
      sharePositionOrigin: origin,
    );
  } catch (e) {
    messenger.hideCurrentSnackBar();
    // Image unavailable → share the caption (with the link) rather than fail.
    if (shareText.isNotEmpty) {
      await Share.share(shareText, sharePositionOrigin: origin);
    } else {
      messenger.showSnackBar(const SnackBar(
        content: Text('Could not prepare the share card. Please try again.'),
      ));
    }
  }
}

/// Builds a clearly-sectioned share caption from the share endpoint's structured
/// fields. Emoji markers keep the title / description / club / district / link
/// distinct even when the target app strips blank lines. Falls back to the
/// server's pre-baked `shareText` (then `shareTextSingleLine`) when those fields
/// are absent.
///
///   📌 {title}
///
///   {description}
///
///   🏛 {club}
///   📍 RI District {n}
///   🔗 {url}
String _composeCaption(Map<String, dynamic> data) {
  String s(String k) => (data[k] ?? '').toString().trim();
  final title = s('title');
  final summary = s('summary');
  final club = s('clubDisplayName');
  final district = s('districtNumber');
  final url = s('shareUrl');

  // Without the pieces we build from, use whatever the server pre-baked.
  if (title.isEmpty && url.isEmpty) {
    return (data['shareText'] ?? data['shareTextSingleLine'] ?? '')
        .toString()
        .trim();
  }

  final b = StringBuffer();
  if (title.isNotEmpty) b.write('📌 $title');
  if (summary.isNotEmpty) {
    if (b.isNotEmpty) b.write('\n\n');
    b.write(summary);
  }

  final footer = <String>[
    if (club.isNotEmpty) '🏛 $club',
    if (district.isNotEmpty) '📍 RI District $district',
    if (url.isNotEmpty) '🔗 $url',
  ];
  if (footer.isNotEmpty) {
    if (b.isNotEmpty) b.write('\n\n');
    b.write(footer.join('\n'));
  }
  return b.toString();
}
