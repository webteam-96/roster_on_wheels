import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/services/privacy_api.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "My data": download everything held about the member, or withdraw consent
/// (which signs them out, as declining the consent dialog does). WS7 / GDPR set.
class MyDataScreen extends StatefulWidget {
  const MyDataScreen({super.key, this.api});
  final PrivacyApi? api;

  @override
  State<MyDataScreen> createState() => _MyDataScreenState();
}

class _MyDataScreenState extends State<MyDataScreen> {
  late final PrivacyApi _api = widget.api ?? PrivacyApi();
  bool _busy = false;

  Future<void> _export() async {
    final memberId = context.read<AuthProvider>().memberId;
    setState(() => _busy = true);
    final url = await _api.exportMyData(memberId).catchError((_) => null);
    if (!mounted) return;
    setState(() => _busy = false);
    if (url == null) {
      SnackbarUtils.showError(context, 'Could not prepare your data. Please try again.');
      return;
    }
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  Future<void> _withdraw() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Withdraw consent?'),
        content: const Text('You will be signed out and asked to accept the privacy policy again next time.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Withdraw')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final auth = context.read<AuthProvider>();
    final router = GoRouter.of(context);
    setState(() => _busy = true);
    final done = await _api.withdrawConsent().catchError((_) => false);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!done) {
      SnackbarUtils.showError(context, 'Could not withdraw consent. Please try again.');
      return;
    }
    await auth.logout();
    router.go(RouteNames.login);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My data')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.download_outlined),
            title: const Text('Download my data'),
            subtitle: const Text('A ZIP of everything held about you; the link works for 7 days.'),
            enabled: !_busy,
            onTap: _export,
          ),
          ListTile(
            leading: const Icon(Icons.policy_outlined),
            title: const Text('Withdraw consent'),
            subtitle: const Text('Signs you out until you accept the privacy policy again.'),
            enabled: !_busy,
            onTap: _withdraw,
          ),
          if (_busy) const Padding(padding: EdgeInsets.all(16), child: LinearProgressIndicator()),
        ],
      ),
    );
  }
}
