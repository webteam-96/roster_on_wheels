import 'package:flutter/material.dart' hide Text;
import 'package:geolocator/geolocator.dart';
import '../../../core/constants/feature_flags.dart';
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/coming_soon_card.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import 'club_finder_results_screen.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ClubFinderSearchScreen extends StatefulWidget {
  const ClubFinderSearchScreen({super.key});

  @override
  State<ClubFinderSearchScreen> createState() => _ClubFinderSearchScreenState();
}

class _ClubFinderSearchScreenState extends State<ClubFinderSearchScreen>
    with SingleTickerProviderStateMixin {
  static const _meetingDays = [
    '', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
  ];
  static const _rangeValues = [5, 10, 25, 50, 100, 200];

  late final TabController _tabCtrl;

  // Any Club tab — a single keyword that the backend matches against club name,
  // Rotary ID, city, state, country, meeting address/day, district number and
  // zone name (see ClubFinderController.Search).
  final _keywordCtrl = TextEditingController();

  // Near Me tab
  int _rangeValue = 10;
  String _nearMeetingDay = '';

  bool _searching = false;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
    _tabCtrl.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    _keywordCtrl.dispose();
    super.dispose();
  }

  Future<void> _runSearch() async {
    FocusScope.of(context).unfocus();
    if (_tabCtrl.index == 0) {
      _runAnyClubSearch();
    } else {
      await _runNearMeSearch();
    }
  }

  void _runAnyClubSearch() {
    final kw = _keywordCtrl.text.trim();
    // Backend requires a keyword of at least 2 characters.
    if (kw.length < 2) {
      _snack('Enter at least 2 characters to search.');
      return;
    }

    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ClubFinderResultsScreen(
        mode: ClubFinderMode.anyClub,
        queryParams: {'keyword': kw},
      ),
    ));
  }

  Future<void> _runNearMeSearch() async {
    setState(() => _searching = true);
    try {
      // 1) Location services (the OS GPS toggle) must be ON. This is DISTINCT
      //    from app permission — on Android the toggle is often off by default,
      //    and the old code bailed here with a misleading "permission" message
      //    BEFORE ever prompting (why iOS prompted but Android just errored).
      if (!await Geolocator.isLocationServiceEnabled()) {
        if (!mounted) return;
        setState(() => _searching = false);
        _locationSnack(
          'Turn on location services to use Near Me.',
          onSettings: Geolocator.openLocationSettings,
        );
        return;
      }

      // 2) App permission. First tap on Android is `denied` (re-promptable) —
      //    request it. `deniedForever` (user tapped Deny twice / "Don't ask
      //    again") can ONLY be undone from app settings, so we must NOT silently
      //    fail there; send the user to settings instead.
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.deniedForever) {
        if (!mounted) return;
        setState(() => _searching = false);
        _locationSnack(
          'Location permission is blocked. Enable it in app settings.',
          onSettings: Geolocator.openAppSettings,
        );
        return;
      }
      if (perm != LocationPermission.whileInUse &&
          perm != LocationPermission.always) {
        if (!mounted) return;
        setState(() => _searching = false);
        _snack('Location permission is required for Near Me.');
        return;
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      if (!mounted) return;
      final rangeKm = _rangeValue.toDouble();

      final qp = <String, dynamic>{
        'userLatitude': pos.latitude,
        'userLongitude': pos.longitude,
        'range': rangeKm,
      };
      if (_nearMeetingDay.isNotEmpty) qp['meetingDay'] = _nearMeetingDay;

      setState(() => _searching = false);
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ClubFinderResultsScreen(
          mode: ClubFinderMode.nearMe,
          queryParams: qp,
        ),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _searching = false);
      _snack('Could not get location: $e');
    }
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  /// Snack with a "Settings" action — used when location is unavailable for a
  /// reason the user can only fix in system/app settings (services off, or
  /// permission permanently denied).
  void _locationSnack(String msg, {required Future<bool> Function() onSettings}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      duration: const Duration(seconds: 6),
      action: SnackBarAction(label: 'Settings', onPressed: () => onSettings()),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Find a Club'),
      body: SafeArea(
        child: Column(
          children: [
            _tabSelector(),
            Expanded(
              child: TabBarView(
                controller: _tabCtrl,
                physics: const NeverScrollableScrollPhysics(),
                children: [_buildAnyClubForm(), _buildNearMeForm()],
              ),
            ),
            if (kNearMeEnabled || _tabCtrl.index == 0) _buildSearchBar(),
          ],
        ),
      ),
    );
  }

  Widget _tabSelector() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 6),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(child: _pill('Any Club', 0)),
          Expanded(child: _pill('Near Me', 1)),
        ],
      ),
    );
  }

  Widget _pill(String label, int index) {
    final selected = _tabCtrl.index == index;
    return GestureDetector(
      onTap: () => _tabCtrl.animateTo(index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(10),

        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: AppFonts.body(
            color: selected ? AppColors.primaryPrime : AppColors.textSecondary,
            fontSize: 14,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
          ),
        ),
      ),
    );
  }

  Widget _buildAnyClubForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: _sectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CustomTextField(
              label: 'Keyword',
              hint: 'Search clubs…',
              controller: _keywordCtrl,
              prefixIcon: Icons.search_rounded,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _runSearch(),
            ),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline_rounded,
                    size: 15, color: AppColors.textMuted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Searches club name, Rotary ID, city, state, country, '
                    'district number, zone and meeting day.',
                    style: AppFonts.body(
                      fontSize: 13,
                      height: 1.4,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNearMeForm() {
    if (!kNearMeEnabled) {
      return const SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: ComingSoonCard(
          title: 'Near Me',
          description:
              'Finding clubs near your location is coming soon. For now, use '
              '"Any Club" to search by name, city, district and more.',
        ),
      );
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: _sectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.near_me_rounded, size: 18, color: AppColors.primaryPrime),
                const SizedBox(width: 8),
                Text(
                  'Search by distance',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryPrime,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'We\'ll use your current location to find clubs within the selected range.',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 18),
            _dropdownLabel('Range'),
            Row(
              children: [
                SizedBox(
                  width: 110,
                  child: _styledDropdown<int>(
                    value: _rangeValue,
                    items: _rangeValues
                        .map((v) => DropdownMenuItem(value: v, child: Text('$v')))
                        .toList(),
                    onChanged: (v) => setState(() => _rangeValue = v ?? 10),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'Kilometers',
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _dropdownLabel('Meeting Day'),
            _styledDropdown<String>(
              value: _nearMeetingDay,
              items: _meetingDays
                  .map((d) => DropdownMenuItem(
                        value: d,
                        child: Text(d.isEmpty ? 'Any' : d),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => _nearMeetingDay = v ?? ''),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionCard({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),

      ),
      child: child,
    );
  }

  Widget _buildSearchBar() {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.white,
        border: const Border(top: const BorderSide(color: AppColors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
      child: CustomButton(
        label: 'Search',
        icon: Icons.search_rounded,
        onPressed: _searching ? null : _runSearch,
        isLoading: _searching,
        fullWidth: true,
        height: 52,
      ),
    );
  }

  Widget _dropdownLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 8),
      child: Text(
        text,
        style: AppFonts.body(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w600,
          fontSize: 13,
        ),
      ),
    );
  }

  Widget _styledDropdown<T>({
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?>? onChanged,
    String? hint,
  }) {
    return DropdownButtonFormField<T>(
      value: value,
      isExpanded: true,
      isDense: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded),
      style: AppFonts.body(
        fontSize: 14,
        color: AppColors.textPrimary,
        fontWeight: FontWeight.w500,
      ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: AppFonts.body(
          color: AppColors.textMuted,
          fontSize: 14,
        ),
        filled: true,
        fillColor: AppColors.primaryPrime.withValues(alpha: 0.04),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.primaryPrime, width: 1.3),
        ),
      ),
      items: items,
      onChanged: onChanged,
    );
  }

}
