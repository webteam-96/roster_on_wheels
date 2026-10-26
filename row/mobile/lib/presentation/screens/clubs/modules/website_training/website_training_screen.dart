import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../../core/services/training_appointment_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../data/models/training_appointment_models.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Website Training" — a club admin books a Calendly-style 30-minute Zoom
/// training slot for their club website. Lists upcoming appointments (Join +
/// Reschedule) and offers a booking flow. Reachable only when the club website
/// is active (booking requires an active website subscription).
class WebsiteTrainingScreen extends StatefulWidget {
  final int clubId;
  final String? clubName;
  const WebsiteTrainingScreen({super.key, required this.clubId, this.clubName});

  @override
  State<WebsiteTrainingScreen> createState() => _WebsiteTrainingScreenState();
}

class _WebsiteTrainingScreenState extends State<WebsiteTrainingScreen> {
  final TrainingAppointmentApi _api = TrainingAppointmentApi();
  late Future<List<TrainingAppointment>> _future;

  // Overlaid busy spinner during availability fetch / book / reschedule.
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _api.getMine(widget.clubId);
  }

  void _reload() =>
      setState(() => _future = _api.getMine(widget.clubId));

  Future<void> _refresh() async {
    final f = _api.getMine(widget.clubId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  // ── Booking / reschedule flow ─────────────────────────────────────────────

  /// Fetch availability then open the day/slot picker. When [rescheduleId] is
  /// null this books a new slot (with optional notes); otherwise it reschedules
  /// the given appointment (no notes).
  Future<void> _startFlow({int? rescheduleId}) async {
    if (_busy) return;
    setState(() => _busy = true);
    AvailabilityResponse availability;
    try {
      availability = await _api.getAvailability(widget.clubId);
    } on TrainingLockedException catch (e) {
      if (mounted) setState(() => _busy = false);
      if (mounted) _showLocked(e.message);
      return;
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        SnackbarUtils.showError(context, _errMsg(e));
      }
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);

    if (!availability.hasSlots) {
      SnackbarUtils.showInfo(
          context, 'No open training slots are available right now.');
      return;
    }

    final booking = await showModalBottomSheet<_SlotSelection>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _SlotPickerSheet(
        availability: availability,
        collectNotes: rescheduleId == null,
        title: rescheduleId == null ? 'Book training' : 'Reschedule training',
        confirmLabel: rescheduleId == null ? 'Confirm booking' : 'Reschedule',
      ),
    );
    if (booking == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final res = rescheduleId == null
          ? await _api.book(widget.clubId, booking.slotStart,
              notes: booking.notes)
          : await _api.reschedule(rescheduleId, booking.slotStart);
      if (!mounted) return;
      setState(() => _busy = false);
      if (res.isSuccess) {
        SnackbarUtils.showSuccess(
          context,
          res.message ??
              (rescheduleId == null
                  ? 'Training session booked.'
                  : 'Training session rescheduled.'),
        );
        _reload();
      } else {
        SnackbarUtils.showError(
            context, res.message ?? 'Could not complete the request.');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      SnackbarUtils.showError(context, _errMsg(e));
    }
  }

  Future<void> _openJoin(TrainingAppointment appt) async {
    final raw = (appt.zoomJoinUrl ?? '').trim();
    if (raw.isEmpty) return;
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme) {
      SnackbarUtils.showError(context, 'The meeting link is invalid.');
      return;
    }
    bool ok = false;
    try {
      ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      ok = false;
    }
    if (!ok && mounted) {
      SnackbarUtils.showError(context, 'Could not open the meeting link.');
    }
  }

  void _showLocked(String message) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.white,
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.lock_outline_rounded,
                color: AppColors.warning, size: 20),
            const SizedBox(width: 8),
            Text('Website required',
                style: AppTextStyles.bodyLarge
                    .copyWith(fontWeight: FontWeight.w700)),
          ],
        ),
        content: Text(message, style: AppTextStyles.body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('OK', style: AppTextStyles.buttonSmall),
          ),
        ],
      ),
    );
  }

  String _errMsg(Object e) => e.toString().replaceFirst('Exception: ', '');

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Website Training'),
      body: Stack(
        children: [
          FutureBuilder<List<TrainingAppointment>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const _CenteredLoader();
              }
              if (snap.hasError) {
                return _ErrorState(
                    message: _errMsg(snap.error!), onRetry: _reload);
              }
              final appts = snap.data ?? const <TrainingAppointment>[];
              return RefreshIndicator(
                color: AppColors.rotaryBlue,
                onRefresh: _refresh,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                  children: [
                    const _IntroCard(),
                    const SizedBox(height: 14),
                    if (appts.isEmpty)
                      const _EmptyState()
                    else ...[
                      Padding(
                        padding: const EdgeInsets.only(left: 2, bottom: 8),
                        child: Text(
                          'Upcoming sessions',
                          style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: AppColors.slate700,
                          ),
                        ),
                      ),
                      for (final a in appts) ...[
                        _AppointmentCard(
                          appt: a,
                          onJoin: a.hasJoinUrl ? () => _openJoin(a) : null,
                          onReschedule: () => _startFlow(rescheduleId: a.id),
                        ),
                        const SizedBox(height: 10),
                      ],
                    ],
                  ],
                ),
              );
            },
          ),
          if (_busy)
            const Positioned.fill(
              child: ColoredBox(
                color: AppColors.scrim,
                child: Center(
                  child: SizedBox(
                    width: 30,
                    height: 30,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.8,
                      valueColor:
                          AlwaysStoppedAnimation<Color>(AppColors.white),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _busy ? null : () => _startFlow(),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.white,
              padding: const EdgeInsets.symmetric(vertical: 13),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.video_call_rounded, size: 20),
            label: Text('Book training',
                style: AppTextStyles.button
                    .copyWith(color: AppColors.white, fontSize: 15)),
          ),
        ),
      ),
    );
  }
}

