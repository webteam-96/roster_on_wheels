import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../core/utils/validators.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';

class ResetPasswordScreen extends StatefulWidget {
  final String? token;
  const ResetPasswordScreen({super.key, this.token});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _newPassCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();

  @override
  void dispose() {
    _newPassCtrl.dispose();
    _confirmPassCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (widget.token == null) {
      SnackbarUtils.showError(context, 'Invalid reset token.');
      return;
    }
    final auth = context.read<AuthProvider>();
    final success = await auth.resetPassword(
      token: widget.token!,
      newPassword: _newPassCtrl.text,
      confirmPassword: _confirmPassCtrl.text,
    );
    if (!mounted) return;
    if (success) {
      SnackbarUtils.showSuccess(context, 'Password reset successfully.');
      context.go(RouteNames.login);
    } else {
      SnackbarUtils.showError(context, auth.error ?? 'Failed to reset password.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      appBar: const CustomAppBar(title: 'Reset Password'),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Enter your new password below.', style: AppTextStyles.body.copyWith(color: AppColors.textSecondary)),
              const SizedBox(height: 24),
              CustomTextField(
                label: 'New Password',
                controller: _newPassCtrl,
                obscureText: true,
                validator: Validators.password,
                prefixIcon: Icons.lock_outline,
              ),
              const SizedBox(height: 16),
              CustomTextField(
                label: 'Confirm New Password',
                controller: _confirmPassCtrl,
                obscureText: true,
                textInputAction: TextInputAction.done,
                validator: (v) => Validators.confirmPassword(v, _newPassCtrl.text),
                prefixIcon: Icons.lock_outline,
              ),
              const SizedBox(height: 24),
              CustomButton(
                label: 'Reset Password',
                onPressed: _submit,
                fullWidth: true,
                isLoading: auth.isLoading,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
