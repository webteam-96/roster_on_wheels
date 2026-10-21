import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

const _linkTypes = <(String, String)>[
  ('page', 'Page'),
  ('external', 'External Link'),
  ('document', 'Document'),
];

class ClubMenuFormInitial {
  final int? menuId;
  final int? subMenuId;
  final int? parentMenuId;
  final String name;
  final String linkType;
  final String linkValue;
  final int sortOrder;
  final bool isActive;
  const ClubMenuFormInitial({
    this.menuId,
    this.subMenuId,
    this.parentMenuId,
    required this.name,
    required this.linkType,
    required this.linkValue,
    required this.sortOrder,
    required this.isActive,
  });
}

class ClubWebsiteMenuFormScreen extends StatefulWidget {
  final int clubId;
  final ClubMenuFormInitial? initial;
  final int defaultSortOrder;
  final bool isSub;
  final int? parentMenuId;

  const ClubWebsiteMenuFormScreen({
    super.key,
    required this.clubId,
    this.initial,
    required this.defaultSortOrder,
    required this.isSub,
    this.parentMenuId,
  });

  @override
  State<ClubWebsiteMenuFormScreen> createState() =>
      _ClubWebsiteMenuFormScreenState();
}

class _ClubWebsiteMenuFormScreenState extends State<ClubWebsiteMenuFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _valueCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();

  String _linkType = 'page';
  bool _isActive = true;
  bool _uploading = false;
  bool _saving = false;

  bool get _isEdit =>
      (widget.initial?.menuId ?? widget.initial?.subMenuId) != null;
  bool get _busy => _saving || _uploading;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _nameCtrl.text = init.name;
      _valueCtrl.text = init.linkValue;
      _sortCtrl.text = init.sortOrder.toString();
      _linkType = init.linkType;
      _isActive = init.isActive;
    } else {
      _sortCtrl.text = widget.defaultSortOrder.toString();
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _valueCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickPdf() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    if (result == null || result.files.isEmpty) return;
    final pickedPath = result.files.single.path;
    if (pickedPath == null) return;
    setState(() => _uploading = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/menu_list/upload-document',
        filePath: pickedPath,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      if (newPath.isNotEmpty) {
        setState(() => _valueCtrl.text = newPath);
      }
    } catch (e) {
      _showError('Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = <String, dynamic>{
      if (widget.isSub)
        'subMenuName': _nameCtrl.text.trim()
      else
        'menuName': _nameCtrl.text.trim(),
      'linkType': _linkType,
      'linkValue': _valueCtrl.text.trim(),
      'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 1,
      'isActive': _isActive,
    };
    setState(() => _saving = true);
    try {
      if (widget.isSub) {
        final pid = widget.parentMenuId!;
        if (widget.initial?.subMenuId != null) {
          await _api.put(
            '/api/clubs/${widget.clubId}/website-data/menu_list/$pid/submenus/${widget.initial!.subMenuId}',
            body: body,
          );
        } else {
          await _api.post(
            '/api/clubs/${widget.clubId}/website-data/menu_list/$pid/submenus',
            body: body,
          );
        }
      } else {
        if (widget.initial?.menuId != null) {
          await _api.put(
            '/api/clubs/${widget.clubId}/website-data/menu_list/${widget.initial!.menuId}',
            body: body,
          );
        } else {
          await _api.post(
            '/api/clubs/${widget.clubId}/website-data/menu_list',
            body: body,
          );
        }
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      _showError('Save failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = _isEdit
        ? (widget.isSub ? 'Edit Sub-Menu' : 'Edit Menu')
        : (widget.isSub ? 'Add Sub-Menu' : 'Add Menu');
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: title,
        onBack: _busy ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _busy ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.goldPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.black54,
                      ),
                    )
                  : Text(
                      'Save',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            CustomTextField(
              label: widget.isSub ? 'Sub-Menu Name' : 'Menu Name',
              controller: _nameCtrl,
              hint: 'Enter name',
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Name is required' : null,
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _linkType,
              decoration: InputDecoration(
                labelText: 'Link Type',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
              items: _linkTypes
                  .map((t) =>
                      DropdownMenuItem(value: t.$1, child: Text(t.$2)))
                  .toList(),
              onChanged: _busy
                  ? null
                  : (v) => setState(() => _linkType = v ?? 'page'),
            ),
            const SizedBox(height: 16),
            CustomTextField(
              label: _linkType == 'document'
                  ? 'Document Path'
                  : (_linkType == 'external'
                      ? 'External URL'
                      : 'Page Path'),
              controller: _valueCtrl,
              hint: _linkType == 'document'
                  ? 'Pick a PDF below'
                  : (_linkType == 'external' ? 'https://...' : '/about'),
            ),
            if (_linkType == 'document') ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: _uploading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.picture_as_pdf_outlined, size: 18),
                  label: Text(
                    _uploading
                        ? 'Uploading...'
                        : (_valueCtrl.text.trim().isEmpty
                            ? 'Pick PDF'
                            : 'Replace PDF'),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  onPressed: _busy ? null : _pickPdf,
                ),
              ),
            ],
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Sort Order',
              controller: _sortCtrl,
              hint: '1',
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(10),
                color: AppColors.surface,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Status', style: AppTextStyles.bodyMedium),
                        const SizedBox(height: 2),
                        Text(
                          _isActive ? 'Active' : 'Inactive',
                          style: AppTextStyles.caption.copyWith(
                            color: _isActive
                                ? AppColors.success
                                : AppColors.textMuted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Switch.adaptive(
                    value: _isActive,
                    activeThumbColor: AppColors.primary,
                    onChanged: _busy
                        ? null
                        : (v) => setState(() => _isActive = v),
                  ),
                ],
              ),
            ),
          ],
          ),
        ),
      ),
    );
  }
}
