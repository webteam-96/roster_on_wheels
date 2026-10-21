import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:provider/provider.dart';
import 'core/features/feature_controller.dart';
import 'core/maintenance/maintenance_controller.dart';
import 'core/notifications/notification_badge_service.dart';
import 'core/routing/app_router.dart';
import 'core/services/website_provisioning_controller.dart';
import 'core/theme/app_colors.dart';
import 'core/theme/app_theme.dart';
import 'presentation/providers/auth_provider.dart';
import 'presentation/widgets/common/role_changed_dialog.dart';
import 'presentation/widgets/common/website_provisioning_banner.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';

class RotaryApp extends StatefulWidget {
  const RotaryApp({super.key});

  @override
  State<RotaryApp> createState() => _RotaryAppState();
}

class _RotaryAppState extends State<RotaryApp> with WidgetsBindingObserver {
  late final AuthProvider _authProvider;
  late final MaintenanceController _maintenance;
  late final FeatureController _features;
  late final WebsiteProvisioningController _websiteProvisioning;

  @override
  void initState() {
    super.initState();
    _authProvider = AuthProvider();
    _maintenance = MaintenanceController(_authProvider);
    _features = FeatureController(_authProvider);
    _websiteProvisioning = WebsiteProvisioningController();
    // Re-attach to a website purchase that was still provisioning last time.
    _websiteProvisioning.resume();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _maintenance.dispose();
    _features.dispose();
    _websiteProvisioning.dispose();
    _authProvider.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _authProvider.checkAuthStatus();
      // Pick up any maintenance flags toggled while the app was backgrounded.
      _maintenance.refresh(force: true);
      _features.refresh();
      // Recompute the notification bell's unread badge for any push that landed
      // while the app was backgrounded (the badge otherwise only updated on a
      // full home remount / relaunch).
      // ignore: unawaited_futures
      NotificationBadgeService.instance.refresh();
      // Timers pause in the background — catch up on any in-progress website
      // provisioning (and fire the "live"/"issue" notification if it finished).
      _websiteProvisioning.resume();
    }
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _authProvider),
        ChangeNotifierProvider.value(value: _maintenance),
        ChangeNotifierProvider.value(value: _features),
        ChangeNotifierProvider.value(value: _websiteProvisioning),
      ],
      child: Builder(
        builder: (context) {
          final router = AppRouter.createRouter(_authProvider, _maintenance, _features);
          return GestureDetector(
            onTap: () {
              _authProvider.extendSession();
              FocusManager.instance.primaryFocus?.unfocus();
            },
            onPanDown: (_) => _authProvider.extendSession(),
            child: Builder(
              builder: (context) {
                final theme = AppTheme.lightTheme;
                return MaterialApp.router(
                  title: Brand.current.productName,
                  debugShowCheckedModeBanner: false,
                  theme: theme,
                  routerConfig: router,
                  builder: (context, child) {
                    // Text size is fixed at 110% globally for now — Text Size
                    // picker is hidden from the drawer. To restore the picker
                    // and re-honor [FontScaleController], replace this block
                    // with the original watch-controller version.
                    final scaled = MediaQuery(
                      data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(1.2)),
                      child: child ?? const SizedBox.shrink(),
                    );
                    // GLOBAL bottom-inset fix: Android draws edge-to-edge
                    // (targetSdk 35 forces it), so the transparent 3-button
                    // nav bar overlaps screen content. Lift every screen above
                    // it once, here, instead of per-screen SafeArea. The
                    // Container fills the strip behind the transparent nav bar
                    // with the app background so it doesn't show a black bar.
                    // Top is left untouched (screens manage their own status-bar
                    // padding via custom headers).
                    return ColoredBox(
                      color: AppColors.background,
                      child: SafeArea(
                        top: false,
                        left: false,
                        right: false,
                        child: Stack(
                          children: [
                            scaled,
                            // App-wide club-website provisioning status card —
                            // floats above the bottom of every screen so the
                            // buyer is told when their site goes live / needs
                            // attention even after leaving the purchase page.
                            const Positioned(
                              left: 0,
                              right: 0,
                              bottom: 0,
                              child: WebsiteProvisioningBanner(),
                            ),
                            // App-wide role-change gate: renders nothing, but
                            // forces the mandatory re-login dialog from ANY
                            // screen the moment the live role set stops
                            // matching the JWT's `roles` claim.
                            const RoleChangeWatcher(),
                          ],
                        ),
                      ),
                    );
                  },
                  localizationsDelegates: const [
                    GlobalMaterialLocalizations.delegate,
                    GlobalCupertinoLocalizations.delegate,
                    GlobalWidgetsLocalizations.delegate,
                    FlutterQuillLocalizations.delegate,
                  ],
                  supportedLocales: const [Locale('en')],
                );
              },
            ),
          );
        },
      ),
    );
  }
}
