import 'package:flutter/material.dart' hide Text;
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// Club Website → Logos management (parity with the web
/// `/clubs/[id]/website-data/logos` page).
///
/// Two per-club logos stored on `club_master`:
///   • Club Logo   — SQUARE (1:1). Same column the club add/edit page reads, so
///                   changing it here also updates the club profile page.
///   • Rotary Logo — HORIZONTAL (3.75:1). The club's branded Rotary mark shown
///                   in the public website header.
///
/// Flow (mirrors the banner form): pick image → crop to the locked aspect →
/// upload to the matching endpoint (returns a bare filename) → keep that
/// filename in state + refresh the preview → on Save, PUT both filenames.
class ClubWebsiteLogosScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteLogosScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteLogosScreen> createState() => _ClubWebsiteLogosScreenState();
}

class _ClubWebsiteLogosScreenState extends State<ClubWebsiteLogosScreen> {
  final _api = ApiClient();

  // Current stored values. On load these hold the resolved paths the GET
  // returns (rooted `/Documents/...`); after an upload they hold the fresh bare
  // filename the upload endpoint returns. Both resolve to a preview URL below,
  // and both are valid to PUT back on Save (the backend accepts either shape).
  String? _clubLogoPath;
  String? _rotaryLogoPath;

  bool _loading = true;
  bool _clubUploading = false;
  bool _rotaryUploading = false;
  bool _saving = false;

