import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/money_format.dart';
import '../../../data/models/club_admin_dashboard_models.dart';

/// The four money KPI cards — Total Amount / Collected / Pending / Collection
/// Rate — plus a full-width collection-progress bar, mirroring the web
/// `club-admin-dashboard/membership-dues` header. Shared by the club-dashboard
/// `DuesManagementView` and the setups-list `MembershipDuesScreen` so both read
/// from a single source.
class DuesKpiCards extends StatelessWidget {
  final double totalDue;
  final double totalCollected;

  /// Members the totals cover (the "N members" subtitle on Total Amount).
  final int memberCount;
  final int paidCount;
  final int partialCount;
  final int unpaidCount;

  const DuesKpiCards({
    super.key,
    required this.totalDue,
    required this.totalCollected,
    required this.memberCount,
    required this.paidCount,
    required this.partialCount,
    required this.unpaidCount,
  });

  /// The club-dashboard shape (`/club-admin-dashboard/payments`), which carries
  /// the same six numbers under its own names.
  DuesKpiCards.fromPayments(ClubAdminPayments p, {super.key})
      : totalDue = p.totalDueInr,
        totalCollected = p.totalCollectedInr,
        memberCount = p.members.length,
        paidCount = p.paidCount,
        partialCount = p.partialCount,
        unpaidCount = p.unpaidCount;

  int get _payableCount => paidCount + partialCount + unpaidCount;
  double get _outstanding =>
      totalDue - totalCollected > 0 ? totalDue - totalCollected : 0;

  /// Amount-based collection rate (collected ÷ due), matching the web's
  /// `collectionPct = round(totalCollected / totalDue * 100)`.
  int get _amtRate =>
      totalDue > 0 ? ((totalCollected / totalDue) * 100).round() : 0;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _kpiCards(),
        const SizedBox(height: 10),
        _collectionBar(),
      ],
    );
  }

  Widget _kpiCards() {
    final n = memberCount;
    final pendingCount = unpaidCount + partialCount;
    final cards = <Widget>[
      _kpiCard(
          'Total Amount',
          fmtInrShort(totalDue),
          '${fmtInrFull(totalDue)} · $n member${n == 1 ? '' : 's'}',
          Icons.account_balance_wallet_rounded,
          AppColors.rotaryBlue),
      _kpiCard(
          'Collected',
          fmtInrShort(totalCollected),
          '${fmtInrFull(totalCollected)} · $paidCount paid',
          Icons.check_circle_rounded,
          AppColors.success),
      _kpiCard(
          'Pending',
          fmtInrShort(_outstanding),
          '${fmtInrFull(_outstanding)} · $pendingCount pending',
          Icons.error_outline_rounded,
          AppColors.error),
      _kpiCard(
          'Collection Rate',
          '$_amtRate%',
          '$paidCount/$_payableCount fully paid',
          Icons.trending_up_rounded,
          AppColors.warningDark),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      // Taller cards: the content (icon row + value + sub) is ~80px and the old
      // 1.62 ratio left only ~72px, overflowing by ~8px. The Spacer absorbs any
      // surplus height, so a roomier ratio is safe.
      childAspectRatio: 1.45,
      children: cards,
    );
  }

  /// Full-width collection-progress bar — mirrors "X of Y (pct%)" + gradient bar.
  Widget _collectionBar() {
    final rate = (_amtRate / 100.0).clamp(0.0, 1.0);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('COLLECTION PROGRESS',
                    style: AppTextStyles.caption.copyWith(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.3,
                        color: AppColors.textSecondary)),
              ),
              Text('$paidCount of $_payableCount ($_amtRate%)',
                  style: AppTextStyles.caption.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: rate,
              minHeight: 8,
              backgroundColor: AppColors.muted,
              valueColor:
                  const AlwaysStoppedAnimation<Color>(AppColors.warningDark),
            ),
          ),
        ],
      ),
    );
  }

  Widget _kpiCard(
      String title, String value, String sub, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, size: 15, color: color),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(title.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.caption.copyWith(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.3,
                      color: AppColors.textSecondary)),
            ),
          ]),
          const Spacer(),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.h4.copyWith(
                  fontSize: 21,
                  height: 1.1,
                  fontWeight: FontWeight.w800,
                  color: color)),
          Text(sub,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.caption
                  .copyWith(fontSize: 11, height: 1.1, color: AppColors.textMuted)),
        ],
      ),
    );
  }
}
