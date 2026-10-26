
import 'dart:io';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'app.dart';
import 'core/brand/brand.dart';
import 'core/notifications/push_service.dart';
import 'core/preferences/font_scale_controller.dart';
import 'core/preferences/home_layout_controller.dart';
import 'core/security/biometric_controller.dart';
import 'core/theme/legacy_prefs.dart';
import 'core/utils/date_formatter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/i18n/live_translator.dart';

/// Debug-only HttpOverrides that accept self-signed / missing-intermediate
/// certs. Production builds use the OS root cert chain — never registered.
class _DebugNoSslVerifyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback = (_, __, ___) => true;
  }
}

void main() async {
  if (kDebugMode) {
    HttpOverrides.global = _DebugNoSslVerifyHttpOverrides();
  }
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase auto-detects from native config files
  // (ios/Runner/GoogleService-Info.plist + android/app/google-services.json
  // processed by the Google Services Gradle plugin). Each instance supplies its
  // own; a build without them runs with push notifications and analytics off.
  try {
    await Firebase.initializeApp();
    await FirebaseAnalytics.instance.setAnalyticsCollectionEnabled(true);
    await PushService.instance.init();
  } catch (e) {
    debugPrint('Firebase not configured, push notifications off: $e');
  }

  // Name, logos, support contacts and flags of this instance (cached; ROW defaults offline).
  await Brand.load();
  await DateFormatter.init();
  await clearLegacyThemePrefs(await SharedPreferences.getInstance());

  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );
  // AppBarTheme(
  //   backgroundColor: Colors.deepPurple,
  //   foregroundColor: Colors.white, // title + icon color
  //   elevation: 4,
  //   centerTitle: true,
  // );

  // The member's UI language and its saved translations (N13); English until they pick another.
  await LiveTranslator.instance.load();

  runApp(
    TranslationScope(
      translator: LiveTranslator.instance,
      child: MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => HomeLayoutController()),
          ChangeNotifierProvider(create: (_) => BiometricController()..init()),
          ChangeNotifierProvider(create: (_) => FontScaleController()),
        ],
        child: const RotaryApp(),
      ),
    ),
  );
}
