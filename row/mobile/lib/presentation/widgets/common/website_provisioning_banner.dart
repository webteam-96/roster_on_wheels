import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/services/website_provisioning_controller.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// App-wide floating status card for a club-website purchase that is still being
/// provisioned. Mounted once above the router (see `app.dart`) so it follows the
/// buyer across every screen: they can pay, leave the purchase page, and still
/// be told here (and by a notification + email) when the site is live or needs
/// attention. Renders nothing when no order is being tracked.
class WebsiteProvisioningBanner extends StatelessWidget {
  const WebsiteProvisioningBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<WebsiteProvisioningController>().state;
    if (state == null) return const SizedBox.shrink();

    final provisioning = state.phase == WebsiteProvisioningPhase.provisioning;
    final active = state.phase == WebsiteProvisioningPhase.active;

    final Color accent = active
        ? AppColors.success
        : provisioning
            ? AppColors.primary
            : AppColors.accentAmber;

    final String title = active
        ? 'Your website is live!'
        : provisioning
            ? 'Setting up your website…'
            : 'Almost there…';

    final String subtitle = active
        ? state.host
        : provisioning
            ? 'This can take a few minutes: we’ll notify you when it’s live.'
            : 'Taking a little longer than usual. We’ll email you as soon as it’s live.';

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(14),
        shadowColor: Colors.black.withValues(alpha: 0.18),
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(9),
                ),
                alignment: Alignment.center,
                child: provisioning
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.4, color: accent),
                      )
                    : Icon(
                        active
                            ? Icons.check_circle_rounded
                            : Icons.schedule_rounded,
                        color: accent,
                        size: 20,
                      ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: AppFonts.body(
                        fontSize: 11,
                        height: 1.25,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    if (active && (state.visitUrl ?? '').trim().isNotEmpty) ...[
                      const SizedBox(height: 6),
                      GestureDetector(
                        onTap: () => _open(state.visitUrl!),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Open website',
                              style: AppFonts.body(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                                color: AppColors.primary,
                              ),
                            ),
                            const SizedBox(width: 3),
                            const Icon(Icons.open_in_new_rounded,
                                size: 13, color: AppColors.primary),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              // Provisioning has no dismiss (like the web) — only terminal states.
              if (!provisioning)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  icon: const Icon(Icons.close_rounded,
                      size: 18, color: AppColors.slate500),
                  onPressed: () =>
                      context.read<WebsiteProvisioningController>().dismiss(),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url.trim());
    if (uri == null || !uri.hasScheme) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
