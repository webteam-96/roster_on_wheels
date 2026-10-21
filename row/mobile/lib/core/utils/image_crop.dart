import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import '../theme/app_colors.dart';

/// Free-form image crop — no locked aspect ratio, so the user can crop the
/// picked image to whatever shape they want (with optional preset buttons for
/// convenience). Returns the cropped file path, or `null` if the user cancels.
///
/// Used by the Announcement and Upcoming-Event image uploads, where the picture
/// has no fixed ratio (unlike the website banner/ad, which lock a ratio).
///
/// Output is forced to **PNG**: the server's gallery upload pipeline reliably
/// stores PNGs, but silently dropped the file (created the DB row, no file on
/// disk → 404) for the cropper's default JPEG output — iOS JPEGs can carry a
/// colour profile/orientation the server decoder rejects. PNG is lossless and
/// sidesteps that; maxWidth/maxHeight cap the result so a lossless PNG still
/// stays well under the 10 MB upload limit.
Future<String?> cropImageFree(
  String sourcePath, {
  String title = 'Crop Image',
}) async {
  final cropped = await ImageCropper().cropImage(
    sourcePath: sourcePath,
    compressFormat: ImageCompressFormat.png,
    compressQuality: 100,
    maxWidth: 2048,
    maxHeight: 2048,
    uiSettings: [
      AndroidUiSettings(
        toolbarTitle: title,
        toolbarColor: AppColors.primary,
        toolbarWidgetColor: Colors.white,
        activeControlsWidgetColor: AppColors.primary,
        // Free-form: no locked ratio; start from the image's own ratio.
        lockAspectRatio: false,
        initAspectRatio: CropAspectRatioPreset.original,
        aspectRatioPresets: const [
          CropAspectRatioPreset.original,
          CropAspectRatioPreset.square,
          CropAspectRatioPreset.ratio4x3,
          CropAspectRatioPreset.ratio16x9,
        ],
      ),
      IOSUiSettings(
        title: title,
        aspectRatioLockEnabled: false,
        resetAspectRatioEnabled: true,
        aspectRatioPresets: const [
          CropAspectRatioPreset.original,
          CropAspectRatioPreset.square,
          CropAspectRatioPreset.ratio4x3,
          CropAspectRatioPreset.ratio16x9,
        ],
      ),
    ],
  );
  return cropped?.path;
}
