import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/validators.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ClubContactFormInitial {
  final int id;
  final String email;
  final String phone;
  final bool isActive;
  const ClubContactFormInitial({
    required this.id,
    required this.email,
    required this.phone,
    required this.isActive,
  });
}

class ClubWebsiteContactFormScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final ClubContactFormInitial? initial;

  const ClubWebsiteContactFormScreen({
    super.key,
    required this.clubId,
    required this.yearId,
    this.initial,
  });

  @override
  State<ClubWebsiteContactFormScreen> createState() =>
      _ClubWebsiteContactFormScreenState();
}

class _ClubWebsiteContactFormScreenState
    extends State<ClubWebsiteContactFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();

  bool _isActive = true;
  bool _saving = false;

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _emailCtrl.text = init.email;
      _phoneCtrl.text = init.phone;
      _isActive = init.isActive;
    }
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = {
      'email': _emailCtrl.text.trim(),
      'phone': _phoneCtrl.text.trim(),
      'isActive': _isActive,
      if (!_isEdit) 'yearId': widget.yearId,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/website-data/contact_details/${widget.initial!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/website-data/contact_details',
          body: body,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      _showError('Save failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Contact Detail' : 'Add Contact Detail',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _saving ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: const StadiumBorder(),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.black54,
                      ),
                    )
                  : Text(
                      'Save',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            CustomTextField(
              label: 'Email',
              controller: _emailCtrl,
              hint: 'email@example.com',
              keyboardType: TextInputType.emailAddress,
              prefixIcon: Icons.mail_outline,
              validator: Validators.email,
            ),
            const SizedBox(height: 16),
            CustomTextField(
              label: 'Phone',
              controller: _phoneCtrl,
              hint: '10-digit mobile number',
              keyboardType: TextInputType.phone,
              prefixIcon: Icons.phone_outlined,
              validator: Validators.phone,
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(10),
                color: AppColors.surface,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Status', style: AppTextStyles.bodyMedium),
                        const SizedBox(height: 2),
                        Text(
                          _isActive ? 'Active' : 'Inactive',
                          style: AppTextStyles.caption.copyWith(
                            color: _isActive
                                ? AppColors.success
                                : AppColors.textMuted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Switch.adaptive(
                    value: _isActive,
                    activeThumbColor: AppColors.primary,
                    onChanged:
                        _saving ? null : (v) => setState(() => _isActive = v),
                  ),
                ],
              ),
            ),
          ],
          ),
        ),
      ),
    );
  }
}
