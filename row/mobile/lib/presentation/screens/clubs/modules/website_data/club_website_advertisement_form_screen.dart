import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

const _maxActiveAdvertisements = 10;

class ClubAdvertisementFormInitial {
  final int id;
  final String imagePath;
  final String? documentPath;
  final String? description;
  final int sortOrder;
  final bool isActive;
  final int yearId;
  const ClubAdvertisementFormInitial({
    required this.id,
    required this.imagePath,
    this.documentPath,
    this.description,
    required this.sortOrder,
    required this.isActive,
    required this.yearId,
  });
}

class ClubWebsiteAdvertisementFormScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final ClubAdvertisementFormInitial? initial;
  final int activeCountExcludingThis;

  const ClubWebsiteAdvertisementFormScreen({
    super.key,
    required this.clubId,
    required this.yearId,
    this.initial,
    required this.activeCountExcludingThis,
  });

  @override
  State<ClubWebsiteAdvertisementFormScreen> createState() =>
      _ClubWebsiteAdvertisementFormScreenState();
}

class _ClubWebsiteAdvertisementFormScreenState
    extends State<ClubWebsiteAdvertisementFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _descCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();

  String _imagePath = '';
  String? _documentPath;
  bool _isActive = true;
  bool _uploadingImage = false;
  bool _uploadingDocument = false;
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _imagePath = init.imagePath;
      _documentPath = init.documentPath;
      _descCtrl.text = init.description ?? '';
      _sortCtrl.text = init.sortOrder.toString();
      _isActive = init.isActive;
    } else {
      _sortCtrl.text = '1';
    }
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  String _absUrl(String path) => ApiConstants.mediaUrl(path);

  // Deployed upload endpoint sometimes returns just `filename.ext` instead of
  // the full `/uploads/advertisement/filename.ext` path. Normalize so the saved
  // value is always servable.
  String _normalizeAdPath(String path) {
    if (path.isEmpty) return path;
    if (path.startsWith('http')) return path;
    if (path.startsWith('/')) return path;
    return '/uploads/advertisement/$path';
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 100,
      maxWidth: 4096,
      maxHeight: 4096,
    );
    if (picked == null) return;

    // Lock the crop to 454:518 (≈ 0.88:1, portrait) — the exact ratio of the
    // live website's advertisement slot (measured: `aspect-[454/518]` +
    // object-cover on the club / district website). Matching it means nothing is
    // cropped when the ad is displayed. Rotate stays available.
    final cropped = await ImageCropper().cropImage(
      sourcePath: picked.path,
      aspectRatio: const CropAspectRatio(ratioX: 454, ratioY: 518),
      compressQuality: 95,
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: 'Crop Advertisement',
          toolbarColor: AppColors.primary,
          toolbarWidgetColor: Colors.white,
          activeControlsWidgetColor: AppColors.primary,
          lockAspectRatio: true,
          initAspectRatio: CropAspectRatioPreset.original,
        ),
        IOSUiSettings(
          title: 'Crop Advertisement',
          aspectRatioLockEnabled: true,
          aspectRatioPickerButtonHidden: true,
          resetAspectRatioEnabled: false,
        ),
      ],
    );
    if (cropped == null) return; // user cancelled the crop

    setState(() => _uploadingImage = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/advertisements/upload-image',
        filePath: cropped.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = _normalizeAdPath((resp.data?['path'] as String?) ?? '');
      if (newPath.isNotEmpty) {
        setState(() => _imagePath = newPath);
      }
    } catch (e) {
      _showError('Image upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploadingImage = false);
    }
  }

  Future<void> _pickDocument() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    if (result == null || result.files.isEmpty) return;
    final pickedPath = result.files.single.path;
    if (pickedPath == null) return;
    setState(() => _uploadingDocument = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/advertisements/upload-document',
        filePath: pickedPath,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = _normalizeAdPath((resp.data?['path'] as String?) ?? '');
      if (newPath.isNotEmpty) {
        setState(() => _documentPath = newPath);
      }
    } catch (e) {
      _showError('PDF upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploadingDocument = false);
    }
  }

  Future<void> _save() async {
    if (_imagePath.isEmpty) {
      _showError('Please pick an image');
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    final wasActive = widget.initial?.isActive ?? false;
    final willBeActive = _isActive;
    if (willBeActive &&
        !wasActive &&
        widget.activeCountExcludingThis >= _maxActiveAdvertisements) {
      _showError('Maximum $_maxActiveAdvertisements active advertisements allowed');
      return;
    }
    final body = {
      'advertisementImagePath': _imagePath,
      'documentPath': _documentPath,
      'description':
          _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
      'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 1,
      'isActive': willBeActive,
      if (!_isEdit) 'yearId': widget.yearId,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/website-data/advertisements/${widget.initial!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/website-data/advertisements',
          body: body,
        );
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

  bool get _busy => _saving || _uploadingImage || _uploadingDocument;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Advertisement' : 'Add Advertisement',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
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
                        letterSpacing: 0.3,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            _label('Image *'),
            const SizedBox(height: 8),
            _imageBox(),
            const SizedBox(height: 8),
            _imagePickerButton(),
            const SizedBox(height: 20),
            _label('Document (PDF, optional)'),
            const SizedBox(height: 8),
            _documentRow(),
            const SizedBox(height: 20),
            CustomTextField(
              label: 'Description',
              controller: _descCtrl,
              hint: 'Optional caption',
              maxLines: 2,
            ),
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Sort Order',
              controller: _sortCtrl,
              hint: '1',
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            _statusToggle(),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Text(
        text,
        style: AppTextStyles.bodyMedium.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w700,
        ),
      );

  Widget _imageBox() {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surface,
      ),
      // Ad slot is 454:518 (the website's slot), so shape the box to match and
      // use contain — the whole image shows at its true proportions, never cropped.
      child: AspectRatio(
        aspectRatio: 454 / 518,
        child: _imagePath.isNotEmpty
            ? Image.network(
                _absUrl(_imagePath),
                fit: BoxFit.contain,
                width: double.infinity,
                height: double.infinity,
                errorBuilder: (_, __, ___) => const Center(
                  child: const Icon(Icons.broken_image_outlined,
                      size: 40, color: AppColors.textSecondary),
                ),
              )
            : Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.image_outlined,
                        size: 44, color: AppColors.textSecondary),
                    const SizedBox(height: 6),
                    Text('No image selected',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary)),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _imagePickerButton() {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        icon: _uploadingImage
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.upload, size: 18),
        label: Text(
          _uploadingImage
              ? 'Uploading...'
              : (_imagePath.isEmpty ? 'Pick Image' : 'Replace Image'),
        ),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 12),
        ),
        onPressed: _busy ? null : _pickImage,
      ),
    );
  }

  Widget _documentRow() {
    final hasDoc = (_documentPath ?? '').isNotEmpty;
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(10),
            color: AppColors.surface,
          ),
          child: Row(
            children: [
              const Icon(Icons.picture_as_pdf_outlined,
                  size: 20, color: AppColors.textSecondary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  hasDoc ? _documentPath!.split('/').last : 'No PDF attached',
                  style: AppTextStyles.body.copyWith(
                    color:
                        hasDoc ? AppColors.textPrimary : AppColors.textSecondary,
                  ),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
              ),
              if (hasDoc)
                IconButton(
                  icon: const Icon(Icons.close, size: 20),
                  color: AppColors.error,
                  tooltip: 'Remove PDF',
                  onPressed:
                      _busy ? null : () => setState(() => _documentPath = null),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            icon: _uploadingDocument
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.attach_file, size: 18),
            label: Text(
              _uploadingDocument
                  ? 'Uploading...'
                  : (hasDoc ? 'Replace PDF' : 'Pick PDF'),
            ),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
            onPressed: _busy ? null : _pickDocument,
          ),
        ),
      ],
    );
  }

  Widget _statusToggle() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
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
                    color: _isActive ? AppColors.success : AppColors.textMuted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: _isActive,
            activeThumbColor: AppColors.primary,
            onChanged: _busy ? null : (v) => setState(() => _isActive = v),
          ),
        ],
      ),
    );
  }
}
