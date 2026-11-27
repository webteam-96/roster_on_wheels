import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Mass email templates and signature for club and district officers: the sender's own signature (edited as plain
/// text), the template library (ROW starters and saved ones) and the merge fields. Opened from the Mass Emails list.
/// [scope] is 'clubs' or 'districts'.
class MassEmailLibraryScreen extends StatefulWidget {
  final String scope;
  final int ownerId;
  final bool canManage;

  const MassEmailLibraryScreen({super.key, required this.scope, required this.ownerId, required this.canManage});

  @override
  State<MassEmailLibraryScreen> createState() => _MassEmailLibraryScreenState();
}

/// Rich text to plain text for display and editing: line breaks kept, tags dropped, common entities decoded.
String massEmailHtmlToText(String html) => html
    .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
    .replaceAll(RegExp(r'</p>\s*', caseSensitive: false), '\n')
    .replaceAll(RegExp(r'<[^>]*>'), '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .trim();

/// Plain text to the HTML a signature is stored as.
String massEmailTextToHtml(String text) {
  final escaped = text
      .trim()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  return escaped.isEmpty ? '' : '<p>${escaped.replaceAll('\n', '<br>')}</p>';
}

class _MassEmailLibraryScreenState extends State<MassEmailLibraryScreen> {
  final _api = ApiClient();
  final _signature = TextEditingController();
  Map<String, dynamic>? _library;
  String? _error;
  bool _loading = true;
  bool _busy = false;

  String get _base => '/api/${widget.scope}/${widget.ownerId}/mass-email-templates';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _signature.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final lib = await _api.get<Map<String, dynamic>>(_base, fromJson: (j) => j as Map<String, dynamic>);
      final sig = await _api.get<Map<String, dynamic>>('/api/mass-email/signature',
          fromJson: (j) => j as Map<String, dynamic>);
      _library = lib.data;
      _signature.text = massEmailHtmlToText((sig.data?['html'] as String?) ?? '');
    } on ApiException catch (e) {
      _error = e.message;
    } catch (_) {
      _error = 'Could not load the templates.';
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _saveSignature() async {
    setState(() => _busy = true);
    try {
      await _api.put<Map<String, dynamic>>('/api/mass-email/signature',
          body: {'html': massEmailTextToHtml(_signature.text)}, fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) SnackbarUtils.showSuccess(context, 'Your signature is saved.');
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _delete(Map<String, dynamic> t) async {
    final ok = await showRowDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete template'),
        content: Text('Delete "${t['name']}"?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('$_base/${t['id']}');
      if (mounted) SnackbarUtils.showSuccess(context, 'Template deleted.');
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  Future<void> _copy(String text, String done) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) SnackbarUtils.showSuccess(context, done);
  }

  void _open(Map<String, dynamic> t) {
    final body = massEmailHtmlToText((t['bodyHtml'] as String?) ?? '');
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text((t['name'] as String?) ?? '', style: Theme.of(ctx).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text('Subject: ${(t['subject'] as String?) ?? ''}'),
                const SizedBox(height: 8),
                Text(body),
                const SizedBox(height: 16),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  OutlinedButton.icon(
                    icon: const Icon(Icons.copy_outlined),
                    label: const Text('Copy subject'),
                    onPressed: () => _copy((t['subject'] as String?) ?? '', 'Subject copied'),
                  ),
                  OutlinedButton.icon(
                    icon: const Icon(Icons.copy_outlined),
                    label: const Text('Copy body'),
                    onPressed: () => _copy(body, 'Body copied'),
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lib = _library;
    final starters = ((lib?['starters'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final saved = ((lib?['saved'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final fields = ((lib?['mergeFields'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: const CustomAppBar(title: 'Templates and signature'),
      body: _loading
          ? const RowSkeletonList()
          : _error != null
              ? ListView(children: [
                  ListTile(
                    leading: const Icon(Icons.error_outline),
                    title: Text(_error!),
                    subtitle: const Text('Tap to try again.'),
                    onTap: _load,
                  ),
                ])
              : RowRefresh(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      const ListTile(
                        title: Text('My signature'),
                        subtitle: Text('Add it to a mass email from the compose screen on the web.'),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: TextField(
                          controller: _signature,
                          minLines: 3,
                          maxLines: 8,
                          maxLength: 1000,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            hintText: 'Your name, role and contact details',
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: FilledButton(
                            onPressed: _busy ? null : _saveSignature,
                            child: const Text('Save signature'),
                          ),
                        ),
                      ),
                      const Divider(height: 32),
                      const ListTile(title: Text('Merge fields'), subtitle: Text('Each recipient gets their own value. Tap to copy.')),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Wrap(spacing: 8, runSpacing: 8, children: [
                          for (final f in fields)
                            ActionChip(
                              label: Text('${f['label']} ${f['token']}'),
                              onPressed: () => _copy('${f['token']}', '${f['token']} copied'),
                            ),
                        ]),
                      ),
                      const Divider(height: 32),
                      ListTile(title: Text(widget.scope == 'clubs' ? 'Saved by your club' : 'Saved by your district')),
                      if (saved.isEmpty)
                        const ListTile(
                          leading: Icon(Icons.info_outline),
                          title: Text('No saved templates yet'),
                          subtitle: Text('Save one from the mass email compose screen on the web.'),
                        ),
                      for (final t in saved)
                        ListTile(
                          leading: const Icon(Icons.description_outlined),
                          title: Text((t['name'] as String?) ?? ''),
                          subtitle: Text((t['subject'] as String?) ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                          onTap: () => _open(t),
                          trailing: widget.canManage
                              ? IconButton(
                                  tooltip: 'Delete template',
                                  icon: const Icon(Icons.delete_outline),
                                  onPressed: () => _delete(t),
                                )
                              : null,
                        ),
                      const ListTile(title: Text('ROW starters')),
                      for (final t in starters)
                        ListTile(
                          leading: const Icon(Icons.article_outlined),
                          title: Text((t['name'] as String?) ?? ''),
                          subtitle: Text((t['subject'] as String?) ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                          onTap: () => _open(t),
                        ),
                    ],
                  ),
                ),
    );
  }
}
