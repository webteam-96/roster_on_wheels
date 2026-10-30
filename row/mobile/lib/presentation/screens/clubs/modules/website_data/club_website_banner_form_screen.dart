import 'package:flutter/material.dart' hide Text;
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ClubBannerFormInitial {
  final int id;
  final String imagePath;
  final String? description;
  final int sortOrder;
  final bool isActive;
  const ClubBannerFormInitial({
    required this.id,
    required this.imagePath,
    this.description,
    required this.sortOrder,
    required this.isActive,
  });
}

class ClubWebsiteBannerFormScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final ClubBannerFormInitial? initial;

  const ClubWebsiteBannerFormScreen({
    super.key,
    required this.clubId,
    required this.yearId,
    this.initial,
  });

  @override
  State<ClubWebsiteBannerFormScreen> createState() =>
      _ClubWebsiteBannerFormScreenState();
}

class _ClubWebsiteBannerFormScreenState
    extends State<ClubWebsiteBannerFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _descCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();

  String _imagePath = '';
  bool _isActive = true;
  bool _uploading = false;
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _imagePath = init.imagePath;
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

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 100,
      maxWidth: 4096,
      maxHeight: 4096,
    );
    if (picked == null) return;

    // Let the user crop/rotate to the required banner shape before upload.
    // The aspect ratio is locked to 996:596 (≈ 5:3) — the exact ratio of the
    // live website's banner slot (measured: `aspect-[996/596]` + object-cover on
    // the club / district website). Matching it exactly means nothing is cropped when
    // the banner is displayed. The backend enforces no minimum dimensions, so we
    // don't reject on size — a bigger source just looks sharper.
    final cropped = await ImageCropper().cropImage(
      sourcePath: picked.path,
      aspectRatio: const CropAspectRatio(ratioX: 996, ratioY: 596),
      compressQuality: 95,
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: 'Crop Banner',
          toolbarColor: AppColors.primary,
          toolbarWidgetColor: Colors.white,
          activeControlsWidgetColor: AppColors.primary,
          lockAspectRatio: true,
          initAspectRatio: CropAspectRatioPreset.original,
        ),
        IOSUiSettings(
          title: 'Crop Banner',
          aspectRatioLockEnabled: true,
          aspectRatioPickerButtonHidden: true,
          resetAspectRatioEnabled: false,
        ),
      ],
    );
    if (cropped == null) return; // user cancelled the crop

    setState(() => _uploading = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/banners/upload',
        filePath: cropped.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      if (newPath.isNotEmpty) {
        setState(() => _imagePath = newPath);
      }
    } catch (e) {
      _showError('Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  /// Resolves the preview URL for [_imagePath]. A fresh upload returns a bare
  /// filename (the backend stores filename-only and rebuilds the URL on read),
  /// so it needs the /uploads/banner/ folder; an existing banner's path comes
  /// back already rooted and resolves directly.
  String _bannerPreviewUrl() {
    final p = _imagePath;
    if (p.isEmpty) return '';
    if (p.startsWith('http')) return p;
    final rooted = p.startsWith('/') ? p : '/uploads/banner/$p';
    return ApiConstants.mediaUrl(rooted);
  }

  Future<void> _save() async {
    if (_imagePath.isEmpty) {
      _showError('Please pick an image');
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    final body = {
      'bannerImagePath': _imagePath,
      'description':
          _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
      'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 1,
      'isActive': _isActive,
      if (!_isEdit) 'yearId': widget.yearId,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/website-data/banners/${widget.initial!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/website-data/banners',
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

  bool get _busy => _saving || _uploading;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Banner' : 'Add Banner',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _busy ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: const StadiumBorder(),
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
            Text(
              'Image *',
              style: AppTextStyles.bodyMedium.copyWith(
                color: AppColors.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            _imageBox(),
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
                    : const Icon(Icons.upload, size: 18),
                label: Text(
                  _uploading
                      ? 'Uploading...'
                      : (_imagePath.isEmpty ? 'Pick Image' : 'Replace Image'),
                ),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                onPressed: _busy ? null : _pickImage,
              ),
            ),
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

  Widget _imageBox() {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surface,
      ),
      // Banner is 996:596 (the website's slot), so shape the box to match and
      // use contain — the whole image shows at its true proportions, never cropped.
      child: AspectRatio(
        aspectRatio: 996 / 596,
        child: _imagePath.isNotEmpty
            ? Image.network(
                _bannerPreviewUrl(),
                fit: BoxFit.contain,
                width: double.infinity,
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
                    color:
                        _isActive ? AppColors.success : AppColors.textMuted,
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
