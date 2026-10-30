import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/features/feature_controller.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Email and push consent (feature `communication`, `api/mobile/comms/preferences`) and the member's personal
/// calendar feed (feature `meetings`, `api/mobile/calendar-feed`). Each part shows only while its switch is on.
class CommsPreferencesScreen extends StatefulWidget {
  const CommsPreferencesScreen({super.key});

  @override
  State<CommsPreferencesScreen> createState() => _CommsPreferencesScreenState();
}

class _CommsPreferencesScreenState extends State<CommsPreferencesScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _prefs;
  String? _feedUrl;
  bool _feedOn = false; // meetings switch on: the section shows even before the member has a link
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final features = context.read<FeatureController>();
    try {
      if (features.isOn('communication')) {
        _prefs = (await _api.get<Map<String, dynamic>>('/api/mobile/comms/preferences',
                fromJson: (j) => j as Map<String, dynamic>))
            .data;
      }
      if (features.isOn('meetings')) {
        _feedOn = true;
        _feedUrl = (await _api.get<Map<String, dynamic>>('/api/mobile/calendar-feed',
                fromJson: (j) => j as Map<String, dynamic>))
            .data?['url'] as String?;
      }
    } catch (_) {
      // the sections without data stay hidden
    }
    if (mounted) setState(() => _loading = false);
  }

  bool _consented(String channel) =>
      ((_prefs?['consents'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .firstWhere((c) => c['channel'] == channel, orElse: () => const {'consented': true})['consented'] !=
      false;

  Future<void> _setConsent(String channel, bool on) async {
    setState(() => _busy = true);
    try {
      _prefs = (await _api.put<Map<String, dynamic>>('/api/mobile/comms/preferences',
              body: {channel: on}, fromJson: (j) => j as Map<String, dynamic>))
          .data;
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _resetFeed() async {
    setState(() => _busy = true);
    try {
      _feedUrl = (await _api.post<Map<String, dynamic>>('/api/mobile/calendar-feed',
              fromJson: (j) => j as Map<String, dynamic>))
          .data?['url'] as String?;
      if (mounted) SnackbarUtils.showSuccess(context, 'Your calendar link is ready.');
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final prefs = _prefs;
    final feed = _feedUrl;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Communication'),
      body: _loading
          ? const LoadingWidget()
          : ListView(
              children: [
                if (prefs != null) ...[
                  const ListTile(title: Text('Messages from your club and district')),
                  SwitchListTile(
                    title: const Text('Email'),
                    subtitle: const Text('Newsletters, announcements and mass emails'),
                    value: _consented('email'),
                    onChanged: _busy ? null : (v) => _setConsent('email', v),
                  ),
                  SwitchListTile(
                    title: const Text('Push notifications'),
                    value: _consented('push'),
                    onChanged: _busy ? null : (v) => _setConsent('push', v),
                  ),
                  ListTile(
                    title: const Text('Email language'),
                    subtitle: Text((prefs['effectiveLanguage'] as String?)?.toUpperCase() ?? ''),
                  ),
                  const Divider(),
                ],
                if (_feedOn) ...[
                  const ListTile(
                    title: Text('Calendar feed'),
                    subtitle: Text("Add your clubs' meetings and events to your phone's calendar app. "
                        'Anyone with the link can see them, so keep it private.'),
                  ),
                  if (feed == null)
                    ListTile(
                      leading: const Icon(Icons.add_link_outlined),
                      title: const Text('Create my calendar link'),
                      enabled: !_busy,
                      onTap: _resetFeed,
                    ),
                  if (feed != null) ...[
                    ListTile(
                      leading: const Icon(Icons.copy_outlined),
                      title: const Text('Copy link'),
                      onTap: () async {
                        await Clipboard.setData(ClipboardData(text: feed));
                        if (context.mounted) SnackbarUtils.showSuccess(context, 'Link copied');
                      },
                    ),
                    ListTile(
                      leading: const Icon(Icons.ios_share_outlined),
                      title: const Text('Open in calendar app'),
                      onTap: () => Share.share(feed),
                    ),
                    ListTile(
                      leading: const Icon(Icons.refresh_outlined),
                      title: const Text('Make a new link'),
                      subtitle: const Text('The old link stops working.'),
                      enabled: !_busy,
                      onTap: _resetFeed,
                    ),
                  ],
                ],
                if (prefs == null && !_feedOn)
                  const ListTile(
                    leading: Icon(Icons.info_outline),
                    title: Text('No communication settings yet'),
                    subtitle: Text('Settings appear here once your club turns on emails or a calendar feed.'),
                  ),
              ],
            ),
    );
  }
}
