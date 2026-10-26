import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../widgets/common/greeting_pause_notice.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class GreetingsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const GreetingsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<GreetingsScreen> createState() => _GreetingsScreenState();
}

class _GreetingsScreenState extends State<GreetingsScreen> {
  bool get _canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  bool _loading = true;
  bool _saving = false;

  // 1-July pause rule — server-computed, never recomputed here.
  bool _greetingPaused = false;
  String? _reviewedYearLabel;
  String? _currentYearLabel;

  // Toggles
  bool _isBirthdayEnabled = false;
  bool _isAnniversaryEnabled = false;
  bool _isEnableBirthdayEmail = false;
  bool _isEnableAnniversaryEmail = false;

  // Controllers
  final _birthdayGreetingCtrl = TextEditingController();
  final _anniversaryGreetingCtrl = TextEditingController();
  final _birthdayEmailSubjectCtrl = TextEditingController();
  final _birthdayEmailMessageCtrl = TextEditingController();
  final _anniversaryEmailSubjectCtrl = TextEditingController();
  final _anniversaryEmailMessageCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadGreetings();
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

  Future<void> _loadGreetings() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/greetings',
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        final data = resp.data as Map<String, dynamic>;
        setState(() {
          _isBirthdayEnabled = (data['isEnableBirthdayNotification'] ?? data['isBirthdayEnabled']) as bool? ?? false;
          _isAnniversaryEnabled = (data['isEnableAnniversaryNotification'] ?? data['isAnniversaryEnabled']) as bool? ?? false;
          _isEnableBirthdayEmail = data['isEnableBirthdayEmail'] as bool? ?? false;
          _isEnableAnniversaryEmail = data['isEnableAnniversaryEmail'] as bool? ?? false;

          _greetingPaused = data['isGreetingPaused'] as bool? ?? false;
          _reviewedYearLabel = data['greetingReviewedYearLabel']?.toString();
          _currentYearLabel = data['currentYearLabel']?.toString();

          _birthdayGreetingCtrl.text = data['birthdayGreeting']?.toString() ?? '';
          _anniversaryGreetingCtrl.text = data['anniversaryGreeting']?.toString() ?? '';
          _birthdayEmailSubjectCtrl.text = data['birthdayEmailSubject']?.toString() ?? '';
          _birthdayEmailMessageCtrl.text = data['birthdayEmailMessage']?.toString() ?? '';
          _anniversaryEmailSubjectCtrl.text = data['anniversaryEmailSubject']?.toString() ?? '';
          _anniversaryEmailMessageCtrl.text = data['anniversaryEmailMessage']?.toString() ?? '';
        });
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load greetings settings');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Returns trimmed text or null if empty (spec: `.trim() || null`).
  String? _trimOrNull(TextEditingController c) {
    final v = c.text.trim();
    return v.isEmpty ? null : v;
  }