// ── Intro card ────────────────────────────────────────────────────────────────

class _IntroCard extends StatelessWidget {
  const _IntroCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.cast_for_education_rounded,
                color: AppColors.primary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Book a website training session',
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'Pick an open 30-minute slot and our team will host a live '
                  'Zoom walkthrough of your club website tools.',
                  style: AppFonts.body(
                    fontSize: 11.5,
                    height: 1.4,
                    color: AppColors.slate500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Appointment card ──────────────────────────────────────────────────────────

class _AppointmentCard extends StatelessWidget {
  final TrainingAppointment appt;
  final VoidCallback? onJoin;
  final VoidCallback onReschedule;
  const _AppointmentCard({
    required this.appt,
    required this.onJoin,
    required this.onReschedule,
  });

  @override
  Widget build(BuildContext context) {
    final dt = appt.slotDateTime;
    final dateText =
        dt != null ? DateFormat('EEE, dd MMM yyyy').format(dt) : appt.slotStart;
    final timeText = dt != null
        ? '${DateFormat('h:mm a').format(dt)} · ${appt.durationMinutes} min'
        : '${appt.durationMinutes} min';
    final accent = _statusColor(appt.status);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.event_available_rounded,
                  size: 18, color: AppColors.rotaryBlue),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      dateText,
                      style: AppFonts.body(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      timeText,
                      style: AppFonts.body(
                        fontSize: 11.5,
                        color: AppColors.slate500,
                      ),
                    ),
                  ],
                ),
              ),
              if (appt.status.isNotEmpty)
                _Pill(text: appt.status, color: accent),
            ],
          ),
          if ((appt.bookedByName ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            _MetaRow(
                icon: Icons.person_outline_rounded,
                text: 'Booked by ${appt.bookedByName}'),
          ],
          if ((appt.notes ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            _MetaRow(icon: Icons.sticky_note_2_outlined, text: appt.notes!),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onReschedule,
                  icon: const Icon(Icons.schedule_rounded, size: 16),
                  label: Text('Reschedule',
                      style: AppFonts.body(
                          fontSize: 12.5, fontWeight: FontWeight.w700)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    side: BorderSide(
                        color: AppColors.primary.withValues(alpha: 0.4)),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: onJoin,
                  icon: const Icon(Icons.videocam_rounded, size: 16),
                  label: Text('Join',
                      style: AppFonts.body(
                          fontSize: 12.5, fontWeight: FontWeight.w800)),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.statusDone,
                    foregroundColor: AppColors.white,
                    disabledBackgroundColor: AppColors.slate200,
                    disabledForegroundColor: AppColors.slate400,
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),
          if (onJoin == null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'The meeting link will appear here once it is ready.',
                style: AppFonts.body(
                    fontSize: 10.5, color: AppColors.slate400),
              ),
            ),
        ],
      ),
    );
  }

  static Color _statusColor(String status) {
    final s = status.toLowerCase();
    if (s.contains('cancel')) return AppColors.statusNone;
    if (s.contains('complete') || s.contains('done')) {
      return AppColors.slate500;
    }
    if (s.contains('reschedul')) return AppColors.warning;
    return AppColors.statusDone; // booked / scheduled / confirmed
  }
}

class _MetaRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 14, color: AppColors.slate400),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: AppFonts.body(
                fontSize: 11.5, color: AppColors.slate500, height: 1.35),
          ),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  final String text;
  final Color color;
  const _Pill({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        text.toUpperCase(),
        style: AppFonts.body(
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.3,
          color: color,
        ),
      ),
    );
  }
}

// ── Empty / error / loading states ────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(16, 26, 16, 26),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 46,
            height: 46,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.slate100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.event_note_outlined,
                size: 22, color: AppColors.slate400),
          ),
          const SizedBox(height: 12),
          Text(
            'No training booked yet',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Tap "Book training" below to pick a Zoom session slot.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.slate500,
            ),
          ),
        ],
      ),
    );
  }
}

