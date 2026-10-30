import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/club_dues_pay_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/club_dues_pay_models.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'club_dues_pay_screen.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Lists the district dues campaigns the signed-in officer (current-year Club
/// President / Secretary / Treasurer) may pay for. The server returns only the
/// clubs they hold office in — an empty list means there's nothing to pay.
class ClubDuesMyClubsScreen extends StatefulWidget {
  const ClubDuesMyClubsScreen({super.key});

  @override
  State<ClubDuesMyClubsScreen> createState() => _ClubDuesMyClubsScreenState();
}

class _ClubDuesMyClubsScreenState extends State<ClubDuesMyClubsScreen> {
  final _api = ClubDuesPayApi();
  List<ClubDuesPayableClub> _items = const [];
  bool _loading = true;
  String? _error;

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
      final rows = await _api.getMyClubs();
      if (!mounted) return;
      setState(() {
        _items = rows;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Could not load club dues.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Pay District Dues'),
      body: RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    if (_loading) return const LoadingWidget();
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    if (_items.isEmpty) {
      return ListView(
        children: const [
          SizedBox(height: 80),
          EmptyStateWidget(
            icon: Icons.account_balance_wallet_outlined,
            title: 'No club dues to pay',
            subtitle:
                'Only the Club President, Secretary or Treasurer can pay club '
                'dues, and only when a district campaign is active.',
          ),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: _items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) => _clubCard(_items[i]),
    );
  }

  Widget _clubCard(ClubDuesPayableClub c) {
    final subtitle = [
      if ((c.districtNumber ?? '').isNotEmpty) 'District ${c.districtNumber}',
      if ((c.rotaryYear ?? '').isNotEmpty) c.rotaryYear!,
    ].join(' · ');

    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => ClubDuesPayScreen(
              duesId: c.duesId,
              clubId: c.clubId,
              clubName: c.clubName,
            ),
          ));
        },
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryPrime.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.receipt_long_rounded,
                    color: AppColors.primaryPrime, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.clubName ?? 'Club ${c.clubId}',
                      style: AppFonts.body(
                          fontSize: 15, fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if ((c.purpose ?? '').isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        c.purpose!,
                        style: AppFonts.body(
                            fontSize: 13,
                            color: AppColors.textSecondary,
                            fontWeight: FontWeight.w500),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    if (subtitle.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: AppFonts.body(
                            fontSize: 13, color: AppColors.textMuted),
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded,
                  color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}
