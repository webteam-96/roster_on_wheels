import 'package:flutter/material.dart' hide Text;
import '../../../core/constants/feature_flags.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/member_settings_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Member self-service "Privacy & Notifications" screen.
///
/// Loads GET `/api/mobile/member-settings`, then saves each group on toggle via
/// PUT `…/privacy` (4 visibility flags) or PUT `…/notifications` (4 module flags).
/// Toggles update optimistically and revert on failure.
///
/// All 8 flags are GLOBAL per member; "My Club" vs "All Clubs" is the audience.
/// Backend read-side gating is Phase 2 — these only persist today.
class MemberSettingsScreen extends StatefulWidget {
  const MemberSettingsScreen({super.key});

  @override
  State<MemberSettingsScreen> createState() => _MemberSettingsScreenState();
}

class _MemberSettingsScreenState extends State<MemberSettingsScreen> {
  final _api = ApiClient();

  MemberSettings _settings = const MemberSettings();
  bool _loading = true;
  String? _error;
  // Disable interaction for a group while its PUT is in flight.
  bool _savingPrivacy = false;
  bool _savingNotifications = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<MemberSettings>(
        '/api/mobile/member-settings',
        fromJson: (j) => MemberSettings.fromJson(j as Map<String, dynamic>),
      );
      if (!mounted) return;
      if (resp.isSuccess && resp.data != null) {
        setState(() {
          _settings = resp.data!;
          _loading = false;
        });
      } else {
        setState(() {
          _error = resp.error ?? 'Failed to load settings';
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // ── Privacy save ──────────────────────────────────────────────────────────
  Future<void> _savePrivacy(MemberSettings next) async {
    final previous = _settings;
    setState(() {
      _settings = next; // optimistic
      _savingPrivacy = true;
    });
    try {
      final resp = await _api.put<MemberSettings>(
        '/api/mobile/member-settings/privacy',
        body: next.toPrivacyJson(),
        fromJson: (j) => MemberSettings.fromJson(j as Map<String, dynamic>),
      );
      if (!mounted) return;
      if (resp.isSuccess) {
        // Server echoes the fresh state — adopt it if present.
        setState(() => _settings = resp.data ?? next);
      } else {
        setState(() => _settings = previous);
        SnackbarUtils.showError(context, resp.error ?? 'Could not save');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _settings = previous);
      SnackbarUtils.showError(context, 'Could not save: $e');
    } finally {
      if (mounted) setState(() => _savingPrivacy = false);
    }
  }

  // ── Notifications save ────────────────────────────────────────────────────
  Future<void> _saveNotifications(MemberSettings next) async {
    final previous = _settings;
    setState(() {
      _settings = next; // optimistic
      _savingNotifications = true;
    });
    try {
      final resp = await _api.put<MemberSettings>(
        '/api/mobile/member-settings/notifications',
        body: next.toNotificationsJson(),
        fromJson: (j) => MemberSettings.fromJson(j as Map<String, dynamic>),
      );
      if (!mounted) return;
      if (resp.isSuccess) {
        setState(() => _settings = resp.data ?? next);
      } else {
        setState(() => _settings = previous);
        SnackbarUtils.showError(context, resp.error ?? 'Could not save');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _settings = previous);
      SnackbarUtils.showError(context, 'Could not save: $e');
    } finally {
      if (mounted) setState(() => _savingNotifications = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: const CustomAppBar(
        title: kNotificationPrefsEnabled ? 'Privacy & Notifications' : 'Privacy',
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);

    final s = _settings;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        // ── Privacy ───────────────────────────────────────────────────────
        _sectionHeader(
          icon: Icons.visibility_rounded,
          color: AppColors.accentBlue,
          title: 'Privacy',
          subtitle:
              'Choose who can see your phone number and email in the directory.',
        ),
        const SizedBox(height: 12),
        _card(children: [
          _switchRow(
            label: 'Show phone in my club',
            sublabel: 'Members who share a club with you',
            value: s.showPhoneInMyClub,
            enabled: !_savingPrivacy,
            onChanged: (v) => _savePrivacy(s.copyWith(showPhoneInMyClub: v)),
          ),
          _divider(),
          _switchRow(
            label: 'Show phone in all clubs',
            sublabel: 'Any member across the directory',
            value: s.showPhoneInAllClubs,
            enabled: !_savingPrivacy,
            onChanged: (v) => _savePrivacy(s.copyWith(showPhoneInAllClubs: v)),
          ),
          _divider(),
          _switchRow(
            label: 'Show email in my club',
            sublabel: 'Members who share a club with you',
            value: s.showEmailInMyClub,
            enabled: !_savingPrivacy,
            onChanged: (v) => _savePrivacy(s.copyWith(showEmailInMyClub: v)),
          ),
          _divider(),
          _switchRow(
            label: 'Show email in all clubs',
            sublabel: 'Any member across the directory',
            value: s.showEmailInAllClubs,
            enabled: !_savingPrivacy,
            onChanged: (v) => _savePrivacy(s.copyWith(showEmailInAllClubs: v)),
          ),
        ]),
        _note(
          'These apply only when your profile\'s personal details are visible. '
          'Turning a toggle off hides that detail from the chosen audience.',
        ),

        // ── Notifications ───────────────────────────────────────────────────
        // Hidden until backend push-suppression ships (kNotificationPrefsEnabled).
        // The section persists the 4 Notify* flags but no dispatcher honors them
        // yet, so it's gated out to avoid exposing toggles that suppress nothing.
        if (kNotificationPrefsEnabled) ...[
          const SizedBox(height: 24),
          _sectionHeader(
            icon: Icons.notifications_active_rounded,
            color: AppColors.accentBlue,
            title: 'Notifications',
            subtitle: 'Pick which updates you want pushed to this device.',
          ),
          const SizedBox(height: 12),
          _card(children: [
            _switchRow(
              label: 'Upcoming events',
              sublabel: 'New events and reminders',
              value: s.notifyUpcomingEvents,
              enabled: !_savingNotifications,
              onChanged: (v) =>
                  _saveNotifications(s.copyWith(notifyUpcomingEvents: v)),
            ),
            _divider(),
            _switchRow(
              label: 'Announcements',
              sublabel: 'Club and district announcements',
              value: s.notifyAnnouncements,
              enabled: !_savingNotifications,
              onChanged: (v) =>
                  _saveNotifications(s.copyWith(notifyAnnouncements: v)),
            ),
            _divider(),
            _switchRow(
              label: 'Newsletters',
              sublabel: 'New bulletins and newsletters',
              value: s.notifyNewsletters,
              enabled: !_savingNotifications,
              onChanged: (v) =>
                  _saveNotifications(s.copyWith(notifyNewsletters: v)),
            ),
            _divider(),
            _switchRow(
              label: 'Documents',
              sublabel: 'Newly shared documents',
              value: s.notifyDocuments,
              enabled: !_savingNotifications,
              onChanged: (v) =>
                  _saveNotifications(s.copyWith(notifyDocuments: v)),
            ),
          ]),
        ],
      ],
    );
  }

  // ── Building blocks ─────────────────────────────────────────────────────
  Widget _sectionHeader({
    required IconData icon,
    required Color color,
    required String title,
    required String subtitle,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 20, color: color),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: AppFonts.body(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: AppFonts.body(
                  fontSize: 12.5,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w500,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _card({required List<Widget> children}) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.lightBorder),
      ),
      child: Column(children: children),
    );
  }

  Widget _divider() => const Divider(height: 1, color: AppColors.lightBorder);

  Widget _switchRow({
    required String label,
    required String sublabel,
    required bool value,
    required bool enabled,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppFonts.body(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  sublabel,
                  style: AppFonts.body(
                    fontSize: 11.5,
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Switch.adaptive(
            value: value,
            onChanged: enabled ? onChanged : null,
            activeColor: AppColors.primaryPrime,
          ),
        ],
      ),
    );
  }

  Widget _note(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, size: 15, color: AppColors.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.caption.copyWith(
                color: AppColors.textMuted,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