  bool get _busy => _saving || _clubUploading || _rotaryUploading;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/logos',
        fromJson: (j) => (j as Map).cast<String, dynamic>(),
      );
      if (!mounted) return;
      final data = resp.data ?? const <String, dynamic>{};
      // The deployed backend returns already-resolved `*Url` fields; accept the
      // documented `*Path` keys too so the screen works either way.
      setState(() {
        _clubLogoPath = _str(data['clubLogoUrl']) ?? _str(data['clubLogoPath']);
        _rotaryLogoPath =
            _str(data['rotaryLogoUrl']) ?? _str(data['rotaryLogoPath']);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      SnackbarUtils.showError(context, 'Failed to load logos: $e');
    }
  }

  static String? _str(dynamic v) {
    final s = v?.toString();
    return (s == null || s.isEmpty) ? null : s;
  }

  /// Pick → crop (to [aspect]) → upload to [uploadPath]. On success stores the
  /// returned bare filename via [onUploaded] and refreshes the preview.
  Future<void> _pickCropUpload({
    required String title,
    required CropAspectRatio aspect,
    required String uploadPath,
    required void Function(bool) setUploading,
    required void Function(String) onUploaded,
  }) async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 100,
      maxWidth: 4096,
      maxHeight: 4096,
    );
    if (picked == null) return;

    // Lock the aspect so "what you crop is what the website shows" — no
    // surprise letterboxing or distortion. The backend enforces no minimum
    // dimensions, so a larger source just looks sharper.
    final cropped = await ImageCropper().cropImage(
      sourcePath: picked.path,
      aspectRatio: aspect,
      compressQuality: 95,
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: title,
          toolbarColor: AppColors.primary,
          toolbarWidgetColor: Colors.white,
          activeControlsWidgetColor: AppColors.primary,
          lockAspectRatio: true,
          initAspectRatio: CropAspectRatioPreset.original,
        ),
        IOSUiSettings(
          title: title,
          aspectRatioLockEnabled: true,
          aspectRatioPickerButtonHidden: true,
          resetAspectRatioEnabled: false,
        ),
      ],
    );
    if (cropped == null) return; // user cancelled the crop

    setState(() => setUploading(true));
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        uploadPath,
        filePath: cropped.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final newPath = (resp.data?['path'] as String?) ?? '';
      if (newPath.isNotEmpty) {
        setState(() => onUploaded(newPath));
      }
    } catch (e) {
      if (!mounted) return;
      SnackbarUtils.showError(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => setUploading(false));
    }
  }

  Future<void> _pickClubLogo() => _pickCropUpload(
        title: 'Crop Club Logo',
        aspect: const CropAspectRatio(ratioX: 1, ratioY: 1),
        uploadPath: '/api/clubs/${widget.clubId}/upload-club-logo',
        setUploading: (v) => _clubUploading = v,
        onUploaded: (p) => _clubLogoPath = p,
      );

  Future<void> _pickRotaryLogo() => _pickCropUpload(
        title: 'Crop Rotary Logo',
        aspect: const CropAspectRatio(ratioX: 300, ratioY: 80),
        uploadPath: '/api/clubs/${widget.clubId}/upload-rotary-logo',
        setUploading: (v) => _rotaryUploading = v,
        onUploaded: (p) => _rotaryLogoPath = p,
      );

  /// Resolves a preview URL for the club logo. A fresh upload returns a bare
  /// filename that lives in `/Documents/group/`; an existing value comes back
  /// already rooted (`/Documents/...`) and resolves directly. Mirrors the
  /// backend's `BuildClubLogoUrl`.
  String _clubLogoPreviewUrl() =>
      _previewUrl(_clubLogoPath, '/Documents/group/');

  /// Resolves a preview URL for the Rotary logo. A fresh upload lands in the
  /// per-club `/Documents/WebsiteData/Group{clubId}/LOGO/` folder. Mirrors the
  /// backend's `BuildRotaryLogoUrl`.
  String _rotaryLogoPreviewUrl() => _previewUrl(
      _rotaryLogoPath, '/Documents/WebsiteData/Group${widget.clubId}/LOGO/');

  String _previewUrl(String? path, String bareFolder) {
    final p = path;
    if (p == null || p.isEmpty) return '';
    if (p.startsWith('http')) return p;
    final rooted = p.startsWith('/') ? p : '$bareFolder$p';
    return ApiConstants.mediaUrl(rooted);
  }

  Future<void> _save() async {
    final body = <String, dynamic>{
      if (_clubLogoPath != null && _clubLogoPath!.isNotEmpty)
        'clubLogoPath': _clubLogoPath,
      if (_rotaryLogoPath != null && _rotaryLogoPath!.isNotEmpty)
        'rotaryLogoPath': _rotaryLogoPath,
    };
    setState(() => _saving = true);
    try {
      await _api.put('/api/clubs/${widget.clubId}/logos', body: body);
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Logos saved.');
    } catch (e) {
      if (!mounted) return;
      SnackbarUtils.showError(context, 'Save failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Logos',
        onBack: _busy ? null : () => Navigator.of(context).pop(),
      ),
      body: _loading
          ? const RowSkeletonList()
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                _logoCard(
                  title: 'Club Logo',
                  helper:
                      'Your club emblem. Also used on the club profile page. '
                      'Square (1:1).',
                  previewUrl: _clubLogoPreviewUrl(),
                  aspectRatio: 1,
                  hasLogo: _clubLogoPath != null && _clubLogoPath!.isNotEmpty,
                  uploading: _clubUploading,
                  onPressed: _busy ? null : _pickClubLogo,
                ),
                const SizedBox(height: 16),
                _logoCard(
                  title: 'Rotary Logo',
                  helper:
                      'Horizontal Rotary logo shown in the website header. '
                      'Wide (3.75:1).',
                  previewUrl: _rotaryLogoPreviewUrl(),
                  aspectRatio: 300 / 80,
                  hasLogo:
                      _rotaryLogoPath != null && _rotaryLogoPath!.isNotEmpty,
                  uploading: _rotaryUploading,
                  onPressed: _busy ? null : _pickRotaryLogo,
                ),
              ],
            ),
      bottomNavigationBar: _loading
          ? null
          : SafeArea(
              minimum: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _busy ? null : _save,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: const StadiumBorder(),
                  ),
                  child: _saving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          'Save',
                          style: AppFonts.body(
                            fontWeight: FontWeight.w800,
                            fontSize: 14,
                            letterSpacing: 0.3,
                          ),
                        ),
                ),
              ),
            ),
    );
  }

  Widget _logoCard({
    required String title,
    required String helper,
    required String previewUrl,
    required double aspectRatio,
    required bool hasLogo,
    required bool uploading,
    required VoidCallback? onPressed,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: AppTextStyles.bodyMedium.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            helper,
            style: AppTextStyles.caption
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 12),
          _preview(previewUrl, aspectRatio),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              icon: uploading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload, size: 18),
              label: Text(
                uploading
                    ? 'Uploading...'
                    : (hasLogo ? 'Change $title' : 'Upload $title'),
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              onPressed: onPressed,
            ),
          ),
        ],
      ),
    );
  }

  Widget _preview(String url, double aspectRatio) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(10),
        color: Colors.white,
      ),
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: url.isNotEmpty
            ? Image.network(
                url,
                fit: BoxFit.contain,
                width: double.infinity,
                errorBuilder: (_, __, ___) => const Center(
                  child: Icon(Icons.broken_image_outlined,
                      size: 40, color: AppColors.textSecondary),
                ),
              )
            : Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.image_outlined,
                        size: 40, color: AppColors.textSecondary),
                    const SizedBox(height: 6),
                    Text('No logo uploaded yet',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary)),
                  ],
                ),
              ),
      ),
    );
  }
}
