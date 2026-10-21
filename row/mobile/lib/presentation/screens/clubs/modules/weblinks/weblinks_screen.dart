import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';

class WeblinksScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const WeblinksScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<WeblinksScreen> createState() => _WeblinksScreenState();
}

class _WeblinksScreenState extends State<WeblinksScreen> {
  final _api = ApiClient();

  List<dynamic> _weblinks = [];
  bool _loading = true;

  /// Breadcrumb trail: list of {id, title} maps. Empty = root (Level 1).
  final List<Map<String, dynamic>> _breadcrumbs = [];

  /// Current parentId for fetching children. null = root.
  int? get _currentParentId =>
      _breadcrumbs.isNotEmpty ? _breadcrumbs.last['id'] as int : null;

  /// Current level (1-based): breadcrumb depth + 1.
  int get _currentLevel => _breadcrumbs.length + 1;

  @override
  void initState() {
    super.initState();
    _loadWeblinks();
  }

  Future<void> _loadWeblinks() async {
    setState(() => _loading = true);
    try {
      final parentParam = _currentParentId != null
          ? '?parentId=$_currentParentId'
          : '';
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/weblinks$parentParam',
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        final data = resp.data;
        List<dynamic> items;
        if (data is List) {
          items = data;
        } else if (data is Map<String, dynamic>) {
          items = (data['items'] as List<dynamic>?) ?? [];
        } else {
          items = [];
        }
        setState(() => _weblinks = items);
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load weblinks');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> link) async {
    try {
      await _api.put('/api/clubs/${widget.clubId}/weblinks/${link['id']}/toggle-active');
      if (mounted) {
        final wasActive = link['isActive'] as bool? ?? true;
        SnackbarUtils.showSuccess(context, wasActive ? 'Weblink deactivated' : 'Weblink activated');
        _loadWeblinks();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to toggle active status');
    }
  }

  Future<void> _delete(int id) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Weblink',
      message: 'This will also delete all child weblinks. This action cannot be undone.',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/weblinks/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Weblink deleted');
      _loadWeblinks();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  void _navigateInto(Map<String, dynamic> link) {
    setState(() {
      _breadcrumbs.add({'id': link['id'], 'title': link['title'] ?? ''});
    });
    _loadWeblinks();
  }

  void _navigateToBreadcrumb(int index) {
    if (index < 0) {
      // Go to root
      setState(() => _breadcrumbs.clear());
    } else {
      setState(() {
        // Keep breadcrumbs up to and including index
        while (_breadcrumbs.length > index + 1) {
          _breadcrumbs.removeLast();
        }
      });
    }
    _loadWeblinks();
  }

  void _openForm({Map<String, dynamic>? link}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _WeblinkFormScreen(
          clubId: widget.clubId,
          link: link,
          currentParentId: _currentParentId,
          currentLevel: _currentLevel,
          onSaved: _loadWeblinks,
        ),
      ),
    );
  }

  Color _linkTypeBadgeColor(String? linkType) {
    switch (linkType) {
      case 'Page': return Colors.blue[100]!;
      case 'URL': return Colors.green[100]!;
      case 'PDF': return Colors.red[100]!;
      default: return Colors.grey[100]!;
    }
  }

  Color _linkTypeBadgeTextColor(String? linkType) {
    switch (linkType) {
      case 'Page': return Colors.blue[700]!;
      case 'URL': return Colors.green[700]!;
      case 'PDF': return Colors.red[700]!;
      default: return Colors.grey[700]!;
    }
  }

