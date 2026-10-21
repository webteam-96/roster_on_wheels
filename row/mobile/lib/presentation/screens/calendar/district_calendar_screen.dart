import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/calendar_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'calendar_widgets.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class DistrictCalendarScreen extends StatefulWidget {
  /// When set, the screen is scoped to a single district (no selection page).
  final int? onlyDistrictId;

  /// Optional app-bar title override (e.g. the district number).
  final String? titleOverride;

  const DistrictCalendarScreen(
      {super.key, this.onlyDistrictId, this.titleOverride});

  @override
  State<DistrictCalendarScreen> createState() => _DistrictCalendarScreenState();
}

class _DistrictCalendarScreenState extends State<DistrictCalendarScreen> {
  final _api = ApiClient();

  List<CalendarDistrict> _districts = [];
  CalendarDistrict? _selected;
  DistrictCalendarData? _data;

  bool _loadingDistricts = true;
  bool _loadingData = false;
  String? _error;

  // Day ("date") view: only the selected day's data is shown. The backend is
  // month-based, so we fetch the month and filter client-side, refetching only
  // when the day crosses into another month.
  late DateTime _selectedDate;
  int? _loadedMonth;
  int? _loadedYear;

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _loadDistricts();
  }

  bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  bool _activeOn(DateTime? publish, DateTime? expiry) {
    final d = DateTime(_selectedDate.year, _selectedDate.month, _selectedDate.day);
    if (publish != null &&
        DateTime(publish.year, publish.month, publish.day).isAfter(d)) {
      return false;
    }
    if (expiry != null &&
        DateTime(expiry.year, expiry.month, expiry.day).isBefore(d)) {
      return false;
    }
    return true;
  }

  // The district calendar wishes only the members themselves — no family
  // (spouse/child) birthdays or anniversaries. (Family is shown on the club
  // and COG calendars.)
  List<Object> get _birthdaysToday => [
        ...(_data?.birthdays ?? const [])
            .where((p) => p.day == _selectedDate.day),
      ];

  List<Object> get _anniversariesToday => (_data?.anniversaries ?? const [])
      .where((p) => p.day == _selectedDate.day)
      .toList();

  List<CalendarEvent> get _eventsToday => (_data?.upcomingEvents ?? const [])
      .where((e) => e.eventDate != null && _sameDay(e.eventDate!, _selectedDate))
      .toList();

  List<CalendarAnnouncement> get _announcementsToday =>
      (_data?.announcements ?? const [])
          .where((a) => _activeOn(a.publishDate, a.expiryDate))
          .toList();

  void _onDateChanged(DateTime d) {
    final needFetch = d.month != _loadedMonth || d.year != _loadedYear;
    setState(() => _selectedDate = d);
    if (needFetch) _loadCalendar();
  }

  Future<void> _loadDistricts() async {
    setState(() {
      _loadingDistricts = true;
      _error = null;
    });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/mobile/district-calendar/my-districts',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess) {
        var items = (resp.data ?? const [])
            .map((e) => CalendarDistrict.fromJson(e as Map<String, dynamic>))
            .toList();
        // COG is a special club; its district is hidden from the district
        // calendar listing (COG members use the COG Calendar chip instead).
        // Skip the hide when scoped so a direct deep-link still works.
        if (widget.onlyDistrictId == null) {
          final cogDistrictId =
              context.read<AuthProvider>().cogDistrictId;
          if (cogDistrictId != null) {
            items = items.where((d) => d.districtId != cogDistrictId).toList();
          }
        }
        // Scoped mode: keep only the requested district.
        if (widget.onlyDistrictId != null) {
          final scoped =
              items.where((d) => d.districtId == widget.onlyDistrictId).toList();
          if (scoped.isNotEmpty) items = scoped;
        }
        setState(() {
          _districts = items;
          _selected = items.isNotEmpty ? items.first : null;
          _loadingDistricts = false;
        });
        if (_selected != null) _loadCalendar();
      } else {
        setState(() {
          _error = resp.error ?? 'Failed to load districts';
          _loadingDistricts = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingDistricts = false;
      });
    }
  }

  Future<void> _loadCalendar() async {
    final d = _selected;
    if (d == null) return;
    setState(() {
      _loadingData = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/district-calendar/${d.districtId}',
        queryParams: {'month': _selectedDate.month, 'year': _selectedDate.year},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess && resp.data != null) {
        setState(() {
          _data = DistrictCalendarData.fromJson(resp.data!);
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

  // Whether an announcement (publish..expiry, inclusive, date-only) is active
  // on the given day. Mirrors `_activeOn` but for an arbitrary date.
  bool _activeOnDate(DateTime day, DateTime? publish, DateTime? expiry) {
    final d = DateTime(day.year, day.month, day.day);
    if (publish != null &&
        DateTime(publish.year, publish.month, publish.day).isAfter(d)) {
      return false;
    }
    if (expiry != null &&
        DateTime(expiry.year, expiry.month, expiry.day).isBefore(d)) {
      return false;
    }
    return true;
  }

  // Marked days for the month picker. Reuses the loaded month when possible;
  // otherwise fetches that month without disturbing the current day view.
  Future<Map<int, Set<CalendarMarkKind>>> _marksForMonth(
      int year, int month) async {
    DistrictCalendarData? data;
    if (year == _loadedYear && month == _loadedMonth && _data != null) {
      data = _data;
    } else {
      final d = _selected;
      if (d == null) return const {};
      try {
        final resp = await _api.get<Map<String, dynamic>>(
          '/api/mobile/district-calendar/${d.districtId}',
          queryParams: {'month': month, 'year': year},
          fromJson: (j) => j as Map<String, dynamic>,
        );
        if (resp.isSuccess && resp.data != null) {
          data = DistrictCalendarData.fromJson(resp.data!);
        }
      } catch (_) {}
    }
    if (data == null) return const {};

    final marks = <int, Set<CalendarMarkKind>>{};
    void add(int day, CalendarMarkKind kind) {
      if (day < 1 || day > 31) return;
      (marks[day] ??= <CalendarMarkKind>{}).add(kind);
    }

    // Members only — no family day-dots on the district calendar.
    for (final p in data.birthdays) {
      add(p.day, CalendarMarkKind.birthday);
    }
    for (final p in data.anniversaries) {
      add(p.day, CalendarMarkKind.anniversary);
    }
    for (final e in data.upcomingEvents) {
      final dt = e.eventDate;
      if (dt != null && dt.year == year && dt.month == month) {
        add(dt.day, CalendarMarkKind.event);
      }
    }
    // Announcements span a publish..expiry range — mark every active day in
    // the month (matches the day view, which lists them on each active day).
    final daysInMonth = DateTime(year, month + 1, 0).day;
    for (final a in data.announcements) {
      for (var day = 1; day <= daysInMonth; day++) {
        if (_activeOnDate(DateTime(year, month, day), a.publishDate, a.expiryDate)) {
          add(day, CalendarMarkKind.announcement);
        }
      }
    }
    return marks;
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar:
            CustomAppBar(title: widget.titleOverride ?? 'Calendar'),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loadingDistricts) return const LoadingWidget();
    if (_error != null && _districts.isEmpty) {
      return ErrorStateWidget(message: _error!, onRetry: _loadDistricts);
    }
    if (_districts.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.map_rounded,
        title: 'No Districts',
        subtitle: "You're not a member of any district yet.",
      );
    }

    // Multi-district, unscoped entry: show a selection page (not a dropdown).
    // Tapping a district opens its calendar (scoped) as a new page.
    if (widget.onlyDistrictId == null && _districts.length > 1) {
      return _picker();
    }

    return Column(
      children: [
        DayPicker(
          date: _selectedDate,
          onChanged: _onDateChanged,
          marksLoader: _marksForMonth,
        ),
        TabBar(
          labelColor: AppColors.primary,
          unselectedLabelColor: AppColors.textSecondary,
          indicatorColor: AppColors.primary,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelStyle:
              AppFonts.body(fontSize: 13, fontWeight: FontWeight.w700),
          tabs: [
            Tab(text: _tabLabel('Birthdays', _data == null ? null : _birthdaysToday.length)),
            Tab(text: _tabLabel('Anniversaries', _data == null ? null : _anniversariesToday.length)),
            Tab(text: _tabLabel('Events', _data == null ? null : _eventsToday.length)),
            Tab(text: _tabLabel('Announcements', _data == null ? null : _announcementsToday.length)),
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
                ? CalendarFamilyTile(item: o)
                : CalendarPersonTile(
                    person: o as CalendarPerson, showContact: true),
          ),
          _listOrEmpty(
            _anniversariesToday,
            empty: 'No anniversaries on this day',
            icon: Icons.favorite_rounded,
            builder: (o) => o is CalendarFamilyEvent
                ? CalendarFamilyTile(item: o, isAnniversary: true)
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
          _listOrEmpty(
            _announcementsToday,
            empty: 'No announcements on this day',
            icon: Icons.campaign_rounded,
            builder: (a) => CalendarAnnouncementTile(announcement: a),
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

  // Selection page shown when the user belongs to more than one district.
  // Lists districts by number only (no "District" prefix, no zone); tapping
  // one opens its calendar on its own page.
  Widget _picker() {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      itemCount: _districts.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final d = _districts[i];
        return CalendarChoiceTile(
          label: d.districtNumber,
          icon: Icons.date_range_rounded,
          index: i,
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => DistrictCalendarScreen(
              onlyDistrictId: d.districtId,
              titleOverride: d.districtNumber,
            ),
          )),
        );
      },
    );
  }

  String _tabLabel(String base, int? count) =>
      count == null ? base : '$base ($count)';
}
