import 'dart:convert';

import 'package:flutter/material.dart' hide Text;
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Member map (`api/member-map/me`, `api/clubs|districts/{id}/member-map`): the member chooses whether to show their
/// area (the server keeps the point rounded to about 1 km, never an address), then sees the club or district map with
/// the clubs' meeting places. The map is Leaflet + OpenStreetMap in a web view (no extra Flutter package).
class MemberMapScreen extends StatefulWidget {
  const MemberMapScreen({super.key});

  @override
  State<MemberMapScreen> createState() => _MemberMapScreenState();
}

class _MemberMapScreenState extends State<MemberMapScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _me;
  Map<String, dynamic>? _map;
  String? _error;
  bool _district = false;

  List<Map<String, dynamic>> get _clubs => ((_me?['clubs'] as List?) ?? const []).cast<Map<String, dynamic>>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final me = await _api.get<Map<String, dynamic>>('/api/member-map/me', fromJson: (j) => j as Map<String, dynamic>);
      if (!mounted) return;
      setState(() => _me = me.data);
      await _loadMap();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _loadMap() async {
    if (_clubs.isEmpty) return;
    final club = _clubs.first;
    final path = _district
        ? '/api/districts/${club['districtId']}/member-map'
        : '/api/clubs/${club['clubId']}/member-map';
    setState(() => _map = null);
    try {
      final res = await _api.get<Map<String, dynamic>>(path, fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _map = res.data);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _editPin() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PinForm(api: _api, me: _me ?? const {}),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Member map'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.error_outline, title: 'Could not load the map', subtitle: _error!)
          : me == null
              ? const LoadingWidget()
              : _clubs.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.map_outlined, title: 'No club yet', subtitle: 'The map shows the members of your club.')
                  : RowRefresh(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Card(
                            child: ListTile(
                              leading: Icon(me['showOnMap'] == true ? Icons.location_on : Icons.location_off_outlined),
                              title: Text(me['showOnMap'] == true ? 'You are on the map' : 'You are not on the map'),
                              subtitle: Text(me['showOnMap'] == true
                                  ? [me['area'], me['city']].whereType<String>().where((s) => s.isNotEmpty).join(', ')
                                  : 'Choose to show your approximate area to members of your club and district.'),
                              trailing: const Icon(Icons.edit_outlined),
                              onTap: _editPin,
                            ),
                          ),
                          const SizedBox(height: 12),
                          SegmentedButton<bool>(
                            segments: const [
                              ButtonSegment(value: false, label: Text('My club')),
                              ButtonSegment(value: true, label: Text('My district')),
                            ],
                            selected: {_district},
                            onSelectionChanged: (s) {
                              setState(() => _district = s.first);
                              _loadMap();
                            },
                          ),
                          const SizedBox(height: 12),
                          if (_map == null) const SizedBox(height: 300, child: LoadingWidget()) else ..._mapParts(_map!),
                        ],
                      ),
                    ),
    );
  }

  List<Widget> _mapParts(Map<String, dynamic> map) {
    final members = ((map['members'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final places = ((map['meetingPlaces'] as List?) ?? const []).cast<Map<String, dynamic>>();
    if (members.isEmpty && places.isEmpty) {
      return const [
        EmptyStateWidget(
            icon: Icons.map_outlined,
            title: 'Nothing on the map yet',
            subtitle: 'Members appear once they choose to show their area.'),
      ];
    }
    return [
      SizedBox(
        height: 320,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: InAppWebView(
            key: ValueKey(_district),
            initialData: InAppWebViewInitialData(data: _leafletHtml(members, places), baseUrl: WebUri('https://unpkg.com/')),
          ),
        ),
      ),
      const SizedBox(height: 8),
      Text('${members.length} members on the map. Each circle is about 1 km wide.',
          style: Theme.of(context).textTheme.bodySmall),
      const SizedBox(height: 16),
      if (places.isNotEmpty) Text('Meeting places', style: Theme.of(context).textTheme.titleMedium),
      for (final p in places)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.place_outlined),
          title: Text(p['clubName'] as String? ?? ''),
          subtitle: Text([p['meetingAddress'], p['meetingDay'], p['meetingFromTime']]
              .whereType<String>()
              .where((s) => s.isNotEmpty)
              .join('  ·  ')),
          trailing: IconButton(
            tooltip: 'Open in maps',
            icon: const Icon(Icons.open_in_new),
            onPressed: () => launchUrl(
                Uri.parse('https://www.openstreetmap.org/?mlat=${p['latitude']}&mlon=${p['longitude']}#map=16/'
                    '${p['latitude']}/${p['longitude']}'),
                mode: LaunchMode.externalApplication),
          ),
        ),
      if (members.isNotEmpty) Text('Members', style: Theme.of(context).textTheme.titleMedium),
      for (final m in members)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.person_pin_circle_outlined),
          title: Text(m['name'] as String? ?? ''),
          subtitle: Text([m['area'], m['city'], if (_district) m['clubName']]
              .whereType<String>()
              .where((s) => s.isNotEmpty)
              .join(', ')),
        ),
    ];
  }

  /// The data goes in as JSON and names are set as text, so nothing a member typed can run as script.
  static String _leafletHtml(List<Map<String, dynamic>> members, List<Map<String, dynamic>> places) {
    final data = jsonEncode({'members': members, 'places': places}).replaceAll('</', r'<\/');
    return '''<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{height:100%;margin:0}</style></head><body><div id="m"></div><script>
var d = $data, map = L.map('m'), b = [];
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 16, attribution: '&copy; OpenStreetMap contributors'}).addTo(map);
function pop(lines) { var e = document.createElement('div'); lines.filter(Boolean).forEach(function (t) { var p = document.createElement('div'); p.textContent = t; e.appendChild(p); }); return e; }
d.members.forEach(function (x) { L.circle([x.latitude, x.longitude], {radius: 1000, weight: 1}).bindPopup(pop([x.name, x.clubName, x.area, x.city])).addTo(map); b.push([x.latitude, x.longitude]); });
d.places.forEach(function (x) { L.marker([x.latitude, x.longitude]).bindPopup(pop([x.clubName, x.meetingAddress, x.meetingDay])).addTo(map); b.push([x.latitude, x.longitude]); });
map.fitBounds(b, {padding: [20, 20], maxZoom: 13});
</script></body></html>''';
  }
}

