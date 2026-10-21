import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../network/api_exceptions.dart';

/// Writes [bytes] to the temp directory under [filename] and opens it via
/// the platform's default handler. Used for Excel/PDF report downloads.
Future<void> saveAndOpenBytes(Uint8List bytes, String filename) async {
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$filename');
  await file.writeAsBytes(bytes, flush: true);
  await OpenFilex.open(file.path);
}

/// Downloads a server-hosted file (a relative media path like
/// `/uploads/documents/abc.pdf`, or an already-absolute URL on our own API
/// host) through the authenticated API client and opens it with the device's
/// default handler. Shows progress + error feedback via [context]'s
/// ScaffoldMessenger.
///
/// This is the reliable path for newsletter / document attachments. Handing
/// the URL to an external browser (`launchUrl`) either silently fails on
/// Android 11+ (no matching `<queries>` intent → `canLaunchUrl` is false) or
/// just renders the file in-browser instead of saving it — so use this
/// bytes-download + open-with-default-app flow instead.
Future<void> downloadAndOpenServerFile(
  BuildContext context, {
  required String? filePath,
  String? fileName,
}) async {
  final raw = (filePath ?? '').trim();
  if (raw.isEmpty) return;

  final messenger = ScaffoldMessenger.of(context);

  // Resolve to a path our ApiClient can fetch (it prepends baseUrl). If the
  // value is an absolute URL on our own API host, strip the base back off; if
  // it points somewhere else entirely, fall back to opening it in a browser.
  String relative = raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    if (raw.startsWith(ApiConstants.baseUrl)) {
      relative = raw.substring(ApiConstants.baseUrl.length);
    } else {
      final uri = Uri.tryParse(raw);
      if (uri != null) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
      return;
    }
  }
  if (!relative.startsWith('/')) relative = '/$relative';

  final name = (fileName != null && fileName.trim().isNotEmpty)
      ? fileName.trim()
      : relative.split('/').last.split('?').first;
  final safeName = name.isEmpty ? 'document' : name;

  messenger.showSnackBar(
    const SnackBar(
      content: Text('Downloading…'),
      duration: Duration(seconds: 30),
    ),
  );
  try {
    final bytes = await ApiClient().downloadBytes(relative);
    await saveAndOpenBytes(bytes, safeName);
    messenger.hideCurrentSnackBar();
  } catch (e) {
    messenger.hideCurrentSnackBar();
    // A 404 here is a server-side issue, not an app bug: the file isn't being
    // served at its stored path (e.g. the migrated Documents tree isn't present
    // / readable under the API's media web root). Say so plainly instead of
    // dumping the raw exception.
    final msg = (e is ApiException && e.statusCode == 404)
        ? 'File not found on the server. It may have been moved or did not '
            'upload correctly.'
        : 'Download failed: $e';
    messenger.showSnackBar(SnackBar(content: Text(msg)));
  }
}

/// Downloads a server-hosted file (same path rules as [downloadAndOpenServerFile])
/// through the authenticated API client, then hands it to the OS share sheet so
/// the user can save it ("Save to Files" on iOS, "Save to Device"/Drive on
/// Android) or send it onward. This is the "Download" action — distinct from the
/// "View" action above, which opens the file straight into the default viewer.
///
/// Media is auth-protected (fetched with the JWT via [ApiClient]), so we cannot
/// just hand a bare URL to the browser/WebView — we fetch the bytes first.
Future<void> shareServerFile(
  BuildContext context, {
  required String? filePath,
  String? fileName,
}) async {
  final raw = (filePath ?? '').trim();
  if (raw.isEmpty) return;

  final messenger = ScaffoldMessenger.of(context);

  // iPad presents the share sheet as a popover and needs a source rect.
  final box = context.findRenderObject() as RenderBox?;
  final origin = (box != null && box.hasSize)
      ? box.localToGlobal(Offset.zero) & box.size
      : const Rect.fromLTWH(0, 0, 1, 1);

  String relative = raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    if (raw.startsWith(ApiConstants.baseUrl)) {
      relative = raw.substring(ApiConstants.baseUrl.length);
    } else {
      final uri = Uri.tryParse(raw);
      if (uri != null) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
      return;
    }
  }
  if (!relative.startsWith('/')) relative = '/$relative';

  final name = (fileName != null && fileName.trim().isNotEmpty)
      ? fileName.trim()
      : relative.split('/').last.split('?').first;
  final safeName = name.isEmpty ? 'document' : name;

  messenger.showSnackBar(
    const SnackBar(
      content: Text('Preparing download…'),
      duration: Duration(seconds: 30),
    ),
  );
  try {
    final bytes = await ApiClient().downloadBytes(relative);
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$safeName');
    await file.writeAsBytes(bytes, flush: true);
    messenger.hideCurrentSnackBar();
    await Share.shareXFiles(
      [XFile(file.path)],
      subject: safeName,
      sharePositionOrigin: origin,
    );
  } catch (e) {
    messenger.hideCurrentSnackBar();
    final msg = (e is ApiException && e.statusCode == 404)
        ? 'File not found on the server. It may have been moved or did not '
            'upload correctly.'
        : 'Download failed: $e';
    messenger.showSnackBar(SnackBar(content: Text(msg)));
  }
}
