import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class PphCampFormInitial {
  final int id;
  final String title;
  final String description;
  final String address;
  final DateTime? campDate;
  final String? campLogoPath;
  const PphCampFormInitial({
    required this.id,
    required this.title,
    required this.description,
    required this.address,
    this.campDate,
    this.campLogoPath,
  });
}

class DistrictRniCampFormScreen extends StatefulWidget {
  final int districtId;
  final PphCampFormInitial? initial;

  const DistrictRniCampFormScreen({
    super.key,
    required this.districtId,
    this.initial,
  });

  @override
  State<DistrictRniCampFormScreen> createState() =>
      _DistrictRniCampFormScreenState();
}

class _DistrictRniCampFormScreenState extends State<DistrictRniCampFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _addrCtrl = TextEditingController();

  DateTime? _campDate;
  String? _existingLogoPath;
  String? _pickedImagePath;
  bool _removeExistingLogo = false;
  bool _saving = false;

  bool get _isEdit => widget.initial != null;
  bool get _hasImage =>
      _pickedImagePath != null ||
      (!_removeExistingLogo &&
          _existingLogoPath != null &&
          _existingLogoPath!.isNotEmpty);

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _titleCtrl.text = init.title;
      _descCtrl.text = init.description;
      _addrCtrl.text = init.address;
      _campDate = init.campDate;
      _existingLogoPath = init.campLogoPath;
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _addrCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final picked =
        await picker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 2560, maxHeight: 2560);
    if (picked == null) return;
    setState(() {
      _pickedImagePath = picked.path;
      _removeExistingLogo = false;
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _campDate ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() => _campDate = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_campDate == null) {
      _showError('Please select camp date');
      return;
    }
    setState(() => _saving = true);
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_campDate!);
      final title = _titleCtrl.text.trim();
      final desc = _descCtrl.text.trim();
      final addr = _addrCtrl.text.trim();
      final base = '/api/district-modules/${widget.districtId}/pph-camps';

      final fields = <String, String>{
        'title': title,
        'description': desc,
        'address': addr,
        'campDate': dateStr,
        if (_isEdit) 'isActive': 'true',
      };
      final files = _pickedImagePath != null
          ? <String, String>{'logo': _pickedImagePath!}
          : null;

      await _api.sendMultipart(
        _isEdit ? '$base/${widget.initial!.id}' : base,
        method: _isEdit ? 'PUT' : 'POST',
        fields: fields,
        files: files,
      );
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

  String _formatDate(DateTime d) => DateFormat('dd MMM yyyy').format(d);

  Widget _placeholderIcon() => const Center(
        child: const Icon(Icons.medical_services_outlined,
            color: AppColors.textSecondary, size: 36),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit PPH Camp' : 'Add PPH Camp',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _saving ? null : _save,
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
            _logoBlock(),
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Title *',
              controller: _titleCtrl,
              hint: 'Camp title',
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Title required' : null,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Description',
              controller: _descCtrl,
              hint: 'Optional description',
              maxLines: 3,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Address',
              controller: _addrCtrl,
              hint: 'Venue / address',
              maxLines: 2,
            ),
            const SizedBox(height: 12),
            InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: _saving ? null : _pickDate,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: 'Camp Date *',
                  border:
                      OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  suffixIcon:
                      const Icon(Icons.calendar_today_outlined, size: 18),
                ),
                child: Text(
                  _campDate != null ? _formatDate(_campDate!) : 'Select date',
                  style: AppTextStyles.body.copyWith(
                    color: _campDate != null
                        ? AppColors.textPrimary
                        : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }

  Widget _logoBlock() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(12),
        color: AppColors.surface,
      ),
      child: Row(
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: AppColors.background,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.border),
            ),
            clipBehavior: Clip.antiAlias,
            child: _pickedImagePath != null
                ? Image.file(
                    File(_pickedImagePath!),
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => _placeholderIcon(),
                  )
                : (!_removeExistingLogo &&
                        _existingLogoPath != null &&
                        _existingLogoPath!.isNotEmpty)
                    ? Image.network(
                        ApiConstants.mediaUrl(_existingLogoPath!),
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _placeholderIcon(),
                      )
                    : _placeholderIcon(),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Camp Logo',
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.photo_library_outlined, size: 18),
                    label: Text(_hasImage ? 'Replace Logo' : 'Pick Logo'),
                    onPressed: _saving ? null : _pickImage,
                  ),
                ),
                if (_hasImage)
                  TextButton.icon(
                    icon: const Icon(Icons.close,
                        size: 16, color: AppColors.error),
                    label: const Text('Remove',
                        style: TextStyle(color: AppColors.error)),
                    onPressed: _saving
                        ? null
                        : () => setState(() {
                              _pickedImagePath = null;
                              _removeExistingLogo = true;
                            }),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
