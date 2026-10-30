import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/calendar_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'calendar_widgets.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class ClubCalendarScreen extends StatefulWidget {
  /// When set, the screen is scoped to a single club (the chooser is hidden).
  /// Used by the home "COG Calendar" chip to reuse this screen for the COG club.
  final int? onlyClubId;

  /// Optional app-bar title override (e.g. "COG Calendar").
  final String? titleOverride;

  const ClubCalendarScreen({super.key, this.onlyClubId, this.titleOverride});

  @override
  State<ClubCalendarScreen> createState() => _ClubCalendarScreenState();
}

class _ClubCalendarScreenState extends State<ClubCalendarScreen> {
  final _api = ApiClient();

  List<CalendarClub> _clubs = [];
  CalendarClub? _selectedClub;
  ClubCalendarData? _data;

  bool _loadingClubs = true;
  bool _loadingData = false;
  String? _error;

  // Day ("date") view: only the selected day's data is shown. The backend is
  // month-based, so we fetch the month containing the selected date and filter
  // client-side; we only refetch when the day crosses into another month.
  late DateTime _selectedDate;
  int? _loadedMonth;
  int? _loadedYear;

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _loadClubs();
  }

  bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  // The COG calendar wishes only the member and their spouse; a regular club
  // wishes the whole family (spouse + children). (Districts wish members only —
  // handled in the district calendar screen.)
  bool get _isCog =>
      (_selectedClub?.clubName ?? '').trim().toLowerCase() == 'cog';
  bool _isSpouse(CalendarFamilyEvent f) =>
      f.relation.trim().toLowerCase() == 'spouse';

  // Birthday/anniversary tabs merge member entries with family-member entries
  // (spouse/child) for the same day; the builder switches on the runtime type.
  // On COG, family is narrowed to the spouse only.
  List<Object> get _birthdaysToday => [
        ...(_data?.birthdays ?? const [])
            .where((p) => p.day == _selectedDate.day),
        ...(_data?.familyBirthdays ?? const [])
            .where((f) => f.day == _selectedDate.day)
            .where((f) => !_isCog || _isSpouse(f)),
      ];

  List<Object> get _anniversariesToday {
    final members = (_data?.anniversaries ?? const [])
        .where((p) => p.day == _selectedDate.day)
        .toList();
    // A spouse's wedding anniversary is the SAME event as the member's, sent
    // twice by the backend (member side + family side). Drop the family (spouse)
    // entry when the member's own anniversary for that couple is already shown —
    // the member card already reaches the spouse via its contact popup.
    final memberIds = members.map((p) => p.memberId).toSet();
    final family = (_data?.familyAnniversaries ?? const [])
        .where((f) => f.day == _selectedDate.day)
        .where((f) => !_isCog || _isSpouse(f))
        .where((f) => !(f.relation.trim().toLowerCase() == 'spouse' &&
            memberIds.contains(f.memberId)))
        .toList();
    return [...members, ...family];
  }

  List<CalendarEvent> get _eventsToday => (_data?.upcomingEvents ?? const [])
      .where((e) => e.eventDate != null && _sameDay(e.eventDate!, _selectedDate))
      .toList();

  void _onDateChanged(DateTime d) {
    final needFetch = d.month != _loadedMonth || d.year != _loadedYear;
    setState(() => _selectedDate = d);
    if (needFetch) _loadCalendar();
  }

  Future<void> _loadClubs() async {
    setState(() {
      _loadingClubs = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/mobile/club-calendar/my-clubs',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess) {
        var items = (resp.data ?? const [])
            .map((e) => CalendarClub.fromJson(e as Map<String, dynamic>))
            .toList();
        // Scoped mode (e.g. COG Calendar): keep only the requested club so the
        // chooser stays hidden and the screen shows that club's calendar.
        if (widget.onlyClubId != null) {
          final scoped =
              items.where((c) => c.clubId == widget.onlyClubId).toList();
          if (scoped.isNotEmpty) items = scoped;
        }
        setState(() {
          _clubs = items;
          _selectedClub = items.isNotEmpty ? items.first : null;
          _loadingClubs = false;
        });
        if (_selectedClub != null) _loadCalendar();
      } else {
        setState(() {
          _error = resp.error ?? 'Failed to load clubs';
          _loadingClubs = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingClubs = false;
      });
    }
  }

  Future<void> _loadCalendar() async {
    final club = _selectedClub;
    if (club == null) return;
    setState(() {
      _loadingData = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/club-calendar/${club.clubId}',
        queryParams: {'month': _selectedDate.month, 'year': _selectedDate.year},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess && resp.data != null) {
        setState(() {
          _data = ClubCalendarData.fromJson(resp.data!);
          _loadedMonth = _selectedDate.month;
          _loadedYear = _selectedDate.year;
          _loadingData = false;
        });
      } else {
        setState(() {
          _error = resp.error ?? 'Failed to load calendar';
          _loadingData = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingData = false;
      });
    }
  }

  // Marked days for the month picker. Reuses the already-loaded month's data
  // when possible; otherwise fetches that month (without disturbing the
  // current day view).
  Future<Map<int, Set<CalendarMarkKind>>> _marksForMonth(
      int year, int month) async {
    ClubCalendarData? data;
    if (year == _loadedYear && month == _loadedMonth && _data != null) {
      data = _data;
    } else {
      final club = _selectedClub;
      if (club == null) return const {};
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/mobile/club-calendar/${club.clubId}',
          queryParams: {'month': month, 'year': year},
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.isSuccess && resp.data != null) {
          data = ClubCalendarData.fromJson(resp.data!);
        }
      } catch (_) {}
    }
    if (data == null) return const {};

    final marks = <int, Set<CalendarMarkKind>>{};
    void add(int day, CalendarMarkKind kind) {
      if (day < 1 || day > 31) return;
      (marks[day] ??= <CalendarMarkKind>{}).add(kind);
    }

    for (final p in data.birthdays) {
      add(p.day, CalendarMarkKind.birthday);
    }
    for (final f in data.familyBirthdays) {
      if (_isCog && !_isSpouse(f)) continue;
      add(f.day, CalendarMarkKind.birthday);
    }
    for (final p in data.anniversaries) {
      add(p.day, CalendarMarkKind.anniversary);
    }
    for (final f in data.familyAnniversaries) {
      if (_isCog && !_isSpouse(f)) continue;
      add(f.day, CalendarMarkKind.anniversary);
    }
    for (final e in data.upcomingEvents) {
      final dt = e.eventDate;
      if (dt != null && dt.year == year && dt.month == month) {
        add(dt.day, CalendarMarkKind.event);
      }
    }
    return marks;
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: CustomAppBar(title: widget.titleOverride ?? 'Calendar'),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loadingClubs) return const LoadingWidget();
    if (_error != null && _clubs.isEmpty) {
      return ErrorStateWidget(message: _error!, onRetry: _loadClubs);
    }
    if (_clubs.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.account_balance_rounded,
        title: 'No Clubs',
        subtitle: "You're not an active member of any club yet.",
      );
    }

    // Multi-club, unscoped entry: show a selection page (not a dropdown).
    // Tapping a club opens that club's calendar (scoped) as a new page.
    if (widget.onlyClubId == null && _clubs.length > 1) {
      return _picker();
    }

    return Column(
      children: [
        DayPicker(
          date: _selectedDate,
          onChanged: _onDateChanged,
          marksLoader: _marksForMonth,
          markKinds: const [
            CalendarMarkKind.birthday,
            CalendarMarkKind.anniversary,
            CalendarMarkKind.event,
          ],
        ),
        TabBar(
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelStyle:
              AppFonts.body(fontSize: 13, fontWeight: FontWeight.w700),
          tabs: [
            Tab(text: _tabLabel('Birthdays', _data == null ? null : _birthdaysToday.length)),
            Tab(text: _tabLabel('Anniversaries', _data == null ? null : _anniversariesToday.length)),
            Tab(text: _tabLabel('Events', _data == null ? null : _eventsToday.length)),
          ],
        ),
        Expanded(child: _buildTabViews()),
      ],
    );
  }

  Widget _buildTabViews() {
    if (_loadingData) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _loadCalendar);
    final d = _data;
    if (d == null) return const SizedBox.shrink();

    // COG calendar shows the Rotarian's designation on family tiles
    // ("Spouse of Siva(PDG 2017 - 18)"); plain elsewhere.
    final isCog = _isCog;

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _loadCalendar,
      child: TabBarView(
        children: [
          _listOrEmpty(
            _birthdaysToday,
            empty: 'No birthdays on this day',
            icon: Icons.cake_rounded,
            builder: (o) => o is CalendarFamilyEvent
                ? CalendarFamilyTile(item: o, isCog: isCog)
                : CalendarPersonTile(
                    person: o as CalendarPerson, showContact: true),
          ),
          _listOrEmpty(
            _anniversariesToday,
            empty: 'No anniversaries on this day',
            icon: Icons.favorite_rounded,
            builder: (o) => o is CalendarFamilyEvent
                ? CalendarFamilyTile(item: o, isAnniversary: true, isCog: isCog)
                : CalendarPersonTile(
                    person: o as CalendarPerson,
                    isAnniversary: true,
                    showContact: true),
          ),
          _listOrEmpty(
            _eventsToday,
            empty: 'No events on this day',
            icon: Icons.event_rounded,
            builder: (e) => CalendarEventTile(event: e),
          ),
        ],
      ),
    );
  }

  Widget _listOrEmpty<T>(
    List<T> items, {
    required String empty,
    required IconData icon,
    required Widget Function(T) builder,
  }) {
    if (items.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 60),
          EmptyStateWidget(icon: icon, title: empty),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) => builder(items[i]),
    );
  }

  // Selection page shown when the user belongs to more than one club. Lists
  // the clubs by name only; tapping one opens its calendar on its own page.
  Widget _picker() {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      itemCount: _clubs.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final c = _clubs[i];
        return CalendarChoiceTile(
          label: c.clubName,
          icon: Icons.calendar_month_rounded,
          index: i,
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => ClubCalendarScreen(
              onlyClubId: c.clubId,
              titleOverride: c.clubName,
            ),
          )),
        );
      },
    );
  }

  String _tabLabel(String base, int? count) =>
      count == null ? base : '$base ($count)';
}
