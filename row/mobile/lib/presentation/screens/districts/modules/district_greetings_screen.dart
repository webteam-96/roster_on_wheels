import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/greeting_pause_notice.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_button.dart';
import '../../../widgets/common/custom_text_field.dart';

// ---------------------------------------------------------------------------
// District Greetings Settings Screen
// ---------------------------------------------------------------------------
class DistrictGreetingsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;

  const DistrictGreetingsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
  });

  @override
  State<DistrictGreetingsScreen> createState() =>
      _DistrictGreetingsScreenState();
}

class _DistrictGreetingsScreenState extends State<DistrictGreetingsScreen> {
  final _api = ApiClient();

  // Controllers
  final _birthdayGreetingCtrl = TextEditingController();
  final _anniversaryGreetingCtrl = TextEditingController();
  final _birthdayEmailSubjectCtrl = TextEditingController();
  final _birthdayEmailMessageCtrl = TextEditingController();
  final _anniversaryEmailSubjectCtrl = TextEditingController();
  final _anniversaryEmailMessageCtrl = TextEditingController();

  // Toggles
  // 1-July pause rule — server-computed, never recomputed here.
  bool _greetingPaused = false;
  String? _reviewedYearLabel;
  String? _currentYearLabel;

  bool _isEnableBirthdayNotification = false;
  bool _isEnableAnniversaryNotification = false;
  bool _isEnableBirthdayEmail = false;
  bool _isEnableAnniversaryEmail = false;

  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _birthdayGreetingCtrl.dispose();
    _anniversaryGreetingCtrl.dispose();
    _birthdayEmailSubjectCtrl.dispose();
    _birthdayEmailMessageCtrl.dispose();
    _anniversaryEmailSubjectCtrl.dispose();
    _anniversaryEmailMessageCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/greetings',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? {};
      setState(() {
        _isEnableBirthdayNotification =
            data['isEnableBirthdayNotification'] as bool? ?? false;
        _isEnableAnniversaryNotification =
            data['isEnableAnniversaryNotification'] as bool? ?? false;
        _isEnableBirthdayEmail =
            data['isEnableBirthdayEmail'] as bool? ?? false;
        _isEnableAnniversaryEmail =
            data['isEnableAnniversaryEmail'] as bool? ?? false;

        _greetingPaused = data['isGreetingPaused'] as bool? ?? false;
        _reviewedYearLabel = data['greetingReviewedYearLabel']?.toString();
        _currentYearLabel = data['currentYearLabel']?.toString();

        _birthdayGreetingCtrl.text =
            (data['birthdayGreeting'] as String?) ?? '';
        _anniversaryGreetingCtrl.text =
            (data['anniversaryGreeting'] as String?) ?? '';
        _birthdayEmailSubjectCtrl.text =
            (data['birthdayEmailSubject'] as String?) ?? '';
        _birthdayEmailMessageCtrl.text =
            (data['birthdayEmailMessage'] as String?) ?? '';
        _anniversaryEmailSubjectCtrl.text =
            (data['anniversaryEmailSubject'] as String?) ?? '';
        _anniversaryEmailMessageCtrl.text =
            (data['anniversaryEmailMessage'] as String?) ?? '';

        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      if (mounted && !e.toString().contains('(404)')) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to load greetings: $e'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  String? _nullIfEmpty(String v) {
    final t = v.trim();
    return t.isEmpty ? null : t;
  }

  void _snack(String msg, {Color? bg}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: bg ?? AppColors.error,
      ),
    );
  }

  bool _validate() {
    if (_isEnableBirthdayNotification &&
        _birthdayGreetingCtrl.text.trim().isEmpty) {
      _snack(
          'Birthday Greeting is required when Birthday Notification is enabled.');
      return false;
    }
    if (_isEnableAnniversaryNotification &&
        _anniversaryGreetingCtrl.text.trim().isEmpty) {
      _snack(
          'Anniversary Greeting is required when Anniversary Notification is enabled.');
      return false;
    }
    if (_isEnableBirthdayEmail) {
      if (_birthdayEmailSubjectCtrl.text.trim().isEmpty) {
        _snack(
            "Birthday Email 'Subject' is required when Birthday Email is enabled.");
        return false;
      }
      if (_birthdayEmailMessageCtrl.text.trim().isEmpty) {
        _snack(
            "Birthday Email 'Message' is required when Birthday Email is enabled.");
        return false;
      }
    }
    if (_isEnableAnniversaryEmail) {
      if (_anniversaryEmailSubjectCtrl.text.trim().isEmpty) {
        _snack(
            "Anniversary Email 'Subject' is required when Anniversary Email is enabled.");
        return false;
      }
      if (_anniversaryEmailMessageCtrl.text.trim().isEmpty) {
        _snack(
            "Anniversary Email 'Message' is required when Anniversary Email is enabled.");
        return false;
      }
    }
    return true;
  }

  Future<void> _save() async {
    if (!_validate()) return;
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'birthdayGreeting': _nullIfEmpty(_birthdayGreetingCtrl.text),
        'isEnableBirthdayNotification': _isEnableBirthdayNotification,
        'anniversaryGreeting': _nullIfEmpty(_anniversaryGreetingCtrl.text),
        'isEnableAnniversaryNotification': _isEnableAnniversaryNotification,
        'isGreetingSendEmail':
            _isEnableBirthdayEmail || _isEnableAnniversaryEmail,
        'isEnableBirthdayEmail': _isEnableBirthdayEmail,
        'birthdayEmailSubject': _nullIfEmpty(_birthdayEmailSubjectCtrl.text),
        'birthdayEmailMessage': _nullIfEmpty(_birthdayEmailMessageCtrl.text),
        'isEnableAnniversaryEmail': _isEnableAnniversaryEmail,
        'anniversaryEmailSubject':
            _nullIfEmpty(_anniversaryEmailSubjectCtrl.text),
        'anniversaryEmailMessage':
            _nullIfEmpty(_anniversaryEmailMessageCtrl.text),
      };

      await _api.put(
        '/api/districts/${widget.districtId}/greetings',
        body: body,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Greetings settings saved successfully'),
            backgroundColor: AppColors.success,
          ),
        );
      }

      // Saving stamps GreetingReviewedYearId server-side, which is what lifts the
      // 1-July pause — so re-read rather than clearing the flag locally, and the
      // red notice can't linger after the thing it warns about is fixed.
      if (mounted) await _load();
    } catch (e) {
      _snack('Save failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar:
          widget.embedded ? null : const CustomAppBar(title: 'Greetings Settings'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Above everything, as on web: when greetings are paused this
                  // is the ONLY thing telling the admin why nothing is going out.
                  GreetingPauseNotice(
                    paused: _greetingPaused,
                    reviewedYear: _reviewedYearLabel,
                    currentYear: _currentYearLabel,
                  ),
                  const SizedBox(height: 16),
                  _buildSection(
                    number: '1',
                    icon: Icons.notifications_active_outlined,
                    title: 'In-App Notifications',
                    child: _buildNotificationsBody(),
                  ),
                  const SizedBox(height: 16),
                  _buildSection(
                    number: '2',
                    icon: Icons.mail_outline,
                    title: 'Email Settings',
                    child: _buildEmailBody(),
                  ),
                  const SizedBox(height: 24),
                  if (canManage)
                    CustomButton(
                      label: 'Save Settings',
                      icon: Icons.send_outlined,
                      isLoading: _saving,
                      onPressed: _save,
                      fullWidth: true,
                    ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
    );
  }

  // -------------------------------------------------------------------------
  // Section wrapper
  // -------------------------------------------------------------------------
  Widget _buildSection({
    required String number,
    required IconData icon,
    required String title,
    required Widget child,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.06),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(12),
                topRight: Radius.circular(12),
              ),
              border: const Border(
                bottom: const BorderSide(color: AppColors.border),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    number,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 18, color: AppColors.primary),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: AppTextStyles.bodyMedium.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: child,
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Notifications body
  // -------------------------------------------------------------------------
  Widget _buildNotificationsBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _checkbox(
          value: _isEnableBirthdayNotification,
          label: 'Is Enable Birthday Notification?',
          onChanged: (v) =>
              setState(() => _isEnableBirthdayNotification = v ?? false),
        ),
        if (_isEnableBirthdayNotification) ...[
          const SizedBox(height: 12),
          _requiredLabel('Birthday Greeting'),
          const SizedBox(height: 6),
          _multilineField(
            controller: _birthdayGreetingCtrl,
            rows: 4,
            maxLength: 700,
          ),
          _counter(_birthdayGreetingCtrl.text.length, 700),
        ],
        const SizedBox(height: 12),
        _checkbox(
          value: _isEnableAnniversaryNotification,
          label: 'Is Enable Anniversary Notification?',
          onChanged: (v) =>
              setState(() => _isEnableAnniversaryNotification = v ?? false),
        ),
        if (_isEnableAnniversaryNotification) ...[
          const SizedBox(height: 12),
          _requiredLabel('Anniversary Greeting'),
          const SizedBox(height: 6),
          _multilineField(
            controller: _anniversaryGreetingCtrl,
            rows: 4,
            maxLength: 700,
          ),
          _counter(_anniversaryGreetingCtrl.text.length, 700),
        ],
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Email body
  // -------------------------------------------------------------------------
  Widget _buildEmailBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _emailSubCard(
          title: 'Birthday Email',
          checkboxLabel: 'Is Enable Birthday Email?',
          isEnabled: _isEnableBirthdayEmail,
          onToggle: (v) =>
              setState(() => _isEnableBirthdayEmail = v ?? false),
          subjectCtrl: _birthdayEmailSubjectCtrl,
          messageCtrl: _birthdayEmailMessageCtrl,
        ),
        const SizedBox(height: 14),
        _emailSubCard(
          title: 'Anniversary Email',
          checkboxLabel: 'Is Enable Anniversary Email?',
          isEnabled: _isEnableAnniversaryEmail,
          onToggle: (v) =>
              setState(() => _isEnableAnniversaryEmail = v ?? false),
          subjectCtrl: _anniversaryEmailSubjectCtrl,
          messageCtrl: _anniversaryEmailMessageCtrl,
        ),
      ],
    );
  }

  Widget _emailSubCard({
    required String title,
    required String checkboxLabel,
    required bool isEnabled,
    required ValueChanged<bool?> onToggle,
    required TextEditingController subjectCtrl,
    required TextEditingController messageCtrl,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: AppTextStyles.bodyMedium.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          _checkbox(
            value: isEnabled,
            label: checkboxLabel,
            onChanged: onToggle,
          ),
          if (isEnabled) ...[
            const SizedBox(height: 12),
            _requiredLabel('Subject'),
            const SizedBox(height: 6),
            CustomTextField(
              label: '',
              controller: subjectCtrl,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 10),
            _infoBanner(
              'Every email will start with: Dear Rotarian <Recipient Name>',
            ),
            const SizedBox(height: 10),
            _requiredLabel('Message'),
            const SizedBox(height: 6),
            _multilineField(
              controller: messageCtrl,
              rows: 6,
              maxLength: 10000,
            ),
            _counter(messageCtrl.text.length, 10000),
          ],
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------
  Widget _checkbox({
    required bool value,
    required String label,
    required ValueChanged<bool?> onChanged,
  }) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: Checkbox(
                value: value,
                onChanged: onChanged,
                activeColor: AppColors.primary,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(label, style: AppTextStyles.bodyMedium),
            ),
          ],
        ),
      ),
    );
  }

  Widget _requiredLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: RichText(
        text: TextSpan(
          style: AppTextStyles.bodyMedium.copyWith(
            fontWeight: FontWeight.w600,
          ),
          children: [
            TextSpan(text: text),
            const TextSpan(
              text: ' *',
              style: TextStyle(color: AppColors.error),
            ),
          ],
        ),
      ),
    );
  }

  Widget _multilineField({
    required TextEditingController controller,
    required int rows,
    required int maxLength,
  }) {
    return TextField(
      controller: controller,
      maxLines: rows,
      minLines: rows,
      maxLength: maxLength,
      onChanged: (_) => setState(() {}),
      style: AppTextStyles.bodyMedium,
      decoration: InputDecoration(
        counterText: '',
        filled: true,
        fillColor: AppColors.primary.withValues(alpha: 0.04),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(
              color: AppColors.primary.withValues(alpha: 0.5), width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.primary, width: 2),
        ),
      ),
    );
  }

  Widget _counter(int current, int max) {
    return Padding(
      padding: const EdgeInsets.only(top: 4, right: 2),
      child: Align(
        alignment: Alignment.centerRight,
        child: Text(
          '$current/$max',
          style: AppTextStyles.caption,
        ),
      ),
    );
  }

  Widget _infoBanner(String text) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.blue.shade200),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: Colors.blue.shade700),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.caption.copyWith(
                color: Colors.blue.shade900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
