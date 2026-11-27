import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/services/attendance_qr_code.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/event_zone.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// Admin: scan members' living attendance QRs. Marker: QR-ATTENDANCE
///
/// The scanner never trusts one frame. It collects the QR for a moment and
/// sends 2+ DIFFERENT ticks; a photo/screenshot only ever shows one tick, so it
/// is refused here ("Photo detected") without even calling the server. The
/// server re-checks everything (signature, liveness, freshness, meeting day,
/// club membership, this admin's year rights).
class AttendanceScanScreen extends StatefulWidget {
  final int clubId;
  const AttendanceScanScreen({super.key, required this.clubId});

  @override
  State<AttendanceScanScreen> createState() => _AttendanceScanScreenState();
}

class _Meeting {
  final int id;
  final String name;
  final String? at; // as sent, shown in the club's zone via DateFormatter.eventDateTime
  int presentCount;
  _Meeting(this.id, this.name, this.at, this.presentCount);
}

class _ScanResult {
  final bool ok;
  final String title;
  final String? name;
  final String? photo;
  const _ScanResult(this.ok, this.title, {this.name, this.photo});
}

class _AttendanceScanScreenState extends State<AttendanceScanScreen> {
  static const _photoAfter = Duration(milliseconds: 2500);
  static const _window = Duration(seconds: 5);
  static const _cooldown = Duration(seconds: 4);

