import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/i18n/live_translator.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

/// Every club of one district, for a District Admin with All Club Access (opened
/// from the "All Club Access" card in My Connections). Tapping a club borrows it
/// (AuthProvider.borrowClubFromDistrict) and opens its dashboard.
class AllClubAccessScreen extends StatefulWidget {
  final int districtId;
  final String districtNumber;
  const AllClubAccessScreen(
      {super.key, required this.districtId, required this.districtNumber});

  @override
  State<AllClubAccessScreen> createState() => _AllClubAccessScreenState();
}

class _AllClubAccessScreenState extends State<AllClubAccessScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  bool _loading = true;
  String? _error;
  List<({int id, String name})> _clubs = [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await _api.get<List<dynamic>>(
        ApiConstants.districtAllClubs(widget.districtId),
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      if (!res.isSuccess || res.data == null) {
        setState(() {
          _loading = false;
          _error = res.error ?? 'Failed to load clubs.';
        });
        return;
      }
      setState(() {
        _loading = false;
        _clubs = res.data!
            .whereType<Map<String, dynamic>>()
            .map((c) => (id: c['clubId'] as int? ?? 0, name: c['clubName']?.toString() ?? ''))
            .where((c) => c.id > 0)
            .toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = friendlyErrorMessage(e);
      });
    }
  }

  void _open(int clubId) {
    context.read<AuthProvider>().borrowClubFromDistrict(clubId, widget.districtId);
    context.push(RouteNames.clubDashboard(clubId));
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.districtNumber.isEmpty
        ? 'All Club Access'
        : 'All Club Access: ${widget.districtNumber}';
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: title),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
              decoration: InputDecoration(
                hintText: TranslationScope.of(context, 'Search clubs'),
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() => _query = '');
                        },
                      ),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
              ),
            ),
          ),
          Expanded(
            child: RowRefresh(
              color: AppColors.primary,
              onRefresh: _load,
              child: _buildBody(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const RowSkeletonList();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    final visible = _query.isEmpty
        ? _clubs
        : _clubs.where((c) => c.name.toLowerCase().contains(_query)).toList();
    if (visible.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 80),
          EmptyStateWidget(
            icon: Icons.search_off,
            title: _clubs.isEmpty ? 'No clubs' : 'No matching clubs',
            subtitle: _clubs.isEmpty ? 'This district has no clubs yet.' : 'Try a different name.',
          ),
        ],
      );
    }
    return RowListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: visible.length + 1,
      separatorBuilder: (_, i) => i == 0 ? const SizedBox.shrink() : const SizedBox(height: 8),
      itemBuilder: (_, i) {
        if (i == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              visible.length == 1 ? '1 club' : '${visible.length} clubs',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
            ),
          );
        }
        final c = visible[i - 1];
        return RowPressable(
          child: Card(
            elevation: 0,
            margin: EdgeInsets.zero,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: AppColors.border),
            ),
            color: AppColors.surface,
            child: InkWell(
              onTap: () => _open(c.id),
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.groups_outlined, color: AppColors.primary, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        c.name.isEmpty ? 'Club ${c.id}' : c.name,
                        style: AppFonts.body(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: AppColors.textMuted),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
