import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:screen_protector/screen_protector.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/attendance_qr_code.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// The member's "living" attendance QR. Marker: QR-ATTENDANCE
///
/// • Drawn on the phone from a once-a-day key — no server call per refresh.
/// • Changes every 500 ms (see AttendanceQrKey), so a photo, screenshot or
///   old video of it is refused by the admin's scanner.
/// • Screenshots / screen recording blocked while open: Android FLAG_SECURE
///   (shows black); iOS hides the content in captures and blurs it in the
///   app switcher (Apple allows no full block).
class MyAttendanceQrScreen extends StatefulWidget {
  const MyAttendanceQrScreen({super.key});

  @override
  State<MyAttendanceQrScreen> createState() => _MyAttendanceQrScreenState();
}

class _MyAttendanceQrScreenState extends State<MyAttendanceQrScreen>
    with WidgetsBindingObserver {
  final _api = ApiClient();
  AttendanceQrKey? _key;
  bool _loading = true;
  String? _error;
  Timer? _timer;
  int _tick = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _protect(true);
    _loadKey();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _protect(false);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-sync the clock after the app was in the background.
    if (state == AppLifecycleState.resumed) _loadKey(silent: true);
  }

  Future<void> _protect(bool on) async {
    try {
      if (on) {
        await ScreenProtector.preventScreenshotOn();
        await ScreenProtector.protectDataLeakageWithBlur();
      } else {
        await ScreenProtector.preventScreenshotOff();
        await ScreenProtector.protectDataLeakageWithBlurOff();
      }
    } catch (_) {
      // A platform without support must not stop the QR from showing.
    }
  }

  Future<void> _loadKey({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final sent = DateTime.now().millisecondsSinceEpoch;
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.attendanceQrKey,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final received = DateTime.now().millisecondsSinceEpoch;
      if (!mounted) return;
      if (!res.isSuccess || res.data == null) {
        setState(() {
          _loading = false;
          _error = res.error ?? 'Could not load your QR.';
        });
        return;
      }
      setState(() {
        _key = AttendanceQrKey.fromJson(res.data!, sent, received);
        _loading = false;
        _error = null;
      });
      _startTicking();
    } catch (e) {
      if (!mounted) return;
      if (silent && _key != null) return; // keep showing the current QR
      setState(() {
        _loading = false;
        _error = friendlyErrorMessage(e);
      });
    }
  }

  void _startTicking() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      final k = _key;
      if (k == null || !mounted) return;
      final now = DateTime.now().millisecondsSinceEpoch;
      // New UTC day → the key has expired; fetch today's.
      if (k.utcDayAt(now) != k.date) {
        _timer?.cancel();
        _loadKey(silent: true);
        return;
      }
      final t = k.tickAt(now);
      if (t != _tick) setState(() => _tick = t);
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My Attendance QR'),
      body: _buildBody(auth),
    );
  }

  Widget _buildBody(AuthProvider auth) {
    if (_loading) {
      return const RowSkeletonList(rows: 3);
    }
    final k = _key;
    if (_error != null || k == null) {
      return ErrorStateWidget(
          message: _error ?? 'Could not load your QR.', onRetry: _loadKey);
    }
    final code = k.codeForTick(_tick);
    final photo = ApiConstants.mediaUrl(auth.profilePhotoPath);
    // The pulse is the visible half of the "living" QR: it flips every tick.
    final pulse = _tick.isEven;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
      child: Column(
        children: [
          CircleAvatar(
            radius: 34,
            backgroundColor: AppColors.primaryLight,
            backgroundImage:
                photo.isEmpty ? null : CachedNetworkImageProvider(photo),
            child: photo.isEmpty
                ? const Icon(Icons.person, size: 34, color: AppColors.primary)
                : null,
          ),
          const SizedBox(height: 10),
          Text(
            auth.memberName,
            textAlign: TextAlign.center,
            style: AppFonts.display(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 20),
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: pulse ? AppColors.primary : AppColors.success,
                width: 5,
              ),
            ),
            child: QrImageView(
              data: code,
              size: 250,
              backgroundColor: Colors.white,
              gapless: true,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.circle,
                  size: 10,
                  color: pulse
                      ? AppColors.success
                      : AppColors.success.withValues(alpha: 0.35)),
              const SizedBox(width: 6),
              const Text('Live: changes every moment',
                  style: TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 16),
          const Text(
            'Show this to your club admin at the meeting.\n'
            'Screenshots, photos and recordings of this QR will not work.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary, height: 1.4),
          ),
        ],
      ),
    );
  }
}
