import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../clubs/overview/widgets/club_website_tab.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/loading_widget.dart';

class _MyClub {
  final int id;
  final String name;
  final String? websiteUrl;
  const _MyClub({required this.id, required this.name, this.websiteUrl});
  factory _MyClub.fromJson(Map<String, dynamic> j) => _MyClub(
        id: j['id'] as int? ?? 0,
        name: j['name']?.toString() ?? '',
        websiteUrl: j['websiteUrl']?.toString(),
      );
}

class MyClubWebsitesScreen extends StatefulWidget {
  const MyClubWebsitesScreen({super.key});

  @override
  State<MyClubWebsitesScreen> createState() => _MyClubWebsitesScreenState();
}

class _MyClubWebsitesScreenState extends State<MyClubWebsitesScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_MyClub> _clubs = const [];

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
    // COG (by id) and IFRM (by name, e.g. "IFRM 3142") are special clubs hidden
    // from this list, mirroring the home "My Clubs" card.
    final cogId = context.read<AuthProvider>().cogClubId;
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/auth/my-context',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final raw = (resp.data?['accessibleClubs'] as List<dynamic>? ?? const []);
      final clubs = raw
          .map((e) => _MyClub.fromJson(e as Map<String, dynamic>))
          .where((c) =>
              c.id != cogId && !c.name.trim().toLowerCase().contains('ifrm'))
          .toList();
      setState(() {
        _clubs = clubs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  /// Club admins manage their site here: the same reusable "My Club Website"
  /// page ([ClubWebsiteTab]) used by the club overview tab — status, Set up (if
  /// no website), Renew (if expired), the management grid and the visit link.
  void _openManage(_MyClub club) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: AppColors.background,
          appBar: const CustomAppBar(title: 'My Club Website'),
          body: ClubWebsiteTab(clubId: club.id),
        ),
      ),
    );
  }

  /// A plain member gets the same "My Club Website" page as an admin, minus the management tools:
  /// the public link (copy / visit / share), or the "not set up yet" card with Contact support.
  void _openMemberView(_MyClub club) {
    final url = (club.websiteUrl ?? '').trim();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: AppColors.background,
          appBar: const CustomAppBar(title: 'My Club Website'),
          body: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(12, 16, 12, 32),
            child: url.isEmpty
                ? WebsiteNotConfiguredCard(
                    clubId: club.id, clubName: club.name, showSetup: false)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(club.name,
                          style: AppFonts.body(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary)),
                      const SizedBox(height: 12),
                      WebsiteShareBar(
                          url: url.startsWith('http') ? url : 'https://$url'),
                      const SizedBox(height: 12),
                      Text('Club admins manage the website content.',
                          style: AppTextStyles.caption),
                    ],
                  ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My Club Websites'),
      body: RowRefresh(
        color: AppColors.primary,
        onRefresh: _load,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const LoadingWidget();
    }
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    if (_clubs.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 80),
          EmptyStateWidget(
            icon: Icons.link_off,
            title: 'No clubs',
            subtitle: 'You are not a member of any club yet.',
          ),
        ],
      );
    }
    return RowListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: _clubs.length + 1,
      separatorBuilder: (_, i) =>
          i == 0 ? const SizedBox.shrink() : const SizedBox(height: 10),
      itemBuilder: (_, i) {
        if (i == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'Tap a club to open or manage its website',
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
          );
        }
        final club = _clubs[i - 1];
        final hasWebsite = (club.websiteUrl ?? '').isNotEmpty;
        // Same page for everyone; only admins of THIS club get the management tools on it.
        final isAdmin = context.read<AuthProvider>().isClubAdminOf(club.id);

        final String subtitle;
        final Color subtitleColor;
        final FontWeight subtitleWeight;
        if (isAdmin && !hasWebsite) {
          subtitle = 'Tap to set up your website';
          subtitleColor = AppColors.primary;
          subtitleWeight = FontWeight.w600;
        } else if (hasWebsite) {
          subtitle = club.websiteUrl!;
          subtitleColor = AppColors.primary;
          subtitleWeight = FontWeight.w500;
        } else {
          subtitle = 'No website configured';
          subtitleColor = AppColors.textMuted;
          subtitleWeight = FontWeight.w400;
        }

        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppColors.border),
          ),
          color: AppColors.surface,
          child: InkWell(
            onTap: () {
              if (isAdmin) {
                _openManage(club);
              } else {
                _openMemberView(club);
              }
            },
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.business_outlined,
                        color: AppColors.primary, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          club.name,
                          style: AppFonts.body(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          subtitle,
                          style: AppTextStyles.caption.copyWith(
                            color: subtitleColor,
                            fontWeight: subtitleWeight,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.chevron_right_rounded,
                      size: 24, color: AppColors.primary),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
