import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/brand/brand.dart';
import '../../core/routing/route_names.dart';
import '../../core/services/privacy_api.dart';
import '../providers/auth_provider.dart';

/// Consent at first sign-in after the policy version changes (WS7-05), as the web
/// ConsentGate: a blocking dialog; declining signs the member out. Never locks a
/// member out when the endpoint fails.
Future<void> checkAndShowConsent(BuildContext context, {PrivacyApi? api}) async {
  if (!Brand.current.feature('privacy.enabled')) return;
  final privacy = api ?? PrivacyApi();
  String? version;
  try {
    version = await privacy.requiredPolicyVersion();
  } catch (_) {
    return;
  }
  if (version == null || !context.mounted) return;
  final policyVersion = version;
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => PopScope(
      canPop: false,
      child: _ConsentDialog(policyVersion: policyVersion, api: privacy),
    ),
  );
}

class _ConsentDialog extends StatefulWidget {
  const _ConsentDialog({required this.policyVersion, required this.api});
  final String policyVersion;
  final PrivacyApi api;

  @override
  State<_ConsentDialog> createState() => _ConsentDialogState();
}

class _ConsentDialogState extends State<_ConsentDialog> {
  bool _saving = false;
  String? _error;

  Future<void> _accept() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final lang = Localizations.localeOf(context).languageCode;
    final ok = await widget.api.acceptConsent(widget.policyVersion, lang).catchError((_) => false);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      setState(() {
        _saving = false;
        _error = 'Could not save your answer. Please try again.';
      });
    }
  }

  Future<void> _decline() async {
    final auth = context.read<AuthProvider>();
    final router = GoRouter.of(context);
    Navigator.of(context).pop();
    await auth.logout();
    router.go(RouteNames.login);
  }

  @override
  Widget build(BuildContext context) {
    final brand = Brand.current;
    final privacyUrl = brand.webUrl(brand.privacyUrl);
    return AlertDialog(
      title: const Text('Your privacy'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${brand.productName} keeps your member record to run your club and district. '
              'Please read the privacy policy and accept it to continue.'),
          if (privacyUrl.isNotEmpty)
            TextButton(
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              onPressed: () => launchUrl(Uri.parse(privacyUrl), mode: LaunchMode.externalApplication),
              child: const Text('Read the privacy policy'),
            ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
      ),
      actions: [
        TextButton(onPressed: _saving ? null : _decline, child: const Text('Decline and sign out')),
        FilledButton(onPressed: _saving ? null : _accept, child: Text(_saving ? 'Saving…' : 'Accept')),
      ],
    );
  }
}