class _CenteredLoader extends StatelessWidget {
  const _CenteredLoader();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 72),
      child: Center(
        child: SizedBox(
          width: 28,
          height: 28,
          child: CircularProgressIndicator(
            strokeWidth: 2.6,
            valueColor: AlwaysStoppedAnimation<Color>(AppColors.rotaryBlue),
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 48, 16, 24),
      children: [
        const Icon(Icons.error_outline_rounded,
            size: 40, color: AppColors.slate400),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: AppFonts.body(
              fontSize: 13, color: AppColors.slate700, height: 1.4),
        ),
        const SizedBox(height: 16),
        Center(
          child: OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 16),
            label: Text('Retry',
                style: AppFonts.body(
                    fontSize: 12.5, fontWeight: FontWeight.w700)),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: BorderSide(color: AppColors.primary.withValues(alpha: 0.4)),
              shape:
                  RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ),
      ],
    );
  }
}

// ── Slot picker bottom sheet ──────────────────────────────────────────────────

/// The result of the picker: a fully composed `slotStart` ("yyyy-MM-ddTHH:mm",
/// echoed verbatim from availability) plus optional notes (booking only).
class _SlotSelection {
  final String slotStart;
  final String? notes;
  const _SlotSelection(this.slotStart, this.notes);
}

class _SlotPickerSheet extends StatefulWidget {
  final AvailabilityResponse availability;
  final bool collectNotes;
  final String title;
  final String confirmLabel;
  const _SlotPickerSheet({
    required this.availability,
    required this.collectNotes,
    required this.title,
    required this.confirmLabel,
  });

  @override
  State<_SlotPickerSheet> createState() => _SlotPickerSheetState();
}

class _SlotPickerSheetState extends State<_SlotPickerSheet> {
  int _dayIndex = 0;
  String? _slot;
  final TextEditingController _notesCtrl = TextEditingController();

  List<AvailabilityDay> get _days => widget.availability.openDays;

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  String _fmtSlot(String hhmm) {
    final parts = hhmm.split(':');
    final h = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 0;
    final m = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    return DateFormat('h:mm a').format(DateTime(2000, 1, 1, h, m));
  }

  void _confirm() {
    final day = _days[_dayIndex];
    final slot = _slot;
    if (slot == null) return;
    // Compose EXACTLY as "yyyy-MM-ddTHH:mm" — no timezone conversion.
    final slotStart = '${day.date}T$slot';
    Navigator.of(context).pop(
      _SlotSelection(
        slotStart,
        widget.collectNotes ? _notesCtrl.text.trim() : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final days = _days;
    final day = days[_dayIndex];
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.82,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.slate200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.title,
                      style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded, size: 20),
                    color: AppColors.slate500,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _sectionLabel('Choose a day'),
                    const SizedBox(height: 8),
                    SizedBox(
                      height: 40,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: days.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (_, i) {
                          final selected = i == _dayIndex;
                          return _ChoiceChip(
                            label: days[i].dayLabel,
                            selected: selected,
                            onTap: () => setState(() {
                              _dayIndex = i;
                              _slot = null; // reset slot when the day changes
                            }),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 16),
                    _sectionLabel('Choose a time'),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final s in day.slots)
                          _ChoiceChip(
                            label: _fmtSlot(s),
                            selected: _slot == s,
                            onTap: () => setState(() => _slot = s),
                          ),
                      ],
                    ),
                    if (widget.collectNotes) ...[
                      const SizedBox(height: 16),
                      _sectionLabel('Notes (optional)'),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _notesCtrl,
                        maxLines: 3,
                        maxLength: 500,
                        style: AppFonts.body(
                            fontSize: 13, color: AppColors.textPrimary),
                        decoration: InputDecoration(
                          hintText:
                              'Anything you want the trainer to focus on…',
                          hintStyle: AppFonts.body(
                              fontSize: 12.5, color: AppColors.slate400),
                          isDense: true,
                          contentPadding: const EdgeInsets.all(12),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide:
                                const BorderSide(color: AppColors.slate200),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide:
                                const BorderSide(color: AppColors.slate200),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide:
                                const BorderSide(color: AppColors.primary),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            SafeArea(
              top: false,
              minimum: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _slot == null ? null : _confirm,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    disabledBackgroundColor: AppColors.slate200,
                    disabledForegroundColor: AppColors.slate400,
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(
                    widget.confirmLabel,
                    style: AppTextStyles.button.copyWith(
                        color:
                            _slot == null ? AppColors.slate400 : AppColors.white,
                        fontSize: 15),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionLabel(String text) => Text(
        text,
        style: AppFonts.body(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          color: AppColors.slate700,
        ),
      );
}

class _ChoiceChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _ChoiceChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primary : AppColors.slate50,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
                color: selected ? AppColors.primary : AppColors.slate200),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: selected ? AppColors.white : AppColors.slate700,
            ),
          ),
        ),
      ),
    );
  }
}
