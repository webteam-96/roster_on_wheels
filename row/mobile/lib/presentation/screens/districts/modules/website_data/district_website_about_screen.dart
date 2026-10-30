import 'package:flutter/material.dart' hide Text;
import 'package:flutter_html/flutter_html.dart';
import 'package:flutter_quill/flutter_quill.dart' as quill;
import 'package:flutter_quill_delta_from_html/flutter_quill_delta_from_html.dart';
import 'package:provider/provider.dart';
import 'package:vsc_quill_delta_to_html/vsc_quill_delta_to_html.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class _About {
  final int id;
  final String content;
  final bool isActive;
  const _About({required this.id, required this.content, required this.isActive});

  factory _About.fromJson(Map<String, dynamic> j) => _About(
        id: (j['id'] as int?) ?? 0,
        content: j['content']?.toString() ?? '',
        isActive: j['isActive'] as bool? ?? true,
      );
}

/// Rewrites relative img src/href values to absolute URLs using ApiConstants.baseUrl.
String _normalizeHtml(String html) {
  const base = ApiConstants.baseUrl;
  final srcReg = RegExp(r'''(src|href)=(["'])(/[^"']+)\2''');
  return html.replaceAllMapped(srcReg, (m) {
    final attr = m.group(1);
    final quote = m.group(2);
    final path = m.group(3);
    return '$attr=$quote$base$path$quote';
  });
}

class DistrictWebsiteAboutScreen extends StatefulWidget {
  final int districtId;
  const DistrictWebsiteAboutScreen({super.key, required this.districtId});

  @override
  State<DistrictWebsiteAboutScreen> createState() => _DistrictWebsiteAboutScreenState();
}

class _DistrictWebsiteAboutScreenState extends State<DistrictWebsiteAboutScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _About? _about;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/website-data/about',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? []).map((e) => _About.fromJson(e as Map<String, dynamic>)).toList();
      setState(() { _about = list.isNotEmpty ? list.first : null; _loading = false; });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() { _about = null; _loading = false; });
      } else {
        setState(() { _error = e.message; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _showAddEditDialog({_About? existing}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AboutEditorPage(
          districtId: widget.districtId,
          existing: existing,
        ),
      ),
    );
    if (saved == true) await _fetch();
  }

  Future<void> _confirmDelete(_About a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete About'),
        content: const Text('Delete the About content? This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/districts/${widget.districtId}/website-data/about/${a.id}');
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  Future<void> _toggleActive(_About a) async {
    try {
      await _api.put(
        '/api/districts/${widget.districtId}/website-data/about/${a.id}',
        body: {'content': a.content, 'isActive': !a.isActive},
      );
      if (mounted) await _fetch();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'About'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    if (_about == null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Expanded(
              child: EmptyStateWidget(
                title: 'No about content yet',
                subtitle: canManage ? 'Tap "Add About" to add content.' : 'No about content has been added yet.',
                icon: Icons.info_outline,
              ),
            ),
            if (canManage)
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: CustomButton(
                  label: 'Add About',
                  icon: Icons.add,
                  onPressed: () => _showAddEditDialog(),
                ),
              ),
          ],
        ),
      );
    }

    final about = _about!;
    final normalized = _normalizeHtml(about.content);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Card(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.border),
        ),
        color: AppColors.surface,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: about.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      about.isActive ? 'Active' : 'Inactive',
                      style: AppTextStyles.caption.copyWith(
                        color: about.isActive ? AppColors.success : AppColors.textSecondary,
                      ),
                    ),
                  ),
                  if (canManage)
                    Wrap(
                      spacing: 4,
                      children: [
                        IconButton(
                          icon: Icon(about.isActive ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20),
                          onPressed: () => _toggleActive(about),
                          tooltip: about.isActive ? 'Deactivate' : 'Activate',
                        ),
                        IconButton(
                          icon: const Icon(Icons.edit_outlined, size: 20),
                          onPressed: () => _showAddEditDialog(existing: about),
                          tooltip: 'Edit',
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.error),
                          onPressed: () => _confirmDelete(about),
                          tooltip: 'Delete',
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Html(data: normalized),
            ],
          ),
        ),
      ),
    );
  }
}

