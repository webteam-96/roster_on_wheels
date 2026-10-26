import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import '../../../core/theme/app_text_styles.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// Membership Dues support contact — shown when a club has no dues set up
// (the backend has no separate "subscription" flag, so any club absent from
// `/api/mobile/my-membership-dues` is treated as not yet activated).
// The instance's support contacts (api/public/brand).
List<String> get kDuesSupportPhones => Brand.current.supportPhones;
String get kDuesSupportEmail => Brand.current.supportEmail;
String get kDuesSupportHours => Brand.current.supportHours;

/// Compact, polished popup explaining Membership Dues isn't active for the club
/// yet, with tappable Call / Email contacts. Shared by the home dues picker and
/// the club dashboard so both look identical.
void showDuesSubscriptionDialog(BuildContext context, {String? clubName}) {
  final club = (clubName ?? '').trim();
  showDialog<void>(
    context: context,
    builder: (ctx) => Dialog(
      backgroundColor: AppColors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 40, vertical: 24),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Gradient header ──────────────────────────────────────────────
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
            decoration: const BoxDecoration(gradient: AppGradients.royalSweep),
            child: Column(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.white.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                    border: Border.all(
                        color: AppColors.white.withValues(alpha: 0.30)),
                  ),
                  child: const Icon(Icons.card_membership_rounded,
                      color: AppColors.white, size: 22),
                ),
                const SizedBox(height: 9),
                Text(
                  'Activation Required',
                  style: AppTextStyles.bodyLarge.copyWith(
                    color: AppColors.white,
                    fontWeight: FontWeight.w700,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 3),
                Text(
                  club.isEmpty
                      ? "Club Dues isn't active for this club yet."
                      : "Club Dues isn't active for $club yet.",
                  textAlign: TextAlign.center,
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.white.withValues(alpha: 0.88),
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),

          // ── Body ─────────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'FOR ACTIVATION, PLEASE CONTACT',
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.textMuted,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 9),
                for (final p in kDuesSupportPhones) ...[
                  _DuesContactTile(
                    icon: Icons.call_rounded,
                    label: 'Call',
                    value: p,
                    onTap: () => _launchDuesContact(
                      ctx,
                      uri: Uri(scheme: 'tel', path: p.replaceAll(' ', '')),
                      copyValue: p,
                      noun: 'Phone number',
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                _DuesContactTile(
                  icon: Icons.mail_rounded,
                  label: 'Email',
                  value: kDuesSupportEmail,
                  onTap: () => _launchDuesContact(
                    ctx,
                    uri: Uri(scheme: 'mailto', path: kDuesSupportEmail),
                    copyValue: kDuesSupportEmail,
                    noun: 'Email',
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Icon(Icons.schedule_rounded,
                        size: 15, color: AppColors.textMuted),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        kDuesSupportHours,
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.textSecondary,
                          fontSize: 11.5,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: AppColors.white,
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(11)),
                    ),
                    onPressed: () => Navigator.of(ctx).pop(),
                    child: Text('Close', style: AppTextStyles.buttonSmall),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

// Open the tel:/mailto: target. If the device has no handler app (e.g. no email
// client configured — Android logs "component name … is null" and the launch
// fails), fall back to copying the number/address to the clipboard and telling
// the user, so the contact is never a dead tap.
Future<void> _launchDuesContact(
  BuildContext context, {
  required Uri uri,
  required String copyValue,
  required String noun,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (ok) return;
  } catch (_) {
    // fall through to the clipboard fallback
  }
  await Clipboard.setData(ClipboardData(text: copyValue));
  messenger.showSnackBar(
    SnackBar(content: Text('No app found to open it. $noun copied: $copyValue')),
  );
}

/// A tappable contact row: leading type icon, a small label over the value, and
/// a trailing chevron. The value (long emails included) is scaled down to fit on
/// a single line so it never wraps mid-word.
class _DuesContactTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;
  const _DuesContactTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primaryLight.withValues(alpha: 0.45),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 16, color: AppColors.primary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      label,
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.textMuted,
                        fontSize: 10.5,
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          value,
                          maxLines: 1,
                          style: AppTextStyles.bodySemiBold.copyWith(
                            color: AppColors.textPrimary,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Icon(Icons.chevron_right_rounded,
                  size: 18, color: AppColors.primary.withValues(alpha: 0.7)),
            ],
          ),
        ),
      ),
    );
  }
}