  final _api = ApiClient();
  final _scanner = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    detectionTimeoutMs: 200,
  );

  bool _loading = true;
  String? _error;
  List<_Meeting> _meetings = [];
  _Meeting? _selected;
  bool _busy = false;
  _ScanResult? _result;
  final List<String> _recent = [];

  // memberId → {tick → raw}, and when we first saw that member.
  final Map<int, Map<int, String>> _frames = {};
  final Map<int, DateTime> _firstSeen = {};
  final Map<int, DateTime> _cooldownUntil = {};
  DateTime _lastForeignHint = DateTime.fromMillisecondsSinceEpoch(0);

  String? _zone;

  @override
  void initState() {
    super.initState();
    EventZones.club(widget.clubId).then((z) {
      if (mounted) setState(() => _zone = z);
    });
    _loadMeetings();
  }

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _loadMeetings({int? select}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await _api.get<List<dynamic>>(
        ApiConstants.clubAttendanceToday(widget.clubId),
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      if (!res.isSuccess || res.data == null) {
        setState(() {
          _loading = false;
          _error = res.error ?? 'Could not load today\'s meetings.';
        });
        return;
      }
      final list = res.data!
          .whereType<Map<String, dynamic>>()
          .map((m) => _Meeting(
                (m['id'] as num?)?.toInt() ?? 0,
                (m['eventName'] ?? '').toString(),
                m['eventDateTime']?.toString(),
                (m['presentCount'] as num?)?.toInt() ?? 0,
              ))
          .where((m) => m.id > 0)
          .toList();
      setState(() {
        _loading = false;
        _meetings = list;
        final want = select ?? _selected?.id;
        _selected = list.where((m) => m.id == want).firstOrNull ??
            (list.isNotEmpty ? list.first : null);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = friendlyErrorMessage(e);
      });
    }
  }

  Future<void> _createMeeting() async {
    final ctrl = TextEditingController(text: 'Club Meeting');
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New meeting (today)'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Meeting name'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Create')),
        ],
      ),
    );
    ctrl.dispose();
    if (name == null || name.isEmpty || !mounted) return;
    try {
      final res = await _api.post<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/attendance',
        body: {
          'eventName': name,
          'description': '',
          // shortcut: device wall clock, same as the Attendance form; a club in
          // another zone than the admin's phone gets the phone's time.
          'eventDateTime': _wallClockNow(),
          'memberIds': <int>[],
          'anns': [],
          'annets': [],
          'visitors': [],
          'rotarians': [],
          'delegates': [],
        },
        fromJson: (j) => j is Map<String, dynamic> ? j : <String, dynamic>{},
      );
      await _loadMeetings(select: (res.data?['id'] as num?)?.toInt());
    } catch (e) {
      _toast(friendlyErrorMessage(e, fallback: 'Could not create the meeting.'));
    }
  }

  Future<void> _markSelf() async {
    final m = _selected;
    if (m == null || _busy) return;
    setState(() => _busy = true);
    try {
      final res = await _api.post<Map<String, dynamic>>(
        ApiConstants.attendanceMarkSelf(m.id),
        fromJson: (j) => j as Map<String, dynamic>,
      );
      _showServerResult(res.data ?? const {});
    } catch (e) {
      _setResult(_ScanResult(false, friendlyErrorMessage(e)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── Scanning ─────────────────────────────────────────────────────────
  void _onDetect(BarcodeCapture capture) {
    if (_selected == null) return;
    final now = DateTime.now();
    for (final b in capture.barcodes) {
      final raw = b.rawValue;
      final qr = ScannedAttendanceQr.parse(raw);
      if (qr == null) {
        if ((raw ?? '').isNotEmpty &&
            now.difference(_lastForeignHint) > const Duration(seconds: 3)) {
          _lastForeignHint = now;
          _setResult(
              const _ScanResult(false, 'This is not a ROW attendance QR.'));
        }
        continue;
      }
      final until = _cooldownUntil[qr.memberId];
      if (until != null && now.isBefore(until)) continue;

      final first = _firstSeen[qr.memberId];
      if (first == null || now.difference(first) > _window) {
        _frames[qr.memberId] = {};
        _firstSeen[qr.memberId] = now;
      }
      final frames = _frames[qr.memberId]!;
      frames[qr.tick] = qr.raw;

      if (frames.length >= 2 && !_busy) {
        final ticks = frames.keys.toList()..sort();
        final codes = ticks.reversed.take(4).map((t) => frames[t]!).toList();
        _forget(qr.memberId, now);
        _submit(codes);
      } else if (frames.length == 1 &&
          now.difference(_firstSeen[qr.memberId]!) > _photoAfter) {
        // The same frozen frame for 2.5 s — a photo or screenshot.
        _forget(qr.memberId, now);
        _setResult(const _ScanResult(false,
            'Photo detected. Please show the live QR from your own app.'));
      }
    }
  }

  void _forget(int memberId, DateTime now) {
    _frames.remove(memberId);
    _firstSeen.remove(memberId);
    _cooldownUntil[memberId] = now.add(_cooldown);
  }

  Future<void> _submit(List<String> codes) async {
    final m = _selected;
    if (m == null) return;
    setState(() => _busy = true);
    try {
      final res = await _api.post<Map<String, dynamic>>(
        ApiConstants.attendanceScan(m.id),
        body: {'codes': codes},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      _showServerResult(res.data ?? const {});
    } catch (e) {
      _setResult(_ScanResult(false, friendlyErrorMessage(e)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showServerResult(Map<String, dynamic> d) {
    final name = (d['memberName'] ?? '').toString();
    final already = d['status'] == 'already';
    final count = (d['presentCount'] as num?)?.toInt();
    if (count != null && _selected != null) _selected!.presentCount = count;
    if (!already && name.isNotEmpty) {
      _recent.insert(0, name);
      if (_recent.length > 30) _recent.removeLast();
    }
    _setResult(_ScanResult(
        true, already ? 'Already marked present' : 'Marked present',
        name: name, photo: d['profilePhotoPath']?.toString()));
  }

  void _setResult(_ScanResult r) {
    if (!mounted) return;
    setState(() => _result = r);
  }

  static String _wallClockNow() {
    final n = DateTime.now();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${n.year}-${two(n.month)}-${two(n.day)}T${two(n.hour)}:${two(n.minute)}:00';
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  // ── UI ───────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Scan Attendance'),
      body: _loading
          ? const RowSkeletonList(rows: 4)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadMeetings)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _meetingPicker(),
                    const SizedBox(height: 12),
                    if (_selected != null) ...[
                      _scannerBox(),
                      const SizedBox(height: 12),
                      if (_result != null) _resultCard(_result!),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _markSelf,
                        icon: const Icon(Icons.how_to_reg_outlined),
                        label: const Text('Mark my own attendance'),
                      ),
                      if (_recent.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        const Text('Marked in this session',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        ..._recent.map((n) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(children: [
                                const Icon(Icons.check_circle,
                                    size: 16, color: AppColors.success),
                                const SizedBox(width: 8),
                                Expanded(child: Text(n)),
                              ]),
                            )),
                      ],
                    ],
                  ],
                ),
    );
  }

  Widget _meetingPicker() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Attendance for this meeting',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (_meetings.isEmpty)
            const Text('No meeting today yet. Create one to start scanning.',
                style: TextStyle(color: AppColors.textSecondary))
          else
            DropdownButtonFormField<int>(
              initialValue: _selected?.id,
              isExpanded: true,
              decoration: const InputDecoration(
                  border: OutlineInputBorder(), isDense: true),
              items: _meetings
                  .map((m) => DropdownMenuItem(
                        value: m.id,
                        child: Text(
                          m.at == null
                              ? m.name
                              : '${m.name}: ${DateFormatter.eventDateTime(m.at, _zone)}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ))
                  .toList(),
              onChanged: (id) => setState(() {
                _selected = _meetings.firstWhere((m) => m.id == id);
                _result = null;
                _recent.clear();
              }),
            ),
          const SizedBox(height: 6),
          Row(
            children: [
              if (_selected != null)
                Text('${_selected!.presentCount} present',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
              const Spacer(),
              TextButton.icon(
                onPressed: _createMeeting,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New meeting (today)'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _scannerBox() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        height: 300,
        child: Stack(
          fit: StackFit.expand,
          children: [
            MobileScanner(
              controller: _scanner,
              onDetect: _onDetect,
              errorBuilder: (context, error) => Container(
                color: Colors.black,
                alignment: Alignment.center,
                padding: const EdgeInsets.all(20),
                child: const Text(
                  'Camera not available. Allow camera access in Settings to scan.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white),
                ),
              ),
            ),
            if (_busy)
              Container(
                color: Colors.black38,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(color: Colors.white),
              ),
            const Positioned(
              left: 0,
              right: 0,
              bottom: 10,
              child: Text(
                'Hold the member\'s live QR in view for a second',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    shadows: [Shadow(blurRadius: 4)]),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _resultCard(_ScanResult r) {
    final color = r.ok ? AppColors.success : AppColors.error;
    final photo = ApiConstants.mediaUrl(r.photo);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          if (r.ok)
            CircleAvatar(
              radius: 30,
              backgroundColor: AppColors.primaryLight,
              backgroundImage:
                  photo.isEmpty ? null : CachedNetworkImageProvider(photo),
              child: photo.isEmpty
                  ? const Icon(Icons.person, color: AppColors.primary)
                  : null,
            )
          else
            Icon(Icons.block, size: 40, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (r.name != null && r.name!.isNotEmpty)
                  Text(r.name!,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700)),
                Text(r.title,
                    style: TextStyle(color: color, fontWeight: FontWeight.w600)),
                if (r.ok)
                  const Text('Check the photo matches the person.',
                      style: TextStyle(
                          fontSize: 12, color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