  /// Per-level gating: only club admins of THIS club can manage.
  bool get canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Weblinks'),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          // Breadcrumb bar
          if (_breadcrumbs.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.grey[50],
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    InkWell(
                      onTap: () => _navigateToBreadcrumb(-1),
                      child: Text('Root',
                          style: AppTextStyles.caption.copyWith(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w600)),
                    ),
                    ..._breadcrumbs.asMap().entries.map((entry) {
                      final i = entry.key;
                      final bc = entry.value;
                      final isLast = i == _breadcrumbs.length - 1;
                      return Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 4),
                            child: Icon(Icons.chevron_right, size: 16, color: Colors.grey),
                          ),
                          InkWell(
                            onTap: isLast ? null : () => _navigateToBreadcrumb(i),
                            child: Text(
                              bc['title']?.toString() ?? '',
                              style: AppTextStyles.caption.copyWith(
                                color: isLast ? Colors.black87 : AppColors.primary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      );
                    }),
                  ],
                ),
              ),
            ),
          // Content
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _weblinks.isEmpty
                    ? const EmptyStateWidget(title: 'No weblinks added')
                    : RefreshIndicator(
                        onRefresh: _loadWeblinks,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _weblinks.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) => _buildWeblinkTile(_weblinks[i]),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeblinkTile(dynamic item) {
    final link = item as Map<String, dynamic>;
    final isActive = link['isActive'] as bool? ?? true;
    final linkType = link['linkType']?.toString() ?? 'None';
    final childCount = link['childCount'] ?? 0;
    final level = link['level'] as int? ?? _currentLevel;
    final logoPath = link['logoPath']?.toString();

    return Opacity(
      opacity: isActive ? 1.0 : 0.55,
      child: Card(
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              // Logo
              if (logoPath != null && logoPath.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(
                    _absUrl(logoPath),
                    width: 40,
                    height: 40,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => _logoPlaceholder(),
                  ),
                )
              else
                _logoPlaceholder(),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      link['title']?.toString() ?? '',
                      style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        // Link Type badge
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: _linkTypeBadgeColor(linkType),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            linkType,
                            style: AppTextStyles.caption.copyWith(
                              color: _linkTypeBadgeTextColor(linkType),
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        // Child count badge
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.grey[200],
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            '$childCount',
                            style: AppTextStyles.caption.copyWith(
                              fontSize: 10,
                              color: Colors.grey[700],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (link['sortOrder'] != null)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Text(
                    '#${link['sortOrder']}',
                    style: AppTextStyles.caption.copyWith(color: Colors.grey),
                  ),
                ),
              // Active toggle
              if (canManage)
                Switch(
                  value: isActive,
                  onChanged: (_) => _toggleActive(link),
                  activeColor: AppColors.primary,
                ),
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'edit') _openForm(link: link);
                  if (v == 'delete') _delete(link['id'] as int);
                  if (v == 'children') _navigateInto(link);
                },
                itemBuilder: (_) => [
                  if (level < 3)
                    const PopupMenuItem(value: 'children', child: Text('View Children')),
                  if (canManage)
                    const PopupMenuItem(value: 'edit', child: Text('Edit')),
                  if (canManage)
                    const PopupMenuItem(value: 'delete', child: Text('Delete')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _logoPlaceholder() => Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppColors.primary.withOpacity(0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Icon(Icons.link, color: AppColors.primary, size: 18),
      );
}

String _absUrl(String? path) => ApiConstants.mediaUrl(path);

// -- Form BottomSheet --

class _WeblinkFormScreen extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? link;
  final int? currentParentId;
  final int currentLevel;
  final VoidCallback onSaved;

  const _WeblinkFormScreen({
    required this.clubId,
    required this.onSaved,
    required this.currentParentId,
    required this.currentLevel,
    this.link,
  });

  @override
  State<_WeblinkFormScreen> createState() => _WeblinkFormScreenState();
}

class _WeblinkFormScreenState extends State<_WeblinkFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _writeupCtrl = TextEditingController();
  final _urlCtrl = TextEditingController();
  final _youtubeCtrl = TextEditingController();
  final _buttonTextCtrl = TextEditingController();
  final _sortOrderCtrl = TextEditingController();
  String _linkType = 'None';
  bool _saving = false;
  String? _logoPath;
  String? _logoName;
  String? _bannerPath;
  String? _bannerName;
  String? _pdfPath;
  String? _pdfName;

  bool get _isEdit => widget.link != null;

  /// The effective level for this form item.
  int get _level {
    if (_isEdit) return widget.link!['level'] as int? ?? widget.currentLevel;
    return widget.currentLevel;
  }

  /// Link Type options vary by level per spec.
  /// Level 1: None, Page, URL, PDF
  /// Level 2: URL, PDF
  /// Level 3: No selector (URL always shown)
  List<String> get _linkTypeOptions {
    if (_level == 1) return const ['None', 'Page', 'URL', 'PDF'];
    if (_level == 2) return const ['URL', 'PDF'];
    return const []; // Level 3 has no selector
  }

  bool get _showLinkTypeSelector => _level <= 2;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _titleCtrl.text = widget.link!['title']?.toString() ?? '';
      _writeupCtrl.text = widget.link!['writeup']?.toString() ?? '';
      _urlCtrl.text =
          (widget.link!['linkUrl'] ?? widget.link!['url'])?.toString() ?? '';
      _youtubeCtrl.text =
          (widget.link!['youtubeUrl'] ?? '').toString();
      _buttonTextCtrl.text =
          (widget.link!['buttonText'] ?? '').toString();
      _sortOrderCtrl.text = widget.link!['sortOrder']?.toString() ?? '';
      _linkType = (widget.link!['linkType'] ?? 'None').toString();
      if (_showLinkTypeSelector && !_linkTypeOptions.contains(_linkType)) {
        // Match case-insensitively so a stored 'url'/'Url' maps to the canonical
        // 'URL' option — otherwise the URL field would hide, its value would be
        // dropped from the save payload, and the backend (which compares the
        // type case-insensitively) would reject it with "Link URL is required".
        _linkType = _linkTypeOptions.firstWhere(
          (o) => o.toLowerCase() == _linkType.toLowerCase(),
          orElse: () => _linkTypeOptions.first,
        );
      }
      // The deployed weblinks LIST endpoint can omit linkUrl/youtubeUrl/buttonText
      // on list rows, so the URL field would open blank and a save would fail with
      // "Link URL is required". Recover the missing values from the tree endpoint
      // (which carries them) so the user isn't forced to re-type the URL.
      _hydrateMissingFieldsFromTree();
    } else {
      _linkType = _level == 1 ? 'None' : (_level == 2 ? 'URL' : 'None');
    }
  }

  /// Best-effort backfill of URL-bearing fields that the list row didn't include.
  /// Silent on failure — the inline URL validator still guards an empty save.
  Future<void> _hydrateMissingFieldsFromTree() async {
    final needsUrl =
        (_level == 3 || _linkType == 'URL') && _urlCtrl.text.trim().isEmpty;
    if (!needsUrl) return;
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/weblinks/tree',
        fromJson: (json) => json,
      );
      final data = resp.data;
      final roots = data is List
          ? data
          : (data is Map<String, dynamic>
              ? (data['items'] as List<dynamic>? ?? const [])
              : const []);
      final node = _findNode(roots, widget.link!['id']);
      if (node == null || !mounted) return;
      setState(() {
        if (_urlCtrl.text.trim().isEmpty) {
          _urlCtrl.text = (node['linkUrl'] ?? node['url'] ?? '').toString();
        }
        if (_youtubeCtrl.text.trim().isEmpty) {
          _youtubeCtrl.text = (node['youtubeUrl'] ?? '').toString();
        }
        if (_buttonTextCtrl.text.trim().isEmpty) {
          _buttonTextCtrl.text = (node['buttonText'] ?? '').toString();
        }
      });
    } catch (_) {
      // Ignore — the URL validator will prompt the user to enter it manually.
    }
  }

  /// Depth-first search of the nested weblink tree for the node with [id].
  Map<String, dynamic>? _findNode(List<dynamic> nodes, dynamic id) {
    for (final n in nodes) {
      if (n is! Map<String, dynamic>) continue;
      if (n['id'] == id) return n;
      final children = n['children'];
      if (children is List) {
        final found = _findNode(children, id);
        if (found != null) return found;
      }
    }
    return null;
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _writeupCtrl.dispose();
    _urlCtrl.dispose();
    _youtubeCtrl.dispose();
    _buttonTextCtrl.dispose();
    _sortOrderCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage(bool isLogo) async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      setState(() {
        if (isLogo) {
          _logoPath = picked.path;
          _logoName = picked.name;
        } else {
          _bannerPath = picked.path;
          _bannerName = picked.name;
        }
      });
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to pick image');
    }
  }

  Future<void> _pickPdf() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
      );
      if (result == null || result.files.isEmpty) return;
      final f = result.files.first;
      if (f.path == null) return;
      setState(() {
        _pdfPath = f.path;
        _pdfName = f.name;
      });
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to pick PDF');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final fields = <String, String>{
        'title': _titleCtrl.text.trim(),
        'writeup': _writeupCtrl.text.trim(),
        'sortOrder': _sortOrderCtrl.text.trim().isNotEmpty
            ? _sortOrderCtrl.text.trim()
            : '0',
      };

      // linkType
      if (_showLinkTypeSelector) {
        fields['linkType'] = _linkType;
      }

      // linkUrl: for L1/L2 only when linkType == URL; for L3 always
      if (_level == 3 || _linkType == 'URL') {
        fields['linkUrl'] = _urlCtrl.text.trim();
      }

      // youtubeUrl: Level 1 only
      if (_level == 1 && _youtubeCtrl.text.trim().isNotEmpty) {
        fields['youtubeUrl'] = _youtubeCtrl.text.trim();
      }

      // buttonText: Level 2 and 3 only
      if (_level >= 2 && _buttonTextCtrl.text.trim().isNotEmpty) {
        fields['buttonText'] = _buttonTextCtrl.text.trim();
      }

      // parentId: only for new items when currentParentId is not null
      if (!_isEdit && widget.currentParentId != null) {
        fields['parentId'] = widget.currentParentId.toString();
      }

      // isActive: only in edit mode
      if (_isEdit) {
        final existingActive = widget.link!['isActive'] as bool? ?? true;
        fields['isActive'] = existingActive.toString();
      }

      final files = <String, String>{
        if (_logoPath != null && _logoPath!.isNotEmpty) 'logo': _logoPath!,
        if (_bannerPath != null && _bannerPath!.isNotEmpty) 'banner': _bannerPath!,
        if (_pdfPath != null && _pdfPath!.isNotEmpty) 'pdf': _pdfPath!,
      };
      if (_isEdit) {
        await _api.sendMultipart(
          '/api/clubs/${widget.clubId}/weblinks/${widget.link!['id']}',
          method: 'PUT',
          fields: fields,
          files: files,
        );
      } else {
        await _api.sendMultipart(
          '/api/clubs/${widget.clubId}/weblinks',
          method: 'POST',
          fields: fields,
          files: files,
        );
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Created');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      // Surface the real server reason (e.g. "Link URL is required.",
      // "Enter a valid URL...") instead of a generic, unactionable message.
      if (mounted) {
        SnackbarUtils.showError(
          context,
          e is ApiException ? e.toString() : 'Failed to save',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Weblink' : 'Add Weblink',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            children: [
              // ── 1. Details ──
              _WlSectionCard(
                number: 1,
                icon: Icons.info_outline_rounded,
                title: 'Details',
                accent: _kWlAccents[0],
                children: [
                  CustomTextField(
                    controller: _titleCtrl,
                    label: 'Title *',
                    validator: (v) =>
                        v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  CustomTextField(
                    controller: _writeupCtrl,
                    label: _level == 1 ? 'Writeup / About' : 'About Weblink',
                    maxLines: 4,
                  ),
                  CustomTextField(
                    controller: _sortOrderCtrl,
                    label: 'Sort Order',
                    keyboardType: TextInputType.number,
                  ),
                ],
              ),

              // ── 2. Link Destination ──
              _WlSectionCard(
                number: 2,
                icon: Icons.link_rounded,
                title: 'Link Destination',
                accent: _kWlAccents[1],
                children: [
                  // Link Type selector (Level 1 and 2 only)
                  if (_showLinkTypeSelector)
                    DropdownButtonFormField<String>(
                      value: _linkTypeOptions.contains(_linkType)
                          ? _linkType
                          : _linkTypeOptions.first,
                      decoration: InputDecoration(
                        labelText: 'Link Type',
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                      items: _linkTypeOptions
                          .map((t) =>
                              DropdownMenuItem(value: t, child: Text(t)))
                          .toList(),
                      onChanged: (v) => setState(
                          () => _linkType = v ?? _linkTypeOptions.first),
                    ),
                  // URL field: L1/L2 when linkType == URL; L3 always
                  if (_level == 3 || _linkType == 'URL')
                    CustomTextField(
                      controller: _urlCtrl,
                      label: 'URL',
                      keyboardType: TextInputType.url,
                      hint: 'https://...',
                      // The backend requires a real http(s) URL for URL-type
                      // links (and for every Level-3 link). Validate inline so
                      // the user gets an immediate, clear alert instead of a
                      // round-trip "Failed to save".
                      validator: (v) {
                        final t = (v ?? '').trim();
                        if (t.isEmpty) return 'Please enter a URL';
                        if (!RegExp(r'^https?://').hasMatch(t)) {
                          return 'URL must start with http:// or https://';
                        }
                        return null;
                      },
                    ),
                  // PDF upload: when linkType == PDF and level <= 2
                  if (_linkType == 'PDF' && _level <= 2)
                    _uploadTile(
                      icon: Icons.picture_as_pdf_outlined,
                      label: 'Pick PDF File',
                      fileName: _pdfName,
                      onTap: _pickPdf,
                    ),
                  // YouTube URL: Level 1 only
                  if (_level == 1)
                    CustomTextField(
                      controller: _youtubeCtrl,
                      label: 'YouTube Video Link (optional)',
                      keyboardType: TextInputType.url,
                      hint: 'https://youtube.com/...',
                    ),
                  // Button Text: Level 2 and 3 only
                  if (_level >= 2)
                    CustomTextField(
                      controller: _buttonTextCtrl,
                      label: 'Button Text (optional)',
                      hint: 'e.g. "Read More"',
                    ),
                ],
              ),

              // ── 3. Media ──
              _WlSectionCard(
                number: 3,
                icon: Icons.image_outlined,
                title: 'Media',
                accent: _kWlAccents[2],
                children: [
                  _uploadTile(
                    icon: Icons.image_outlined,
                    label: _level == 1
                        ? 'Pick Module Logo (optional)'
                        : 'Pick Logo (optional)',
                    fileName: _logoName,
                    onTap: () => _pickImage(true),
                    helper:
                        _level >= 2 ? 'Recommended: 300x300 pixels' : null,
                  ),
                  // Banner: Level 1 only
                  if (_level == 1)
                    _uploadTile(
                      icon: Icons.panorama_outlined,
                      label: 'Pick Banner (optional)',
                      fileName: _bannerName,
                      onTap: () => _pickImage(false),
                    ),
                ],
              ),

              const SizedBox(height: 8),
              CustomButton(
                label: _isEdit ? 'Update Weblink' : 'Add Weblink',
                onPressed: _saving ? null : _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Styled file-picker tile (logo / banner / PDF) — replaces the plain
  /// OutlinedButton so uploads sit cleanly inside the section cards. Shows the
  /// picked file name with a check + "replace" affordance once selected.
  Widget _uploadTile({
    required IconData icon,
    required String label,
    String? fileName,
    required VoidCallback onTap,
    String? helper,
  }) {
    final has = fileName != null && fileName.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
            decoration: BoxDecoration(
              color: has
                  ? AppColors.primary.withValues(alpha: 0.06)
                  : AppColors.background,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: has
                    ? AppColors.primary.withValues(alpha: 0.45)
                    : AppColors.lightBorder,
              ),
            ),
            child: Row(
              children: [
                Icon(has ? Icons.check_circle_rounded : icon,
                    size: 20,
                    color: has ? AppColors.primary : AppColors.textSecondary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    has ? fileName : label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.body.copyWith(
                      fontWeight: FontWeight.w500,
                      color: has ? AppColors.primary : AppColors.textPrimary,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(has ? Icons.refresh_rounded : Icons.upload_rounded,
                    size: 18, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
        if (helper != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(helper,
                style: AppTextStyles.caption
                    .copyWith(color: Colors.grey, fontSize: 11)),
          ),
      ],
    );
  }
}

// ── Section-card scaffolding for the weblink form ──────────────────────────
// Numbered, accented white cards matching the projects form design language.
const List<Color> _kWlAccents = [
  AppColors.accentBlue, // blue-600
  AppColors.success, // emerald-600
  AppColors.accentBlue, // violet-600
];

class _WlSectionCard extends StatelessWidget {
  final int number;
  final IconData icon;
  final String title;
  final Color accent;
  final List<Widget> children;
  const _WlSectionCard({
    required this.number,
    required this.icon,
    required this.title,
    required this.accent,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.lightBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header strip — slate-50 bg, number badge in the section accent.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            decoration: const BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(14),
                topRight: Radius.circular(14),
              ),
              border: Border(bottom: BorderSide(color: AppColors.muted)),
            ),
            child: Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration:
                      BoxDecoration(color: accent, shape: BoxShape.circle),
                  child: Text(
                    '$number',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Icon(icon, size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (int i = 0; i < children.length; i++) ...[
                  if (i > 0) const SizedBox(height: 14),
                  children[i],
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
