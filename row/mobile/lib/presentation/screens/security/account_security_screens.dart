import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/row/skeleton_list.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// Account security (gap agent 2026-11-19): authenticator-app second step at sign-in, emailed one-time sign-in
// codes, and turning multi-factor sign-in on or off. Server: AccountSecurityController.

const _mfaSetupPath = '/api/mobile/auth/mfa/setup';
const _mfaVerifyPath = '/api/mobile/auth/mfa/verify';
const _codeRequestPath = '/api/mobile/auth/magic-link';
const _codeConsumePath = '/api/mobile/auth/magic-link/consume';
const _mfaPath = '/api/account-security/mfa';

Map<String, dynamic> _json(dynamic j) => j is Map<String, dynamic> ? j : <String, dynamic>{};

/// POST that returns (data, error) and never throws, so every screen shows the server's message.
Future<(Map<String, dynamic>?, String?)> _post(String path, Map<String, dynamic>? body, {bool auth = false}) async {
  try {
    final r = await ApiClient().post<Map<String, dynamic>>(path, body: body, fromJson: _json, requiresAuth: auth);
    if (r.isSuccess) return (r.data ?? <String, dynamic>{}, null);
    return (null, r.error ?? 'Something went wrong. Please try again.');
  } on ApiException catch (e) {
    return (null, e.message);
  }
}

class _CodeField extends StatelessWidget {
  const _CodeField({required this.controller, required this.label});
  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) => TextField(
        key: const Key('mfaCode'),
        controller: controller,
        autofillHints: const [AutofillHints.oneTimeCode],
        textInputAction: TextInputAction.done,
        decoration: InputDecoration(labelText: label, hintText: '123456', border: const OutlineInputBorder()),
      );
}

class _SetupBlock extends StatelessWidget {
  const _SetupBlock({required this.secret, required this.uri});
  final String secret;
  final String uri;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Add ROW to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others). '
              'On this phone, tap the button. On another device, scan the code.'),
          const SizedBox(height: 12),
          Center(
            child: Container(
              color: AppColors.surface,
              padding: const EdgeInsets.all(8),
              child: QrImageView(data: uri, size: 180, semanticsLabel: 'QR code for your authenticator app'),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: () => launchUrl(Uri.parse(uri), mode: LaunchMode.externalApplication),
            child: const Text('Open in authenticator app'),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: SelectableText(secret, style: AppTextStyles.caption)),
            IconButton(
              tooltip: 'Copy key',
              icon: const Icon(Icons.copy_rounded, size: 18),
              onPressed: () => Clipboard.setData(ClipboardData(text: secret)),
            ),
          ]),
        ],
      );
}

class _RecoveryCodes extends StatelessWidget {
  const _RecoveryCodes({required this.codes});
  final List<String> codes;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Save these recovery codes now. They are shown only once, and each works once if you lose your phone.'),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.primaryLight.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.line),
            ),
            child: SelectableText(codes.join('\n'), style: const TextStyle(fontFamily: 'monospace', height: 1.5)),
          ),
          TextButton.icon(
            onPressed: () => Clipboard.setData(ClipboardData(text: codes.join('\n'))),
            icon: const Icon(Icons.copy_rounded, size: 18),
            label: const Text('Copy codes'),
          ),
        ],
      );
}

/// Second step of sign-in. Pops true once a session is saved (or a temporary-password session is waiting).
class MfaSignInScreen extends StatefulWidget {
  const MfaSignInScreen({super.key});

  @override
  State<MfaSignInScreen> createState() => _MfaSignInScreenState();
}

class _MfaSignInScreenState extends State<MfaSignInScreen> {
  final _code = TextEditingController();
  Map<String, dynamic>? _setup;
  String? _error;
  bool _busy = false;
  List<String>? _codes;

