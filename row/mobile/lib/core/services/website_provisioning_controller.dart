import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models/website_billing_models.dart';
import '../notifications/push_service.dart';
import 'website_billing_api.dart';

enum WebsiteProvisioningPhase { provisioning, active, failed }

/// A single club-website order being tracked to completion.
class WebsiteProvisioningState {
  final int orderId;
  final String host; // e.g. "myclub.<club-site parent domain>" (best-effort label)
  final WebsiteProvisioningPhase phase;
  final String? visitUrl;

  const WebsiteProvisioningState({
    required this.orderId,
    required this.host,
    required this.phase,
    this.visitUrl,
  });
}

/// App-wide tracker for a club-website purchase that is still being provisioned
/// (Plesk vhost + SSL) by the server-side background worker.
///
/// The purchase screen hands the paid order to [track]; from then on this
/// controller polls `order-status` on its own and drives a global banner (see
/// `WebsiteProvisioningBanner`) so the buyer is told when the site is live — or
/// hit a snag — **even after they leave the purchase screen**. It also fires a
/// local notification on the terminal transition (so it surfaces on any screen
/// or when the app is backgrounded-but-alive), and [resume]s across app
/// relaunches by re-reading the last in-progress order from local storage.
///
/// Timers don't fire while the app is fully backgrounded; [resume] (called on
/// launch and on app-resume) re-checks status and catches up. The server email
/// remains the backstop if the user never reopens the app.
class WebsiteProvisioningController extends ChangeNotifier {
  WebsiteProvisioningController({WebsiteBillingApi? api})
      : _api = api ?? WebsiteBillingApi();

  final WebsiteBillingApi _api;

  static const String _kActiveKey = 'website_provisioning_active';
  static const String _kDismissedKey = 'website_provisioning_dismissed';
  static const Duration _interval = Duration(seconds: 4);
  static const int _maxTicks = 90; // ~6 min ceiling, then stop polling

  WebsiteProvisioningState? _state;
  WebsiteProvisioningState? get state => _state;

  Timer? _timer;
  int _ticks = 0;
  bool _notified = false; // guard: fire the terminal local-notification once

  /// Begin tracking a freshly-paid order. Called by the purchase screen right
  /// after `verify` succeeds (status is `Provisioning`, occasionally `Active`).
  Future<void> track({
    required int orderId,
    required String host,
    String? visitUrl,
  }) async {
    _state = WebsiteProvisioningState(
      orderId: orderId,
      host: host,
      phase: WebsiteProvisioningPhase.provisioning,
      visitUrl: visitUrl,
    );
    _notified = false;
    await _persistActive(orderId, host);
    notifyListeners();
    await _pollOnce(); // reflect an already-live site immediately
    if (_state?.phase == WebsiteProvisioningPhase.provisioning) _startTimer();
  }

  /// Re-attach to any in-progress order after an app launch / foreground. Never
  /// resurrects an order the user already dismissed.
  Future<void> resume() async {
    if (_state?.phase == WebsiteProvisioningPhase.provisioning) {
      if (_timer == null) _startTimer();
      return;
    }
    if (_state != null) return; // a terminal banner is already showing
    final saved = await _readActive();
    if (saved == null) return;
    if (await _isDismissed(saved.orderId)) {
      await _clearActive();
      return;
    }
    _state = WebsiteProvisioningState(
      orderId: saved.orderId,
      host: saved.host,
      phase: WebsiteProvisioningPhase.provisioning,
    );
    _notified = false;
    notifyListeners();
    await _pollOnce();
    if (_state?.phase == WebsiteProvisioningPhase.provisioning) _startTimer();
  }

  /// Dismiss the (terminal) banner and don't show this order again.
  Future<void> dismiss() async {
    final s = _state;
    _timer?.cancel();
    _timer = null;
    if (s != null) await _rememberDismissed(s.orderId);
    await _clearActive();
    _state = null;
    notifyListeners();
  }

  void _startTimer() {
    _timer?.cancel();
    _ticks = 0;
    _timer = Timer.periodic(_interval, (_) async {
      _ticks++;
      await _pollOnce();
      if (_ticks >= _maxTicks) {
        _timer?.cancel();
        _timer = null;
      }
    });
  }

  Future<void> _pollOnce() async {
    final current = _state;
    if (current == null) return;
    try {
      final s = await _api.getOrderStatus(current.orderId);
      _apply(s, fallbackHost: current.host);
    } catch (_) {
      // transient — keep the current (provisioning) banner and try next tick
    }
  }

  void _apply(WebsiteOrderStatus s, {required String fallbackHost}) {
    final host = fallbackHost.isNotEmpty ? fallbackHost : s.subdomain;
    if (s.isActive) {
      _timer?.cancel();
      _timer = null;
      _state = WebsiteProvisioningState(
        orderId: s.websiteOrderId,
        host: host,
        phase: WebsiteProvisioningPhase.active,
        visitUrl: s.visitUrl,
      );
      _clearActive();
      notifyListeners();
      if (!_notified) {
        _notified = true;
        PushService.instance.showLocalNotification(
          title: 'Your club website is live!',
          body: '$host is ready.',
        );
      }
    } else if (s.isFailed) {
      _timer?.cancel();
      _timer = null;
      _state = WebsiteProvisioningState(
        orderId: s.websiteOrderId,
        host: host,
        phase: WebsiteProvisioningPhase.failed,
      );
      _clearActive();
      notifyListeners();
      if (!_notified) {
        _notified = true;
        PushService.instance.showLocalNotification(
          title: 'Website setup is taking longer',
          body: 'We’ll email you as soon as $host is live.',
        );
      }
    } else {
      // still provisioning / awaiting — refresh the label + any early visitUrl
      _state = WebsiteProvisioningState(
        orderId: s.websiteOrderId,
        host: host,
        phase: WebsiteProvisioningPhase.provisioning,
        visitUrl: s.visitUrl,
      );
      notifyListeners();
    }
  }

  // ── local persistence ──────────────────────────────────────────────────────

  Future<void> _persistActive(int orderId, String host) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
          _kActiveKey, jsonEncode({'orderId': orderId, 'host': host}));
    } catch (_) {/* ignore */}
  }

  Future<({int orderId, String host})?> _readActive() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kActiveKey);
      if (raw == null || raw.isEmpty) return null;
      final m = jsonDecode(raw);
      if (m is! Map) return null;
      final id = m['orderId'];
      if (id is! int) return null;
      return (orderId: id, host: '${m['host'] ?? ''}');
    } catch (_) {
      return null;
    }
  }

  Future<void> _clearActive() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kActiveKey);
    } catch (_) {/* ignore */}
  }

  Future<Set<int>> _dismissedSet() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final list = prefs.getStringList(_kDismissedKey) ?? const [];
      return list.map(int.tryParse).whereType<int>().toSet();
    } catch (_) {
      return <int>{};
    }
  }

  Future<bool> _isDismissed(int orderId) async =>
      (await _dismissedSet()).contains(orderId);

  Future<void> _rememberDismissed(int orderId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final set = await _dismissedSet()..add(orderId);
      await prefs.setStringList(
          _kDismissedKey, set.map((e) => e.toString()).toList());
    } catch (_) {/* ignore */}
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
