import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/services/mobile_version_service.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Blocking force-update dialog. Cannot be dismissed by tapping outside,
/// pressing back, or anything other than tapping "Update".
///
/// "Update" opens the platform store URL in the external store app.
Future<void> showForceUpdateDialog(
  BuildContext context, {
  required MobileVersionResult result,
}) async {
  // Re-show on dismiss to keep the user gated. The only way out is
  // tapping "Update", which leaves the app entirely.
  while (true) {
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _UpdateDialog(
        result: result,
        force: true,
        onLater: null,
      ),
    );
  }
}

/// Soft-update prompt. Returns once the user dismisses or taps Later/Update.
Future<void> showSoftUpdateDialog(
  BuildContext context, {
  required MobileVersionResult result,
}) async {
  await showDialog<void>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => _UpdateDialog(
      result: result,
      force: false,
      onLater: () => Navigator.of(ctx).pop(),
    ),
  );
}

class _UpdateDialog extends StatelessWidget {
  final MobileVersionResult result;
  final bool force;
  final VoidCallback? onLater;

  const _UpdateDialog({
    required this.result,
    required this.force,
    required this.onLater,
  });

  Future<void> _openStore(BuildContext context) async {
    final url = result.storeUrlForPlatform();
    if (url == null || url.isEmpty) return;
    final uri = Uri.parse(url);
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final hasMessage = result.message?.trim().isNotEmpty == true;
    final fallbackCopy = force
        ? "A newer version is required to keep using the app. Update now to get the latest features and fixes."
        : "A newer version of the app is available. Update now to get the latest features and fixes.";

    return PopScope(
      canPop: !force,
      child: Dialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
        backgroundColor: Colors.white,
        elevation: 24,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _Header(force: force),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      force ? 'Update Required' : 'Update Available',
                      textAlign: TextAlign.center,
                      style: AppTextStyles.h2.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      hasMessage ? result.message! : fallbackCopy,
                      textAlign: TextAlign.center,
                      style: AppTextStyles.body.copyWith(
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                    ),
                    if (result.requiredVersion != null &&
                        result.requiredVersion!.trim().isNotEmpty) ...[
                      const SizedBox(height: 20),
                      _VersionRow(
                        current: result.currentVersion,
                        required: result.requiredVersion!,
                      ),
                    ],
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton.icon(
                        onPressed: () async {
                          await _openStore(context);
                          if (force) {
                            // Belt-and-suspenders: also try to back the user
                            // out so the app effectively closes.
                            await SystemChannels.platform
                                .invokeMethod<void>('SystemNavigator.pop');
                          }
                        },
                        icon: const Icon(Icons.open_in_new_rounded, size: 18),
                        label: Text(
                          force ? 'Update Now' : 'Update',
                          style: AppTextStyles.button.copyWith(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ),
                    if (!force && onLater != null) ...[
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        height: 44,
                        child: TextButton(
                          onPressed: onLater,
                          style: TextButton.styleFrom(
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: Text(
                            'Maybe later',
                            style: AppTextStyles.button.copyWith(
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
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

class _Header extends StatelessWidget {
  final bool force;
  const _Header({required this.force});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Center(
        child: Container(
          width: 76,
          height: 76,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,

          ),
          child: Container(
            margin: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
            child: Icon(
              force
                  ? Icons.system_update_rounded
                  : Icons.cloud_download_rounded,
              color: Colors.white,
              size: 32,
            ),
          ),
        ),
      ),
    );
  }
}

class _VersionRow extends StatelessWidget {
  final String? current;
  final String required;
  const _VersionRow({required this.current, required this.required});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: 0.12),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (current != null && current!.trim().isNotEmpty)
            Expanded(
              child: _VersionBlock(
                label: 'Current',
                version: current!,
                emphasized: false,
              ),
            ),
          if (current != null && current!.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Icon(
                Icons.arrow_forward_rounded,
                size: 18,
                color: AppColors.primary.withValues(alpha: 0.7),
              ),
            ),
          Expanded(
            child: _VersionBlock(
              label: 'Latest',
              version: required,
              emphasized: true,
            ),
          ),
        ],
      ),
    );
  }
}

class _VersionBlock extends StatelessWidget {
  final String label;
  final String version;
  final bool emphasized;
  const _VersionBlock({
    required this.label,
    required this.version,
    required this.emphasized,
  });

  /// Display only: drop the `+build` (and `-prerelease`) suffix so the user
  /// sees a clean `59.0.18` instead of `59.0.18+132175`. Does not affect the
  /// version comparison, which still runs on the full string elsewhere.
  String get _display {
    var v = version.trim();
    final plus = v.indexOf('+');
    if (plus >= 0) v = v.substring(0, plus);
    final dash = v.indexOf('-');
    if (dash >= 0) v = v.substring(0, dash);
    return v;
  }

  @override
  Widget build(BuildContext context) {
    final color = emphasized ? AppColors.primary : AppColors.textSecondary;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          style: AppTextStyles.caption.copyWith(
            color: color.withValues(alpha: 0.7),
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 4),
        // Version strings carry a long `+build` suffix (e.g. 59.0.18+132175);
        // shrink-to-fit on one line so the number never wraps mid-digit.
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            _display,
            maxLines: 1,
            softWrap: false,
            textAlign: TextAlign.center,
            style: AppTextStyles.bodyMedium.copyWith(
              color: color,
              fontWeight: FontWeight.w800,
              fontSize: 15,
            ),
          ),
        ),
      ],
    );
  }
}
