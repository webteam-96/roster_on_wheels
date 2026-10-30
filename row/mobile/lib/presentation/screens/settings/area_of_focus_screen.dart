import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/custom_drawer.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _AreaOfFocus {
  final int id;
  final int moduleId;
  final String name;
  final String? imagePath;
  final int sortOrder;
  final bool isActive;

  const _AreaOfFocus({
    required this.id,
    required this.moduleId,
    required this.name,
    this.imagePath,
    required this.sortOrder,
    required this.isActive,
  });

  factory _AreaOfFocus.fromJson(Map<String, dynamic> j) => _AreaOfFocus(
        id: j['id'] as int? ?? 0,
        moduleId: j['moduleId'] as int? ?? 0,
        name: j['name'] as String? ?? '',
        imagePath: j['imagePath'] as String?,
        sortOrder: j['sortOrder'] as int? ?? 0,
        isActive: j['isActive'] as bool? ?? true,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class AreaOfFocusScreen extends StatefulWidget {
  const AreaOfFocusScreen({super.key});

  @override
  State<AreaOfFocusScreen> createState() => _AreaOfFocusScreenState();
}

class _AreaOfFocusScreenState extends State<AreaOfFocusScreen> {
  final _api = ApiClient();

  List<_AreaOfFocus> _items = [];
  bool _loading = true;
  String? _error;

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
      final resp = await _api.get<List<dynamic>>(
        '/api/area-of-focus',
        fromJson: (j) => j as List<dynamic>,
      );
      final rawItems = resp.data ?? [];
      setState(() {
        _items = rawItems
            .map((e) => _AreaOfFocus.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/area-of-focus/$id');
      setState(() => _items.removeWhere((a) => a.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Area of focus deleted'),
              backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Delete failed: $e'),
              backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _showForm({_AreaOfFocus? existing}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _AreaFormSheet(existing: existing, onSaved: _fetch),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Area of Focus'),
      drawer: const CustomDrawer(),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.primary,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _loading
          ? const ShimmerList(itemCount: 6, itemHeight: 80)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _items.isEmpty
                  ? EmptyStateWidget(
                      title: 'No Areas of Focus',
                      subtitle: 'Tap + to add a new area of focus.',
                      icon: Icons.track_changes_outlined,
                      actionLabel: 'Add Area',
                      onAction: () => _showForm(),
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: _fetch,
                      child: ListView.separated(
                        padding: (const EdgeInsets.all(16)).add(const EdgeInsets.only(bottom: 88)),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (ctx, i) {
                          final item = _items[i];
                          return _AreaCard(
                            item: item,
                            onEdit: () => _showForm(existing: item),
                            onDelete: () async {
                              final ok = await ConfirmationDialog.show(
                                context,
                                title: 'Delete Area of Focus',
                                message: 'Delete "${item.name}"?',
                              );
                              if (ok) _delete(item.id);
                            },
                          );
                        },
                      ),
                    ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _AreaCard extends StatelessWidget {
  final _AreaOfFocus item;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _AreaCard(
      {required this.item, required this.onEdit, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: item.imagePath != null && item.imagePath!.isNotEmpty
                  ? Image.network(
                      ApiConstants.mediaUrl(item.imagePath),
                      width: 48,
                      height: 48,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _placeholder(),
                    )
                  : _placeholder(),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name, style: AppTextStyles.bodyMedium),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text('Sort: ${item.sortOrder}',
                          style: AppTextStyles.caption),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: item.isActive
                              ? AppColors.success.withValues(alpha: 0.1)
                              : AppColors.error.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          item.isActive ? 'Active' : 'Inactive',
                          style: AppTextStyles.caption.copyWith(
                            color: item.isActive
                                ? AppColors.success
                                : AppColors.error,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            IconButton(
              icon:
                  const Icon(Icons.edit_outlined, size: 18, color: AppColors.primary),
              onPressed: onEdit,
              constraints: const BoxConstraints(),
              padding: const EdgeInsets.all(6),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline,
                  size: 18, color: AppColors.error),
              onPressed: onDelete,
              constraints: const BoxConstraints(),
              padding: const EdgeInsets.all(6),
            ),
          ],
        ),
      ),
    );
  }

  Widget _placeholder() {
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Icon(Icons.track_changes_outlined,
          size: 24, color: AppColors.primary),
    );
  }
}

// ---------------------------------------------------------------------------
// Form Sheet
// ---------------------------------------------------------------------------
class _AreaFormSheet extends StatefulWidget {
  final _AreaOfFocus? existing;
  final VoidCallback onSaved;

  const _AreaFormSheet({this.existing, required this.onSaved});

  @override
  State<_AreaFormSheet> createState() => _AreaFormSheetState();
}

class _AreaFormSheetState extends State<_AreaFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  final _nameCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  String? _selectedImagePath;
  String? _selectedImageName;
  String? _existingImagePath;
  bool _isActive = true;
  bool _saving = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final e = widget.existing!;
      _nameCtrl.text = e.name;
      _sortCtrl.text = e.sortOrder.toString();
      _isActive = e.isActive;
      _existingImagePath = e.imagePath;
    } else {
      _sortCtrl.text = '0';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.image);
    if (result != null && result.files.isNotEmpty) {
      setState(() {
        _selectedImagePath = result.files.first.path;
        _selectedImageName = result.files.first.name;
      });
    }
  }

  Future<String?> _uploadImage(String filePath) async {
    final resp = await _api.uploadFile(
      '/api/area-of-focus/upload',
      filePath: filePath,
      fieldName: 'file',
    );
    final data = resp.data as Map<String, dynamic>?;
    return data?['path'] as String?;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    try {
      String? imagePath = _existingImagePath;

      if (_selectedImagePath != null) {
        imagePath = await _uploadImage(_selectedImagePath!);
      }

      final body = {
        'name': _nameCtrl.text.trim(),
        'moduleId': _isEditing ? widget.existing!.moduleId : 0,
        'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 0,
        'isActive': _isActive,
        if (imagePath != null && imagePath.isNotEmpty) 'imagePath': imagePath,
      };

      if (_isEditing) {
        await _api.put('/api/area-of-focus/${widget.existing!.id}', body: body);
      } else {
        await _api.post('/api/area-of-focus', body: body);
      }

      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                _isEditing ? 'Area of focus updated' : 'Area of focus created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Save failed: $e'),
              backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                      color: AppColors.border,
                      borderRadius: BorderRadius.circular(2)),
                ),
              ),
              Text(
                  _isEditing ? 'Edit Area of Focus' : 'New Area of Focus',
                  style: AppTextStyles.h3),
              const SizedBox(height: 16),
              CustomTextField(
                label: 'Area Name *',
                controller: _nameCtrl,
                hint: 'e.g. Peace and Conflict Prevention',
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Name is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Sort Order',
                controller: _sortCtrl,
                hint: '0',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Active', style: AppTextStyles.label),
                  Switch(
                    value: _isActive,
                    onChanged: (v) => setState(() => _isActive = v),
                    activeThumbColor: AppColors.primary,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('Image', style: AppTextStyles.label),
              const SizedBox(height: 6),
              InkWell(
                onTap: _pickImage,
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.image_outlined, color: AppColors.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _selectedImageName ??
                              (_existingImagePath != null
                                  ? 'Image uploaded'
                                  : 'Select image'),
                          style: AppTextStyles.body.copyWith(
                            color: _selectedImageName != null
                                ? AppColors.textPrimary
                                : AppColors.textMuted,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (_selectedImageName != null || _existingImagePath != null)
                        const Icon(Icons.check_circle_outline,
                            color: AppColors.success, size: 18),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              CustomButton(
                label: _isEditing ? 'Update' : 'Create',
                onPressed: _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
