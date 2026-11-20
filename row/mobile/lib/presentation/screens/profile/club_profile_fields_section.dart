import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Club profile fields (member flexibility): the extra questions each of the member's clubs asks, with the member's
/// answers. The API returns the fields visible to members (club admins also see admin-only fields). Read-only here:
/// club admins fill them in on the web admin.
class ClubProfileFieldsSection extends StatefulWidget {
  const ClubProfileFieldsSection({super.key, required this.memberId, required this.clubIds, this.api});
  final int memberId;
  final List<int> clubIds;
  final ApiClient? api;

  @override
  State<ClubProfileFieldsSection> createState() => _ClubProfileFieldsSectionState();
}

class _ClubProfileFieldsSectionState extends State<ClubProfileFieldsSection> {
  late final ApiClient _api = widget.api ?? ApiClient();
  List<Map<String, dynamic>>? _fields; // answered fields of every club
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _fields = null; _error = null; });
    try {
      final all = <Map<String, dynamic>>[];
      for (final clubId in widget.clubIds) {
        final res = await _api.get<List<dynamic>>(
          '/api/clubs/$clubId/members/${widget.memberId}/profile-fields',
          fromJson: (j) => j as List<dynamic>,
        );
        all.addAll((res.data ?? const [])
            .cast<Map<String, dynamic>>()
            .where((f) => (f['value'] as String?)?.isNotEmpty == true));
      }
      if (mounted) setState(() => _fields = all);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the club profile fields.');
    }
  }

  String _display(Map<String, dynamic> f) {
    final v = f['value'] as String;
    if (f['fieldType'] == 'yesno') return v == 'yes' ? 'Yes' : 'No';
    if (f['fieldType'] == 'date') {
      final d = DateTime.tryParse(v);
      if (d != null) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return '${d.day} ${months[d.month - 1]} ${d.year}';
      }
    }
    return v;
  }

  @override
  Widget build(BuildContext context) {
    if (widget.clubIds.isEmpty) return const SizedBox.shrink();
    final fields = _fields;
    // Nothing answered: leave the profile as it was.
    if (fields != null && fields.isEmpty && _error == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 8, bottom: 12),
            child: Row(children: [
              const Icon(Icons.badge_rounded, size: 18, color: AppColors.primaryPrime),
              const SizedBox(width: 8),
              Text('Club Profile', style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.textMuted)),
            ]),
          ),
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.line, width: 1),
            ),
            child: _error != null
                ? Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Row(children: [
                      Expanded(child: Text(_error!, style: AppFonts.body(fontSize: 14, color: AppColors.textSecondary))),
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ]),
                  )
                : fields == null
                    ? const Padding(
                        padding: EdgeInsets.all(AppSpacing.md),
                        child: LinearProgressIndicator(minHeight: 2),
                      )
                    : Column(
                        children: [
                          for (final f in fields)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(f['label'] as String,
                                      style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.textSecondary)),
                                  const SizedBox(height: 4),
                                  Text(_display(f),
                                      style: AppFonts.body(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
                                ],
                              ),
                            ),
                        ],
                      ),
          ),
        ],
      ),
    );
  }
}
