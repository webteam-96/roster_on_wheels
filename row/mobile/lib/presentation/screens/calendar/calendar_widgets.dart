import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/calendar_model.dart';
import '../../../data/models/rotarian_model.dart';
import 'calendar_detail_screens.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The kinds of things a calendar day can be marked with. Each gets its own
/// colour dot in the month picker.
enum CalendarMarkKind { birthday, anniversary, event, announcement }

const Map<CalendarMarkKind, Color> kCalendarMarkColors = {
  CalendarMarkKind.birthday: AppColors.goldPrime,
  CalendarMarkKind.anniversary: AppColors.accentBlue,
  CalendarMarkKind.event: AppColors.primaryPrime,
  CalendarMarkKind.announcement: AppColors.slate700,
};

const Map<CalendarMarkKind, String> kCalendarMarkLabels = {
  CalendarMarkKind.birthday: 'Birthday',
  CalendarMarkKind.anniversary: 'Anniversary',
  CalendarMarkKind.event: 'Event',
  CalendarMarkKind.announcement: 'Announcement',
};

/// Loads the set of mark kinds for each day (1-31) of a given month.
typedef CalendarMarksLoader = Future<Map<int, Set<CalendarMarkKind>>> Function(
    int year, int month);

/// Single-day picker — the calendars are a "day view": prev/next-day arrows,
/// the full date in the middle (tap to open a month calendar with marked days),
/// and a "Today" chip when the user has navigated away from today.
class DayPicker extends StatelessWidget {
  final DateTime date;
  final ValueChanged<DateTime> onChanged;

  /// Loads marked days per month for the picker. When null, tapping the date
  /// falls back to the plain Material date picker (no markers).
  final CalendarMarksLoader? marksLoader;

  /// Which mark kinds this calendar can show (drives the legend). Club calendars
  /// have no announcements, so they pass the first three.
  final List<CalendarMarkKind> markKinds;

  const DayPicker({
    super.key,
    required this.date,
    required this.onChanged,
    this.marksLoader,
    this.markKinds = const [
      CalendarMarkKind.birthday,
      CalendarMarkKind.anniversary,
      CalendarMarkKind.event,
      CalendarMarkKind.announcement,
    ],
  });

  bool get _isToday {
    final now = DateTime.now();
    return date.year == now.year && date.month == now.month && date.day == now.day;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left_rounded),
            color: AppColors.primary,
            onPressed: () =>
                onChanged(DateTime(date.year, date.month, date.day - 1)),
          ),
          Expanded(
            child: InkWell(
              onTap: () => _pick(context),
              borderRadius: BorderRadius.circular(10),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 8),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      DateFormat('EEEE').format(date),
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    Text(
                      _isToday
                          ? 'Today · ${DateFormat('d MMM yyyy').format(date)}'
                          : DateFormat('d MMMM yyyy').format(date),
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right_rounded),
            color: AppColors.primary,
            onPressed: () =>
                onChanged(DateTime(date.year, date.month, date.day + 1)),
          ),
        ],
      ),
    );
  }

  Future<void> _pick(BuildContext context) async {
    final loader = marksLoader;
    if (loader == null) {
      final picked = await showDatePicker(
        context: context,
        initialDate: date,
        firstDate: DateTime(2000, 1, 1),
        lastDate: DateTime(2100, 12, 31),
      );
      if (picked != null) {
        onChanged(DateTime(picked.year, picked.month, picked.day));
      }
      return;
    }

    final picked = await showModalBottomSheet<DateTime>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _MonthCalendarSheet(
        selectedDate: date,
        marksLoader: loader,
        markKinds: markKinds,
      ),
    );
    if (picked != null) {
      onChanged(DateTime(picked.year, picked.month, picked.day));
    }
  }
}

/// Month calendar shown as a bottom sheet. Each day shows colour dots for the
/// birthdays / anniversaries / events / announcements falling on it, so the
/// user can see at a glance which dates have something. Tap a day to select it.
class _MonthCalendarSheet extends StatefulWidget {
  final DateTime selectedDate;
  final CalendarMarksLoader marksLoader;
  final List<CalendarMarkKind> markKinds;

