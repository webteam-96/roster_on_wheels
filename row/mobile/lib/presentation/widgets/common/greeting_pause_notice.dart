import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Greetings Settings (club + district) — explains the 1-July pause rule.
/// Mobile twin of web's `GreetingPauseNotice`.
///
/// The rule lives in GreetingsJob and is mirrored by the settings endpoint: a
/// club/district whose custom message was last saved for an EARLIER Rotary year
/// has every greeting channel skipped — email, push and the digest —
/// so last year's DG / President names can never go out. Saving this screen for
/// the current year resumes them.
///
/// Blank messages never pause: the worker sends its own neutral default text,
/// so there is nothing stale to hold back.
///
/// This matters more on mobile than on web: without it the feature simply stops
/// on 1 July with no visible cause, and an admin who only uses the app has no
/// way to find out why.
class GreetingPauseNotice extends StatelessWidget {
  /// Server's `isGreetingPaused` — do NOT recompute this on the client; the
  /// rule (and the "blank never pauses" exemption) belongs to the worker.
  final bool paused;

  /// `greetingReviewedYearLabel` — the year the message was last saved for.
  /// Null when the club/district has never saved one.
  final String? reviewedYear;

  /// `currentYearLabel` — the Rotary year greetings are paused *for*.
  final String? currentYear;

  const GreetingPauseNotice({
    super.key,
    required this.paused,
    this.reviewedYear,
    this.currentYear,
  });

  @override
  Widget build(BuildContext context) {
    final cy = (currentYear ?? '').trim();
    final ry = (reviewedYear ?? '').trim();

    if (!paused) {
      // Same standing explainer web shows to everyone who isn't paused, so the
      // rule is discoverable BEFORE it bites on 1 July.
      return _card(
        background: AppColors.infoLight,
        border: AppColors.info.withValues(alpha: 0.35),
        icon: Icons.info_outline_rounded,
        iconColor: AppColors.info,
        child: Text(
          'Every 1 July, greetings with a custom message pause until this page '
          'is saved again for the new Rotary year.',
          style: AppFonts.body(
            fontSize: 12,
            height: 1.35,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
          ),
        ),
      );
    }

    return _card(
      background: AppColors.errorLight,
      border: AppColors.error.withValues(alpha: 0.45),
      icon: Icons.warning_amber_rounded,
      iconColor: AppColors.error,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Birthday & anniversary greetings are paused'
            '${cy.isNotEmpty ? ' for $cy' : ''}.',
            style: AppFonts.body(
              fontSize: 13,
              height: 1.3,
              fontWeight: FontWeight.w800,
              color: AppColors.error,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            'These messages were last saved '
            '${ry.isNotEmpty ? 'for $ry' : 'in an earlier Rotary year'} and may '
            'still carry last year\'s names. Review the messages below, remove '
            'any old names, and tap Save Settings to resume greetings.',
            style: AppFonts.body(
              fontSize: 12,
              height: 1.35,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _card({
    required Color background,
    required Color border,
    required IconData icon,
    required Color iconColor,
    required Widget child,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 19, color: iconColor),
          const SizedBox(width: 10),
          Expanded(child: child),
        ],
      ),
    );
  }
}
