import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/rotary_year_bar.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _Theme {
  final int id;
  final String name;
  final String? imagePath;
  const _Theme({required this.id, required this.name, this.imagePath});

  factory _Theme.fromJson(Map<String, dynamic> j) => _Theme(
        id: (j['id'] as int?) ?? 0,
        name: (j['name'] ?? j['themeName'] ?? 'Theme ${j['id']}').toString(),
        imagePath: j['themeImagePath']?.toString(),
      );
}

class ClubWebsiteThemeScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteThemeScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteThemeScreen> createState() => _ClubWebsiteThemeScreenState();
}

class _ClubWebsiteThemeScreenState extends State<ClubWebsiteThemeScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  bool _saving = false;

  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  List<_Theme> _themes = [];
  int? _selectedThemeId;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      final yearsResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (yearsResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      final themesResp = await _api.get<List<dynamic>>(
        '/api/themes',
        fromJson: (j) => j as List<dynamic>,
      );
      final raw = (themesResp.data ?? []).cast<Map<String, dynamic>>();
      // Dedupe by id and skip entries without an int id (Dropdown asserts unique values)
      final seen = <int>{};
      final themes = <_Theme>[];
      for (final t in raw) {
        final id = t['id'];
        if (id is int && seen.add(id)) themes.add(_Theme.fromJson(t));
      }
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
      );
      setState(() {
        _years = years;
        _themes = themes;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) await _fetchSavedTheme(_selectedYearId!);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchSavedTheme(int yearId) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/theme',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data;
      if (data != null) {
        final tid = data['themeId'] as int?;
        // Clear if saved theme isn't in current themes list
        setState(() => _selectedThemeId =
            (tid != null && _themes.any((t) => t.id == tid)) ? tid : null);
      } else {
        setState(() => _selectedThemeId = null);
      }
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() => _selectedThemeId = null);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: ${e.message}')));
      }
    } catch (_) {
      setState(() => _selectedThemeId = null);
    }
  }

  Future<void> _save() async {
    if (_selectedYearId == null) {
      _showError('Please select a year');
      return;
    }
    if (_selectedThemeId == null) {
      _showError('Please select a theme');
      return;
    }
    setState(() => _saving = true);
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/theme',
        body: {'yearId': _selectedYearId, 'themeId': _selectedThemeId},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Theme saved'), backgroundColor: AppColors.success),
        );
      }
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

  /// Placeholder thumbnail shown inside a theme card when the theme has no
  /// image, or when image loading fails.
  Widget _themePlaceholder() {
    return Container(
      color: AppColors.muted,
      alignment: Alignment.center,
      child: const Icon(Icons.palette_outlined, size: 36, color: AppColors.textSecondary),
    );
  }

  String? get _previewImagePath {
    if (_selectedThemeId == null) return null;
    final t = _themes.firstWhere(
      (t) => t.id == _selectedThemeId,
      orElse: () => const _Theme(id: 0, name: ''),
    );
    return t.imagePath;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isClubAdminOf(widget.clubId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Theme'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!, style: AppTextStyles.body.copyWith(color: AppColors.error)),
                )
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    final preview = _previewImagePath;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_years.isNotEmpty) ...[
            RotaryYearBar<int>(
              value: _selectedYearId,
              margin: EdgeInsets.zero,
              options: [
                for (final y in _years)
                  RotaryYearOption(value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: _saving
                  ? null
                  : (v) {
                      setState(() => _selectedYearId = v);
                      if (v != null) _fetchSavedTheme(v);
                    },
            ),
            const SizedBox(height: 16),
          ],
          Text(
            'Available Themes (${_themes.length})',
            style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          if (_themes.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 24),
              decoration: BoxDecoration(
                color: AppColors.muted,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              alignment: Alignment.center,
              child: Text(
                'No themes available yet.',
                style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
              ),
            )
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 0.95,
              ),
              itemCount: _themes.length,
              itemBuilder: (_, i) {
                final t = _themes[i];
                final selected = t.id == _selectedThemeId;
                return InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: _saving || !canManage
                      ? null
                      : () => setState(() => _selectedThemeId = t.id),
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: selected ? AppColors.primary : AppColors.border,
                        width: selected ? 2 : 1,
                      ),
                      color: AppColors.surface,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(9)),
                            child: (t.imagePath != null && t.imagePath!.isNotEmpty)
                                ? Image.network(
                                    ApiConstants.mediaUrl(t.imagePath!),
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => _themePlaceholder(),
                                  )
                                : _themePlaceholder(),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  t.name,
                                  style: AppTextStyles.bodyMedium.copyWith(
                                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                                    color: selected ? AppColors.primary : AppColors.textPrimary,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (selected)
                                const Icon(Icons.check_circle, size: 18, color: AppColors.primary),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          const SizedBox(height: 16),
          if (preview != null && preview.isNotEmpty) ...[
            Text('Preview', style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                ApiConstants.mediaUrl(preview),
                width: double.infinity,
                height: 220,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => Container(
                  width: double.infinity,
                  height: 220,
                  color: AppColors.muted,
                  alignment: Alignment.center,
                  child: Text('No preview image available',
                      style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                ),
              ),
            ),
          ],
          const SizedBox(height: 24),
          if (canManage)
            CustomButton(
              label: 'Save Theme',
              onPressed: _saving ? null : _save,
              isLoading: _saving,
            ),
        ],
      ),
    );
  }
}
