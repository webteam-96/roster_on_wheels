import 'package:flutter/material.dart';
import '../../modules/membership_dues/membership_dues_screen.dart';

/// "Membership Dues" tab on the Club Overview (analytics) dashboard.
///
/// Renders the SAME page as the normal club dashboard's Membership Dues module:
/// the unified setups list (`MembershipDuesScreen`) — KPI cards plus a card per
/// dues setup (View / Copy-URL / Report / Report-Link / Sheet), drilling into a
/// setup's member editor from there. Embedded so it shows body-only (the overview
/// already supplies its own app bar + tab bar). `MembershipDuesScreen` manages its
/// own year filter, so the overview's selected year is not threaded in here.
class ClubDuesTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubDuesTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubDuesTab> createState() => _ClubDuesTabState();
}

class _ClubDuesTabState extends State<ClubDuesTab>
    with AutomaticKeepAliveClientMixin<ClubDuesTab> {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return MembershipDuesScreen(
      clubId: widget.clubId,
      embedded: true,
    );
  }
}