class _PinForm extends StatefulWidget {
  const _PinForm({required this.api, required this.me});
  final ApiClient api;
  final Map<String, dynamic> me;

  @override
  State<_PinForm> createState() => _PinFormState();
}

class _PinFormState extends State<_PinForm> {
  late bool _show = widget.me['showOnMap'] == true;
  late final _city = TextEditingController(text: widget.me['city'] as String?);
  late final _area = TextEditingController(text: widget.me['area'] as String?);
  late double? _lat = (widget.me['latitude'] as num?)?.toDouble();
  late double? _lng = (widget.me['longitude'] as num?)?.toDouble();
  bool _busy = false;

  @override
  void dispose() {
    _city.dispose();
    _area.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    setState(() => _busy = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        if (mounted) SnackbarUtils.showError(context, 'Turn on location services first.');
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm != LocationPermission.whileInUse && perm != LocationPermission.always) {
        if (mounted) SnackbarUtils.showError(context, 'Allow location access to place yourself on the map.');
        return;
      }
      // Low accuracy is enough: the server rounds the point to about 1 km anyway.
      final pos = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.low);
      if (mounted) {
        setState(() {
          _lat = pos.latitude;
          _lng = pos.longitude;
        });
      }
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Could not find your location.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    if (_show && (_lat == null || _lng == null)) {
      SnackbarUtils.showError(context, 'Use your location first, so we know your area.');
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.api.put<dynamic>('/api/member-map/me', body: {
        'showOnMap': _show,
        'city': _city.text.trim(),
        'area': _area.text.trim(),
        'latitude': _lat,
        'longitude': _lng,
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration d(String label) => InputDecoration(labelText: label, border: const OutlineInputBorder());
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('My place on the map', style: Theme.of(context).textTheme.titleLarge),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show my area on the member map'),
              subtitle: const Text('Members of your club and district see your name and area, never your address. '
                  'Turning this off removes your place.'),
              value: _show,
              onChanged: (v) => setState(() => _show = v),
            ),
            if (_show) ...[
              OutlinedButton.icon(
                icon: const Icon(Icons.my_location),
                label: Text(_lat == null ? 'Use my location' : 'Location set, use it again'),
                onPressed: _busy ? null : _locate,
              ),
              const SizedBox(height: 12),
              TextField(controller: _city, decoration: d('City'), maxLength: 100),
              TextField(controller: _area, decoration: d('Area or neighbourhood'), maxLength: 100),
            ],
            const SizedBox(height: 8),
            FilledButton(onPressed: _busy ? null : _save, child: const Text('Save')),
          ],
        ),
      ),
    );
  }
}
