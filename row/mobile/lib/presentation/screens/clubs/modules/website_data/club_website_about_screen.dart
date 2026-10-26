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

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _About {
  final int id;
  final String content;
  final bool isActive;
  const _About({required this.id, required this.content, required this.isActive});

  factory _About.fromJson(Map<String, dynamic> j) => _About(
        id: (j['id'] as int?) ?? 0,
        content: j['content']?.toString() ?? '',
        isActive: _asBool(j['isActive'] ?? true),
      );
}

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

class ClubWebsiteAboutScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteAboutScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteAboutScreen> createState() => _ClubWebsiteAboutScreenState();
}

class _ClubWebsiteAboutScreenState extends State<ClubWebsiteAboutScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  int? _selectedYearId;
  _About? _about;
  bool _loadingAbout = false;
  // Monotonically increasing fetch token. Each call to _fetchAbout takes the
  // next value; only the response matching the current value is committed to
  // state. Prevents an older request that resolves later from clobbering a
  // newer year's data (race condition when the user changes year quickly).
  int _fetchToken = 0;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      final allResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (allResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      final current = years.firstWhere((y) => y.isCurrent, orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''));
      setState(() {
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) await _fetchAbout(_selectedYearId!);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchAbout(int yearId) async {
    final token = ++_fetchToken;
    setState(() { _loadingAbout = true; _about = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/about',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted || token != _fetchToken) return;
      final list = (resp.data ?? []).map((e) => _About.fromJson(e as Map<String, dynamic>)).toList();
      setState(() { _about = list.isNotEmpty ? list.first : null; _loadingAbout = false; });
    } on ApiException catch (e) {
      if (!mounted || token != _fetchToken) return;
      if (e.statusCode == 404) {
        setState(() { _about = null; _loadingAbout = false; });
      } else {
        setState(() { _about = null; _loadingAbout = false; });
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to load: ${e.message}')));
      }
    } catch (_) {
      if (!mounted || token != _fetchToken) return;
      setState(() { _about = null; _loadingAbout = false; });
    }
  }

  Future<void> _showEditor({_About? existing}) async {
    if (_selectedYearId == null) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _AboutEditorPage(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          existing: existing,
        ),
      ),
    );
    if (saved == true && _selectedYearId != null) await _fetchAbout(_selectedYearId!);
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
      await _api.delete('/api/clubs/${widget.clubId}/website-data/about/${a.id}');
      if (mounted && _selectedYearId != null) await _fetchAbout(_selectedYearId!);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  Future<void> _toggleActive(_About a) async {
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/about/${a.id}',
        body: {'content': a.content, 'isActive': !a.isActive},
      );
      if (mounted && _selectedYearId != null) await _fetchAbout(_selectedYearId!);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isClubAdminOf(widget.clubId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'About'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadInitial)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_loadingAbout)
            const Center(child: Padding(padding: EdgeInsets.all(40), child: const CircularProgressIndicator(color: AppColors.primary)))
          else if (_about == null)
            Expanded(
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
                        onPressed: () => _showEditor(),
                      ),
                    ),
                ],
              ),
            )
          else
            Expanded(
              child: SingleChildScrollView(
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
                                color: _about!.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                _about!.isActive ? 'Active' : 'Inactive',
                                style: AppTextStyles.caption.copyWith(
                                  color: _about!.isActive ? AppColors.success : AppColors.textSecondary,
                                ),
                              ),
                            ),
                            if (canManage)
                              Wrap(
                                spacing: 4,
                                children: [
                                  IconButton(
                                    icon: Icon(_about!.isActive ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20),
                                    onPressed: () => _toggleActive(_about!),
                                    tooltip: _about!.isActive ? 'Deactivate' : 'Activate',
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.edit_outlined, size: 20),
                                    onPressed: () => _showEditor(existing: _about),
                                    tooltip: 'Edit',
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.error),
                                    onPressed: () => _confirmDelete(_about!),
                                    tooltip: 'Delete',
                                  ),
                                ],
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Html(data: _normalizeHtml(_about!.content)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AboutEditorPage extends StatefulWidget {
  final int clubId;
  final int yearId;
  final _About? existing;
  const _AboutEditorPage({required this.clubId, required this.yearId, this.existing});

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
      final body = <String, dynamic>{
        'content': html,
        'isActive': _activeStr == '1',
        if (widget.existing == null) 'yearId': widget.yearId,
      };
      if (widget.existing == null) {
        await _api.post('/api/clubs/${widget.clubId}/website-data/about', body: body);
      } else {
        await _api.put('/api/clubs/${widget.clubId}/website-data/about/${widget.existing!.id}', body: body);
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
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    isEdit ? 'Update' : 'Save',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
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