  Future<void> _saveGreetings() async {
    if (!(_formKey.currentState?.validate() ?? true)) return;
    setState(() => _saving = true);
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/greetings',
        body: {
          'isEnableBirthdayNotification': _isBirthdayEnabled,
          'isEnableAnniversaryNotification': _isAnniversaryEnabled,
          'birthdayGreeting': _trimOrNull(_birthdayGreetingCtrl),
          'anniversaryGreeting': _trimOrNull(_anniversaryGreetingCtrl),
          'isEnableBirthdayEmail': _isEnableBirthdayEmail,
          'birthdayEmailSubject': _trimOrNull(_birthdayEmailSubjectCtrl),
          'birthdayEmailMessage': _trimOrNull(_birthdayEmailMessageCtrl),
          'isEnableAnniversaryEmail': _isEnableAnniversaryEmail,
          'anniversaryEmailSubject': _trimOrNull(_anniversaryEmailSubjectCtrl),
          'anniversaryEmailMessage': _trimOrNull(_anniversaryEmailMessageCtrl),
        },
      );
      if (mounted) SnackbarUtils.showSuccess(context, 'Greetings settings saved');
      // Saving stamps GreetingReviewedYearId server-side, which is what lifts the
      // 1-July pause — so re-read rather than clearing the flag locally, and the
      // red notice can't linger after the thing it warns about is fixed.
      if (mounted) await _loadGreetings();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save settings');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = _canManage;
    return Scaffold(
      appBar: widget.embedded
          ? null
          : CustomAppBar(
              title: 'Greetings Settings',
              actions: [
                if (canManage)
                  TextButton(
                    onPressed: _saving || _loading ? null : _saveGreetings,
                    child: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Save',
                            style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                                fontSize: 15)),
                  ),
              ],
            ),
      body: _loading
          ? const LoadingWidget()
          : RefreshIndicator(
              onRefresh: _loadGreetings,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Above everything, as on web: when greetings are paused
                      // this is the ONLY thing telling the admin why nothing is
                      // going out.
                      GreetingPauseNotice(
                        paused: _greetingPaused,
                        reviewedYear: _reviewedYearLabel,
                        currentYear: _currentYearLabel,
                      ),
                      const SizedBox(height: 16),
                      _buildBirthdayCard(canManage),
                      const SizedBox(height: 16),
                      _buildAnniversaryCard(canManage),
                      const SizedBox(height: 24),
                      if (canManage)
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed: _saving ? null : _saveGreetings,
                            icon: _saving
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                    ),
                                  )
                                : const Icon(Icons.save),
                            label: const Text('Save Settings'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                          ),
                        ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
    );
  }


  Widget _buildBirthdayCard(bool canManage) {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionTitle('Birthday'),
          const SizedBox(height: 12),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: _isBirthdayEnabled,
            activeColor: AppColors.primary,
            onChanged: canManage
                ? (v) => setState(() => _isBirthdayEnabled = v)
                : null,
            title: Text('Enable Birthday Greeting', style: AppTextStyles.body),
            subtitle: Text(
              'Send automated birthday greetings to members',
              style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
            ),
            secondary: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.pink.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.cake, color: Colors.pink, size: 24),
            ),
          ),
          if (_isBirthdayEnabled) ...[
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Birthday Greeting',
              hint: 'Happy Birthday, {name}! Wishing you joy...',
              controller: _birthdayGreetingCtrl,
              maxLines: 4,
              maxLength: 700,
              readOnly: !canManage,
              validator: (v) => _isBirthdayEnabled && (v == null || v.trim().isEmpty)
                  ? 'Required when birthday notification is enabled'
                  : null,
            ),
          ],
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 8),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: _isEnableBirthdayEmail,
            activeColor: AppColors.primary,
            onChanged: canManage
                ? (v) => setState(() => _isEnableBirthdayEmail = v)
                : null,
            title: Text('Send Birthday Email', style: AppTextStyles.body),
            subtitle: Text(
              'Also deliver birthday greetings via email',
              style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
            ),
            secondary: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.email, color: Colors.blue, size: 24),
            ),
          ),
          if (_isEnableBirthdayEmail) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.06),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: Colors.blue.shade700),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Every email will start with: Dear Rotarian <Recipient Name>',
                      style: AppTextStyles.caption.copyWith(color: Colors.blue.shade700),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Subject',
              hint: 'Happy Birthday!',
              controller: _birthdayEmailSubjectCtrl,
              readOnly: !canManage,
              validator: (v) => _isEnableBirthdayEmail && (v == null || v.trim().isEmpty)
                  ? 'Required when birthday email is enabled'
                  : null,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Message',
              hint: 'Dear Rotarian, ...',
              controller: _birthdayEmailMessageCtrl,
              maxLines: 6,
              maxLength: 10000,
              readOnly: !canManage,
              validator: (v) => _isEnableBirthdayEmail && (v == null || v.trim().isEmpty)
                  ? 'Required when birthday email is enabled'
                  : null,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAnniversaryCard(bool canManage) {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionTitle('Anniversary'),
          const SizedBox(height: 12),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: _isAnniversaryEnabled,
            activeColor: AppColors.primary,
            onChanged: canManage
                ? (v) => setState(() => _isAnniversaryEnabled = v)
                : null,
            title: Text('Enable Anniversary Greeting', style: AppTextStyles.body),
            subtitle: Text(
              'Send automated anniversary greetings to members',
              style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
            ),
            secondary: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.favorite, color: Colors.red, size: 24),
            ),
          ),
          if (_isAnniversaryEnabled) ...[
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Anniversary Greeting',
              hint: 'Happy Anniversary, {name}! Wishing you...',
              controller: _anniversaryGreetingCtrl,
              maxLines: 4,
              maxLength: 700,
              readOnly: !canManage,
              validator: (v) => _isAnniversaryEnabled && (v == null || v.trim().isEmpty)
                  ? 'Required when anniversary notification is enabled'
                  : null,
            ),
          ],
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 8),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: _isEnableAnniversaryEmail,
            activeColor: AppColors.primary,
            onChanged: canManage
                ? (v) => setState(() => _isEnableAnniversaryEmail = v)
                : null,
            title: Text('Send Anniversary Email', style: AppTextStyles.body),
            subtitle: Text(
              'Also deliver anniversary greetings via email',
              style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
            ),
            secondary: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.email, color: Colors.blue, size: 24),
            ),
          ),
          if (_isEnableAnniversaryEmail) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.06),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: Colors.blue.shade700),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Every email will start with: Dear Rotarian <Recipient Name>',
                      style: AppTextStyles.caption.copyWith(color: Colors.blue.shade700),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Subject',
              hint: 'Happy Anniversary!',
              controller: _anniversaryEmailSubjectCtrl,
              readOnly: !canManage,
              validator: (v) => _isEnableAnniversaryEmail && (v == null || v.trim().isEmpty)
                  ? 'Required when anniversary email is enabled'
                  : null,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Message',
              hint: 'Dear Rotarian, ...',
              controller: _anniversaryEmailMessageCtrl,
              maxLines: 6,
              maxLength: 10000,
              readOnly: !canManage,
              validator: (v) => _isEnableAnniversaryEmail && (v == null || v.trim().isEmpty)
                  ? 'Required when anniversary email is enabled'
                  : null,
            ),
          ],
        ],
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    );
  }

  Widget _sectionTitle(String title) => Row(
        children: [
          Container(
            width: 4,
            height: 20,
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(title, style: AppTextStyles.h3),
        ],
      );
}