  @override
  void initState() {
    super.initState();
    final ch = context.read<AuthProvider>().mfaChallenge;
    if (ch != null && ch.setupRequired) _loadSetup(ch.token);
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _loadSetup(String token) async {
    final (data, err) = await _post(_mfaSetupPath, {'mfaToken': token});
    if (!mounted) return;
    setState(() {
      _setup = data;
      _error = err;
    });
  }

  Future<void> _verify() async {
    final auth = context.read<AuthProvider>();
    final ch = auth.mfaChallenge;
    if (ch == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final body = {'mfaToken': ch.token, 'code': _code.text.trim(), ...await auth.signInDeviceFields()};
    final (data, err) = await _post(_mfaVerifyPath, body);
    if (data != null) await auth.acceptSignInResponse(data, email: ch.email, password: ch.password);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
      _codes = data == null ? null : auth.lastRecoveryCodes;
    });
    if (data != null && (_codes == null || _codes!.isEmpty)) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final ch = context.watch<AuthProvider>().mfaChallenge;
    final setupRequired = ch?.setupRequired ?? false;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Verify it is you'),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (_codes != null && _codes!.isNotEmpty) ...[
            const Text('Multi-factor sign-in is on.'),
            const SizedBox(height: 12),
            _RecoveryCodes(codes: _codes!),
            const SizedBox(height: 16),
            CustomButton(label: 'Continue', fullWidth: true, onPressed: () => Navigator.pop(context, true)),
          ] else ...[
            if (setupRequired) ...[
              const Text('Your account needs multi-factor sign-in. Set it up now.'),
              const SizedBox(height: 12),
              if (_setup == null && _error == null) const SizedBox(height: 240, child: RowSkeletonList(rows: 3)),
              if (_setup != null) _SetupBlock(secret: '${_setup!['secret']}', uri: '${_setup!['otpAuthUri']}'),
            ] else
              const Text('Enter the 6-digit code from your authenticator app, or one of your recovery codes.'),
            const SizedBox(height: 16),
            _CodeField(controller: _code, label: 'Code'),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: AppTextStyles.caption.copyWith(color: AppColors.error)),
            ],
            const SizedBox(height: 16),
            CustomButton(
              label: 'Verify',
              fullWidth: true,
              isLoading: _busy,
              onPressed: setupRequired && _setup == null ? null : _verify,
            ),
          ],
        ],
      ),
    );
  }
}

/// Sign in with a one-time code emailed to the member (no password). Pops true once signed in.
class SignInCodeScreen extends StatefulWidget {
  const SignInCodeScreen({super.key, this.email = ''});
  final String email;

  @override
  State<SignInCodeScreen> createState() => _SignInCodeScreenState();
}

class _SignInCodeScreenState extends State<SignInCodeScreen> {
  late final _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  bool _sent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_email.text.contains('@')) {
      setState(() => _error = 'Enter your email.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final (data, err) = await _post(_codeRequestPath, {'email': _email.text.trim()});
    if (!mounted) return;
    setState(() {
      _busy = false;
      _sent = data != null;
      _error = err;
    });
  }

  Future<void> _signIn() async {
    final auth = context.read<AuthProvider>();
    setState(() {
      _busy = true;
      _error = null;
    });
    final email = _email.text.trim();
    final body = {'email': email, 'code': _code.text.trim(), ...await auth.signInDeviceFields()};
    final (data, err) = await _post(_codeConsumePath, body);
    if (data != null) await auth.acceptSignInResponse(data, email: email);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
    if (data == null) return;
    var done = true;
    if (auth.mfaChallenge != null) {
      done = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const MfaSignInScreen())) ?? false;
    }
    if (done && mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Email sign-in code'),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            _sent
                ? 'If the account exists, a sign-in code has been sent to the registered email. It works once and expires in 15 minutes.'
                : 'We will email you a code that signs you in once, without your password.',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _email,
            enabled: !_sent,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
          ),
          if (_sent) ...[
            const SizedBox(height: 12),
            _CodeField(controller: _code, label: 'Sign-in code'),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: AppTextStyles.caption.copyWith(color: AppColors.error)),
          ],
          const SizedBox(height: 16),
          CustomButton(label: _sent ? 'Sign In' : 'Send code', fullWidth: true, isLoading: _busy, onPressed: _sent ? _signIn : _send),
          if (_sent)
            TextButton(onPressed: _busy ? null : _send, child: const Text('Send a new code')),
        ],
      ),
    );
  }
}

/// Signed in: turn multi-factor sign-in on or off, and make new recovery codes.
class AccountSecurityScreen extends StatefulWidget {
  const AccountSecurityScreen({super.key});

