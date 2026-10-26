import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/confirmation_dialog.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_button.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String? _absUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final sep = path.startsWith('/') ? '' : '/';
  return '$base$sep$path';
}

const _linkTypeOptions = <String>['None', 'Page', 'URL', 'PDF'];

Color _linkTypeColor(String t) {
  switch (t) {
    case 'Page':
      return AppColors.accentBlue; // blue
    case 'URL':
      return AppColors.success; // green
    case 'PDF':
      return AppColors.error; // red
    default:
      return AppColors.textSecondary; // grey
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
class _Weblink {
  final int id;
  final String title;
  final String? writeup;
  final String linkType; // None|Page|URL|PDF
  final String? linkUrl;
  final String? youtubeUrl;
  final String? buttonText;
  final String? logoPath;
  final String? bannerPath;
  final String? pdfPath;
  final int sortOrder;
  final bool isActive;
  final int level;
  final int? parentId;
  final int childCount;

  const _Weblink({
    required this.id,
    required this.title,
    this.writeup,
    required this.linkType,
    this.linkUrl,
    this.youtubeUrl,
    this.buttonText,
    this.logoPath,
    this.bannerPath,
    this.pdfPath,
    required this.sortOrder,
    required this.isActive,
    required this.level,
    this.parentId,
    this.childCount = 0,
  });

  factory _Weblink.fromJson(Map<String, dynamic> j) {
    String typeRaw =
        (j['linkType'] ?? j['link_type'] ?? 'None').toString();
    // Normalize server variants to canonical title-case.
    final normalized = _linkTypeOptions.firstWhere(
      (t) => t.toLowerCase() == typeRaw.toLowerCase(),
      orElse: () => 'None',
    );
    return _Weblink(
      id: (j['id'] as int?) ?? 0,
      title: (j['title'] ?? j['name'] ?? '').toString(),
      writeup: j['writeup']?.toString(),
      linkType: normalized,
      linkUrl: j['linkUrl']?.toString(),
      youtubeUrl: j['youtubeUrl']?.toString(),
      buttonText: j['buttonText']?.toString(),
      logoPath: j['logoPath']?.toString(),
      bannerPath: j['bannerPath']?.toString(),
      pdfPath: j['pdfPath']?.toString(),
      sortOrder: (j['sortOrder'] as int?) ?? 0,
      isActive: j['isActive'] as bool? ?? true,
      level: (j['level'] as int?) ?? 1,
      parentId: j['parentId'] as int?,
      childCount: (j['childCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class _BreadcrumbItem {
  final int? id;
  final String title;
  const _BreadcrumbItem({required this.id, required this.title});
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DistrictWeblinksScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;

  const DistrictWeblinksScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictWeblinksScreen> createState() => _DistrictWeblinksScreenState();
}

class _DistrictWeblinksScreenState extends State<DistrictWeblinksScreen> {
  final _api = ApiClient();

  final List<_BreadcrumbItem> _breadcrumbs = [
    const _BreadcrumbItem(id: null, title: 'Root'),
  ];

  List<_Weblink> _items = [];
  bool _loading = true;
  String? _error;

  int? get _currentParentId => _breadcrumbs.last.id;
  int get _currentLevel => _breadcrumbs.length; // Root=1, child=2, grandchild=3

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final qp = <String, dynamic>{};
      if (_currentParentId != null) qp['parentId'] = _currentParentId;
      final resp = await _api.get<dynamic>(
        '/api/districts/${widget.districtId}/weblinks',
        queryParams: qp.isEmpty ? null : qp,
        fromJson: (j) => j,
      );
      final raw = resp.data;
      final List<dynamic> list = raw is List
          ? raw
          : (raw is Map<String, dynamic>
              ? (raw['items'] as List<dynamic>? ?? const [])
              : const []);
      final parsed = list
          .map((e) => _Weblink.fromJson(e as Map<String, dynamic>))
          .toList();
      parsed.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() {
        _items = parsed;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _items = [];
          _loading = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _navigateInto(_Weblink item) {
    setState(() {
      _breadcrumbs.add(_BreadcrumbItem(id: item.id, title: item.title));
    });
    _fetch();
  }

  void _navigateToBreadcrumb(int index) {
    if (index >= _breadcrumbs.length - 1) return;
    setState(() {
      _breadcrumbs.removeRange(index + 1, _breadcrumbs.length);
    });
    _fetch();
  }

  Future<void> _delete(_Weblink item) async {
    final ok = await ConfirmationDialog.show(
      context,
      title: 'Delete Weblink',
      message: 'Delete "${item.title}"?',
    );
    if (ok != true) return;
    try {
      await _api.delete(
        '/api/districts/${widget.districtId}/weblinks/${item.id}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Weblink deleted'),
          backgroundColor: AppColors.success,
        ),
      );
      _fetch();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Delete failed: $e'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Future<void> _toggleActive(_Weblink item) async {
    try {
      await _api.put(
        '/api/districts/${widget.districtId}/weblinks/${item.id}/toggle-active',
      );
      _fetch();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Toggle failed: $e'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Future<void> _openExternal(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cannot open URL'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Future<void> _openForm({_Weblink? existing}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _WeblinkFormPage(
          districtId: widget.districtId,
          parentId: _currentParentId,
          level: existing?.level ?? _currentLevel,
          existing: existing,
        ),
      ),
    );
    if (saved == true) _fetch();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.embedded
          ? null
          : CustomAppBar(
              title: 'Weblinks',
              actions: [
                if (canManage)
                  IconButton(
                    icon: const Icon(Icons.add),
                    tooltip: 'Add Weblink',
                    onPressed: () => _openForm(),
                  ),
              ],
            ),
      body: Column(
        children: [
          _BreadcrumbBar(
            items: _breadcrumbs,
            onTap: _navigateToBreadcrumb,
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 8, itemHeight: 74)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: _fetch)
                    : _items.isEmpty
                        ? EmptyStateWidget(
                            title: 'No weblinks at this level.',
                            subtitle: canManage
                                ? 'Tap + to add a weblink.'
                                : null,
                            icon: Icons.link_outlined,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: _fetch,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _items.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                final item = _items[i];
                                return _WeblinkTile(
                                  item: item,
                                  canManage: canManage,
                                  canNavigateIn: item.childCount > 0 ||
                                      item.linkType == 'Page',
                                  onTap: () {
                                    // Mirror the web's click priority:
                                    // children > URL > PDF > YouTube.
                                    if (item.childCount > 0 ||
                                        item.linkType == 'Page') {
                                      _navigateInto(item);
                                      return;
                                    }
                                    switch (item.linkType) {
                                      case 'URL':
                                        if ((item.linkUrl ?? '').isNotEmpty) {
                                          _openExternal(item.linkUrl!);
                                        }
                                        break;
                                      case 'PDF':
                                        final u = _absUrl(item.pdfPath);
                                        if (u != null) _openExternal(u);
                                        break;
                                      default:
                                        if ((item.youtubeUrl ?? '').isNotEmpty) {
                                          _openExternal(item.youtubeUrl!);
                                        }
                                        break;
                                    }
                                  },
                                  onViewChildren: () => _navigateInto(item),
                                  onEdit: () => _openForm(existing: item),
                                  onDelete: () => _delete(item),
                                  onToggle: () => _toggleActive(item),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Breadcrumb bar
// ---------------------------------------------------------------------------
class _BreadcrumbBar extends StatelessWidget {
  final List<_BreadcrumbItem> items;
  final void Function(int index) onTap;

  const _BreadcrumbBar({required this.items, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: const Border(bottom: const BorderSide(color: AppColors.border)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (int i = 0; i < items.length; i++) ...[
              InkWell(
                onTap: i < items.length - 1 ? () => onTap(i) : null,
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 6, vertical: 4),
                  child: Text(
                    items[i].title,
                    style: AppTextStyles.bodyMedium.copyWith(
                      color: i == items.length - 1
                          ? AppColors.textPrimary
                          : AppColors.primary,
                      fontWeight: i == items.length - 1
                          ? FontWeight.w700
                          : FontWeight.w500,
                    ),
                  ),
                ),
              ),
              if (i < items.length - 1)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 2),
                  child: const Icon(Icons.chevron_right,
                      size: 18, color: AppColors.textSecondary),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------
class _WeblinkTile extends StatelessWidget {
  final _Weblink item;
  final bool canManage;
  final bool canNavigateIn;
  final VoidCallback onTap;
  final VoidCallback onViewChildren;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onToggle;

  const _WeblinkTile({
    required this.item,
    required this.canManage,
    required this.canNavigateIn,
    required this.onTap,
    required this.onViewChildren,
    required this.onEdit,
    required this.onDelete,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final typeColor = _linkTypeColor(item.linkType);
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: typeColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  canNavigateIn ? Icons.folder_outlined : Icons.link_outlined,
                  size: 22,
                  color: typeColor,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        _Badge(
                          label: item.linkType,
                          color: typeColor,
                        ),
                        _Badge(
                          label: 'Sort ${item.sortOrder}',
                          color: AppColors.textSecondary,
                          soft: true,
                        ),
                        if (item.childCount > 0)
                          _Badge(
                            label: '${item.childCount} '
                                '${item.childCount == 1 ? "child" : "children"}',
                            color: AppColors.primary,
                            soft: true,
                          ),
                        if (!item.isActive)
                          const _Badge(
                            label: 'Inactive',
                            color: AppColors.errorDark,
                            soft: true,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              if (canManage) ...[
                Transform.scale(
                  scale: 0.85,
                  child: Switch.adaptive(
                    value: item.isActive,
                    onChanged: (_) => onToggle(),
                    activeColor: AppColors.primary,
                  ),
                ),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, size: 20),
                  onSelected: (v) {
                    if (v == 'children') onViewChildren();
                    if (v == 'edit') onEdit();
                    if (v == 'delete') onDelete();
                  },
                  itemBuilder: (_) => [
                    // Web shows "View Children" for any node below level 3, so
                    // an admin can drill in to add sub-links even when empty.
                    if (item.level < 3)
                      const PopupMenuItem(
                        value: 'children',
                        child: Row(
                          children: [
                            Icon(Icons.account_tree_outlined, size: 18),
                            SizedBox(width: 8),
                            Text('View Children'),
                          ],
                        ),
                      ),
                    const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    const PopupMenuItem(value: 'delete', child: Text('Delete')),
                  ],
                ),
              ] else if (canNavigateIn)
                const Icon(Icons.chevron_right, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  final bool soft;
  const _Badge({required this.label, required this.color, this.soft = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: soft ? color.withValues(alpha: 0.12) : color,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: AppTextStyles.caption.copyWith(
          color: soft ? color : Colors.white,
          fontWeight: FontWeight.w600,
          fontSize: 11,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Add / Edit Form (full-screen dialog)
// ---------------------------------------------------------------------------
class _WeblinkFormPage extends StatefulWidget {
  final int districtId;
  final int? parentId;
  final int level; // 1..3
  final _Weblink? existing;

  const _WeblinkFormPage({
    required this.districtId,
    required this.parentId,
    required this.level,
    this.existing,
  });

  @override
  State<_WeblinkFormPage> createState() => _WeblinkFormPageState();
}

class _WeblinkFormPageState extends State<_WeblinkFormPage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  final _titleCtrl = TextEditingController();
  final _writeupCtrl = TextEditingController();
  final _linkUrlCtrl = TextEditingController();
  final _youtubeCtrl = TextEditingController();
  final _buttonTextCtrl = TextEditingController();
  final _sortCtrl = TextEditingController(text: '1');

  String _linkType = 'None';
  bool _isActive = true;
  bool _saving = false;

  String? _logoLocalPath;
  String? _bannerLocalPath;
  String? _pdfLocalPath;

  String? _existingLogoPath;
  String? _existingBannerPath;
  String? _existingPdfPath;

  bool get _isEditing => widget.existing != null;

  List<String> get _availableTypes {
    // Level 1: None, Page, URL, PDF
    // Level 2: URL, PDF (no Page — enforces max 3 levels is actually up to spec;
    //   spec says Level 2 allows URL/PDF only).
    // Level 3: editing only (restrict to URL/PDF)
    switch (widget.level) {
      case 1:
        return const ['None', 'Page', 'URL', 'PDF'];
      case 2:
        return const ['URL', 'PDF'];
      case 3:
      default:
        return const ['URL', 'PDF'];
    }
  }

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _titleCtrl.text = e.title;
      _writeupCtrl.text = e.writeup ?? '';
      _linkUrlCtrl.text = e.linkUrl ?? '';
      _youtubeCtrl.text = e.youtubeUrl ?? '';
      _buttonTextCtrl.text = e.buttonText ?? '';
      _sortCtrl.text = e.sortOrder.toString();
      _isActive = e.isActive;
      _existingLogoPath = e.logoPath;
      _existingBannerPath = e.bannerPath;
      _existingPdfPath = e.pdfPath;
      // Ensure linkType remains in available list; fall back to first option.
      _linkType = _availableTypes.contains(e.linkType)
          ? e.linkType
          : _availableTypes.first;
    } else {
      _linkType = _availableTypes.first;
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _writeupCtrl.dispose();
    _linkUrlCtrl.dispose();
    _youtubeCtrl.dispose();
    _buttonTextCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage(bool isLogo) async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
      maxWidth: 2560,
      maxHeight: 2560,
    );
    if (picked == null) return;
    setState(() {
      if (isLogo) {
        _logoLocalPath = picked.path;
      } else {
        _bannerLocalPath = picked.path;
      }
    });
  }

  Future<void> _pickPdf() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    if (result == null || result.files.isEmpty) return;
    final p = result.files.single.path;
    if (p == null) return;
    setState(() => _pdfLocalPath = p);
  }

  Map<String, String> _buildFields() {
    final fields = <String, String>{
      'title': _titleCtrl.text.trim(),
      'writeup': _writeupCtrl.text.trim(),
      'linkType': _linkType,
      'linkUrl': _linkUrlCtrl.text.trim(),
      'youtubeUrl': _youtubeCtrl.text.trim(),
      'buttonText': _buttonTextCtrl.text.trim(),
      'sortOrder': (int.tryParse(_sortCtrl.text.trim()) ?? 1).toString(),
    };
    if (widget.parentId != null) {
      fields['parentId'] = widget.parentId.toString();
    }
    if (_isEditing) {
      fields['isActive'] = _isActive.toString();
    }
    return fields;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final fields = _buildFields();
    final basePath = '/api/districts/${widget.districtId}/weblinks';
    final url = _isEditing ? '$basePath/${widget.existing!.id}' : basePath;

    // The backend weblinks endpoint binds [FromForm], so it ONLY accepts
    // multipart/form-data — sending application/json returns 415. The web admin
    // always submits a FormData (even with no file), so we always use
    // sendMultipart here. Any selected logo/banner/pdf goes in the same request
    // (POST to create, PUT to edit); sendMultipart also sets each file part's
    // Content-Type from its extension.
    final files = <String, String>{
      if (_logoLocalPath != null) 'logo': _logoLocalPath!,
      if (_bannerLocalPath != null) 'banner': _bannerLocalPath!,
      if (_pdfLocalPath != null) 'pdf': _pdfLocalPath!,
    };

    try {
      await _api.sendMultipart<Map<String, dynamic>>(
        url,
        method: _isEditing ? 'PUT' : 'POST',
        fields: fields,
        files: files,
        fromJson: (j) => j as Map<String, dynamic>,
      );

      if (!mounted) return;
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEditing ? 'Weblink updated' : 'Weblink created'),
          backgroundColor: AppColors.success,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Save failed: $e'),
          backgroundColor: AppColors.error,
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEditing ? 'Edit Weblink' : 'New Weblink',
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
              CustomTextField(
                label: 'Title *',
                controller: _titleCtrl,
                hint: 'Enter weblink title',
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Title is required'
                    : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Writeup',
                controller: _writeupCtrl,
                hint: 'Optional description / content',
                maxLines: 5,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _linkType,
                decoration: InputDecoration(
                  labelText: 'Link Type',
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8)),
                ),
                items: _availableTypes
                    .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                    .toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _linkType = v);
                },
              ),
              const SizedBox(height: 12),
              if (_linkType == 'URL')
                CustomTextField(
                  label: 'Link URL',
                  controller: _linkUrlCtrl,
                  hint: 'https://example.com',
                  keyboardType: TextInputType.url,
                  prefixIcon: Icons.link_outlined,
                ),
              if (_linkType == 'PDF') _buildPdfPicker(),
              if (_linkType == 'URL' || _linkType == 'PDF')
                const SizedBox(height: 12),
              CustomTextField(
                label: 'YouTube URL',
                controller: _youtubeCtrl,
                hint: 'Optional YouTube link',
                keyboardType: TextInputType.url,
                prefixIcon: Icons.ondemand_video_outlined,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Button Text',
                controller: _buttonTextCtrl,
                hint: 'e.g. Read more',
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Sort Order',
                controller: _sortCtrl,
                hint: '1',
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 16),
              _buildImagePicker(
                label: 'Logo',
                localPath: _logoLocalPath,
                existingPath: _existingLogoPath,
                onPick: () => _pickImage(true),
                onClear: () => setState(() {
                  _logoLocalPath = null;
                }),
              ),
              const SizedBox(height: 12),
              _buildImagePicker(
                label: 'Banner',
                localPath: _bannerLocalPath,
                existingPath: _existingBannerPath,
                onPick: () => _pickImage(false),
                onClear: () => setState(() {
                  _bannerLocalPath = null;
                }),
              ),
              const SizedBox(height: 16),
              if (_isEditing)
                SwitchListTile.adaptive(
                  value: _isActive,
                  onChanged: (v) => setState(() => _isActive = v),
                  title: Text('Active', style: AppTextStyles.bodyMedium),
                  activeColor: AppColors.primary,
                  contentPadding: EdgeInsets.zero,
                ),
              const SizedBox(height: 20),
              CustomButton(
                label: _isEditing ? 'Update' : 'Create',
                onPressed: _save,
                isLoading: _saving,
                fullWidth: true,
              ),
              const SizedBox(height: 24),
            ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPdfPicker() {
    final hasLocal = _pdfLocalPath != null;
    final hasExisting = (_existingPdfPath ?? '').isNotEmpty;
    String label;
    if (hasLocal) {
      label = 'Replace: ${_pdfLocalPath!.split(Platform.pathSeparator).last}';
    } else if (hasExisting) {
      label = 'Replace PDF';
    } else {
      label = 'Pick PDF';
    }
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: Text(label, overflow: TextOverflow.ellipsis),
            onPressed: _pickPdf,
          ),
        ),
        if (hasLocal)
          IconButton(
            tooltip: 'Clear',
            icon: const Icon(Icons.close, size: 18),
            onPressed: () => setState(() => _pdfLocalPath = null),
          ),
      ],
    );
  }

  Widget _buildImagePicker({
    required String label,
    required String? localPath,
    required String? existingPath,
    required VoidCallback onPick,
    required VoidCallback onClear,
  }) {
    final hasLocal = localPath != null;
    final remoteUrl = _absUrl(existingPath);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: AppTextStyles.bodyMedium
                .copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Row(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: AppColors.surface,
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(8),
              ),
              clipBehavior: Clip.antiAlias,
              child: hasLocal
                  ? Image.file(File(localPath), fit: BoxFit.cover)
                  : (remoteUrl != null
                      ? Image.network(
                          remoteUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(
                            Icons.broken_image_outlined,
                            color: AppColors.textSecondary,
                          ),
                        )
                      : const Icon(Icons.image_outlined,
                          color: AppColors.textSecondary)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.upload_outlined, size: 18),
                      label: Text(hasLocal || remoteUrl != null
                          ? 'Replace $label'
                          : 'Pick $label'),
                      onPressed: onPick,
                    ),
                  ),
                  if (hasLocal)
                    IconButton(
                      tooltip: 'Clear',
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: onClear,
                    ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
