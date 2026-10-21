import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../clubs/overview/widgets/club_website_tab.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

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
    setState(() { _loading = true; _error = null; });
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
              c.id != cogId &&
              !c.name.trim().toLowerCase().contains('ifrm'))
          .toList();
      setState(() {
        _clubs = clubs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
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

  /// A plain member whose club has NO website yet: show the same "Website not
  /// set up yet" card the admin sees, but without any set-up action (members
  /// can't provision a site) — just Contact support.
  void _openMemberNoWebsite(_MyClub club) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: AppColors.background,
          appBar: const CustomAppBar(title: 'My Club Website'),
          body: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(12, 16, 12, 32),
            child: WebsiteNotConfiguredCard(
              clubId: club.id,
              clubName: club.name,
              showSetup: false,
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openWebsite(_MyClub club) async {
    final raw = club.websiteUrl;
    if (raw == null || raw.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No website configured for ${club.name}.')),
      );
      return;
    }
    var url = raw.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not open $url')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My Club Websites'),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _load,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
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
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: _clubs.length + 1,
      separatorBuilder: (_, i) => i == 0 ? const SizedBox.shrink() : const SizedBox(height: 10),
      itemBuilder: (_, i) {
        if (i == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'Tap a club to open or manage its website',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
            ),
          );
        }
        final club = _clubs[i - 1];
        final hasWebsite = (club.websiteUrl ?? '').isNotEmpty;
        // Admins of THIS club manage/set up the site here; plain members just
        // open the public URL (unchanged).
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
              } else if (hasWebsite) {
                _openWebsite(club);
              } else {
                _openMemberNoWebsite(club);
              }
            },
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.business_outlined, color: AppColors.primary, size: 22),
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
                  Icon(
                    isAdmin
                        ? Icons.chevron_right_rounded
                        : (hasWebsite
                            ? Icons.open_in_new
                            : Icons.chevron_right_rounded),
                    size: isAdmin ? 24 : 20,
                    color: (isAdmin || hasWebsite)
                        ? AppColors.primary
                        : AppColors.textMuted,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
