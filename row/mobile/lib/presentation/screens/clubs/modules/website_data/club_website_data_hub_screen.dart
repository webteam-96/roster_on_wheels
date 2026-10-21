import 'package:flutter/material.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../overview/widgets/club_website_tab.dart';

/// The club "Website Data" surface — opened from the normal club dashboard and
/// embedded in the unified dashboard.
///
/// It renders the exact same page as the overview dashboard's "My Club Website"
/// tab ([ClubWebsiteTab]) — website status, public URL (copy/visit), Banner/Ad
/// progress tiles, the Website Training card and the management grid — so the
/// two surfaces share one design and one implementation and can never diverge.
/// (The old grid-only hub UI was replaced by [ClubWebsiteTab].)
class ClubWebsiteDataHubScreen extends StatelessWidget {
  final int clubId;
  final bool embedded;
  const ClubWebsiteDataHubScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: embedded ? null : const CustomAppBar(title: 'Website Data'),
      body: ClubWebsiteTab(clubId: clubId),
    );
  }
}
