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
import 'club_calendar_screen.dart';
import 'district_calendar_screen.dart';

/// Single entry point for all of the user's calendars. Lists, in one screen,
/// COG first, then the user's other clubs, then their districts. Tapping an
/// entry opens that calendar (scoped). Replaces the separate COG / Club /
/// District calendar chips on the home Quick Access card.
class MyCalendarsScreen extends StatefulWidget {
  const MyCalendarsScreen({super.key});

  @override
  State<MyCalendarsScreen> createState() => _MyCalendarsScreenState();
}

class _CalendarChoice {
  final String label;
  final IconData icon;
  final Widget Function() open;
  const _CalendarChoice(
      {required this.label, required this.icon, required this.open});
}

class _MyCalendarsScreenState extends State<MyCalendarsScreen> {
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  List<_CalendarChoice> _choices = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.get<List<dynamic>>('/api/mobile/club-calendar/my-clubs',
            fromJson: (j) => j as List<dynamic>),
        _api.get<List<dynamic>>('/api/mobile/district-calendar/my-districts',
            fromJson: (j) => j as List<dynamic>),
      ]);
      if (!mounted) return;

      final clubsResp = results[0];
      final districtsResp = results[1];
      // Surface an error only when BOTH calls fail (a single failure still
      // lets us show whatever loaded).
      if (!clubsResp.isSuccess && !districtsResp.isSuccess) {
        setState(() {
          _error = clubsResp.error ?? districtsResp.error ?? 'Failed to load.';
          _loading = false;
        });
        return;
      }

      final clubs = (clubsResp.data ?? const [])
          .map((e) => CalendarClub.fromJson(e as Map<String, dynamic>))
          .toList();
      final districts = (districtsResp.data ?? const [])
          .map((e) => CalendarDistrict.fromJson(e as Map<String, dynamic>))
          .toList();

      // COG is a special club: it sorts first and its district is hidden
      // (matches the rest of the app). IFRM (the "IFRM 3142 Main" club and the
      // "IFRM India" district) sorts last.
      bool isCog(CalendarClub c) => c.clubName.trim().toLowerCase() == 'cog';
      bool isIfrmClub(CalendarClub c) =>
          c.clubName.trim().toLowerCase().contains('ifrm');
      bool isIfrmDistrict(CalendarDistrict d) =>
          d.districtNumber.trim().toLowerCase().contains('ifrm');
      final cogDistrictId = context.read<AuthProvider>().cogDistrictId;

      _CalendarChoice clubChoice(CalendarClub c, IconData icon) =>
          _CalendarChoice(
            label: c.clubName,
            icon: icon,
            open: () => ClubCalendarScreen(
                onlyClubId: c.clubId, titleOverride: c.clubName),
          );
      _CalendarChoice districtChoice(CalendarDistrict d) => _CalendarChoice(
            label: d.districtNumber,
            icon: Icons.date_range_rounded,
            open: () => DistrictCalendarScreen(
                onlyDistrictId: d.districtId, titleOverride: d.districtNumber),
          );

      final visDistricts =
          districts.where((d) => d.districtId != cogDistrictId).toList();

      final ordered = <_CalendarChoice>[
        // 1) COG first
        for (final c in clubs.where(isCog))
          clubChoice(c, Icons.event_available_rounded),
        // 2) regular clubs (not COG, not IFRM) — e.g. Thane Hills
        for (final c in clubs.where((c) => !isCog(c) && !isIfrmClub(c)))
          clubChoice(c, Icons.calendar_month_rounded),
        // 3) regular districts (not IFRM) — e.g. 3142
        for (final d in visDistricts.where((d) => !isIfrmDistrict(d)))
          districtChoice(d),
        // 4) IFRM club last (e.g. IFRM 3142 Main)
        for (final c in clubs.where((c) => !isCog(c) && isIfrmClub(c)))
          clubChoice(c, Icons.calendar_month_rounded),
        // 5) IFRM district very last (e.g. IFRM India)
        for (final d in visDistricts.where(isIfrmDistrict)) districtChoice(d),
      ];

      setState(() {
        _choices = ordered;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Calendar'),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null && _choices.isEmpty) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    if (_choices.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.calendar_today_rounded,
        title: 'No Calendars',
        subtitle: "You don't have any club or district calendars yet.",
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      itemCount: _choices.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final c = _choices[i];
        return CalendarChoiceTile(
          label: c.label,
          icon: c.icon,
          index: i,
          onTap: () => Navigator.of(context)
              .push(MaterialPageRoute(builder: (_) => c.open())),
        );
      },
    );
  }
}