  const _MonthCalendarSheet({
    required this.selectedDate,
    required this.marksLoader,
    required this.markKinds,
  });

  @override
  State<_MonthCalendarSheet> createState() => _MonthCalendarSheetState();
}

class _MonthCalendarSheetState extends State<_MonthCalendarSheet> {
  late DateTime _month; // first day of the visible month
  Map<int, Set<CalendarMarkKind>> _marks = const {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _month = DateTime(widget.selectedDate.year, widget.selectedDate.month);
    _loadMarks();
  }

  Future<void> _loadMarks() async {
    setState(() => _loading = true);
    Map<int, Set<CalendarMarkKind>> marks = const {};
    try {
      marks = await widget.marksLoader(_month.year, _month.month);
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _marks = marks;
      _loading = false;
    });
  }

  void _shiftMonth(int delta) {
    setState(() => _month = DateTime(_month.year, _month.month + delta));
    _loadMarks();
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  @override
  Widget build(BuildContext context) {
    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;
    // Sunday-first grid: weekday Sun=7 → 0 … Sat=6 → 6.
    final leadingBlanks = DateTime(_month.year, _month.month, 1).weekday % 7;
    final today = DateTime.now();

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Grab handle
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            // Month header with nav arrows
            Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.chevron_left_rounded),
                  color: AppColors.primary,
                  onPressed: () => _shiftMonth(-1),
                ),
                Expanded(
                  child: Text(
                    DateFormat('MMMM yyyy').format(_month),
                    textAlign: TextAlign.center,
                    style: AppFonts.body(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.chevron_right_rounded),
                  color: AppColors.primary,
                  onPressed: () => _shiftMonth(1),
                ),
              ],
            ),
            const SizedBox(height: 4),
            // Weekday labels
            Row(
              children: ['S', 'M', 'T', 'W', 'T', 'F', 'S']
                  .map((d) => Expanded(
                        child: Text(
                          d,
                          textAlign: TextAlign.center,
                          style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 6),
            // Day grid (loader overlay keeps height stable while fetching)
            Stack(
              children: [
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: EdgeInsets.zero,
                  gridDelegate:
                      const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 7,
                    childAspectRatio: 0.74,
                  ),
                  itemCount: leadingBlanks + daysInMonth,
                  itemBuilder: (_, i) {
                    if (i < leadingBlanks) return const SizedBox.shrink();
                    final day = i - leadingBlanks + 1;
                    final cellDate = DateTime(_month.year, _month.month, day);
                    return _DayCell(
                      day: day,
                      marks: _marks[day] ?? const {},
                      isSelected: _isSameDay(cellDate, widget.selectedDate),
                      isToday: _isSameDay(cellDate, today),
                      onTap: () => Navigator.of(context).pop(cellDate),
                    );
                  },
                ),
                if (_loading)
                  Positioned.fill(
                    child: Container(
                      color: AppColors.surface.withValues(alpha: 0.6),
                      alignment: Alignment.center,
                      child: const SizedBox(
                        width: 22,
                        height: 22,
                        child:
                            CircularProgressIndicator(strokeWidth: 2.5),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            // Legend
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 14,
              runSpacing: 6,
              children: widget.markKinds
                  .map((k) => Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: kCalendarMarkColors[k],
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            kCalendarMarkLabels[k]!,
                            style: AppFonts.body(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ))
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  final int day;
  final Set<CalendarMarkKind> marks;
  final bool isSelected;
  final bool isToday;
  final VoidCallback onTap;

  const _DayCell({
    required this.day,
    required this.marks,
    required this.isSelected,
    required this.isToday,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // Dots in a stable kind order so colours are consistent across days.
    final ordered = CalendarMarkKind.values
        .where((k) => marks.contains(k))
        .toList();
    return InkResponse(
      onTap: onTap,
      radius: 26,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isSelected ? AppColors.primary : Colors.transparent,
              border: !isSelected && isToday
                  ? Border.all(color: AppColors.primary, width: 1.3)
                  : null,
            ),
            child: Text(
              '$day',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: isSelected ? Colors.white : AppColors.textPrimary,
              ),
            ),
          ),
          const SizedBox(height: 3),
          // Reserve dot-row height so cells stay aligned with/without marks.
          SizedBox(
            height: 6,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final k in ordered)
                  Container(
                    width: 5,
                    height: 5,
                    margin: const EdgeInsets.symmetric(horizontal: 1),
                    decoration: BoxDecoration(
                      color: kCalendarMarkColors[k],
                      shape: BoxShape.circle,
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

class CalendarPersonTile extends StatelessWidget {
  final CalendarPerson person;
  final bool isAnniversary;

  /// When true, the member's contact details (call / message /
  /// email) are fetched and shown below the card.
  final bool showContact;

  const CalendarPersonTile({
    super.key,
    required this.person,
    this.isAnniversary = false,
    this.showContact = false,
  });

  // Role line under the name = the member's per-club designation (e.g. on the
  // COG calendar this is their COG role). Trimmed; null / empty / whitespace
  // yields '' so the line is hidden entirely — no classification fallback.
  String get _roleLabel => (person.designation ?? '').trim();

  @override
  Widget build(BuildContext context) {
    final url = _photoUrl(person.profilePhoto);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _dayBadge(person.day),
              const SizedBox(width: 12),
              ClipOval(
                child: Container(
                  width: 44,
                  height: 44,
                  color: AppColors.primaryLight,
                  child: url == null
                      ? const Icon(Icons.person_rounded, color: AppColors.primary)
                      : CachedNetworkImage(
                          imageUrl: url,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              Container(color: AppColors.primaryLight),
                          errorWidget: (_, __, ___) =>
                              const Icon(Icons.person_rounded, color: AppColors.primary),
                        ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      person.memberName,
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (_roleLabel.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        _roleLabel,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    if ((person.clubName ?? '').isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          const Icon(Icons.account_balance_rounded,
                              size: 11, color: AppColors.primary),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              person.clubName!,
                              style: AppFonts.body(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.primary,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                isAnniversary ? Icons.favorite_rounded : Icons.cake_rounded,
                color:
                    isAnniversary ? AppColors.accentPurple : AppColors.goldPrime,
              ),
            ],
          ),
          if (showContact && person.memberId > 0)
            // Indent so the divider + contact icons line up under the avatar
            // (leading = day badge 40 + 12 = 52), giving the card a clean left
            // edge instead of the icons sitting flush against the day badge.
            Padding(
              padding: const EdgeInsets.only(left: 52),
              // Anniversaries offer a chooser popup (the member + their spouse);
              // birthdays use the inline single-person actions.
              child: isAnniversary
                  ? CalendarPersonContactChooser(person: person)
                  : CalendarContactDetails(memberId: person.memberId),
            ),
        ],
      ),
    );
  }

  Widget _dayBadge(int day) {
    return Container(
      width: 40,
      height: 48,
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Center(
        child: Text(
          day.toString().padLeft(2, '0'),
          style: AppFonts.display(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: AppColors.primary,
          ),
        ),
      ),
    );
  }
}

/// Calendar tile for a spouse/child birthday (`familyBirthdays[]`) or
/// anniversary (`familyAnniversaries[]`). Shows the family member's name +
/// relation, and — as context — the Rotarian they belong to and that Rotarian's
/// club. Below the card, a contact row: tapping a channel opens a chooser popup
/// with one card for the Rotarian (call them) and one for the family member
/// themselves (call the family member directly).
class CalendarFamilyTile extends StatelessWidget {
  final CalendarFamilyEvent item;
  final bool isAnniversary;

  /// On the COG calendar, append the Rotarian's designation to the context line
  /// — "Spouse of Siva(PDG 2017 - 18)". Off elsewhere (plain "Spouse of Siva").
  final bool isCog;
  const CalendarFamilyTile({
    super.key,
    required this.item,
    this.isAnniversary = false,
    this.isCog = false,
  });

  // "Spouse of Siva" — and, on the COG calendar with a designation present,
  // "Spouse of Siva(PDG 2017 - 18)". Relation may be empty → just the name.
  String get _contextLine {
    final rel = item.relation.trim();
    final base = rel.isEmpty ? item.memberName : '$rel of ${item.memberName}';
    final desig = (item.designation ?? '').trim();
    return (isCog && desig.isNotEmpty) ? '$base($desig)' : base;
  }

  @override
  Widget build(BuildContext context) {
    final url = _photoUrl(item.profilePhoto);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(
                    item.day.toString().padLeft(2, '0'),
                    style: AppFonts.display(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primary,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              ClipOval(
                child: Container(
                  width: 44,
                  height: 44,
                  color: AppColors.primaryLight,
                  child: url == null
                      ? const Icon(Icons.person_rounded, color: AppColors.primary)
                      : CachedNetworkImage(
                          imageUrl: url,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              Container(color: AppColors.primaryLight),
                          errorWidget: (_, __, ___) => const Icon(
                              Icons.person_rounded, color: AppColors.primary),
                        ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.familyMemberName,
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (item.memberName.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          const Icon(Icons.person_outline_rounded,
                              size: 11, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Expanded(
                            // "Spouse of Khushboo" (+ "(designation)" on COG) —
                            // relation + the Rotarian on its own line so a long
                            // family name doesn't crowd the title.
                            child: Text(
                              _contextLine,
                              style: AppFonts.body(
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                                color: AppColors.textSecondary,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                    if ((item.clubName ?? '').isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          const Icon(Icons.account_balance_rounded,
                              size: 11, color: AppColors.primary),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              item.clubName!,
                              style: AppFonts.body(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.primary,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                isAnniversary ? Icons.favorite_rounded : Icons.cake_rounded,
                color:
                    isAnniversary ? AppColors.accentPurple : AppColors.goldPrime,
              ),
            ],
          ),
          // Indent so the divider + contact icons line up under the avatar
          // (leading = day badge 40 + 12 = 52), matching CalendarPersonTile.
          Padding(
            padding: const EdgeInsets.only(left: 52),
            child: CalendarFamilyContactDetails(item: item),
          ),
        ],
      ),
    );
  }
}

/// Contact row for a family-event tile. Resolves two possible contacts — the
/// Rotarian (via the privacy-gated find-rotarian fetch) and the family member
/// themselves (from the calendar payload, if the backend sent their number/
/// email) — then shows call / message / email actions for whichever
/// channels are reachable on EITHER. Tapping a channel opens a chooser popup so
/// the user picks which person to reach.
class CalendarFamilyContactDetails extends StatelessWidget {
  final CalendarFamilyEvent item;
  const CalendarFamilyContactDetails({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<RotarianProfile?>(
      future: item.memberId > 0
          ? _fetchContact(item.memberId)
          : Future<RotarianProfile?>.value(null),
      builder: (context, snap) {
        if (item.memberId > 0 &&
            snap.connectionState != ConnectionState.done) {
          return const _ContactRowLoading();
        }
        return _ContactChooserRow(targets: _familyTargets(item, snap.data));
      },
    );
  }
}

/// Contact row for a member's wedding-anniversary tile. Offers a chooser popup
/// with the member and their spouse: the member is reached via the privacy-
/// gated find-rotarian fetch; the spouse card is shown whenever a spouse name is
/// known, disabled until the backend sends the spouse's own number/email.
class CalendarPersonContactChooser extends StatelessWidget {
  final CalendarPerson person;
  const CalendarPersonContactChooser({super.key, required this.person});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<RotarianProfile?>(
      future: person.memberId > 0
          ? _fetchContact(person.memberId)
          : Future<RotarianProfile?>.value(null),
      builder: (context, snap) {
        if (person.memberId > 0 &&
            snap.connectionState != ConnectionState.done) {
          return const _ContactRowLoading();
        }
        return _ContactChooserRow(
            targets: _personAnniversaryTargets(person, snap.data));
      },
    );
  }
}

class _ContactRowLoading extends StatelessWidget {
  const _ContactRowLoading();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.only(top: 12),
        child: SizedBox(
          height: 16,
          width: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
}

/// Divider + call / email / message buttons for a set of contact
/// targets. A channel button shows when ANY target is reachable on it; tapping
/// opens the chooser popup. Renders nothing when no target is reachable at all.
class _ContactChooserRow extends StatelessWidget {
  final List<_ContactTarget> targets;
  const _ContactChooserRow({required this.targets});

  @override
  Widget build(BuildContext context) {
    final anyPhone = targets.any((t) => (t.phone ?? '').trim().isNotEmpty);
    final anyEmail = targets.any((t) => (t.email ?? '').trim().isNotEmpty);
    if (!anyPhone && !anyEmail) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 10),
        const Divider(height: 1, color: AppColors.border),
        const SizedBox(height: 10),
        Wrap(
          children: [
            if (anyPhone)
              _ContactIconButton(
                icon: Icons.call_rounded,
                tooltip: 'Call',
                onTap: () =>
                    _showContactChooser(context, _CalChannel.call, targets),
              ),
            if (anyEmail)
              _ContactIconButton(
                icon: Icons.mail_outline_rounded,
                tooltip: 'Email',
                onTap: () =>
                    _showContactChooser(context, _CalChannel.email, targets),
              ),
            if (anyPhone)
            if (anyPhone)
              _ContactIconButton(
                icon: Icons.chat_bubble_outline_rounded,
                tooltip: 'Message',
                onTap: () =>
                    _showContactChooser(context, _CalChannel.sms, targets),
              ),
          ],
        ),
      ],
    );
  }
}

/// The four contact channels a chooser card can act on.
enum _CalChannel { call, sms, email }

const Map<_CalChannel, String> _kChannelLabels = {
  _CalChannel.call: 'Call',
  _CalChannel.sms: 'Message',
  _CalChannel.email: 'Email',
};

/// One person reachable from a family event — either the Rotarian or the
/// family member themselves.
class _ContactTarget {
  final String name;
  final String subtitle;
  final String? photoUrl;
  final String? phone;
  final String? phoneCode;
  final String? email;
  const _ContactTarget({
    required this.name,
    required this.subtitle,
    this.photoUrl,
    this.phone,
    this.phoneCode,
    this.email,
  });

  bool reachable(_CalChannel channel) => channel == _CalChannel.email
      ? (email ?? '').trim().isNotEmpty
      : (phone ?? '').trim().isNotEmpty;
}

/// Builds the contact targets for a family event: the family member (the
/// celebrant — whose birthday/anniversary it is) FIRST, then the Rotarian they
/// belong to. Either may be absent.
List<_ContactTarget> _familyTargets(
    CalendarFamilyEvent item, RotarianProfile? m) {
  final targets = <_ContactTarget>[];

  // Family member themselves (the celebrant) — on top. From the calendar
  // payload (contact may be null until the backend populates it). Shown even
  // without contact so the user sees who the event is for; the card is then
  // disabled per channel.
  if (item.familyMemberName.trim().isNotEmpty) {
    final fphone = (item.mobile ?? '').trim();
    final femail = (item.email ?? '').trim();
    final relation = item.relation.trim();
    targets.add(_ContactTarget(
      name: item.familyMemberName,
      subtitle: relation.isEmpty ? 'Family member' : relation,
      photoUrl: _photoUrl(item.profilePhoto),
      phone: fphone.isEmpty ? null : fphone,
      phoneCode: item.phoneCode,
      email: femail.isEmpty ? null : femail,
    ));
  }

  // Rotarian — below the celebrant. Only when their personal details are visible.
  if (m != null && m.isPersonalDetailsVisible) {
    final phone = (m.primaryMobile ?? '').trim();
    final email = (m.email ?? '').trim();
    if (phone.isNotEmpty || email.isNotEmpty) {
      final name = item.memberName.isNotEmpty ? item.memberName : m.memberName;
      targets.add(_ContactTarget(
        name: name,
        subtitle: (item.clubName ?? '').isNotEmpty
            ? 'Rotarian · ${item.clubName}'
            : 'Rotarian',
        photoUrl: _photoUrl(m.profilePhoto),
        phone: phone.isEmpty ? null : phone,
        phoneCode: m.primaryPhoneCode,
        email: email.isEmpty ? null : email,
      ));
    }
  }

  return targets;
}

/// Builds the contact targets for a member's wedding anniversary: the member
/// (from the privacy-gated find-rotarian profile) and their spouse. The spouse
/// card is included whenever a spouse name is known — disabled until the spouse
/// has their own number/email in the payload.
List<_ContactTarget> _personAnniversaryTargets(
    CalendarPerson p, RotarianProfile? m) {
  final targets = <_ContactTarget>[];

  // Member (the Rotarian) — only when their personal details are visible.
  if (m != null && m.isPersonalDetailsVisible) {
    final phone = (m.primaryMobile ?? '').trim();
    final email = (m.email ?? '').trim();
    if (phone.isNotEmpty || email.isNotEmpty) {
      targets.add(_ContactTarget(
        name: p.memberName.isNotEmpty ? p.memberName : m.memberName,
        subtitle: (p.clubName ?? '').isNotEmpty
            ? 'Rotarian · ${p.clubName}'
            : 'Rotarian',
        photoUrl: _photoUrl(m.profilePhoto) ?? _photoUrl(p.profilePhoto),
        phone: phone.isEmpty ? null : phone,
        phoneCode: m.primaryPhoneCode,
        email: email.isEmpty ? null : email,
      ));
    }
  }

  // Spouse — name from the anniversary entry; contact when the backend sends it.
  final spouse = (p.spouseName ?? '').trim();
  if (spouse.isNotEmpty) {
    final sphone = (p.spouseMobile ?? '').trim();
    final semail = (p.spouseEmail ?? '').trim();
    targets.add(_ContactTarget(
      name: spouse,
      subtitle: 'Spouse',
      photoUrl: null,
      phone: sphone.isEmpty ? null : sphone,
      phoneCode: p.spousePhoneCode,
      email: semail.isEmpty ? null : semail,
    ));
  }

  return targets;
}

/// Builds the launch URL for a target on a given channel.
String _urlForTarget(_CalChannel channel, _ContactTarget t) {
  switch (channel) {
    case _CalChannel.call:
      return 'tel:${_digits(t.phone ?? '')}';
    case _CalChannel.sms:
      return 'sms:${_digits(t.phone ?? '')}';
    case _CalChannel.email:
      return 'mailto:${(t.email ?? '').trim()}';
  }
}

/// Bottom-sheet popup that asks which person to reach on [channel]. Always
/// opens (even for a single contact) so the user sees who they're reaching
/// before acting: the Rotarian/member on top, the family member / spouse below.
/// Every target is listed; a target without a number/email for this channel is
/// shown disabled (e.g. the spouse until the backend sends their contact).
/// Tapping a reachable card launches the action for that person.
Future<void> _showContactChooser(
  BuildContext context,
  _CalChannel channel,
  List<_ContactTarget> targets,
) async {
  if (targets.isEmpty) return;
  // Don't bother opening if nobody is reachable on this channel.
  if (!targets.any((t) => t.reachable(channel))) return;

  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) {
      return Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                '${_kChannelLabels[channel]}: choose contact',
                style: AppFonts.body(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 12),
              for (final t in targets) ...[
                _ContactChooserCard(
                  channel: channel,
                  target: t,
                  onTap: t.reachable(channel)
                      ? () {
                          Navigator.of(sheetContext).pop();
                          _openUrl(_urlForTarget(channel, t));
                        }
                      : null,
                ),
                const SizedBox(height: 10),
              ],
            ],
          ),
        ),
      );
    },
  );
}

class _ContactChooserCard extends StatelessWidget {
  final _CalChannel channel;
  final _ContactTarget target;
  // Null when the target has no number/email for this channel — the card is
  // then shown disabled (greyed, non-tappable, "Not available" hint).
  final VoidCallback? onTap;
  const _ContactChooserCard({
    required this.channel,
    required this.target,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final detail = channel == _CalChannel.email
        ? (target.email ?? '').trim()
        : (target.phone ?? '').trim();
    final hint = channel == _CalChannel.email ? 'No email' : 'No phone number';
    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: Material(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                ClipOval(
                  child: Container(
                    width: 42,
                    height: 42,
                    color: AppColors.surface,
                    child: target.photoUrl == null
                        ? const Icon(Icons.person_rounded, color: AppColors.primary)
                        : CachedNetworkImage(
                            imageUrl: target.photoUrl!,
                            fit: BoxFit.cover,
                            placeholder: (_, __) =>
                                Container(color: AppColors.surface),
                            errorWidget: (_, __, ___) => const Icon(
                                Icons.person_rounded, color: AppColors.primary),
                          ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        target.name,
                        style: AppFonts.body(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        target.subtitle,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        enabled && detail.isNotEmpty ? detail : hint,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          fontStyle: enabled ? FontStyle.normal : FontStyle.italic,
                          color: AppColors.textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(_channelIcon(channel),
                    size: 20,
                    color: enabled ? AppColors.primary : AppColors.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _channelIcon(_CalChannel channel) {
    switch (channel) {
      case _CalChannel.call:
        return Icons.call_rounded;
      case _CalChannel.sms:
        return Icons.chat_bubble_outline_rounded;
      case _CalChannel.email:
        return Icons.mail_outline_rounded;
    }
  }
}

class CalendarEventTile extends StatelessWidget {
  final CalendarEvent event;
  const CalendarEventTile({super.key, required this.event});

  @override
  Widget build(BuildContext context) {
    final imgUrl = _photoUrl(event.imagePath);
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CalendarEventDetailScreen(event: event),
          ),
        ),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (event.eventDate != null) _dayBadge(event.eventDate!),
              if (event.eventDate != null) const SizedBox(width: 12),
          if (imgUrl != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: CachedNetworkImage(
                imageUrl: imgUrl,
                width: 56,
                height: 56,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(
                  width: 56,
                  height: 56,
                  color: AppColors.primaryLight,
                ),
                errorWidget: (_, __, ___) => Container(
                  width: 56,
                  height: 56,
                  color: AppColors.primaryLight,
                  child: const Icon(Icons.event_rounded, color: AppColors.primary),
                ),
              ),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.title,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if ((event.eventVenue ?? '').isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      const Icon(Icons.place_rounded, size: 12, color: AppColors.textSecondary),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          event.eventVenue!,
                          style: AppFonts.body(
                            fontSize: 13,
                            color: AppColors.textSecondary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
                if ((event.description ?? '').isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    event.description!,
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textPrimary,
                      height: 1.4,
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if ((event.registrationLink ?? '').isNotEmpty) ...[
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: () => _launch(event.registrationLink!),
                    icon: const Icon(Icons.open_in_new_rounded, size: 16),
                    label: Text(
                      'Register',
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
          ),
        ),
      ),
    );
  }

  Widget _dayBadge(DateTime d) {
    return Container(
      width: 44,
      height: 52,
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            DateFormat('d').format(d),
            style: AppFonts.display(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          Text(
            DateFormat('MMM').format(d).toUpperCase(),
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: Colors.white.withValues(alpha: 0.85),
            ),
          ),
        ],
      ),
    );
  }
}

class CalendarAnnouncementTile extends StatelessWidget {
  final CalendarAnnouncement announcement;
  const CalendarAnnouncementTile({super.key, required this.announcement});

  @override
  Widget build(BuildContext context) {
    final imgUrl = _photoUrl(announcement.imagePath);
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                CalendarAnnouncementDetailScreen(announcement: announcement),
          ),
        ),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (imgUrl != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: CachedNetworkImage(
                imageUrl: imgUrl,
                width: 56,
                height: 56,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(
                  width: 56,
                  height: 56,
                  color: AppColors.primaryLight,
                ),
                errorWidget: (_, __, ___) => Container(
                  width: 56,
                  height: 56,
                  color: AppColors.primaryLight,
                  child: const Icon(Icons.campaign_rounded, color: AppColors.primary),
                ),
              ),
            ),
            const SizedBox(width: 10),
          ] else ...[
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.campaign_rounded, color: AppColors.primary),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  announcement.title,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (announcement.publishDate != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    DateFormat('d MMM yyyy').format(announcement.publishDate!),
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
                if ((announcement.description ?? '').isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    announcement.description!,
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.textPrimary,
                      height: 1.4,
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
          ),
        ),
      ),
    );
  }
}

Future<void> _launch(String raw) async {
  var url = raw.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://$url';
  }
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}

// ── Contact details (below a person's calendar card) ─────────────────────────

/// Session cache so each member's contact profile is fetched only once even as
/// the day view rebuilds. The calendar payload has no phone/email, so we look
/// the member up on demand via `find-rotarian`.
final Map<int, Future<RotarianProfile?>> _contactCache = {};

Future<RotarianProfile?> _fetchContact(int memberId) {
  return _contactCache.putIfAbsent(memberId, () async {
    try {
      final resp = await ApiClient().get<Map<String, dynamic>>(
        '/api/mobile/find-rotarian/$memberId',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (resp.isSuccess && resp.data != null) {
        return RotarianDetail.fromJson(resp.data!).member;
      }
    } catch (_) {}
    return null;
  });
}

/// Fetches a member's contact profile and renders call / message /
/// email actions plus the visible phone & email below their calendar card.
/// Honours the member's `isPersonalDetailsVisible` privacy flag and renders
/// nothing when there is no reachable contact info.
class CalendarContactDetails extends StatelessWidget {
  final int memberId;
  const CalendarContactDetails({super.key, required this.memberId});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<RotarianProfile?>(
      future: _fetchContact(memberId),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Padding(
            padding: EdgeInsets.only(top: 12),
            child: SizedBox(
              height: 16,
              width: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          );
        }
        final m = snap.data;
        if (m == null || !m.isPersonalDetailsVisible) {
          return const SizedBox.shrink();
        }
        final phone = (m.primaryMobile ?? '').trim();
        final email = (m.email ?? '').trim();
        if (phone.isEmpty && email.isEmpty) return const SizedBox.shrink();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 10),
            const Divider(height: 1, color: AppColors.border),
            const SizedBox(height: 10),
            // Wrap (not Row) so the icons reflow to a second line on narrow
            // screens / large text scales instead of overflowing.
            Wrap(
              children: [
                if (phone.isNotEmpty)
                  _ContactIconButton(
                    icon: Icons.call_rounded,
                    tooltip: 'Call',
                    onTap: () => _openUrl('tel:${_digits(phone)}'),
                  ),
                if (email.isNotEmpty)
                  _ContactIconButton(
                    icon: Icons.mail_outline_rounded,
                    tooltip: 'Email',
                    onTap: () => _openUrl('mailto:$email'),
                  ),
                if (phone.isNotEmpty)
                if (phone.isNotEmpty)
                  _ContactIconButton(
                    icon: Icons.chat_bubble_outline_rounded,
                    tooltip: 'Message',
                    onTap: () => _openUrl('sms:${_digits(phone)}'),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _ContactIconButton extends StatelessWidget {
  final IconData? icon;
  final String tooltip;
  final VoidCallback onTap;
  const _ContactIconButton({
    this.icon,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Material(
        color: AppColors.primaryLight,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Tooltip(
            message: tooltip,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Icon(icon, size: 20, color: AppColors.primary),
            ),
          ),
        ),
      ),
    );
  }
}

String _digits(String input, {bool includeCountry = false, String? fallback}) {
  final stripped = input.replaceAll(RegExp(r'[^0-9+]'), '');
  if (!includeCountry) return stripped;
  if (stripped.startsWith('+')) return stripped.substring(1);
  final code = (fallback ?? '').replaceAll(RegExp(r'[^0-9]'), '');
  return '$code$stripped';
}

Future<void> _openUrl(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
}

/// A tappable gradient choice card used by the Club / District calendar
/// selection pages (shown instead of a dropdown when the user belongs to more
/// than one club / district). Matches the app's club-card style
/// (MyClubsListScreen): cycling gradient, white circular icon badge, bold white
/// label, forward chevron. Tapping opens that club's / district's calendar.
class CalendarChoiceTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final int index;
  final VoidCallback onTap;
  const CalendarChoiceTile({
    super.key,
    required this.label,
    required this.icon,
    required this.index,
    required this.onTap,
  });

  static const _gradients = [
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.accentBlue, AppColors.chart5],
    [AppColors.accentBlue, AppColors.accentBlue],
    [AppColors.errorDark, AppColors.error],
    [AppColors.successDark, AppColors.success],
    [AppColors.warningInk, AppColors.warningDark],
  ];

  @override
  Widget build(BuildContext context) {
    final grad = _gradients[index % _gradients.length];
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.primaryPrime,
          borderRadius: BorderRadius.circular(18),

        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                label,
                style: AppFonts.body(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Icon(Icons.arrow_forward_ios_rounded,
                color: Colors.white.withValues(alpha: 0.7), size: 16),
          ],
        ),
      ),
    );
  }
}
