import 'dart:convert';
import 'dart:developer' as dev;
import 'dart:io' show Platform;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'deep_link_service.dart';
import 'notification_badge_service.dart';

/// FCM helper. Singleton via [PushService.instance].
///
/// Lifecycle:
///   - [init] is called once at app start (in main.dart) to set up handlers
///     for foreground messages and notification taps. Safe to await.
///   - [ensureToken] is called from the OTP-verify flow. It requests the
///     iOS notification permission (no-op on Android <13), fetches the FCM
///     token, and returns it. Plumb the result into the verify-otp body.
///
/// Foreground display: iOS and Android do NOT show a system banner while
/// the app is foreground (by design). We bridge that by showing a local
/// notification via flutter_local_notifications when an FCM message arrives
/// in foreground.
///
/// Token lifecycle: tokens can rotate (reinstall, clear-storage, OS restore /
/// device transfer, Firebase instance-ID reset, ~270-day idle). When that
/// happens the backend keeps a dead token and the device goes silent. We
/// listen to onTokenRefresh, update the cached value, AND fire [onTokenChanged]
/// so AuthProvider can re-register the new token with the backend immediately
/// (POST /api/members/{id}/device-token) — no need to wait for the next login,
/// which matters now that the mobile JWT lasts 10 years.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  /// Called with the new FCM token whenever it rotates (onTokenRefresh).
  /// AuthProvider wires this to POST the token to the backend so push delivery
  /// never goes stale. Fire-and-forget; the callback swallows its own errors.
  void Function(String token)? onTokenChanged;

  // Read on use: a build without Firebase config never touches it (push stays off).
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  // Custom notification sound.
  //   Android: android/app/src/main/res/raw/notification.mp3 (referenced by the
  //            resource name, no extension).
  //   iOS:     ios/Runner/notification.caf (bundled in the Runner target; iOS
  //            can't use mp3 for notification sounds, so it's a converted CAF).
  static const _androidSound =
      RawResourceAndroidNotificationSound('notification');
  static const String _iosSound = 'notification.caf';

  // NOTE: the channel id is intentionally suffixed "_sound". Android freezes a
  // channel's sound at creation time and ignores later changes to an existing
  // channel — so adding the custom sound needs a brand-new channel id to take
  // effect on devices that already created the old sound-less channel.
  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'high_importance_channel_sound',
    'High Importance Notifications',
    description: 'Used for important push notifications.',
    importance: Importance.high,
    playSound: true,
    sound: _androidSound,
  );

  String? _cachedToken;
  String? _cachedApnsToken;

  /// Last-known FCM token. Null if we haven't fetched one yet.
  String? get token => _cachedToken;

  /// Last-known APNs token. iOS only. Null on Android or if APNs registration
  /// hasn't completed (entitlement missing → silent failure).
  String? get apnsToken => _cachedApnsToken;

  /// Diagnostic summary string suitable for inclusion in API request bodies.
  /// Format: "apns=<len|NULL>" — used to verify entitlement is applied without
  /// relying on console output.
  String get apnsStatusForDiagnostics {
    if (_cachedApnsToken == null) return 'apns=NULL';
    return 'apns=len${_cachedApnsToken!.length}';
  }

  /// Wire foreground / opened-app handlers + token refresh listener.
  /// Called from main.dart after Firebase.initializeApp().
  Future<void> init() async {
    // Local notifications init (used to display foreground banners).
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    // We already request notification permission via FirebaseMessaging in
    // ensureToken(), so don't request again here.
    const iosInit = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await _localNotifications.initialize(
      const InitializationSettings(android: androidInit, iOS: iosInit),
      // Tapping a foreground banner (shown via flutter_local_notifications)
      // routes through the same deep-link handler as background/cold-start taps.
      onDidReceiveNotificationResponse: _onLocalNotificationTap,
    );
    // Android needs a notification channel registered up-front.
    await _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);

    // iOS: by default, system suppresses banners while app is foreground.
    // This tells iOS to display alert/badge/sound natively even in foreground,
    // so we don't have to rely solely on flutter_local_notifications bridging.
    await _messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    // Foreground messages.
    // iOS: setForegroundNotificationPresentationOptions(alert: true) above
    //      makes iOS show the native banner — DO NOT also bridge via
    //      flutter_local_notifications or we'd get two banners per push.
    // Android: native FCM doesn't auto-show a foreground banner, so we
    //          bridge via flutter_local_notifications.
    FirebaseMessaging.onMessage.listen((message) {
      _logIncoming('foreground', message);
      if (!Platform.isIOS) {
        _showForegroundBanner(message);
      }
      // Bump the home bell's unread badge as soon as a push lands while the app
      // is open — otherwise the count only updates on the next home remount.
      // ignore: unawaited_futures
      NotificationBadgeService.instance.refresh();
    });

    // Tap handler when app is opened from a notification (background → foreground).
    // The app is already running, so route immediately.
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _logIncoming('opened-from-background', message);
      DeepLinkService.instance.handleTap(message.data, coldStart: false);
    });

    // Cold start: app launched by tapping a notification while it was killed.
    // getInitialMessage() returns the message that triggered the launch (if any).
    // The router/auth aren't ready yet, so queue the deep-link — HomeScreen
    // drains it once the authenticated landing screen is mounted.
    _messaging.getInitialMessage().then((message) {
      if (message != null) {
        _logIncoming('opened-from-terminated', message);
        DeepLinkService.instance.handleTap(message.data, coldStart: true);
      }
    });

    _messaging.onTokenRefresh.listen((newToken) {
      _cachedToken = newToken;
      if (kDebugMode) {
        debugPrint('FCM token refreshed (length=${newToken.length})');
      }
      // Re-register the rotated token with the backend right away so pushes
      // don't go stale until the next login.
      onTokenChanged?.call(newToken);
    });

    // Diagnostic: also probe APNs+FCM at startup, regardless of login state,
    // so we can verify push entitlement is applied without going through OTP.
    // Fire-and-forget — don't block init().
    // ignore: unawaited_futures
    _probeTokensForDiagnostics();
  }

  Future<void> _probeTokensForDiagnostics() async {
    try {
      dev.log('startup probe: requesting permission', name: 'PUSH');
      final settings = await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      dev.log('startup probe: permission=${settings.authorizationStatus}', name: 'PUSH');
      final apns = await _messaging.getAPNSToken().timeout(
            const Duration(seconds: 10),
            onTimeout: () => null,
          );
      _cachedApnsToken = apns;
      dev.log(
          'startup probe: APNs=${apns == null ? "NULL (entitlement missing or APNs blocked)" : "len=${apns.length}"}',
          name: 'PUSH');
      final fcm = await _messaging.getToken().timeout(
            const Duration(seconds: 10),
            onTimeout: () => null,
          );
      dev.log(
          'startup probe: FCM=${fcm == null ? "null/timeout" : "len=${fcm.length}"}',
          name: 'PUSH');
      if (fcm != null) _cachedToken = fcm;
    } catch (e) {
      dev.log('startup probe failed: $e', name: 'PUSH');
    }
  }

  /// Log every incoming push message so the title/body/data are visible
  /// in the Android Studio Run console (alongside [API] lines).
  void _logIncoming(String state, RemoteMessage message) {
    final n = message.notification;
    dev.log(
      'received ($state): title="${n?.title ?? ""}" body="${n?.body ?? ""}" data=${message.data}',
      name: 'PUSH',
    );
  }

  /// Show a local notification immediately (not tied to any FCM message).
  ///
  /// Used for in-app events the user should hear about even when they are on
  /// another screen or have backgrounded the app — e.g. a club website
  /// finishing provisioning. Safe to call anytime after [init]; failures are
  /// swallowed (notifications are best-effort and must never break a flow).
  Future<void> showLocalNotification({
    required String title,
    required String body,
    int? id,
    String? payload,
  }) async {
    try {
      await _localNotifications.show(
        id ?? (title.hashCode ^ body.hashCode),
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high,
            priority: Priority.high,
            icon: '@mipmap/ic_launcher',
            playSound: true,
            sound: _androidSound,
          ),
          iOS: const DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
            sound: _iosSound,
          ),
        ),
        payload: payload,
      );
    } catch (_) {
      // best-effort — never let a notification failure surface to the caller
    }
  }

  /// Show a foreground banner using flutter_local_notifications.
  /// Skipped if the message has no notification payload (e.g. data-only).
  void _showForegroundBanner(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;
    _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
          icon: '@mipmap/ic_launcher',
          playSound: true,
          sound: _androidSound,
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
          sound: _iosSound,
        ),
      ),
      // JSON so the tap handler can decode it back into the FCM data map.
      payload: message.data.isEmpty ? null : jsonEncode(message.data),
    );
  }

  /// Tap on a locally-shown notification (foreground banner, or the
  /// website-provisioning notice). Only FCM-data payloads carrying a `type`
  /// are routed; anything else (e.g. the plain provisioning notice, which has
  /// no payload) is ignored.
  void _onLocalNotificationTap(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;
    try {
      final decoded = jsonDecode(payload);
      if (decoded is Map && decoded['type'] != null) {
        DeepLinkService.instance.handleTap(
          Map<String, dynamic>.from(decoded),
          coldStart: false,
        );
      }
    } catch (_) {
      // Non-JSON payload — nothing to route.
    }
  }

  /// Request notification permission and return the current FCM token.
  /// Returns null if permission denied or the platform fails to provide a token.
  ///
  /// On iOS, the very first call shows the system permission dialog.
  /// On Android 13+ it requests POST_NOTIFICATIONS at runtime.
  /// On older Android versions this is a no-op (granted by manifest).
  Future<String?> ensureToken() async {
    try {
      dev.log('ensureToken: start', name: 'PUSH');
      // iOS prompt + Android 13+ partial: FirebaseMessaging triggers iOS's
      // system dialog but doesn't trigger Android 13's POST_NOTIFICATIONS
      // prompt — we handle that next via flutter_local_notifications.
      final settings = await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      dev.log('ensureToken: permission status=${settings.authorizationStatus}', name: 'PUSH');
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        if (kDebugMode) debugPrint('FCM permission denied by user');
        // Token can still exist (data-only pushes work) — try to fetch anyway.
      }
      // Android 13+ runtime POST_NOTIFICATIONS prompt. No-op on iOS and on
      // Android <13 (granted by manifest).
      await _localNotifications
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      dev.log('ensureToken: about to call getAPNSToken', name: 'PUSH');
      // On iOS, await APNs token first with a timeout. If the build is missing
      // the push entitlement, APNs never registers and getToken() would hang
      // forever. A null APNs token here is the smoking gun for that.
      final apns = await _messaging.getAPNSToken().timeout(
            const Duration(seconds: 10),
            onTimeout: () => null,
          );
      _cachedApnsToken = apns;
      dev.log(
          'ensureToken: APNs=${apns == null ? "NULL (entitlement missing or APNs blocked)" : "len=${apns.length}"}',
          name: 'PUSH');
      dev.log('ensureToken: about to call getToken', name: 'PUSH');
      _cachedToken = await _messaging.getToken().timeout(
            const Duration(seconds: 10),
            onTimeout: () => null,
          );
      dev.log(
          'ensureToken: FCM token=${_cachedToken == null ? "null/timeout" : "len=${_cachedToken!.length}"}',
          name: 'PUSH');
      return _cachedToken;
    } catch (e) {
      dev.log('ensureToken failed: $e', name: 'PUSH');
      return null;
    }
  }
}
