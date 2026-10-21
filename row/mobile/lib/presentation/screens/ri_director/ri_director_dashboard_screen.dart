import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────
class _RiContext {
  final int zoneCount;
  final int districtCount;
  final int clubCount;
  final int memberCount;
  final int emailBalance;

  const _RiContext({
    required this.zoneCount,
    required this.districtCount,
    required this.clubCount,
    required this.memberCount,
    required this.emailBalance,
  });

  factory _RiContext.fromJson(Map<String, dynamic> j) {
    final credits = (j['credits'] as Map<String, dynamic>?) ?? const {};
    return _RiContext(
      zoneCount: j['zoneCount'] as int? ?? 0,
      districtCount: j['districtCount'] as int? ?? 0,
      clubCount: j['clubCount'] as int? ?? 0,
      memberCount: j['memberCount'] as int? ?? 0,
      emailBalance: credits['emailBalance'] as int? ?? 0,
    );
  }
}

class _Module {
  final String key;
  final String label;
  final IconData icon;
  final Color color;
  const _Module(this.key, this.label, this.icon, this.color);
}

const _modules = [
  _Module('announcements', 'Announcements', Icons.campaign_outlined, AppColors.accentBlue),
  _Module('upcoming-events', 'Upcoming Events', Icons.event_outlined, AppColors.accentBlue),
  _Module('mass-emails', 'Mass Emails', Icons.mail_outline, AppColors.primaryPrime),
  _Module('weblinks', 'Web Links', Icons.link, AppColors.success),
  _Module('sub-groups', 'Sub Groups', Icons.groups_outlined, AppColors.goldDark),
  _Module('documents', 'Documents', Icons.description_outlined, AppColors.chart5),
  _Module('newsletters', 'Newsletters', Icons.newspaper_outlined, AppColors.accentBlue),
  _Module('reports', 'Reports', Icons.insert_chart_outlined, AppColors.slate700),
];

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────
class RiDirectorDashboardScreen extends StatefulWidget {
  const RiDirectorDashboardScreen({super.key});

  @override
  State<RiDirectorDashboardScreen> createState() => _RiDirectorDashboardScreenState();
}

class _RiDirectorDashboardScreenState extends State<RiDirectorDashboardScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _RiContext? _ctx;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/context',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _ctx = _RiContext.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _openModule(_Module m) {
    switch (m.key) {
      case 'announcements':
        context.push(RouteNames.riDirectorAnnouncements);
        return;
      case 'upcoming-events':
        context.push(RouteNames.riDirectorUpcomingEvents);
        return;
      case 'mass-emails':
        context.push(RouteNames.riDirectorMassEmails);
        return;
      case 'weblinks':
        context.push(RouteNames.riDirectorWeblinks);
        return;
      case 'sub-groups':
        context.push(RouteNames.riDirectorSubGroups);
        return;
      case 'documents':
        context.push(RouteNames.riDirectorDocuments);
        return;
      case 'newsletters':
        context.push(RouteNames.riDirectorNewsletters);
        return;
      case 'reports':
        context.push(RouteNames.riDirectorReports);
        return;
      default:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${m.label}: coming soon. Open the web admin to use this.'),
            duration: const Duration(seconds: 3),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'RI Director'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: _load,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildHeader(),
                        const SizedBox(height: 16),
                        _buildCredits(),
                        const SizedBox(height: 20),
                        _buildStats(),
                        const SizedBox(height: 24),
                        Text('Modules', style: AppTextStyles.h4),
                        const SizedBox(height: 10),
                        _buildModuleGrid(),
                      ],
                    ),
                  ),
                ),
    );
  }

  // ───────── Header
  Widget _buildHeader() {
    return Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(Icons.emoji_events_outlined, color: Colors.white, size: 28),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'RI Director Dashboard',
                style: AppFonts.display(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Communicate with all zones, districts & clubs',
                style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ───────── Credits
  Widget _buildCredits() {
    final c = _ctx;
    if (c == null) return const SizedBox.shrink();
    return Row(
      children: [
        Expanded(
          child: _CreditBadge(
            icon: Icons.mail_outline,
            label: 'Email',
            balance: c.emailBalance,
            color: AppColors.accentBlue,
          ),
        ),
      ],
    );
  }

  // ───────── Stats
  Widget _buildStats() {
    final c = _ctx;
    if (c == null) return const SizedBox.shrink();
    return GridView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 2.2,
      ),
      children: [
        _StatCard(icon: Icons.public, label: 'Zones', value: c.zoneCount, accent: AppColors.accentBlue),
        _StatCard(icon: Icons.location_on_outlined, label: 'Districts', value: c.districtCount, accent: AppColors.success),
        _StatCard(icon: Icons.business_outlined, label: 'Clubs', value: c.clubCount, accent: AppColors.goldDark),
        _StatCard(icon: Icons.people_outline, label: 'Members', value: c.memberCount, accent: AppColors.error),
      ],
    );
  }

  // ───────── Modules grid
  Widget _buildModuleGrid() {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _modules.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.50,
      ),
      itemBuilder: (_, i) {
        final m = _modules[i];
        return _ModuleTile(
          module: m,
          onTap: () => _openModule(m),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────
class _CreditBadge extends StatelessWidget {
  final IconData icon;
  final String label;
  final int balance;
  final Color color;
  const _CreditBadge({
    required this.icon,
    required this.label,
    required this.balance,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.white, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppTextStyles.caption.copyWith(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 11,
                    height: 1.0,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$balance',
                  style: AppFonts.display(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    height: 1.0,
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

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final int value;
  final Color accent;
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: Colors.white, size: 22),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  label,
                  style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                ),
                Text(
                  '$value',
                  style: AppFonts.display(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                    height: 1.0,
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

class _ModuleTile extends StatelessWidget {
  final _Module module;
  final VoidCallback onTap;
  const _ModuleTile({required this.module, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          padding: const EdgeInsets.all(10),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: module.color,
                  shape: BoxShape.circle,
                ),
                child: Icon(module.icon, color: Colors.white, size: 22),
              ),
              const SizedBox(height: 10),
              Text(
                module.label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.caption.copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
