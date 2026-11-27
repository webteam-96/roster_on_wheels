import 'package:rotary_flutter_app/presentation/widgets/row/handshake_logo.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/app_constants.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../core/utils/validators.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../security/account_security_screens.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/i18n/live_translator.dart'
    show TranslationScope;
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';

/// Email + password sign-in for every member (ROW, 2026-10-19; replaces the
/// earlier mobile-number OTP flow). A member without a password sets one via "Forgot password?".
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  int _failures = 0; // each one shakes the form
  // Terms are accepted here, under the Sign In button (no separate Terms screen since 2026-11-27).
  bool _agreed = false;
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: false),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  @override
  void initState() {
    super.initState();
    _loadAgreed();
  }

  Future<void> _loadAgreed() async {
    String? v;
    try {
      v = await _storage
          .read(key: AppConstants.termsAcceptedKey)
          .timeout(const Duration(seconds: 5), onTimeout: () => null);
    } on Exception {
      v = null;
    }
    if (mounted && v == 'true') setState(() => _agreed = true);
  }

  Future<void> _setAgreed(bool value) async {
    setState(() => _agreed = value);
    try {
      if (value) {
        await _storage.write(key: AppConstants.termsAcceptedKey, value: 'true');
      } else {
        await _storage.delete(key: AppConstants.termsAcceptedKey);
      }
    } on Exception {
      // the tick still counts for this session
    }
  }

  bool _requireAgreed() {
    if (_agreed) return true;
    SnackbarUtils.showError(
        context, 'Please accept the Terms and Conditions to sign in.');
    return false;
  }

  Future<void> _openTerms() async {
    final url = Brand.current.webUrl(Brand.current.termsUrl);
    var ok = false;
    try {
      ok = url.isNotEmpty &&
          await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } on PlatformException {
      // no app can open it: the message below
    }
    if (!ok && mounted)
      SnackbarUtils.showError(context, 'Could not open Terms and Conditions.');
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_requireAgreed()) return;
    final auth = context.read<AuthProvider>();
    var success = await auth.login(
        email: _emailCtrl.text.trim(), password: _passwordCtrl.text);
    if (!mounted) return;
    // Account security: the password was right but the account needs its authenticator code next.
    if (success && auth.mfaChallenge != null) {
      success = await Navigator.push<bool>(context,
              MaterialPageRoute(builder: (_) => const MfaSignInScreen())) ??
          false;
      if (!mounted) return;
      if (!success) {
        auth.clearMfaChallenge();
        return;
      }
    }
    if (success && auth.mustChangePassword) {
      await _changeTemporaryPassword(auth);
    } else if (success) {
      context.go(RouteNames.welcome);
    } else {
      setState(() => _failures++);
      SnackbarUtils.showError(context, auth.error ?? 'Sign-in failed.');
    }
  }

  Future<void> _signInWithCode() async {
    if (!_requireAgreed()) return;
    final done = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
          builder: (_) => SignInCodeScreen(email: _emailCtrl.text.trim())),
    );
    if (done == true && mounted) context.go(RouteNames.welcome);
  }

  Future<void> _changeTemporaryPassword(AuthProvider auth) async {
    final newCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    final done = await showRowDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialog) => AlertDialog(
        title: const Text('Set a new password'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
                'You signed in with a temporary password. Use at least 8 characters with an uppercase letter, a lowercase letter, a digit and a special character.'),
            TextField(
                key: const Key('newPassword'),
                controller: newCtrl,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'New password')),
            TextField(
                key: const Key('confirmPassword'),
                controller: confirmCtrl,
                obscureText: true,
                decoration:
                    const InputDecoration(labelText: 'Confirm password')),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialog, false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () async {
              final ok = await auth.changeTemporaryPassword(
                  newPassword: newCtrl.text, confirmPassword: confirmCtrl.text);
              if (ok) {
                if (dialog.mounted) Navigator.pop(dialog, true);
              } else if (mounted) {
                SnackbarUtils.showError(
                    context, auth.error ?? 'Could not change the password.');
              }
            },
            child: const Text('Change password'),
          ),
        ],
      ),
    );
    newCtrl.dispose();
    confirmCtrl.dispose();
    if (done == true && mounted) context.go(RouteNames.welcome);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            children: [
              const SizedBox(height: 32),
              const RowLogo(width: 220),
              const SizedBox(height: 24),
              RowReveal(child: Text('Sign In', style: AppTextStyles.h1)),
              const SizedBox(height: 8),
              RowReveal(
                  index: 1,
                  child: Text(
                    // Template with {app} so the sentence is translated whole (word order differs by language).
                    TranslationScope.of(context, 'Sign in to {app}')
                        .replaceAll('{app}', Brand.current.productName),
                    style: AppTextStyles.body
                        .copyWith(color: AppColors.textSecondary),
                  )),
              const SizedBox(height: 32),
              RowReveal(
                  index: 2,
                  child: RowShake(
                      trigger: _failures,
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: AppColors.line),
                        ),
                        child: Form(
                          key: _formKey,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CustomTextField(
                                label: 'Email',
                                hint: 'Enter your email',
                                controller: _emailCtrl,
                                keyboardType: TextInputType.emailAddress,
                                validator: Validators.email,
                                prefixIcon: Icons.email_outlined,
                              ),
                              const SizedBox(height: 16),
                              CustomTextField(
                                label: 'Password',
                                hint: 'Enter your password',
                                controller: _passwordCtrl,
                                obscureText: true,
                                textInputAction: TextInputAction.done,
                                validator: (v) =>
                                    Validators.required(v, 'Password'),
                                prefixIcon: Icons.lock_outline,
                              ),
                              const SizedBox(height: 8),
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                  onPressed: () =>
                                      context.push(RouteNames.forgotPassword),
                                  child: Text('Forgot password?',
                                      style: AppTextStyles.link),
                                ),
                              ),
                              const SizedBox(height: 8),
                              CustomButton(
                                label: 'Sign In',
                                onPressed: _submit,
                                fullWidth: true,
                                isLoading: auth.isLoading,
                                icon: Icons.login,
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Checkbox(
                                    key: const Key('terms_checkbox'),
                                    value: _agreed,
                                    activeColor: AppColors.primaryPrime,
                                    onChanged: (v) => _setAgreed(v ?? false),
                                  ),
                                  Expanded(
                                    child: Wrap(
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        GestureDetector(
                                          onTap: () => _setAgreed(!_agreed),
                                          child: Text('I agree to the ',
                                              style: AppTextStyles.caption),
                                        ),
                                        GestureDetector(
                                          key: const Key('terms_view_link'),
                                          onTap: _openTerms,
                                          child: Text('Terms and Conditions',
                                              style: AppTextStyles.link),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  const Expanded(
                                      child: Divider(color: AppColors.line)),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 12),
                                    child: Text('or',
                                        style: AppTextStyles.caption),
                                  ),
                                  const Expanded(
                                      child: Divider(color: AppColors.line)),
                                ],
                              ),
                              const SizedBox(height: 16),
                              // A full-width button, not a text link: the link wrapped to two ragged lines on 360 dp phones.
                              CustomButton(
                                label: 'Email me a code',
                                onPressed: _signInWithCode,
                                variant: ButtonVariant.outline,
                                fullWidth: true,
                                icon: Icons.mail_outline,
                              ),
                            ],
                          ),
                        ),
                      ))),
              const SizedBox(height: 20),
              RowReveal(
                  index: 4,
                  child: Text(
                    'New here? Tap "Forgot password?" to set one.',
                    textAlign: TextAlign.center,
                    style: AppTextStyles.caption,
                  )),
              const SizedBox(height: 24),
              Text('${Brand.current.productName} © ${DateTime.now().year}',
                  style: AppTextStyles.caption),
            ],
          ),
        ),
      ),
    );
  }
}
