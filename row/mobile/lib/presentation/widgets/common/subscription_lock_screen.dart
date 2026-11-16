import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/network/subscription_lock.dart';
import 'package:rotary_flutter_app/core/routing/app_router.dart';
import 'package:rotary_flutter_app/core/routing/route_names.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/presentation/providers/auth_provider.dart';

/// The app's locked screen (KIS/ROW/SUB/01 section 4.4). Mount ONCE in the
/// `MaterialApp` builder stack (see `app.dart`). It renders nothing until the
/// API client raises [subscriptionLock], then covers every screen: the server
/// refuses every app call for this member, so no screen behind it can load.
class SubscriptionLockScreen extends StatelessWidget {
  const SubscriptionLockScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String?>(
      valueListenable: subscriptionLock,
      builder: (context, message, _) {
        if (message == null) return const SizedBox.shrink();
        return Positioned.fill(
          child: Material(
            color: AppColors.background,
            child: SafeArea(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Available with Club subscription',
                          textAlign: TextAlign.center,
                          style: AppFonts.body(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'The app opens for members once the club has a Club '
                          'subscription. A club executive can subscribe on the '
                          'ROW website. Nothing has been deleted.',
                          textAlign: TextAlign.center,
                          style: AppFonts.body(
                            fontSize: 14,
                            color: AppColors.slate500,
                            height: 1.45,
                          ),
                        ),
                        const SizedBox(height: 28),
                        FilledButton(
                          // Clears the cover; the next refused call raises it
                          // again, so this is a real re-check, not a bypass.
                          onPressed: () => subscriptionLock.value = null,
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.rotaryBlue,
                            minimumSize: const Size.fromHeight(48),
                          ),
                          child: Text(
                            'Check again',
                            style: AppFonts.body(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextButton(
                          onPressed: () async {
                            final auth = context.read<AuthProvider>();
                            await auth.logout();
                            subscriptionLock.value = null;
                            appRouter?.go(RouteNames.login);
                          },
                          style: TextButton.styleFrom(
                            minimumSize: const Size.fromHeight(48),
                          ),
                          child: Text(
                            'Sign out',
                            style: AppFonts.body(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.rotaryBlue,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