  @override
  State<AccountSecurityScreen> createState() => _AccountSecurityScreenState();
}

class _AccountSecurityScreenState extends State<AccountSecurityScreen> {
  final _code = TextEditingController();
  Map<String, dynamic>? _status;
  String? _loadError;
  Map<String, dynamic>? _setup;
  String? _action; // 'disable' | 'regenerate'
  List<String>? _codes;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final r = await ApiClient().get<Map<String, dynamic>>(_mfaPath, fromJson: _json);
      if (!mounted) return;
      setState(() {
        _status = r.isSuccess ? r.data : null;
        _loadError = r.isSuccess ? null : (r.error ?? 'Could not load your sign-in settings.');
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    }
  }

  void _reset() {
    _setup = null;
    _action = null;
    _code.clear();
    _error = null;
  }

  Future<void> _turnOn() async {
    setState(() {
      _busy = true;
      _error = null;
      _codes = null;
    });
    final (data, err) = await _post('$_mfaPath/enrol', null, auth: true);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _setup = data;
      _error = err;
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final path = _setup != null ? '$_mfaPath/confirm' : (_action == 'disable' ? '$_mfaPath/disable' : '$_mfaPath/recovery-codes');
    final (data, err) = await _post(path, {'code': _code.text.trim()}, auth: true);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (data == null) {
        _error = err;
        return;
      }
      final list = data['recoveryCodes'];
      _codes = list is List ? list.map((c) => '$c').toList() : null;
      _reset();
    });
    if (data != null) _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    final enabled = s?['enabled'] == true;
    final required = s?['required'] == true;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Multi-factor sign-in'),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_codes != null && _codes!.isNotEmpty) ...[_RecoveryCodes(codes: _codes!), const SizedBox(height: 16)],
            if (_loadError != null) ...[
              Text(_loadError!, style: AppTextStyles.body.copyWith(color: AppColors.error)),
              TextButton(onPressed: _load, child: const Text('Try again')),
            ] else if (s == null)
              const SizedBox(height: 240, child: RowSkeletonList(rows: 3))
            else if (_setup != null) ...[
              _SetupBlock(secret: '${_setup!['secret']}', uri: '${_setup!['otpAuthUri']}'),
              const SizedBox(height: 16),
              _CodeField(controller: _code, label: 'Code from the app'),
              ..._errorAndButtons(),
            ] else ...[
              Text(enabled ? 'Multi-factor sign-in is on.' : 'Multi-factor sign-in is off.', style: AppTextStyles.h3),
              const SizedBox(height: 6),
              Text(enabled
                  ? 'Unused recovery codes: ${s['recoveryCodesLeft']}.'
                  : 'Turn it on so a stolen password alone cannot open your account.'),
              if (required) ...[
                const SizedBox(height: 6),
                const Text('Required for your account by your club or by ROW. It cannot be turned off.'),
              ],
              const SizedBox(height: 16),
              if (!enabled) CustomButton(label: 'Turn on', fullWidth: true, isLoading: _busy, onPressed: _turnOn),
              if (enabled && _action == null) ...[
                CustomButton(
                  label: 'New recovery codes',
                  variant: ButtonVariant.outline,
                  fullWidth: true,
                  onPressed: () => setState(() {
                    _codes = null;
                    _action = 'regenerate';
                  }),
                ),
                if (!required) ...[
                  const SizedBox(height: 8),
                  CustomButton(
                    label: 'Turn off',
                    variant: ButtonVariant.outline,
                    fullWidth: true,
                    onPressed: () => setState(() {
                      _codes = null;
                      _action = 'disable';
                    }),
                  ),
                ],
              ],
              if (_action != null) ...[
                _CodeField(controller: _code, label: 'Code from your app or a recovery code'),
                ..._errorAndButtons(),
              ],
              if (_error != null && _action == null) Text(_error!, style: AppTextStyles.caption.copyWith(color: AppColors.error)),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _errorAndButtons() => [
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: AppTextStyles.caption.copyWith(color: AppColors.error)),
        ],
        const SizedBox(height: 16),
        CustomButton(label: 'Confirm', fullWidth: true, isLoading: _busy, onPressed: _submit),
        TextButton(onPressed: _busy ? null : () => setState(_reset), child: const Text('Cancel')),
      ];
}