class _AboutEditorPage extends StatefulWidget {
  final int districtId;
  final _About? existing;
  const _AboutEditorPage({required this.districtId, this.existing});

  @override
  State<_AboutEditorPage> createState() => _AboutEditorPageState();
}

class _AboutEditorPageState extends State<_AboutEditorPage> {
  final _api = ApiClient();
  late final quill.QuillController _controller;
  final _editorFocusNode = FocusNode();
  final _editorScrollController = ScrollController();
  late String _activeStr;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final initialDelta = (widget.existing != null && widget.existing!.content.trim().isNotEmpty)
        ? HtmlToDelta().convert(widget.existing!.content)
        : null;
    _controller = quill.QuillController(
      document: initialDelta != null
          ? quill.Document.fromDelta(initialDelta)
          : quill.Document(),
      selection: const TextSelection.collapsed(offset: 0),
    );
    _activeStr = (widget.existing?.isActive ?? true) ? '1' : '0';
  }

  @override
  void dispose() {
    _controller.dispose();
    _editorFocusNode.dispose();
    _editorScrollController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final plain = _controller.document.toPlainText().trim();
    if (plain.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Content is required')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final delta = _controller.document.toDelta();
      final converter = QuillDeltaToHtmlConverter(
        List<Map<String, dynamic>>.from(delta.toJson()),
        ConverterOptions.forEmail(),
      );
      final html = converter.convert();
      final body = {
        'content': html,
        'isActive': _activeStr == '1',
      };
      if (widget.existing == null) {
        await _api.post('/api/districts/${widget.districtId}/website-data/about', body: body);
      } else {
        await _api.put('/api/districts/${widget.districtId}/website-data/about/${widget.existing!.id}', body: body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Save failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: isEdit ? 'Edit About' : 'Add About',
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primaryPrime),
                  )
                : Text(
                    isEdit ? 'Update' : 'Save',
                    style: const TextStyle(color: AppColors.primaryPrime, fontWeight: FontWeight.bold),
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          // Single-row toolbar — Quill's built-in arrow indicators handle horizontal overflow
          Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              border: const Border(bottom: const BorderSide(color: AppColors.border)),
            ),
            child: quill.QuillSimpleToolbar(
              controller: _controller,
              config: const quill.QuillSimpleToolbarConfig(
                multiRowsDisplay: false,
                showFontFamily: false,
                showFontSize: false,
                showSmallButton: false,
                showStrikeThrough: false,
                showInlineCode: false,
                showCodeBlock: false,
                showQuote: false,
                showIndent: false,
                showSearchButton: false,
                showSubscript: false,
                showSuperscript: false,
                showDirection: false,
                showBackgroundColorButton: false,
                showListCheck: false,
                showLineHeightButton: false,
                showAlignmentButtons: true,
                showLeftAlignment: true,
                showCenterAlignment: true,
                showRightAlignment: true,
                showJustifyAlignment: true,
                showHeaderStyle: true,
                showListNumbers: true,
                showListBullets: true,
                showBoldButton: true,
                showItalicButton: true,
                showUnderLineButton: true,
                showColorButton: true,
                showClearFormat: true,
                showLink: true,
                showUndo: true,
                showRedo: true,
                embedButtons: null,
              ),
            ),
          ),
          // Editor takes remaining height
          Expanded(
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.all(16),
              child: quill.QuillEditor(
                controller: _controller,
                focusNode: _editorFocusNode,
                scrollController: _editorScrollController,
                config: const quill.QuillEditorConfig(
                  placeholder: 'Write about content here...',
                  expands: true,
                  scrollable: true,
                  autoFocus: false,
                ),
              ),
            ),
          ),
          // Status footer bar
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                Text('Status:', style: AppTextStyles.body),
                const SizedBox(width: 12),
                DropdownButton<String>(
                  value: _activeStr,
                  items: const [
                    DropdownMenuItem(value: '1', child: Text('Active')),
                    DropdownMenuItem(value: '0', child: Text('Inactive')),
                  ],
                  onChanged: (v) => setState(() => _activeStr = v ?? '1'),
                ),
                const Spacer(),
                Flexible(
                  child: Text(
                    'Format with toolbar · Images: web admin',
                    style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
